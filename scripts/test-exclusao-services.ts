import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prismaTest, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// Reimplementação verbatim de lib/cadastro-fornecedor.ts::identityNameHash/normalizePersonName
// (privadas, sem export) — só para simular um audit log LEGADO (de antes desta correção) com
// identityNameHashes real mas SEM administrativeConfigSnapshot.
function legacyIdentityNameHash(value: string) {
  const normalized = value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;
  // Só neutraliza o marcador de bundler Next; os serviços e o banco abaixo são REAIS.
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const {
    deleteFornecedoresDefinitivamente,
    upsertCadastroFornecedor,
    FornecedorIdentityConflictError,
    FornecedorIdentityReviewError,
    FornecedorResolucaoInvalidaError,
    resolverIdentidadeManualmente,
    getCandidateCodigosForRow,
    getIdentityCandidateSummaries,
  } = require("../lib/cadastro-fornecedor");
  const { resolveFornecedorEmail } = require("../lib/email/resolve-recipients");
  const { serializeMedicao } = require("../lib/format");
  Module._load = originalLoad;

  const id = randomUUID();
  const nome = `TESTE EXCLUSAO NOME ${id}`;
  const codigo = `TESTE-COD-${id}`;
  const admin = { id: randomUUID(), nome: "Administrador de teste", usuario: "TESTE-EXCLUSAO-SERVICE" };
  const profissional = await prismaTest.profissional.create({ data: { nome, nomeCompleto: nome, codigo, statusColaborador: "ATO", email: "exclusao@example.test", cpf: "123", cnpj: "456", razaoSocial: "Teste", funcao: "Teste" } });
  const projeto = await prismaTest.projeto.create({ data: { codigoProjeto: `TESTE-EXCLUSAO-${id}` } });
  const cadastro = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigo, responsavel: nome, razaoSocial: "Teste", cnpjNormalizado: "00000000000000" } });
  const medicao = await prismaTest.medicao.create({ data: { numeroMedicao: id, idProjeto: projeto.id, idProfissional: profissional.id, idCoordenador: profissional.id, valorTotal: 4321, sourceRowHash: id } });
  try {
    // Falha da auditoria após os writes: a transação real deve reverter todos eles.
    const originalTransaction = prismaTest.$transaction.bind(prismaTest);
    (prismaTest as any).$transaction = (callback: any) => originalTransaction(async (tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === "adminAuditLog") return { createMany: async () => { throw new Error("FALHA_AUDITORIA_TESTE"); } };
        return Reflect.get(target, key);
      },
    })));
    try {
      const failed = await deleteFornecedoresDefinitivamente([cadastro.id], admin);
      assert.equal(failed.administrativeDeleted, 0);
      assert.ok(failed.errors.some((e: any) => e.error.includes("FALHA_AUDITORIA_TESTE")));
    } finally { (prismaTest as any).$transaction = originalTransaction; }
    assert.ok(await prismaTest.cadastroFornecedor.findUnique({ where: { id: cadastro.id } }));
    assert.equal((await prismaTest.profissional.findUniqueOrThrow({ where: { id: profissional.id } })).deletedAt, null);
    assert.equal((await prismaTest.medicao.findUniqueOrThrow({ where: { id: medicao.id } })).profissionalNomeSnapshot, null);

    const result = await deleteFornecedoresDefinitivamente([cadastro.id], admin, "Teste controlado");
    assert.equal(result.errors.length, 0);
    assert.equal(result.administrativeDeleted, 1);
    const deleted = await prismaTest.profissional.findUniqueOrThrow({ where: { id: profissional.id } });
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedById, admin.id);
    assert.equal(deleted.nome, `EXCLUIDO-${profissional.id}`);
    for (const field of ["nomeCompleto", "cpf", "cnpj", "email", "razaoSocial", "funcao"] as const) assert.equal(deleted[field], null);
    assert.equal(deleted.statusColaborador, "ATO"); // CHECK real intacta.
    const history = await prismaTest.medicao.findUniqueOrThrow({ where: { id: medicao.id }, include: { profissional: true, coordenador: true } });
    assert.equal(Number(history.valorTotal), 4321);
    assert.equal(history.idProfissional, profissional.id);
    assert.equal(history.profissionalNomeSnapshot, nome);
    assert.equal(history.coordenadorNomeSnapshot, nome);
    assert.equal(serializeMedicao(history).profissional.nome, nome);
    const audit = await prismaTest.adminAuditLog.findFirstOrThrow({ where: { targetId: profissional.id, adminId: admin.id } });
    assert.equal(audit.action, "FORNECEDOR_EXCLUSAO_DEFINITIVA");
    assert.equal(audit.reason, "Teste controlado");
    assert.ok(!JSON.stringify(audit.metadata).includes(nome));
    assert.ok(!JSON.stringify(audit.metadata).includes("exclusao@example.test"));

    // CORREÇÃO DE POLÍTICA (bug real reportado pelo usuário): reimportar a MESMA planilha
    // administrativa (Consulta PJ) depois de uma exclusão é ação explícita do ADMIN, não reativação
    // silenciosa por coincidência — precisa RECRIAR o CadastroFornecedor, reutilizando o mesmo
    // `codigo`/Profissional/Usuario, nunca gerar identidade nova nem bloquear a linha inteira.
    // Nome ≠ código nesta fixture (`codigo = TESTE-COD-<id>`, `nome/responsavel = TESTE EXCLUSAO
    // NOME <id>`) — cobre exatamente o caso real de código técnico tipo P0123456, resolvido via
    // hash de nome (Prioridade 1B de `resolveFornecedorIdentity`).
    const reimport = await upsertCadastroFornecedor({ responsavel: nome, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste", email: "reativado@example.test", rawPayload: {} });
    assert.equal(reimport.created, true);
    assert.equal(reimport.recreated, true);
    assert.equal(reimport.colaboradorCodigo, codigo, "reativação nunca gera um novo código — reutiliza o codigo original");
    assert.ok(reimport.usuarioCriado, "não havia Usuario prévio para esta identidade — reativação cria um, como um fornecedor novo");
    const reactivated = await prismaTest.profissional.findUniqueOrThrow({ where: { id: profissional.id } });
    assert.equal(reactivated.deletedAt, null);
    assert.equal(reactivated.deletedById, null);
    assert.equal(reactivated.codigo, codigo, "nunca duplica nem troca o código técnico");
    assert.equal(reactivated.nome, codigo, "convenção nome === codigo restaurada");
    assert.equal(await prismaTest.profissional.count({ where: { codigo } }), 1, "nunca duplica Profissional");
    assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: codigo } }), 1, "exatamente um CadastroFornecedor recriado");

    // E-mail volta a resolver normalmente para a identidade reativada — o bloqueio por
    // `isDeletedFornecedorIdentityName` (hash de auditoria PERMANENTE) não pode persistir depois de
    // uma reativação real; a checagem correta é o `Profissional.deletedAt` ATUAL, não o histórico.
    const recipientDepoisDaReativacao = await resolveFornecedorEmail(codigo);
    assert.equal(recipientDepoisDaReativacao.missing, false);
    assert.equal(recipientDepoisDaReativacao.email, "reativado@example.test");

    // Reimportar a MESMA linha de novo é idempotente: nem cria outro CadastroFornecedor, nem
    // duplica Profissional/Usuario.
    const reimportOutraVez = await upsertCadastroFornecedor({ responsavel: nome, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste", email: "reativado@example.test", rawPayload: {} });
    assert.equal(reimportOutraVez.created, false);
    assert.equal(reimportOutraVez.recreated, false);
    assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: codigo } }), 1);
    assert.equal(await prismaTest.profissional.count({ where: { codigo } }), 1);

    const repeated = await deleteFornecedoresDefinitivamente([cadastro.id], admin);
    assert.equal(repeated.administrativeDeleted, 0, "cadastro.id original já não existe mais (foi substituído pelo recriado) — exclusão desse id específico não encontra nada");
    assert.ok(repeated.errors.length > 0);
    const legacyName = `TESTE LEGADO ${id}`;
    const legacy = await prismaTest.profissional.create({ data: { nome: legacyName, nomeCompleto: legacyName } });
    const legacyCadastro = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: legacyName, responsavel: legacyName, razaoSocial: "Teste", cnpjNormalizado: "00000000000000" } });
    const legacyMedicao = await prismaTest.medicao.create({ data: { numeroMedicao: `${id}-legacy`, idProjeto: projeto.id, idProfissional: legacy.id, sourceRowHash: `${id}-legacy`, valorTotal: 50 } });
    try {
      const legacyResult = await deleteFornecedoresDefinitivamente([legacyCadastro.id], admin);
      assert.equal(legacyResult.errors.length, 0);
      const tombstone = await prismaTest.profissional.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.ok(tombstone.deletedAt);
      assert.equal(tombstone.codigo, legacyName);
      assert.equal((await prismaTest.medicao.findUniqueOrThrow({ where: { id: legacyMedicao.id } })).profissionalNomeSnapshot, legacyName);
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { id: legacyCadastro.id } });
      await prismaTest.medicao.deleteMany({ where: { id: legacyMedicao.id } });
      await prismaTest.profissional.deleteMany({ where: { id: legacy.id } });
    }

    // ─── RECREATE_FROM_HISTORY: CadastroFornecedor excluído SEM nenhum Profissional vinculado
    // (SEM_PROFISSIONAL_VINCULADO, caso real dos 11 fornecedores encontrados na auditoria) — a
    // reimportação precisa recriar Profissional usando o MESMO código histórico (nunca gerar um
    // novo), recriar o CadastroFornecedor e reativar o Usuario existente (nunca duplicar).
    const histId = randomUUID();
    const histNome = `TESTE HISTORICO NOME ${histId}`;
    const histCodigo = `TESTE-HIST-COD-${histId}`;
    const histUsuarioLogin = `TESTEHIST${histId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const histCadastro = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: histCodigo, responsavel: histNome, razaoSocial: "Teste Historico", cnpjNormalizado: "00000000000000" } });
    const histUsuario = await prismaTest.usuario.create({ data: { usuario: histUsuarioLogin, nome: histNome, senhaHash: "x", perfil: "COLABORADOR", ativo: true } });
    try {
      assert.equal(await prismaTest.profissional.count({ where: { codigo: histCodigo } }), 0, "pré-condição: nenhum Profissional para este código");
      const histDelete = await deleteFornecedoresDefinitivamente([histCadastro.id], admin);
      assert.equal(histDelete.errors.length, 0);
      assert.equal(histDelete.administrativeDeleted, 1);
      const histAudit = await prismaTest.adminAuditLog.findFirstOrThrow({ where: { targetCodigo: histCodigo, adminId: admin.id } });
      assert.equal((histAudit.metadata as any)?.resultado, "SEM_PROFISSIONAL_VINCULADO");
      assert.equal((await prismaTest.usuario.findUniqueOrThrow({ where: { id: histUsuario.id } })).excluidoAt !== null, true, "Usuario precisa ter sido desativado mesmo sem Profissional vinculado");

      const histReimport = await upsertCadastroFornecedor({ responsavel: histNome, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Historico", rawPayload: {} });
      assert.equal(histReimport.created, true);
      assert.equal(histReimport.recreated, true);
      assert.equal(histReimport.colaboradorCodigo, histCodigo, "RECREATE_FROM_HISTORY reutiliza o código histórico, nunca gera um novo");
      assert.ok(histReimport.usuarioReativado, "Usuario existente precisa ser REATIVADO, nunca duplicado/criado de novo");
      assert.equal(histReimport.usuarioCriado, null);
      const histProfissional = await prismaTest.profissional.findUniqueOrThrow({ where: { codigo: histCodigo } });
      assert.equal(histProfissional.deletedAt, null);
      assert.equal(await prismaTest.profissional.count({ where: { codigo: histCodigo } }), 1, "nunca duplica Profissional");
      assert.equal(await prismaTest.usuario.count({ where: { id: histUsuario.id } }), 1, "nunca duplica Usuario — mesmo id reativado");
      assert.equal((await prismaTest.usuario.findUniqueOrThrow({ where: { id: histUsuario.id } })).ativo, true);
      console.log("PASS: RECREATE_FROM_HISTORY — código histórico reutilizado, Profissional recriado, Usuario reativado sem duplicar.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: histCodigo } });
      await prismaTest.profissional.deleteMany({ where: { codigo: histCodigo } });
      await prismaTest.usuario.deleteMany({ where: { id: histUsuario.id } });
      await prismaTest.adminAuditLog.deleteMany({ where: { targetCodigo: histCodigo } });
    }

    // ─── CASO RONALD — colisão real de hash: duas identidades SEM_PROFISSIONAL_VINCULADO distintas
    // (códigos diferentes) cujo `responsavel` histórico é EXATAMENTE o mesmo texto — o hash desse
    // nome aponta para os dois códigos. Reimportar uma linha com esse nome NUNCA pode escolher um
    // dos dois automaticamente: precisa virar CONFLICT.
    const ronaldId = randomUUID();
    const nomeCompartilhado = `TESTE RONALD COMPARTILHADO ${ronaldId}`;
    const codigoA = `TESTE-RONALD-A-${ronaldId}`;
    const codigoB = `TESTE-RONALD-B-${ronaldId}`;
    const cadastroA = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigoA, responsavel: nomeCompartilhado, razaoSocial: "Teste Ronald A", cnpjNormalizado: "00000000000000" } });
    const cadastroB = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigoB, responsavel: nomeCompartilhado, razaoSocial: "Teste Ronald B", cnpjNormalizado: "00000000000000" } });
    try {
      const deleteA = await deleteFornecedoresDefinitivamente([cadastroA.id], admin);
      assert.equal(deleteA.errors.length, 0);
      const deleteB = await deleteFornecedoresDefinitivamente([cadastroB.id], admin);
      assert.equal(deleteB.errors.length, 0);

      await assert.rejects(
        () => upsertCadastroFornecedor({ responsavel: nomeCompartilhado, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Ronald", rawPayload: {} }),
        (error: any) => {
          assert.ok(error instanceof FornecedorIdentityConflictError, `esperava FornecedorIdentityConflictError, recebeu ${error?.constructor?.name}: ${error?.message}`);
          assert.match(error.message, new RegExp(codigoA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          assert.match(error.message, new RegExp(codigoB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          return true;
        },
      );
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: { in: [codigoA, codigoB] } } }), 0, "CONFLICT nunca recria nenhum dos dois automaticamente");
      assert.equal(await prismaTest.profissional.count({ where: { codigo: { in: [codigoA, codigoB] } } }), 0);
      console.log("PASS: caso Ronald — hash de nome compartilhado entre 2 identidades distintas vira CONFLICT, nunca escolha automática.");

      // ─── FLUXO DE RESOLUÇÃO MANUAL — passo 1: candidatos reais recalculados no servidor.
      const candidatosInfo = await getCandidateCodigosForRow(nomeCompartilhado);
      assert.equal(candidatosInfo.kind, "CONFLICT");
      assert.deepEqual([...candidatosInfo.candidateCodigos].sort(), [codigoA, codigoB].sort());
      const resumos = await getIdentityCandidateSummaries(candidatosInfo.candidateCodigos);
      assert.equal(resumos.length, 2);
      for (const resumo of resumos) {
        assert.equal(resumo.profissionalStatus, "INEXISTENTE", `${resumo.codigo}: SEM_PROFISSIONAL_VINCULADO nunca tem Profissional`);
        assert.equal(resumo.usuarioStatus, "INEXISTENTE", `${resumo.codigo}: nenhum Usuario foi criado nesta fixture`);
      }

      const linhaRonald = { responsavel: nomeCompartilhado, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Ronald Resolvido", rawPayload: {} };

      // Segurança — código que NÃO está entre os candidatos apresentados NUNCA é aceito.
      await assert.rejects(
        () => resolverIdentidadeManualmente(linhaRonald, { tipo: "USAR_CANDIDATO", codigo: `TESTE-CODIGO-INVENTADO-${ronaldId}` }, admin),
        (error: any) => { assert.ok(error instanceof FornecedorResolucaoInvalidaError, `esperava FornecedorResolucaoInvalidaError, recebeu ${error?.constructor?.name}`); return true; },
      );
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: { in: [codigoA, codigoB] } } }), 0, "código inválido nunca cria nada");

      // ADMIN escolhe o candidato A explicitamente — resolve SÓ essa linha, sem reimportar nada.
      const resolvido = await resolverIdentidadeManualmente(linhaRonald, { tipo: "USAR_CANDIDATO", codigo: codigoA }, admin);
      assert.equal(resolvido.colaboradorCodigo, codigoA, "reutiliza exatamente o código escolhido pelo ADMIN, nunca gera outro");
      assert.equal(resolvido.recreated, true);
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: codigoA } }), 1);
      assert.equal(await prismaTest.profissional.count({ where: { codigo: codigoA } }), 1, "Profissional recriado com o código histórico escolhido");
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: codigoB } }), 0, "candidato B rejeitado permanece intocado");
      assert.equal(await prismaTest.profissional.count({ where: { codigo: codigoB } }), 0);
      const auditoriaManual = await prismaTest.adminAuditLog.findFirstOrThrow({ where: { action: "IDENTITY_MANUAL_RESOLUTION", targetCodigo: codigoA, adminId: admin.id } });
      assert.equal((auditoriaManual.metadata as any)?.codigoEscolhido, codigoA);
      assert.ok(!JSON.stringify(auditoriaManual.metadata).match(/senha|password/i), "auditoria nunca guarda senha/segredo");
      console.log("PASS: resolução manual — escolha do ADMIN reutiliza o código exato, código inválido é rejeitado, candidato rejeitado nunca é tocado.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [codigoA, codigoB] } } });
      await prismaTest.profissional.deleteMany({ where: { codigo: { in: [codigoA, codigoB] } } });
      await prismaTest.adminAuditLog.deleteMany({ where: { targetCodigo: { in: [codigoA, codigoB] } } });
      await prismaTest.usuario.deleteMany({ where: { nome: nomeCompartilhado } });
    }

    // ─── "NENHUMA DESSAS IDENTIDADES" — só é aceita quando o código que seria gerado não colide
    // com nenhuma identidade histórica existente (nem os próprios candidatos rejeitados).
    const nenhumaId = randomUUID();
    const nomeConflitoNenhuma = `TESTE NENHUMA CONFLITO ${nenhumaId}`;
    // Candidato C usa o PRÓPRIO nome como código (convenção nome-como-código) — reproduz o caso
    // real de Ronald: o código que "Nenhuma dessas identidades" geraria para esta linha é
    // EXATAMENTE um dos candidatos rejeitados, então precisa ser bloqueado.
    const codigoNenhumaC = nomeConflitoNenhuma;
    const codigoNenhumaD = `TESTE-NENHUMA-D-${nenhumaId}`;
    const cadastroC = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigoNenhumaC, responsavel: nomeConflitoNenhuma, razaoSocial: "Teste C", cnpjNormalizado: "00000000000000" } });
    const cadastroD = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigoNenhumaD, responsavel: nomeConflitoNenhuma, razaoSocial: "Teste D", cnpjNormalizado: "00000000000000" } });
    try {
      await deleteFornecedoresDefinitivamente([cadastroC.id], admin);
      await deleteFornecedoresDefinitivamente([cadastroD.id], admin);

      // INSEGURO: o nome da linha em conflito É um dos próprios candidatos rejeitados (mesmo texto
      // usado como responsavel/código histórico) — criar do zero colidiria com uma identidade real.
      await assert.rejects(
        () => resolverIdentidadeManualmente({ responsavel: nomeConflitoNenhuma, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste", rawPayload: {} }, { tipo: "NENHUMA_IDENTIDADE" }, admin),
        (error: any) => { assert.ok(error instanceof FornecedorResolucaoInvalidaError); return true; },
      );
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: { in: [codigoNenhumaC, codigoNenhumaD] } } }), 0);

      console.log("PASS: \"Nenhuma dessas identidades\" bloqueada quando o código geraria colisão com identidade real.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [codigoNenhumaC, codigoNenhumaD] } } });
      await prismaTest.profissional.deleteMany({ where: { codigo: { in: [codigoNenhumaC, codigoNenhumaD] } } });
      await prismaTest.adminAuditLog.deleteMany({ where: { targetCodigo: { in: [codigoNenhumaC, codigoNenhumaD] } } });
    }

    // SEGURO: um conflito onde os códigos históricos são DISTINTOS do nome compartilhado (mesmo
    // padrão do caso Ronald) — "nenhuma dessas identidades" pode criar uma pessoa nova
    // legitimamente, porque o código gerado não colide com nenhum candidato nem com nada existente.
    const codigoNenhumaE = `TESTE-NENHUMA-E-${nenhumaId}`;
    const codigoNenhumaF = `TESTE-NENHUMA-F-${nenhumaId}`;
    const nomeConflitoSeguro = `TESTE NENHUMA SEGURO ${nenhumaId}`;
    const cadastroE = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigoNenhumaE, responsavel: nomeConflitoSeguro, razaoSocial: "Teste E", cnpjNormalizado: "00000000000000" } });
    const cadastroF = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: codigoNenhumaF, responsavel: nomeConflitoSeguro, razaoSocial: "Teste F", cnpjNormalizado: "00000000000000" } });
    try {
      await deleteFornecedoresDefinitivamente([cadastroE.id], admin);
      await deleteFornecedoresDefinitivamente([cadastroF.id], admin);

      const criada = await resolverIdentidadeManualmente({ responsavel: nomeConflitoSeguro, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Pessoa Diferente", rawPayload: {} }, { tipo: "NENHUMA_IDENTIDADE" }, admin);
      assert.equal(criada.created, true);
      assert.equal(criada.recreated, false, "identidade genuinamente nova nunca conta como recriada");
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { responsavel: nomeConflitoSeguro } }), 1);
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { colaboradorCodigo: { in: [codigoNenhumaE, codigoNenhumaF] } } }), 0, "candidatos E/F rejeitados continuam intocados");
      console.log("PASS: \"Nenhuma dessas identidades\" permitida quando o código novo é genuinamente seguro (sem colisão).");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { OR: [{ colaboradorCodigo: { in: [codigoNenhumaE, codigoNenhumaF] } }, { responsavel: nomeConflitoSeguro }] } });
      await prismaTest.profissional.deleteMany({ where: { OR: [{ codigo: { in: [codigoNenhumaE, codigoNenhumaF] } }, { nomeCompleto: nomeConflitoSeguro }, { nome: nomeConflitoSeguro }] } });
      await prismaTest.usuario.deleteMany({ where: { nome: nomeConflitoSeguro } });
      await prismaTest.adminAuditLog.deleteMany({ where: { OR: [{ targetCodigo: { in: [codigoNenhumaE, codigoNenhumaF] } }, { action: "IDENTITY_MANUAL_RESOLUTION", metadata: { path: ["responsavelImportado"], equals: nomeConflitoSeguro } }] } });
    }

    // ─── REQUIRES_REVIEW — CadastroFornecedor excluído SEM NENHUM colaboradorCodigo vinculado
    // (SEM_CODIGO_VINCULADO): não há nenhum código histórico pra reaproveitar. Reimportar essa
    // linha nunca pode ser um CREATE silencioso (perderia o histórico de exclusão) nem um
    // BLOCKED_DELETED genérico — precisa sinalizar REQUIRES_REVIEW explicitamente.
    const revisaoId = randomUUID();
    const nomeSemCodigo = `TESTE SEM CODIGO ${revisaoId}`;
    const cadastroSemCodigo = await prismaTest.cadastroFornecedor.create({ data: { colaboradorCodigo: null, responsavel: nomeSemCodigo, razaoSocial: "Teste Sem Codigo", cnpjNormalizado: "00000000000000" } });
    try {
      const deleteSemCodigo = await deleteFornecedoresDefinitivamente([cadastroSemCodigo.id], admin);
      assert.equal(deleteSemCodigo.errors.length, 0);
      assert.equal(deleteSemCodigo.administrativeDeleted, 1);

      await assert.rejects(
        () => upsertCadastroFornecedor({ responsavel: nomeSemCodigo, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Sem Codigo", rawPayload: {} }),
        (error: any) => {
          assert.ok(error instanceof FornecedorIdentityReviewError, `esperava FornecedorIdentityReviewError, recebeu ${error?.constructor?.name}: ${error?.message}`);
          return true;
        },
      );
      assert.equal(await prismaTest.cadastroFornecedor.count({ where: { responsavel: nomeSemCodigo } }), 0, "REQUIRES_REVIEW nunca cria silenciosamente");
      console.log("PASS: REQUIRES_REVIEW — identidade sem código histórico nunca vira CREATE silencioso.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { responsavel: nomeSemCodigo } });
    }

    // ─── PRESERVAÇÃO DE CONFIGURAÇÃO ADMINISTRATIVA (fonteMedicao/tipoCondicaoFixa) EM
    // RECREATE_FROM_HISTORY — mesmo padrão real de Mauricio Spindola (FIXA + DOCUMENTOS_AUXILIARES)
    // e Cristiano Jeferson (CONDICIONAL_PRODUCAO + DOCUMENTOS_AUXILIARES): campos que só existem
    // como decisão administrativa (nunca vêm da Consulta PJ) precisam sobreviver a uma exclusão
    // definitiva seguida de reimportação, sem inferência por nome.
    const cfgId = randomUUID();
    const cfgNomeA = `TESTE CONFIG FONTE AUX ${cfgId}`; // equivalente a Mauricio: FIXA + DOCUMENTOS_AUXILIARES
    const cfgNomeB = `TESTE CONFIG CONDICIONAL ${cfgId}`; // equivalente a Cristiano: CONDICIONAL_PRODUCAO + DOCUMENTOS_AUXILIARES
    const cfgCadastroA = await prismaTest.cadastroFornecedor.create({
      data: { colaboradorCodigo: cfgNomeA, responsavel: cfgNomeA, razaoSocial: "Teste Config A", cnpjNormalizado: "00000000000000", valorCondicaoFixa: 8640, fonteMedicao: "DOCUMENTOS_AUXILIARES" },
    });
    const cfgCadastroB = await prismaTest.cadastroFornecedor.create({
      data: { colaboradorCodigo: cfgNomeB, responsavel: cfgNomeB, razaoSocial: "Teste Config B", cnpjNormalizado: "00000000000000", tipoCondicaoFixa: "CONDICIONAL_PRODUCAO", valorCondicaoFixaComProducao: 8640, valorCondicaoFixaSemProducao: 12000, fonteMedicao: "DOCUMENTOS_AUXILIARES" },
    });
    try {
      const cfgDeleteA = await deleteFornecedoresDefinitivamente([cfgCadastroA.id], admin);
      const cfgDeleteB = await deleteFornecedoresDefinitivamente([cfgCadastroB.id], admin);
      assert.equal(cfgDeleteA.errors.length, 0);
      assert.equal(cfgDeleteB.errors.length, 0);

      const cfgAuditA = await prismaTest.adminAuditLog.findFirstOrThrow({ where: { targetCodigo: cfgNomeA, adminId: admin.id }, orderBy: { createdAt: "desc" } });
      const snapshotA = (cfgAuditA.metadata as any)?.administrativeConfigSnapshot;
      assert.equal(snapshotA?.fonteMedicao, "DOCUMENTOS_AUXILIARES");
      assert.equal(Number(snapshotA?.valorCondicaoFixaComProducao ?? -1) === -1, true, "snapshot administrativo NUNCA inclui valorCondicaoFixa comum (não é config administrativa, vem da Consulta PJ)");

      // Reimportação SEM os campos administrativos (undefined) — exatamente como a Consulta PJ real.
      const reimportA = await upsertCadastroFornecedor({ responsavel: cfgNomeA, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Config A Nova", rawPayload: {} });
      const reimportB = await upsertCadastroFornecedor({ responsavel: cfgNomeB, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Config B Nova", rawPayload: {} });
      assert.equal(reimportA.recreated, true);
      assert.equal(reimportA.administrativeConfigRestored, true);
      assert.equal(reimportB.recreated, true);
      assert.equal(reimportB.administrativeConfigRestored, true);

      const depoisA = await prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: reimportA.cadastroId } });
      const depoisB = await prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: reimportB.cadastroId } });

      // A (equivalente Mauricio): fonteMedicao restaurado; tipoCondicaoFixa nunca existiu -> continua NULL.
      assert.equal(depoisA.fonteMedicao, "DOCUMENTOS_AUXILIARES", "fonteMedicao precisa ser restaurado — nunca voltar para DOCUMENTOS por default");
      assert.equal(depoisA.tipoCondicaoFixa, null);
      // Dado cadastral NOVO da planilha prevalece — razaoSocial não é config administrativa.
      assert.equal(depoisA.razaoSocial, "Teste Config A Nova", "dado cadastral novo da reimportação nunca é sobrescrito pelo snapshot administrativo");

      // B (equivalente Cristiano): TODOS os 4 campos restaurados.
      assert.equal(depoisB.fonteMedicao, "DOCUMENTOS_AUXILIARES");
      assert.equal(depoisB.tipoCondicaoFixa, "CONDICIONAL_PRODUCAO");
      assert.equal(Number(depoisB.valorCondicaoFixaComProducao), 8640);
      assert.equal(Number(depoisB.valorCondicaoFixaSemProducao), 12000);
      assert.equal(depoisB.razaoSocial, "Teste Config B Nova");

      // Isolamento: snapshot de uma identidade NUNCA vaza para a outra (fonteMedicao igual nos dois
      // é esperado aqui, mas tipoCondicaoFixa/valores confirmam que cada um restaurou o SEU próprio).
      assert.notEqual(depoisA.tipoCondicaoFixa, depoisB.tipoCondicaoFixa);
      console.log("PASS: RECREATE_FROM_HISTORY preserva fonteMedicao/tipoCondicaoFixa/valorCondicaoFixaComProducao/valorCondicaoFixaSemProducao por identidade, sem misturar entre fornecedores, sem sobrescrever dado cadastral novo.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [cfgNomeA, cfgNomeB] } } });
      await prismaTest.profissional.deleteMany({ where: { codigo: { in: [cfgNomeA, cfgNomeB] } } });
      await prismaTest.usuario.deleteMany({ where: { nome: { in: [cfgNomeA, cfgNomeB] } } });
      await prismaTest.adminAuditLog.deleteMany({ where: { targetCodigo: { in: [cfgNomeA, cfgNomeB] } } });
    }

    // ─── EXCLUSÃO ANTIGA SEM SNAPSHOT (legado) — audit log de antes desta correção não tem
    // `administrativeConfigSnapshot`; a recriação precisa cair no default (DOCUMENTOS/FIXA), nunca
    // inventar valor, e sinalizar `administrativeConfigUnrecoverable`.
    const legadoSemSnapshotId = randomUUID();
    const legadoSemSnapshotNome = `TESTE LEGADO SEM SNAPSHOT ${legadoSemSnapshotId}`;
    await prismaTest.adminAuditLog.create({
      data: {
        action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
        targetType: "CadastroFornecedor", targetId: null, targetCodigo: legadoSemSnapshotNome,
        // identityNameHashes presente (mecanismo já existia antes desta correção) — só
        // administrativeConfigSnapshot ausente, exatamente como uma exclusão feita antes dela.
        metadata: { resultado: "SEM_PROFISSIONAL_VINCULADO", identityNameHashes: [legacyIdentityNameHash(legadoSemSnapshotNome)] },
      },
    });
    try {
      const legadoReimport = await upsertCadastroFornecedor({ responsavel: legadoSemSnapshotNome, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Legado", rawPayload: {} });
      assert.equal(legadoReimport.recreated, true);
      assert.equal(legadoReimport.administrativeConfigRestored, false, "sem snapshot no audit log, nada para restaurar");
      assert.equal(legadoReimport.administrativeConfigUnrecoverable, true, "recriação sem snapshot precisa sinalizar que a config anterior não pôde ser recuperada");
      const legadoDepois = await prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: legadoReimport.cadastroId } });
      assert.equal(legadoDepois.fonteMedicao, null, "default legado (nunca inventa DOCUMENTOS_AUXILIARES por acidente)");
      assert.equal(legadoDepois.tipoCondicaoFixa, null);
      console.log("PASS: exclusão antiga sem snapshot — recriação cai no default e sinaliza administrativeConfigUnrecoverable, nunca inventa valor.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: legadoSemSnapshotNome } });
      await prismaTest.profissional.deleteMany({ where: { codigo: legadoSemSnapshotNome } });
      await prismaTest.adminAuditLog.deleteMany({ where: { targetCodigo: legadoSemSnapshotNome } });
    }

    // ─── SNAPSHOT MALFORMADO (JSON livre corrompido/adulterado no AdminAuditLog) — tipoCondicaoFixa
    // com um valor que NUNCA poderia ter sido gravado por esta aplicação (nem "FIXA", nem
    // "CONDICIONAL_PRODUCAO", nem null). A recriação precisa cair no comportamento legado seguro
    // (NULL, que normalizeTipoCondicaoFixa já lê como FIXA), nunca gravar o lixo no banco, e
    // sinalizar administrativeConfigSnapshotMalformed.
    const malformadoId = randomUUID();
    const malformadoNome = `TESTE SNAPSHOT MALFORMADO ${malformadoId}`;
    await prismaTest.adminAuditLog.create({
      data: {
        action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
        targetType: "CadastroFornecedor", targetId: null, targetCodigo: malformadoNome,
        metadata: {
          resultado: "SEM_PROFISSIONAL_VINCULADO",
          identityNameHashes: [legacyIdentityNameHash(malformadoNome)],
          administrativeConfigSnapshot: { fonteMedicao: "BM_AUX_QUALQUER_COISA", tipoCondicaoFixa: "VALOR_QUE_NUNCA_EXISTIU", valorCondicaoFixaComProducao: null, valorCondicaoFixaSemProducao: null },
        },
      },
    });
    try {
      const malformadoReimport = await upsertCadastroFornecedor({ responsavel: malformadoNome, cnpj: "00000000000000", cnpjNormalizado: "00000000000000", razaoSocial: "Teste Malformado", rawPayload: {} });
      assert.equal(malformadoReimport.recreated, true);
      assert.equal(malformadoReimport.administrativeConfigRestored, true, "havia snapshot (mesmo que malformado) — é considerado 'restaurado' com fallback seguro, não 'sem snapshot'");
      assert.equal(malformadoReimport.administrativeConfigSnapshotMalformed, true, "precisa sinalizar que o snapshot não era um valor reconhecido");
      const malformadoDepois = await prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: malformadoReimport.cadastroId } });
      assert.equal(malformadoDepois.tipoCondicaoFixa, null, "nunca grava o valor bruto do snapshot corrompido no banco");
      assert.equal(malformadoDepois.fonteMedicao, null, "mesma proteção para fonteMedicao");
      console.log("PASS: snapshot administrativo malformado — nunca grava valor arbitrário no banco, cai no default legado seguro e sinaliza administrativeConfigSnapshotMalformed.");
    } finally {
      await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: malformadoNome } });
      await prismaTest.profissional.deleteMany({ where: { codigo: malformadoNome } });
      await prismaTest.adminAuditLog.deleteMany({ where: { targetCodigo: malformadoNome } });
    }

    console.log("PASS: serviços reais — exclusão, rollback, auditoria, snapshots, reimportação e e-mail.");
  } finally {
    await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: codigo } });
    await prismaTest.medicao.deleteMany({ where: { id: medicao.id } });
    await prismaTest.profissional.deleteMany({ where: { id: profissional.id } });
    await prismaTest.projeto.deleteMany({ where: { id: projeto.id } });
    await prismaTest.adminAuditLog.deleteMany({ where: { adminId: admin.id } });
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
