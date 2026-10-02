import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { assertConnectedToE2eDatabase, prismaTest } from "../lib/prisma-test";

/**
 * Resolução de identidades da importação (lib/identidade-importacao.ts) contra o PostgreSQL E2E:
 * vínculo por alias (mecanismo oficial ProfissionalAlias), idempotência, nunca dois fornecedores
 * para o mesmo nome, resíduo de parser recusado, código canônico intocado, auditoria, e a
 * reimportação (resolver do ETL em Python) reconhecendo o alias. Fixtures sintéticas, removidas
 * no finally.
 */
async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const svc = await import("../lib/identidade-importacao");
  const { resolverIdentidadeOperacional } = await import("../lib/profissional-identidade");

  const S = randomUUID().slice(0, 6).toUpperCase().replace(/\d/g, "X");
  const alfa = `FORNECEDOR ALFA SINTETICO ${S}`;
  const beta = `FORNECEDOR BETA SINTETICO ${S}`;
  const inativo = `FORNECEDOR INATIVO SINTETICO ${S}`;
  const acentuado = `JOSE ACENTO ${S}`;
  const ids: string[] = [];
  const cadastroIds: string[] = [];
  const admin = await prismaTest.usuario.create({
    data: { usuario: `PI${randomUUID().slice(0, 6)}`, nome: `ADMIN IDENTIDADE ${S}`, senhaHash: "x", perfil: "ADMIN" },
  });
  const quem = { id: admin.id, usuario: admin.usuario, nome: admin.nome };
  try {
    const mk = async (codigo: string, ativo = true, razao = `${codigo} LTDA`) => {
      const p = await prismaTest.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: codigo } });
      const c = await prismaTest.cadastroFornecedor.create({
        data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigo, responsavel: codigo, razaoSocial: razao, ativo, rawPayload: {} },
      });
      ids.push(p.id);
      cadastroIds.push(c.id);
      return p;
    };
    const pAlfa = await mk(alfa, true, `ALFA RAZAO ${S} LTDA`);
    const pBeta = await mk(beta);
    const pInativo = await mk(inativo, false);
    const pAcento = await mk(acentuado);

    const apelido = `ALFA APELIDO ${S}`;
    const antes = await prismaTest.profissional.findUniqueOrThrow({ where: { id: pAlfa.id } });

    // A — verificar: nome inédito pendente; sugestão (rótulo do ETL) mapeia para UM fornecedor
    const [v] = await svc.verificarIdentidades([apelido]);
    assert.equal(v.resolucao.status, "NAO_RESOLVIDO");
    const sugestoes = await svc.alvosDasSugestoes([alfa, `NAO EXISTE ${S}`]);
    assert.equal(sugestoes[alfa]?.profissionalId, pAlfa.id);
    assert.equal(sugestoes[`NAO EXISTE ${S}`], null);
    // mesmo nome com acento diferente → sugestão por igualdade normalizada (nunca aplicada)
    const [vAcento] = await svc.verificarIdentidades([`JOSÉ ACENTO ${S}`]);
    assert.equal(vAcento.resolucao.status, "NAO_RESOLVIDO");
    assert.equal(vAcento.mesmoNomeNormalizado?.profissionalId, pAcento.id);
    // Nada foi gravado pelas leituras
    assert.equal(await prismaTest.profissionalAlias.count({ where: { profissionalId: { in: ids } } }), 0);

    // B — busca por nome, código e razão social; inativo nunca aparece
    assert.ok((await svc.buscarFornecedores(`alfa sintetico ${S}`)).some((f) => f.profissionalId === pAlfa.id));
    assert.ok((await svc.buscarFornecedores(`ALFA RAZAO ${S}`)).some((f) => f.profissionalId === pAlfa.id));
    assert.ok(!(await svc.buscarFornecedores(inativo)).some((f) => f.profissionalId === pInativo.id));
    assert.deepEqual(await svc.buscarFornecedores("a"), []);

    // C — vincular cria alias oficial + auditoria; código/nome canônico intocados
    const criado = await svc.criarAliasImportacao({ alias: apelido, profissionalId: pAlfa.id, aba: "Documentos", ciclo: "2804", linhas: [12, 13] }, quem);
    assert.equal(criado.status, "CRIADO");
    assert.equal(criado.codigoCanonico, alfa);
    const alias = await prismaTest.profissionalAlias.findUniqueOrThrow({ where: { id: criado.aliasId } });
    assert.equal(alias.origem, "DOCUMENTOS");
    assert.equal(alias.ativo, true);
    assert.equal(alias.createdById, admin.id);
    const depois = await prismaTest.profissional.findUniqueOrThrow({ where: { id: pAlfa.id } });
    assert.deepEqual({ codigo: depois.codigo, nome: depois.nome, nomeCompleto: depois.nomeCompleto }, { codigo: antes.codigo, nome: antes.nome, nomeCompleto: antes.nomeCompleto });
    const log = await prismaTest.adminAuditLog.findFirst({ where: { action: "PROFISSIONAL_ALIAS_CRIADO", targetId: pAlfa.id } });
    assert.equal((log?.metadata as { aliasId?: string } | null)?.aliasId, criado.aliasId);
    assert.deepEqual(await resolverIdentidadeOperacional(apelido), { status: "RESOLVIDO", via: "ALIAS", profissionalId: pAlfa.id, codigoCanonico: alfa });

    // D — idempotente: repetir devolve JA_EXISTE, sem segundo registro/log
    const repetido = await svc.criarAliasImportacao({ alias: apelido.toLowerCase(), profissionalId: pAlfa.id }, quem);
    assert.equal(repetido.status, "JA_EXISTE");
    assert.equal(await prismaTest.profissionalAlias.count({ where: { profissionalId: pAlfa.id } }), 1);

    // E — o mesmo nome nunca aponta para dois fornecedores
    await assert.rejects(svc.criarAliasImportacao({ alias: apelido, profissionalId: pBeta.id }, quem), (e: Error & { status?: number }) => e.status === 409);
    // nome que é o código de OUTRA identidade
    await assert.rejects(svc.criarAliasImportacao({ alias: beta, profissionalId: pAlfa.id }, quem), (e: Error & { status?: number }) => e.status === 409);
    // ...nem com variação de caixa/acento/pontuação
    await assert.rejects(svc.criarAliasImportacao({ alias: `fornecedor. beta sintético ${S}`, profissionalId: pAlfa.id }, quem), (e: Error & { status?: number }) => e.status === 409);

    // F — duplo clique concorrente: um cria, o outro vê JA_EXISTE (lock por nome)
    const concorrente = `ALFA CONCORRENTE ${S}`;
    const resultados = await Promise.all([1, 2, 3].map(() => svc.criarAliasImportacao({ alias: concorrente, profissionalId: pAlfa.id }, quem)));
    assert.deepEqual(resultados.map((r) => r.status).sort(), ["CRIADO", "JA_EXISTE", "JA_EXISTE"]);
    // concorrência entre DOIS alvos: no máximo um vence
    const disputado = `NOME DISPUTADO ${S}`;
    const disputa = await Promise.allSettled([svc.criarAliasImportacao({ alias: disputado, profissionalId: pAlfa.id }, quem), svc.criarAliasImportacao({ alias: disputado, profissionalId: pBeta.id }, quem)]);
    assert.equal(disputa.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(new Set((await prismaTest.profissionalAlias.findMany({ where: { aliasNormalizado: disputado, ativo: true } })).map((a) => a.profissionalId)).size, 1);

    // G — resíduo de parser e destinos inválidos são recusados (nada gravado)
    for (const lixo of ["GRD-T-SINT-SA-2026-0001-0001", "ORC-SINT-0001", "HORAS DE ESTUDO PARA ADEQUACAO DO PROJETO DE TUBULACAO DA AREA"]) {
      await assert.rejects(svc.criarAliasImportacao({ alias: lixo, profissionalId: pAlfa.id }, quem), (e: Error & { status?: number }) => e.status === 400, lixo);
    }
    await assert.rejects(svc.criarAliasImportacao({ alias: `OUTRO NOME ${S}`, profissionalId: pInativo.id }, quem), (e: Error & { status?: number }) => e.status === 409);
    await assert.rejects(svc.criarAliasImportacao({ alias: `OUTRO NOME ${S}`, profissionalId: randomUUID() }, quem), (e: Error & { status?: number }) => e.status === 404);
    await assert.rejects(svc.criarAliasImportacao({ alias: "   ", profissionalId: pAlfa.id }, quem), (e: Error & { status?: number }) => e.status === 400);
    // nome que já resolve pelo próprio código do alvo: nada a gravar
    assert.equal((await svc.criarAliasImportacao({ alias: alfa.toLowerCase(), profissionalId: pAlfa.id }, quem)).status, "JA_EXISTE");
    // variação com acento do próprio alvo vira alias (explícito) e passa a resolver
    assert.equal((await svc.criarAliasImportacao({ alias: `JOSÉ ACENTO ${S}`, profissionalId: pAcento.id, aba: "Documentos Auxiliares" }, quem)).status, "CRIADO");
    assert.equal((await prismaTest.profissionalAlias.findFirstOrThrow({ where: { profissionalId: pAcento.id } })).origem, "DOCUMENTOS_AUXILIARES");
    assert.equal(await prismaTest.profissionalAlias.count({ where: { profissionalId: pInativo.id } }), 0);

    // H — reimportação: o resolver do ETL (Python) lê os aliases e o preflight passa
    const url = process.env.DATABASE_URL_TEST!;
    const etlUrl = url.replace(/^postgres(ql)?:\/\//, "postgresql+psycopg://").replace(/\?.*$/, "");
    const py = [
      "import json, sys, pandas as pd",
      "from sqlalchemy import create_engine",
      "from ingest_medicoes import OperationalIdentityResolver, assert_operational_identities_resolved, UnresolvedIdentityError",
      "from test_negative_measurement_validation import normal_row",
      "nomes = json.loads(sys.argv[1])",
      "engine = create_engine(sys.argv[2])",
      "with engine.connect() as conn:",
      "    r = OperationalIdentityResolver.load(conn)",
      "df = pd.DataFrame([normal_row(PROJETISTA=n) for n in nomes['ok']])",
      "s = assert_operational_identities_resolved(df, pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), set(), {}, {}, '2804', r, {}, 'Documentos', None, None, None)",
      "print('RESOLVIDO', json.dumps(s['identidades_por_via'], sort_keys=True))",
      "try:",
      "    assert_operational_identities_resolved(pd.DataFrame([normal_row(PROJETISTA=nomes['pendente'])]), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), set(), {}, {}, '2804', r, {}, 'Documentos', None, None, None)",
      "    print('NAO_BLOQUEOU')",
      "except UnresolvedIdentityError as e:",
      "    print('BLOQUEOU', e.details[0]['valor'])",
    ].join("\n");
    const saida = execFileSync(process.env.PYTHON ?? "python", ["-c", py, JSON.stringify({ ok: [apelido, `josé acento ${S}`, alfa], pendente: `PENDENTE ${S}` }), etlUrl], {
      cwd: path.join(__dirname, "..", "etl"), encoding: "utf8", timeout: 60000, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    assert.match(saida, /RESOLVIDO \{"ALIAS": 2, "CODIGO": 1\}/);
    assert.match(saida, new RegExp(`BLOQUEOU PENDENTE ${S}`));

    console.log("PASS: resolução de identidades da importação (verificar, sugestão, busca, alias oficial, idempotência, conflito, concorrência, resíduo recusado, auditoria, reimportação no ETL).");
  } finally {
    await prismaTest.adminAuditLog.deleteMany({ where: { adminId: admin.id } });
    await prismaTest.cadastroFornecedor.deleteMany({ where: { id: { in: cadastroIds } } });
    await prismaTest.profissional.deleteMany({ where: { id: { in: ids } } }); // aliases em cascata
    await prismaTest.usuario.delete({ where: { id: admin.id } });
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
