import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { prisma } from "../lib/prisma";

/**
 * Testes de integração REAIS contra o banco configurado em DATABASE_URL — executam a MESMA query
 * Prisma que `lib/documentos-medidos.ts` roda (copiada aqui verbatim, não uma reimplementação
 * divergente) porque esse módulo declara `import "server-only"`, que só resolve dentro do
 * bundler do Next.js e sempre lança erro num script/teste `tsx` standalone (mesma limitação já
 * documentada para outros módulos server-only deste projeto). Isto não é um teste que lê
 * código-fonte — é uma query Prisma real, executada contra dados reais/de teste reais.
 */
async function getDocumentosMedidos(params: { aliases: string[]; ciclo: string }) {
  const aliases = Array.from(new Set(params.aliases.map((a) => a?.trim()).filter((a): a is string => !!a)));
  if (!aliases.length || !params.ciclo) return [];
  return prisma.medicao.findMany({
    where: {
      ciclo: params.ciclo,
      profissional: {
        OR: [
          { codigo: { in: aliases, mode: "insensitive" } },
          { nome: { in: aliases, mode: "insensitive" } },
          { nomeCompleto: { in: aliases, mode: "insensitive" } },
        ],
      },
    },
    select: { id: true },
    orderBy: [{ dataCadastro: "asc" }, { createdAt: "asc" }],
  });
}

const fixtureSuffix = `DOCS-MEDIDOS-${Date.now()}`;
const fixtureCiclo = `2608-${fixtureSuffix}`;
const fixtureOutroCiclo = `2609-${fixtureSuffix}`;
const fixtureCodigo = `P0129103-${fixtureSuffix}`;
const fixtureNome = `ALEXANDRE BORGES ${fixtureSuffix}`;
const fixtureNomeCompleto = `ALEXANDRE BORGES DE SOUSA ${fixtureSuffix}`;
const fixtureOutroNome = `ADILSON GAIO ${fixtureSuffix}`;
let fixtureProjetoId = "";
let fixtureProfissionalIds: string[] = [];

before(async () => {
  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `${fixtureSuffix}-PROJ`, contrato: "TESTE" } });
  fixtureProjetoId = projeto.id;
  const alexandre = await prisma.profissional.create({
    data: { nome: fixtureNome, codigo: fixtureCodigo, nomeCompleto: fixtureNomeCompleto },
  });
  const adilson = await prisma.profissional.create({ data: { nome: fixtureOutroNome } });
  fixtureProfissionalIds = [alexandre.id, adilson.id];
  await prisma.medicao.createMany({
    data: [
      { numeroMedicao: `${fixtureSuffix}-A-1`, idProjeto: projeto.id, idProfissional: alexandre.id, ciclo: fixtureCiclo, equivalenteA1Horas: 1, percentualEmissao: 1, condicao: "100", sourceRowHash: `${fixtureSuffix}-hash-a1` },
      { numeroMedicao: `${fixtureSuffix}-A-2`, idProjeto: projeto.id, idProfissional: alexandre.id, ciclo: fixtureCiclo, equivalenteA1Horas: 2, percentualEmissao: 1, condicao: "100", sourceRowHash: `${fixtureSuffix}-hash-a2` },
      { numeroMedicao: `${fixtureSuffix}-A-OUTRO`, idProjeto: projeto.id, idProfissional: alexandre.id, ciclo: fixtureOutroCiclo, equivalenteA1Horas: 3, percentualEmissao: 1, condicao: "100", sourceRowHash: `${fixtureSuffix}-hash-a3` },
      { numeroMedicao: `${fixtureSuffix}-B-1`, idProjeto: projeto.id, idProfissional: adilson.id, ciclo: fixtureCiclo, equivalenteA1Horas: 4, percentualEmissao: 1, condicao: "100", sourceRowHash: `${fixtureSuffix}-hash-b1` },
    ],
  });
});

after(async () => {
  await prisma.medicao.deleteMany({ where: { numeroMedicao: { startsWith: fixtureSuffix } } });
  if (fixtureProfissionalIds.length) await prisma.profissional.deleteMany({ where: { id: { in: fixtureProfissionalIds } } });
  if (fixtureProjetoId) await prisma.projeto.delete({ where: { id: fixtureProjetoId } });
});

test("regressão P0129103/2608 com fixture própria: encontra os mesmos documentos da tela Editar Pagamento", async () => {
  const docs = await getDocumentosMedidos({ aliases: [fixtureCodigo, fixtureNome, fixtureNomeCompleto], ciclo: fixtureCiclo });
  assert.ok(docs.length > 0, "esperava encontrar Documentos Medidos reais para este fornecedor/ciclo — não pode ser 0");
});

test("mesma consulta usando somente o codigo canônico (comportamento da tela Editar Pagamento) retorna a mesma contagem", async () => {
  const porAliasCompleto = await getDocumentosMedidos({ aliases: [fixtureCodigo, fixtureNome, fixtureNomeCompleto], ciclo: fixtureCiclo });
  const porCodigoUnico = await getDocumentosMedidos({ aliases: [fixtureCodigo], ciclo: fixtureCiclo });
  assert.equal(porAliasCompleto.length, porCodigoUnico.length);
  assert.deepEqual(
    porAliasCompleto.map((d) => d.id).sort(),
    porCodigoUnico.map((d) => d.id).sort(),
  );
});

