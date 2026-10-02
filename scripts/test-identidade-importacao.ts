import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Identidades pendentes da importação (lib/identidade-importacao.ts) contra o PostgreSQL E2E:
 * pendente no ciclo e no total, BM bloqueado no backend (sem efeito colateral), vínculo sem
 * reimportar (valores intocados, alias global, BM liberado), descarte do ciclo (sai do total,
 * auditado), descarte de linha estrutural, concorrência (vínculo × vínculo, vínculo × descarte) e
 * reimportação futura reconhecendo o alias no resolver do ETL (Python). Fixtures sintéticas.
 */
process.env.ALLOW_E2E_DATABASE = "true";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FAKE_PROVIDER = "true";
process.env.EMAIL_TEST_MODE = "true";
process.env.EMAIL_TEST_RECIPIENT = "e2e-test-recipient@example.test";
process.env.APP_URL = "https://e2e-test.example.test";
process.env.RESEND_FROM_EMAIL = "En Passant <e2e@example.test>";

type Status = { status?: number };
const comStatus = (status: number) => (e: Error & Status) => e.status === status;

async function main() {
  const { prismaTest, assertConnectedToE2eDatabase } = require("../lib/prisma-test");
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const svc = require("../lib/identidade-importacao") as typeof import("../lib/identidade-importacao");
  const { resolverIdentidadeOperacional } = require("../lib/profissional-identidade") as typeof import("../lib/profissional-identidade");
  const { enviarBoletimFornecedor } = require("../lib/bm-envio") as typeof import("../lib/bm-envio");
  Module._load = originalLoad;

  const S = randomUUID().replace(/[^a-f]/g, "").slice(0, 6).toUpperCase().padEnd(6, "X");
  const ciclo = "2809"; // ciclo real (YYMM) exclusivo deste script
  const resolvido = `FORNECEDOR RESOLVIDO ${S}`;
  const canonico = `OTAVIO ${S} DE SOUZA LUZ`;
  const enviado = `FORNECEDOR ENVIADO ${S}`;
  const pendente = `OTAVIO ${S} LUZ`;
  const outro = `CARLOS ${S} NUNES`;
  const disputa = `DISPUTA ${S} NOME`;
  // Usuário real (logs do BM referenciam usuarios.id): o ADMIN do seed E2E.
  const admin = await prismaTest.usuario.findFirstOrThrow({ where: { perfil: "ADMIN", excluidoAt: null }, select: { id: true, usuario: true, nome: true } });
  const inicio = new Date();
  const autor = { id: admin.id, usuario: admin.usuario, nome: admin.nome };
  const profIds: string[] = [];

  const somaMapa = async () => Number((await prismaTest.mapaPagamentoItem.aggregate({ where: { ciclo }, _sum: { valor: true } }))._sum.valor ?? 0);
  const somaMedicoes = async () => Number((await prismaTest.medicao.aggregate({ where: { ciclo }, _sum: { valorMedicao: true } }))._sum.valorMedicao ?? 0);

  try {
    const projeto = await prismaTest.projeto.upsert({ where: { codigoProjeto: `PRJ-IDENT-${S}` }, create: { codigoProjeto: `PRJ-IDENT-${S}`, contrato: "SALOBO" }, update: {} });
    const prof = async (codigo: string) => {
      const p = await prismaTest.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: codigo } });
      await prismaTest.cadastroFornecedor.create({ data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigo, responsavel: codigo, razaoSocial: `${codigo} LTDA`, email: `${codigo.replace(/\s+/g, "-").toLowerCase()}@example.test`, rawPayload: {} } });
      profIds.push(p.id);
      return p;
    };
    const pResolvido = await prof(resolvido);
    const pCanonico = await prof(canonico);
    const pEnviado = await prof(enviado);

    let ordem = 0;
    const medicao = (valor: number, extra: Record<string, unknown>) => prismaTest.medicao.create({
      data: { numeroMedicao: "BM01", idProjeto: projeto.id, ciclo, numeroDocumento: `DOC-${S}-${++ordem}`, valorMedicao: valor, sourceRowHash: `ident-${S}-${ordem}`, ...extra },
    });
    const mapa = (codigo: string, valor: number, identidadeImportacaoId: string | null = null) => prismaTest.mapaPagamentoItem.create({
      data: { ciclo, ordem: ++ordem, projetistaCodigo: codigo, responsavel: codigo, valor, sourceRowHash: `ident-mapa-${S}-${ordem}`, identidadeImportacaoId },
    });
    const pendencia = (valorBruto: string, ocorrencias: number) => prismaTest.importacaoIdentidade.create({
      data: { ciclo, tipo: "IDENTIDADE", chave: valorBruto, valorBruto, origem: "Documentos", status: "PENDENTE", ocorrencias, linhas: [10, 11], metadata: { sugestoesCadastro: [canonico] } },
    });

    // Estado que o ETL grava: A resolvido (100), B pendente (30+20), C pendente (30).
    await medicao(100, { idProfissional: pResolvido.id });
    await mapa(resolvido, 100);
    const idB = await pendencia(pendente, 2);
    await medicao(30, { identidadeImportacaoId: idB.id });
    await medicao(20, { identidadeImportacaoId: idB.id });
    await mapa(pendente, 50, idB.id);
    const idC = await pendencia(outro, 1);
    await medicao(30, { identidadeImportacaoId: idC.id });
    await mapa(outro, 30, idC.id);
    assert.equal(await somaMapa(), 180);

    // ─── listagem ───
    const lista = await svc.listarIdentidadesDoCiclo(ciclo);
    assert.deepEqual(lista.map((i) => [i.valorBruto, i.status, i.valor]).sort(), [[outro, "PENDENTE", 30], [pendente, "PENDENTE", 50]].sort());
    assert.equal(await svc.contarPendentes(ciclo), 2);
    assert.equal((await svc.alvosDasSugestoes([canonico]))[canonico]?.profissionalId, pCanonico.id);

    // ─── BM de pendente: backend recusa sem efeito colateral ───
    const logsAntes = await prismaTest.sgcLog.count();
    const recusa = await enviarBoletimFornecedor({ colaboradorCodigo: pendente, ciclo, usuario: { id: admin.id, nome: admin.nome }, telaOrigem: "teste" });
    assert.equal(recusa.ok, false);
    assert.ok(!recusa.ok && recusa.motivo === "CADASTRO_PENDENTE" && recusa.httpStatus === 409);
    assert.equal(await prismaTest.sgcAprovacaoMedicao.count({ where: { ciclo, colaboradorCodigo: pendente } }), 0);
    assert.equal(await prismaTest.sgcLog.count(), logsAntes);

    // ─── descarte: sai do total, auditado, idempotente; vínculo depois do descarte é recusado ───
    const descarte = await svc.descartarIdentidade(idC.id, autor);
    assert.deepEqual(descarte, { status: "DESCARTADO", ocorrencias: 1, valor: 30 });
    assert.equal(await somaMapa(), 150);
    assert.equal(await somaMedicoes(), 150);
    const regC = await prismaTest.importacaoIdentidade.findUniqueOrThrow({ where: { id: idC.id } });
    assert.equal(regC.status, "DESCARTADO");
    assert.equal(regC.descartadoPorId, admin.id);
    assert.equal((regC.metadata as { snapshot: { valorMapa: number } }).snapshot.valorMapa, 30);
    assert.ok(await prismaTest.adminAuditLog.findFirst({ where: { action: "IDENTIDADE_IMPORTACAO_DESCARTADA", targetId: idC.id } }));
    assert.equal((await svc.descartarIdentidade(idC.id, autor)).status, "JA_DESCARTADO");
    await assert.rejects(svc.vincularIdentidade({ identidadeId: idC.id, profissionalId: pCanonico.id }, autor), comStatus(409));
    assert.equal(await prismaTest.profissionalAlias.count({ where: { aliasNormalizado: outro } }), 0); // descarte nunca cria alias

    // ─── vínculo: duplo clique / dois ADMIN simultâneos → um vínculo, valores intocados ───
    const docsAntes = await prismaTest.medicao.findMany({ where: { identidadeImportacaoId: idB.id }, select: { id: true, numeroDocumento: true, valorMedicao: true }, orderBy: { id: "asc" } });
    const [v1, v2] = await Promise.all([1, 2].map(() => svc.vincularIdentidade({ identidadeId: idB.id, profissionalId: pCanonico.id }, autor)));
    assert.deepEqual([v1.status, v2.status].sort(), ["JA_VINCULADO", "VINCULADO"]);
    const docsDepois = await prismaTest.medicao.findMany({ where: { identidadeImportacaoId: idB.id }, select: { id: true, numeroDocumento: true, valorMedicao: true, idProfissional: true }, orderBy: { id: "asc" } });
    assert.deepEqual(docsDepois.map(({ idProfissional: _p, ...d }: { idProfissional: string | null }) => d), docsAntes);
    assert.ok(docsDepois.every((d: { idProfissional: string | null }) => d.idProfissional === pCanonico.id));
    assert.equal(await somaMapa(), 150); // vínculo nunca muda valor
    const linhaB = await prismaTest.mapaPagamentoItem.findFirstOrThrow({ where: { ciclo, identidadeImportacaoId: idB.id } });
    assert.equal(linhaB.projetistaCodigo, canonico);
    assert.equal(Number(linhaB.valor), 50);
    assert.equal(await prismaTest.profissionalAlias.count({ where: { aliasNormalizado: pendente, profissionalId: pCanonico.id, ativo: true } }), 1);
    assert.deepEqual(await resolverIdentidadeOperacional(pendente), { status: "RESOLVIDO", via: "ALIAS", profissionalId: pCanonico.id, codigoCanonico: canonico });
    assert.equal((await prismaTest.profissional.findUniqueOrThrow({ where: { id: pCanonico.id } })).codigo, canonico); // canônico intocado
    assert.ok(await prismaTest.adminAuditLog.findFirst({ where: { action: "IDENTIDADE_IMPORTACAO_VINCULADA", targetId: pCanonico.id } }));
    await assert.rejects(svc.descartarIdentidade(idB.id, autor), comStatus(409)); // já vinculado
    await assert.rejects(svc.vincularIdentidade({ identidadeId: idB.id, profissionalId: pResolvido.id }, autor), comStatus(409)); // outro alvo

    // ─── BM liberado sem reimportar ───
    const envio = await enviarBoletimFornecedor({ colaboradorCodigo: canonico, ciclo, usuario: { id: admin.id, nome: admin.nome }, telaOrigem: "teste" });
    assert.ok(envio.ok, "BM do fornecedor recém-vinculado segue a elegibilidade normal");

    // ─── vínculo × descarte simultâneos → resultado determinístico (um vence, o outro 409) ───
    const idD = await pendencia(disputa, 1);
    await medicao(5, { identidadeImportacaoId: idD.id });
    await mapa(disputa, 5, idD.id);
    const corrida = await Promise.allSettled([svc.vincularIdentidade({ identidadeId: idD.id, profissionalId: pResolvido.id }, autor), svc.descartarIdentidade(idD.id, autor)]);
    assert.equal(corrida.filter((r) => r.status === "fulfilled").length, 1);
    const finalD = await prismaTest.importacaoIdentidade.findUniqueOrThrow({ where: { id: idD.id } });
    assert.ok(["VINCULADO", "DESCARTADO"].includes(finalD.status));
    assert.equal(await prismaTest.profissionalAlias.count({ where: { aliasNormalizado: disputa, ativo: true } }), finalD.status === "VINCULADO" ? 1 : 0);

    // ─── BM do destino já enviado: vincular mais linhas a ele é recusado ───
    await prismaTest.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: enviado, ciclo, status: "PENDENTE" } });
    const idE = await pendencia(`ENVIADO ${S} APELIDO`, 1);
    await assert.rejects(svc.vincularIdentidade({ identidadeId: idE.id, profissionalId: pEnviado.id }, autor), comStatus(409));

    // ─── resíduo de parser nunca vira alias; código inexistente → 404 ───
    const idLixo = await pendencia("GRD-T-SINT-2026-0009", 1);
    await assert.rejects(svc.vincularIdentidade({ identidadeId: idLixo.id, profissionalId: pCanonico.id }, autor), comStatus(400));
    await assert.rejects(svc.vincularIdentidade({ identidadeId: idE.id, codigoCanonico: `NAO EXISTE ${S}` }, autor), comStatus(404));
    // Cadastro recém-criado pelo fluxo oficial: vínculo pelo código canônico.
    const pNovo = await prof(`ENVIADO ${S} NOVO CADASTRO`);
    const idF = await pendencia(`NOVO ${S} CADASTRO`, 1);
    assert.equal((await svc.vincularIdentidade({ identidadeId: idF.id, codigoCanonico: `ENVIADO ${S} NOVO CADASTRO` }, autor)).status, "VINCULADO");
    assert.equal((await prismaTest.importacaoIdentidade.findUniqueOrThrow({ where: { id: idF.id } })).profissionalId, pNovo.id);

    // ─── descarte consciente de linha estrutural (antes da carga) ───
    const chave = "a".repeat(64);
    assert.deepEqual(await svc.descartarLinhasEstruturais({ ciclo, origem: "Documentos", linhas: [{ chave, linha: 9, numeroDocumento: "DOC-SEM" }] }, autor), { descartadas: 1, novas: 1 });
    assert.deepEqual(await svc.descartarLinhasEstruturais({ ciclo, origem: "Documentos", linhas: [{ chave }] }, autor), { descartadas: 1, novas: 0 });
    await assert.rejects(svc.descartarLinhasEstruturais({ ciclo: "GERAL", origem: "Documentos", linhas: [{ chave }] }, autor), comStatus(400));
    await assert.rejects(svc.descartarLinhasEstruturais({ ciclo, origem: "Documentos", linhas: [{ chave: "nao-hash" }] }, autor), comStatus(400));
    assert.equal(await prismaTest.profissionalAlias.count({ where: { aliasNormalizado: "" } }), 0);

    // ─── reimportação futura: o resolver do ETL reconhece o alias (não volta a ser pendente) ───
    const url = process.env.DATABASE_URL_TEST!;
    const etlUrl = url.replace(/^postgres(ql)?:\/\//, "postgresql+psycopg://").replace(/\?.*$/, "");
    const py = [
      "import json, sys, pandas as pd",
      "from sqlalchemy import create_engine",
      "from ingest_medicoes import OperationalIdentityResolver, assert_operational_identities_resolved",
      "from test_negative_measurement_validation import normal_row",
      "engine = create_engine(sys.argv[2])",
      "with engine.connect() as conn:",
      "    r = OperationalIdentityResolver.load(conn)",
      "df = pd.DataFrame([normal_row(PROJETISTA=sys.argv[1])])",
      "s = assert_operational_identities_resolved(df, pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), set(), {}, {}, '2810', r, {}, 'Documentos', None, None, None)",
      "print('VIAS', json.dumps(s['identidades_por_via'], sort_keys=True), 'PENDENTES', len(s['identidades_pendentes']))",
    ].join("\n");
    const saida = execFileSync(process.env.PYTHON ?? "python", ["-c", py, pendente, etlUrl], {
      cwd: path.join(__dirname, "..", "etl"), encoding: "utf8", timeout: 60000, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    assert.match(saida, /VIAS \{"ALIAS": 1\} PENDENTES 0/);

    console.log("PASS: identidades pendentes da importação (pendente no total, BM bloqueado, vínculo sem reimportar, descarte, concorrência, linha estrutural, alias futuro no ETL).");
  } finally {
    await prismaTest.sgcLog.deleteMany({ where: { ciclo } });
    await prismaTest.sgcAprovacaoMedicao.deleteMany({ where: { ciclo } });
    await prismaTest.medicao.deleteMany({ where: { ciclo } });
    await prismaTest.mapaPagamentoItem.deleteMany({ where: { ciclo } });
    await prismaTest.importacaoIdentidade.deleteMany({ where: { ciclo } });
    await prismaTest.projeto.deleteMany({ where: { codigoProjeto: `PRJ-IDENT-${S}` } });
    await prismaTest.adminAuditLog.deleteMany({ where: { adminId: admin.id, createdAt: { gte: inicio }, action: { in: ["PROFISSIONAL_ALIAS_CRIADO", "IDENTIDADE_IMPORTACAO_VINCULADA", "IDENTIDADE_IMPORTACAO_DESCARTADA"] } } });
    await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { contains: S } } });
    await prismaTest.profissional.deleteMany({ where: { id: { in: profIds } } });
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
