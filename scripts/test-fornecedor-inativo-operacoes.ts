import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { assertConnectedToE2eDatabase, prismaTest } from "../lib/prisma-test";

/**
 * Fornecedor explicitamente inativo (possui CadastroFornecedor, nenhum ativo) não participa de novas
 * operações: não recebe e-mail operacional (resolveFornecedorEmail) nem nova Medicao pela inclusão
 * de divergência (POST /api/admin/conferencia/[id]/incluir). Profissional legado, sem qualquer
 * CadastroFornecedor, mantém o comportamento histórico. A identidade é sempre colaboradorCodigo /
 * Profissional.codigo — todos os fixtures compartilham o MESMO CNPJ para provar que ele não interfere.
 */
const CNPJ_COMPARTILHADO = "99888777000166";
const CICLO = "2612";
const MENSAGEM_INATIVO = "Fornecedor inativo. Reative o fornecedor no Administrativo antes de incluí-lo em uma nova medição.";

async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  // Serviços, rota e banco são REAIS; só o marcador de bundler e a sessão HTTP são neutralizados.
  const adminUser = { id: "", nome: "ADMIN TESTE INATIVO OPS" };
  const adminPath = require.resolve(path.join(__dirname, "../lib/admin"));
  require.cache[adminPath] = {
    id: adminPath, filename: adminPath, loaded: true,
    exports: { requireAdmin: async () => ({ user: adminUser, response: null }) },
  } as any;
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { resolveFornecedorEmail } = require("../lib/email/resolve-recipients");
  const { POST: incluirDivergencia } = require("../app/api/admin/conferencia/[id]/incluir/route");
  Module._load = originalLoad;

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const profissionalIds: string[] = [];
  const cadastroIds: string[] = [];
  const usuarioIds: string[] = [];
  const sgcIds: string[] = [];
  const codigos: string[] = [];

  async function criarFornecedor(label: string, opts: { cadastro: "ATIVO" | "INATIVO" | "NENHUM"; valorDocumento?: number }) {
    const codigo = `TESTE INATIVO OPS ${label} ${suffix}`;
    const nome = `Fornecedor ${label} ${suffix}`;
    const profissional = await prismaTest.profissional.create({
      data: { nome: codigo, codigo, nomeCompleto: nome, email: `profissional.${label.toLowerCase()}.${suffix}@example.test`, cnpj: CNPJ_COMPARTILHADO },
    });
    profissionalIds.push(profissional.id);
    codigos.push(codigo);
    if (opts.cadastro !== "NENHUM") {
      const ativo = opts.cadastro === "ATIVO";
      const cadastro = await prismaTest.cadastroFornecedor.create({
        data: {
          cnpjNormalizado: CNPJ_COMPARTILHADO, cnpj: CNPJ_COMPARTILHADO, colaboradorCodigo: codigo, responsavel: nome, razaoSocial: nome,
          email: `cadastro.${label.toLowerCase()}.${suffix}@example.test`, valorDocumento: opts.valorDocumento ?? 150,
          ativo, inativadoAt: ativo ? null : new Date(), rawPayload: {},
        },
      });
      cadastroIds.push(cadastro.id);
    }
    const usuario = await prismaTest.usuario.create({
      data: {
        usuario: `P9${String(Date.now()).slice(-5)}${usuarioIds.length}`, nome, senhaHash: "hash-preservado", perfil: "COLABORADOR",
        ativo: opts.cadastro !== "INATIVO", email: `usuario.${label.toLowerCase()}.${suffix}@example.test`,
      },
    });
    usuarioIds.push(usuario.id);
    return { codigo, nome, profissionalId: profissional.id, usuarioId: usuario.id };
  }

  async function criarDivergencia(codigoSgc: string, referencia: string) {
    const sgc = await prismaTest.sgcAprovacaoMedicao.upsert({
      where: { colaboradorCodigo_ciclo: { colaboradorCodigo: codigoSgc, ciclo: CICLO } },
      create: { colaboradorCodigo: codigoSgc, ciclo: CICLO, status: "PENDENTE", statusConferencia: "DIVERGENCIA" },
      update: {},
    });
    if (!sgcIds.includes(sgc.id)) sgcIds.push(sgc.id);
    return prismaTest.divergenciaMedicao.create({
      data: {
        sgcId: sgc.id, colaboradorCodigo: referencia, ciclo: CICLO, nrVale: `VALE-${randomUUID().slice(0, 8)}`, documentoNaoMapeado: true,
        fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 100, fornecedorTipo: "DOC",
      },
    });
  }

  async function incluir(divergenciaId: string) {
    const response = await incluirDivergencia({ json: async () => ({}) } as any, { params: Promise.resolve({ id: divergenciaId }) });
    return { status: response.status, body: await response.json() };
  }

  // Contagens sempre restritas à identidade testada: `tsx --test` executa os arquivos em paralelo no
  // mesmo banco E2E, então contagens globais oscilam por causa de outras suítes.
  async function snapshot(fornecedor: { codigo: string; nome: string; profissionalId: string; usuarioId: string }, divergenciaId: string) {
    const [medicoes, medicoesCondicaoZero, mapa, divergencia, cadastros, profissional, usuario] = await Promise.all([
      prismaTest.medicao.count({ where: { idProfissional: fornecedor.profissionalId } }),
      prismaTest.medicao.count({ where: { idProfissional: fornecedor.profissionalId, condicao: "0" } }),
      prismaTest.mapaPagamentoItem.count({ where: { OR: [{ projetistaCodigo: fornecedor.codigo }, { responsavel: fornecedor.nome }] } }),
      prismaTest.divergenciaMedicao.findUniqueOrThrow({ where: { id: divergenciaId } }),
      prismaTest.cadastroFornecedor.findMany({ where: { colaboradorCodigo: fornecedor.codigo }, orderBy: { id: "asc" } }),
      prismaTest.profissional.findUniqueOrThrow({ where: { id: fornecedor.profissionalId } }),
      prismaTest.usuario.findUniqueOrThrow({ where: { id: fornecedor.usuarioId } }),
    ]);
    const sgc = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: divergencia.sgcId } });
    return JSON.parse(JSON.stringify({ medicoes, medicoesCondicaoZero, mapa, divergencia, cadastros, profissional, usuario, sgc }));
  }

  async function assertBloqueadoSemEscrita(fornecedor: { codigo: string; nome: string; profissionalId: string; usuarioId: string }, referencia: string) {
    const divergencia = await criarDivergencia(fornecedor.codigo, referencia);
    const antes = await snapshot(fornecedor, divergencia.id);
    const resultado = await incluir(divergencia.id);
    assert.equal(resultado.status, 409);
    assert.deepEqual(resultado.body, { error: MENSAGEM_INATIVO });
    const depois = await snapshot(fornecedor, divergencia.id);
    assert.deepEqual(depois, antes);
    assert.equal(depois.divergencia.status, "PENDENTE");
    assert.equal(depois.divergencia.resolvidoEm, null);
    assert.equal(depois.medicoes, 0);
    assert.equal(depois.medicoesCondicaoZero, 0);
  }

  try {
    const admin = await prismaTest.usuario.create({
      data: { usuario: `P8${String(Date.now()).slice(-6)}`, nome: adminUser.nome, senhaHash: "hash-admin", perfil: "ADMIN" },
    });
    usuarioIds.push(admin.id);
    adminUser.id = admin.id;
    const ativo = await criarFornecedor("ATIVO", { cadastro: "ATIVO", valorDocumento: 150 });
    const inativo = await criarFornecedor("INATIVO", { cadastro: "INATIVO", valorDocumento: 200 });
    const legado = await criarFornecedor("LEGADO", { cadastro: "NENHUM" });
    const porResponsavel = await criarFornecedor("RESPONSAVEL", { cadastro: "ATIVO", valorDocumento: 175 });

    // ─── HIGH 1 — e-mail operacional ───
    const emailAtivo = await resolveFornecedorEmail(ativo.codigo, ativo.nome);
    assert.deepEqual(emailAtivo, { email: `cadastro.ativo.${suffix}@example.test`, nome: ativo.nome, missing: false });

    // Inativo com Profissional.email e Usuario.email preenchidos: nenhum deles é usado como rota alternativa,
    // e outro fornecedor ATIVO com o mesmo CNPJ não é confundido com ele.
    const emailInativo = await resolveFornecedorEmail(inativo.codigo, inativo.nome);
    assert.equal(emailInativo.email, null);
    assert.equal(emailInativo.missing, true);
    for (const naoUsar of [`profissional.inativo.${suffix}@example.test`, `usuario.inativo.${suffix}@example.test`, `cadastro.inativo.${suffix}@example.test`, `cadastro.ativo.${suffix}@example.test`]) {
      assert.notEqual(emailInativo.email, naoUsar);
    }
    assert.equal((await resolveFornecedorEmail(inativo.codigo)).email, null);

    const emailLegado = await resolveFornecedorEmail(legado.codigo, legado.nome);
    assert.deepEqual(emailLegado, { email: `profissional.legado.${suffix}@example.test`, nome: legado.nome, missing: false });

    // ─── HIGH 2 — inclusão de divergência ───
    // Ativo (mesmo CNPJ do inativo): inclusão funciona, preço por colaboradorCodigo preservado.
    const divergenciaAtivo = await criarDivergencia(ativo.codigo, ativo.codigo);
    assert.deepEqual(await incluir(divergenciaAtivo.id), { status: 200, body: { ok: true } });
    const medicaoAtivo = await prismaTest.medicao.findFirstOrThrow({ where: { idProfissional: ativo.profissionalId } });
    assert.equal(medicaoAtivo.condicao, "150");
    assert.equal((await prismaTest.divergenciaMedicao.findUniqueOrThrow({ where: { id: divergenciaAtivo.id } })).status, "INCLUIDA");

    // Inativo pelo código canônico e pelo nome/nomeCompleto (com caixa diferente): 409 e zero escrita.
    await assertBloqueadoSemEscrita(inativo, inativo.codigo);
    await assertBloqueadoSemEscrita(inativo, inativo.nome.toLowerCase());

    // Legado sem CadastroFornecedor: comportamento histórico preservado (sem preço cadastrado → "0").
    const divergenciaLegado = await criarDivergencia(legado.codigo, legado.codigo);
    assert.deepEqual(await incluir(divergenciaLegado.id), { status: 200, body: { ok: true } });
    const medicaoLegado = await prismaTest.medicao.findFirstOrThrow({ where: { idProfissional: legado.profissionalId } });
    assert.equal(medicaoLegado.condicao, "0");

    // Divergência referenciando o responsável: preço continua localizado por CadastroFornecedor.responsavel.
    const divergenciaResponsavel = await criarDivergencia(porResponsavel.codigo, porResponsavel.nome);
    assert.deepEqual(await incluir(divergenciaResponsavel.id), { status: 200, body: { ok: true } });
    const medicaoResponsavel = await prismaTest.medicao.findFirstOrThrow({ where: { idProfissional: porResponsavel.profissionalId } });
    assert.equal(medicaoResponsavel.condicao, "175");

    console.log("PASS: fornecedor inativo bloqueado em e-mail e inclusão; legado, responsavel e CNPJ compartilhado preservados.");
  } finally {
    const medicoes = await prismaTest.medicao.findMany({ where: { idProfissional: { in: profissionalIds } }, select: { idProjeto: true } });
    await prismaTest.medicao.deleteMany({ where: { idProfissional: { in: profissionalIds } } });
    await prismaTest.projeto.deleteMany({ where: { id: { in: medicoes.map((item) => item.idProjeto) } } });
    await prismaTest.sgcLog.deleteMany({ where: { OR: [{ sgcId: { in: sgcIds } }, { colaboradorCodigo: { in: codigos } }] } });
    await prismaTest.divergenciaMedicao.deleteMany({ where: { sgcId: { in: sgcIds } } });
    await prismaTest.sgcAprovacaoMedicao.deleteMany({ where: { id: { in: sgcIds } } });
    await prismaTest.cadastroFornecedor.deleteMany({ where: { id: { in: cadastroIds } } });
    await prismaTest.usuario.deleteMany({ where: { id: { in: usuarioIds } } });
    await prismaTest.profissional.deleteMany({ where: { id: { in: profissionalIds } } });
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