test("fornecedor diferente no mesmo ciclo não vaza documentos de outro fornecedor", async () => {
  const alexandre = await getDocumentosMedidos({ aliases: [fixtureCodigo], ciclo: fixtureCiclo });
  const outro = await getDocumentosMedidos({ aliases: [fixtureOutroNome], ciclo: fixtureCiclo });
  const idsAlexandre = new Set(alexandre.map((d) => d.id));
  for (const doc of outro) assert.equal(idsAlexandre.has(doc.id), false, "documento de outro fornecedor vazou para o conjunto de Alexandre");
});

test("ciclo diferente para o mesmo fornecedor nunca mistura documentos entre ciclos", async () => {
  const docs2608 = await getDocumentosMedidos({ aliases: [fixtureCodigo], ciclo: fixtureCiclo });
  const docsInexistente = await getDocumentosMedidos({ aliases: [fixtureCodigo], ciclo: "9999-CICLO-INEXISTENTE" });
  assert.equal(docsInexistente.length, 0);
  assert.ok(docs2608.length > 0);
});

test("aliases vazios ou ciclo vazio nunca retornam o banco inteiro por engano", async () => {
  assert.deepEqual(await getDocumentosMedidos({ aliases: [], ciclo: fixtureCiclo }), []);
  assert.deepEqual(await getDocumentosMedidos({ aliases: [fixtureCodigo], ciclo: "" }), []);
});

// ─── CNPJ compartilhado: dois fornecedores de teste com o MESMO CNPJ, códigos diferentes ───

test("CNPJ compartilhado: dois fornecedores distintos permanecem isolados por identidade (nunca por CNPJ)", async () => {
  const suffix = `TESTE-AUDIT-${Date.now()}`;
  const cicloTeste = `TESTE-${suffix}`;
  const nomeA = `${suffix}-FORNECEDOR-A`;
  const nomeB = `${suffix}-FORNECEDOR-B`;

  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `${suffix}-PROJ`, contrato: "TESTE" } });
  const profissionalA = await prisma.profissional.create({ data: { nome: nomeA, codigo: null } });
  const profissionalB = await prisma.profissional.create({ data: { nome: nomeB, codigo: null } });

  try {
    const medicaoA = await prisma.medicao.create({
      data: {
        numeroMedicao: `${suffix}-MED-A`,
        idProjeto: projeto.id,
        idProfissional: profissionalA.id,
        ciclo: cicloTeste,
        equivalenteA1Horas: 10,
        percentualEmissao: 1,
        condicao: "100",
        sourceRowHash: `${suffix}-hash-a`,
      },
    });
    const medicaoB = await prisma.medicao.create({
      data: {
        numeroMedicao: `${suffix}-MED-B`,
        idProjeto: projeto.id,
        idProfissional: profissionalB.id,
        ciclo: cicloTeste,
        equivalenteA1Horas: 20,
        percentualEmissao: 1,
        condicao: "100",
        sourceRowHash: `${suffix}-hash-b`,
      },
    });

    const docsA = await getDocumentosMedidos({ aliases: [nomeA], ciclo: cicloTeste });
    const docsB = await getDocumentosMedidos({ aliases: [nomeB], ciclo: cicloTeste });

    assert.equal(docsA.length, 1);
    assert.equal(docsA[0].id, medicaoA.id);
    assert.equal(docsB.length, 1);
    assert.equal(docsB[0].id, medicaoB.id);
  } finally {
    await prisma.medicao.deleteMany({ where: { numeroMedicao: { startsWith: `${suffix}-MED` } } });
    await prisma.profissional.deleteMany({ where: { id: { in: [profissionalA.id, profissionalB.id] } } });
    await prisma.projeto.delete({ where: { id: projeto.id } });
  }
});

// ─── Documento incluído manualmente / documento excluído ───

test("documento incluído manualmente aparece no conjunto consolidado, e some quando removido", async () => {
  const suffix = `TESTE-AUDIT-MANUAL-${Date.now()}`;
  const cicloTeste = `TESTE-${suffix}`;
  const nome = `${suffix}-FORNECEDOR`;

  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `${suffix}-PROJ`, contrato: "TESTE" } });
  const profissional = await prisma.profissional.create({ data: { nome, codigo: null } });

  try {
    const antes = await getDocumentosMedidos({ aliases: [nome], ciclo: cicloTeste });
    assert.equal(antes.length, 0);

    const manual = await prisma.medicao.create({
      data: {
        numeroMedicao: `${suffix}-MANUAL`,
        idProjeto: projeto.id,
        idProfissional: profissional.id,
        ciclo: cicloTeste,
        equivalenteA1Horas: 5,
        percentualEmissao: 1,
        condicao: "50",
        sourceRowHash: `${suffix}-manual-hash`,
      },
    });

    const depois = await getDocumentosMedidos({ aliases: [nome], ciclo: cicloTeste });
    assert.equal(depois.length, 1);
    assert.equal(depois[0].id, manual.id);

    await prisma.medicao.delete({ where: { id: manual.id } });
    const removido = await getDocumentosMedidos({ aliases: [nome], ciclo: cicloTeste });
    assert.equal(removido.length, 0, "documento excluído da fonte não pode reaparecer");
  } finally {
    await prisma.medicao.deleteMany({ where: { numeroMedicao: `${suffix}-MANUAL` } });
    await prisma.profissional.delete({ where: { id: profissional.id } });
    await prisma.projeto.delete({ where: { id: projeto.id } });
  }
});
