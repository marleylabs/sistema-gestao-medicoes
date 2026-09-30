import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { assertConnectedToE2eDatabase, prismaTest } from "../lib/prisma-test";

/**
 * Resolver central de identidade operacional (lib/profissional-identidade.ts) e seus consumidores
 * (e-mail, resolveProjetistaCodigo, ponte do portal) contra o PostgreSQL E2E. Fixtures próprias,
 * removidas no finally.
 */
async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { resolverIdentidadeOperacional, normalizarAlias, aliasesDaIdentidade } = await import("../lib/profissional-identidade");
  const { resolveFornecedorEmail } = await import("../lib/email/resolve-recipients");
  const { resolveProjetistaCodigo } = await import("../lib/mapa-pagamento");
  const { encryptSensitive } = require("../lib/encryption");

  // Paridade da normalização com o ETL (etl/test_operational_identity.py lê a mesma fixture).
  const fixture = JSON.parse(readFileSync(path.join(__dirname, "..", "tests", "fixtures", "normalizacao-alias.json"), "utf8")) as Array<{ entrada: string; esperado: string }>;
  for (const { entrada, esperado } of fixture) assert.equal(normalizarAlias(entrada), esperado, `normalizarAlias(${JSON.stringify(entrada)})`);

  const S = randomUUID().slice(0, 6).toUpperCase();
  const canonico = `RONALD RAFAEL SILVA LEAL ${S}`;
  const alias = `RONALD LEAL ${S}`;
  const outro = `RONALDO RAMOS ${S}`;
  const legado = `LEGADO SEM CODIGO ${S}`;
  const excluido = `EXCLUIDO ${S}`;
  const ids: string[] = [];
  const cadastroIds: string[] = [];
  try {
    const pCanonico = await prismaTest.profissional.create({ data: { nome: canonico, codigo: canonico, nomeCompleto: canonico } });
    const pOutro = await prismaTest.profissional.create({ data: { nome: outro, codigo: outro } });
    const pLegado = await prismaTest.profissional.create({ data: { nome: legado, email: encryptSensitive(`legado-${S.toLowerCase()}@example.test`) } });
    const pExcluido = await prismaTest.profissional.create({ data: { nome: excluido, codigo: excluido, deletedAt: new Date() } });
    ids.push(pCanonico.id, pOutro.id, pLegado.id, pExcluido.id);
    const cadastro = await prismaTest.cadastroFornecedor.create({
      data: { cnpjNormalizado: "55591066000195", colaboradorCodigo: canonico, responsavel: canonico, razaoSocial: `RR LEAL ${S} LTDA`, email: encryptSensitive(`ronald-${S.toLowerCase()}@example.test`), rawPayload: {} },
    });
    cadastroIds.push(cadastro.id);
    const mk = (profissionalId: string, valor: string, ativo = true) =>
      prismaTest.profissionalAlias.create({ data: { profissionalId, alias: valor, aliasNormalizado: normalizarAlias(valor), origem: "MANUAL", ativo } });
    await mk(pCanonico.id, alias);
    await mk(pCanonico.id, `AMBIGUO ${S}`);
    await mk(pOutro.id, `AMBIGUO ${S}`);
    await mk(pCanonico.id, `INATIVO ${S}`, false);
    await mk(pExcluido.id, `ALIAS DO EXCLUIDO ${S}`);

    // A — código canônico (case-insensitive, espaços nas pontas)
    const a = await resolverIdentidadeOperacional(`  ${canonico.toLowerCase()} `);
    assert.deepEqual(a, { status: "RESOLVIDO", via: "CODIGO", profissionalId: pCanonico.id, codigoCanonico: canonico });
    // B — alias → identidade canônica; variação de acento/pontuação/caixa normaliza igual
    const b = await resolverIdentidadeOperacional(alias);
    assert.deepEqual(b, { status: "RESOLVIDO", via: "ALIAS", profissionalId: pCanonico.id, codigoCanonico: canonico });
    const b2 = await resolverIdentidadeOperacional(`rónald.  leal ${S.toLowerCase()}`);
    assert.equal(b2.status === "RESOLVIDO" && b2.profissionalId, pCanonico.id);
    // C — mesmo alias em duas identidades → AMBÍGUO, nunca escolhe
    const c = await resolverIdentidadeOperacional(`AMBIGUO ${S}`);
    assert.equal(c.status, "AMBIGUO");
    assert.deepEqual(c.status === "AMBIGUO" && c.candidatos.map((x) => x.codigoCanonico).sort(), [canonico, outro].sort());
    // D — legado sem código resolve pelo próprio nome (compatibilidade)
    const d = await resolverIdentidadeOperacional(legado.toLowerCase());
    assert.deepEqual(d, { status: "RESOLVIDO", via: "NOME_LEGADO", profissionalId: pLegado.id, codigoCanonico: legado });
    // E — nome nunca visto → NAO_RESOLVIDO (nada é criado)
    assert.equal((await resolverIdentidadeOperacional(`PAULO SOUZA ${S}`)).status, "NAO_RESOLVIDO");
    assert.equal((await resolverIdentidadeOperacional("   ")).status, "NAO_RESOLVIDO");
    // Nada criado para o nome não resolvido (escopo do próprio teste: outros arquivos rodam em paralelo no mesmo banco).
    assert.equal(await prismaTest.profissional.count({ where: { nome: { contains: `PAULO SOUZA ${S}`, mode: "insensitive" } } }), 0);
    // F — identidade excluída definitivamente nunca resolve (nem por código, nem por alias)
    assert.equal((await resolverIdentidadeOperacional(excluido)).status, "NAO_RESOLVIDO");
    assert.equal((await resolverIdentidadeOperacional(`ALIAS DO EXCLUIDO ${S}`)).status, "NAO_RESOLVIDO");
    // G — alias inativo não resolve; nome apenas parecido não resolve
    assert.equal((await resolverIdentidadeOperacional(`INATIVO ${S}`)).status, "NAO_RESOLVIDO");
    assert.equal((await resolverIdentidadeOperacional(`RONALD R LEAL ${S}`)).status, "NAO_RESOLVIDO");
    // H — lista de aliases ativos da identidade
    assert.deepEqual(await aliasesDaIdentidade(pCanonico.id), [`AMBIGUO ${S}`, alias].sort());

    // E-mail: BM gravado com o alias chega no e-mail do cadastro canônico; legado sem código usa o próprio e-mail.
    const email = await resolveFornecedorEmail(alias);
    assert.equal(email.email, `ronald-${S.toLowerCase()}@example.test`);
    assert.equal(email.missing, false);
    const emailLegado = await resolveFornecedorEmail(legado);
    assert.equal(emailLegado.email, `legado-${S.toLowerCase()}@example.test`);
    assert.equal((await resolveFornecedorEmail(`AMBIGUO ${S}`)).missing, true);

    // Novo pagamento: alias grava o código canônico; alias ambíguo é rejeitado.
    assert.deepEqual(await resolveProjetistaCodigo(alias), { codigo: canonico });
    const amb = await resolveProjetistaCodigo(`AMBIGUO ${S}`);
    assert.equal(amb.codigo, null);
    assert.match(amb.error ?? "", /Mais de um fornecedor/);
    assert.deepEqual(await resolveProjetistaCodigo(legado), { codigo: legado });

    // Legado operacional artificial (artefato do ETL antigo: código = nome, sem dados/cadastro/usuário)
    // é o ÚNICO Profissional com código que o utilitário de alias aceita substituir e o reset remove.
    const { isLegadoOperacionalArtificial } = await import("./lib/legado-artificial");
    const artificial = await prismaTest.profissional.create({ data: { nome: `ARTIFICIAL ${S}`, codigo: `ARTIFICIAL ${S}` } });
    const comNomeCompleto = await prismaTest.profissional.create({ data: { nome: `COM NOME ${S}`, codigo: `COM NOME ${S}`, nomeCompleto: `COM NOME COMPLETO ${S}` } });
    const codigoDiferente = await prismaTest.profissional.create({ data: { nome: `NOME X ${S}`, codigo: `CODIGO Y ${S}` } });
    const comUsuario = await prismaTest.profissional.create({ data: { nome: `COM USUARIO ${S}`, codigo: `COM USUARIO ${S}` } });
    ids.push(artificial.id, comNomeCompleto.id, codigoDiferente.id, comUsuario.id);
    const usuario = await prismaTest.usuario.create({ data: { usuario: `P9${S}`.slice(0, 8), nome: `COM USUARIO ${S}`, senhaHash: "x", perfil: "COLABORADOR" } });
    try {
      assert.equal(await isLegadoOperacionalArtificial(prismaTest, artificial.id), true);
      assert.equal(await isLegadoOperacionalArtificial(prismaTest, pCanonico.id), false); // canônico com cadastro, mesmo com código = nome
      assert.equal(await isLegadoOperacionalArtificial(prismaTest, comNomeCompleto.id), false);
      assert.equal(await isLegadoOperacionalArtificial(prismaTest, codigoDiferente.id), false);
      assert.equal(await isLegadoOperacionalArtificial(prismaTest, comUsuario.id), false);
      assert.equal(await isLegadoOperacionalArtificial(prismaTest, pExcluido.id), false);
    } finally {
      await prismaTest.usuario.delete({ where: { id: usuario.id } });
    }

    console.log("PASS: resolver de identidade (código, alias, ambíguo, legado, não resolvido, excluído, inativo), paridade de normalização, e-mail e novo pagamento por alias.");
  } finally {
    await prismaTest.cadastroFornecedor.deleteMany({ where: { id: { in: cadastroIds } } });
    await prismaTest.profissional.deleteMany({ where: { id: { in: ids } } }); // aliases em cascata
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
