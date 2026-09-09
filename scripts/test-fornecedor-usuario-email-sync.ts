import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prismaTest, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Auditoria pós-incidente: o botão "Enviar primeiro acesso" ficava desabilitado para
 * fornecedores recém-criados/reimportados porque `upsertCadastroFornecedor` nunca copiava
 * `row.email` para o `Usuario.email` vinculado — nem na criação (`tx.usuario.create`), nem na
 * reativação (`tx.usuario.update`). `CadastroFornecedor.email`/`Profissional.email` sempre
 * estiveram corretos; só o `Usuario` (identidade de acesso/login) ficava sem e-mail.
 * `primeiroLogin` nunca foi o problema — confirmado antes de tocar em qualquer código.
 */
async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;

  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { upsertCadastroFornecedor, deleteFornecedoresDefinitivamente } = require("../lib/cadastro-fornecedor");
  const { decryptSensitive } = require("../lib/encryption");
  const { rotateAndSendFirstAccess } = require("../lib/first-access");
  Module._load = originalLoad;

  process.env.ALLOW_E2E_DATABASE = "true";
  process.env.EMAIL_ENABLED = "true";
  process.env.EMAIL_FAKE_PROVIDER = "true";
  process.env.EMAIL_TEST_MODE = "false";
  process.env.APP_URL = "https://e2e-test.example.test";
  process.env.RESEND_FROM_EMAIL = "En Passant <e2e@example.test>";

  const id = randomUUID();
  const nome = `TESTE EMAIL SYNC ${id}`;
  const admin = { id: randomUUID(), nome: "Administrador de teste", usuario: "TESTE-EMAIL-SYNC" };
  const cleanup: { cadastroId?: string; profissionalId?: string; usuario?: string } = {};

  try {
    // ─── CRIAÇÃO: fornecedor novo -> Usuario novo -> email precisa vir junto ───
    const created = await upsertCadastroFornecedor({
      responsavel: nome, cnpj: "11111111111111", cnpjNormalizado: "11111111111111",
      razaoSocial: "Teste Email Sync", email: "email-sync-1@example.test", rawPayload: {},
    });
    cleanup.cadastroId = created.cadastroId;
    cleanup.profissionalId = created.colaboradorCodigo;

    const usuario1 = await prismaTest.usuario.findFirst({ where: { nome, perfil: "COLABORADOR" } });
    assert.ok(usuario1, "esperava um Usuario COLABORADOR criado para este fornecedor");
    cleanup.usuario = usuario1.usuario;
    assert.equal(usuario1.primeiroLogin, true, "primeiroLogin precisa ser true numa conta nova (isso já funcionava)");
    assert.equal(decryptSensitive(usuario1.email), "email-sync-1@example.test", "Usuario.email precisa ser sincronizado com o e-mail da importação na CRIAÇÃO");
    console.log("PASS: criação de fornecedor novo -> Usuario.email sincronizado (antes ficava NULL).");

    // ─── EXCLUSÃO: limpa email/primeiroLogin (comportamento já existente, não alterado) ───
    await deleteFornecedoresDefinitivamente([created.cadastroId], admin, "teste de sincronização de e-mail");
    const usuarioExcluido = await prismaTest.usuario.findUniqueOrThrow({ where: { id: usuario1.id } });
    assert.ok(usuarioExcluido.excluidoAt, "precisa estar excluído após deleteFornecedoresDefinitivamente");
    assert.equal(usuarioExcluido.email, null);

    // ─── REATIVAÇÃO (reimportação): email precisa voltar, primeiroLogin precisa voltar a true ───
    const reimported = await upsertCadastroFornecedor({
      responsavel: nome, cnpj: "11111111111111", cnpjNormalizado: "11111111111111",
      razaoSocial: "Teste Email Sync", email: "email-sync-2@example.test", rawPayload: {},
    });
    cleanup.cadastroId = reimported.cadastroId;

    const usuarioReativado = await prismaTest.usuario.findUniqueOrThrow({ where: { id: usuario1.id } });
    assert.equal(usuarioReativado.excluidoAt, null, "precisa estar reativado");
    assert.equal(usuarioReativado.primeiroLogin, true, "reativação de quem nunca concluiu o primeiro acesso precisa manter primeiroLogin=true (comportamento já existente)");
    assert.equal(decryptSensitive(usuarioReativado.email), "email-sync-2@example.test", "Usuario.email precisa ser sincronizado com o e-mail da reimportação na REATIVAÇÃO");
    console.log("PASS: reativação por reimportação -> Usuario.email sincronizado de novo (antes ficava NULL permanentemente).");

    // ─── Reimportar de novo (usuário JÁ ativo, não veio de exclusão) não deve tocar primeiroLogin,
    // mas o e-mail precisa continuar sincronizado se a planilha trouxer um endereço atualizado ───
    await prismaTest.usuario.update({ where: { id: usuario1.id }, data: { primeiroLogin: false } });
    const reimported2 = await upsertCadastroFornecedor({
      responsavel: nome, cnpj: "11111111111111", cnpjNormalizado: "11111111111111",
      razaoSocial: "Teste Email Sync", email: "email-sync-3@example.test", rawPayload: {},
    });
    cleanup.cadastroId = reimported2.cadastroId;
    const usuarioJaAtivo = await prismaTest.usuario.findUniqueOrThrow({ where: { id: usuario1.id } });
    assert.equal(usuarioJaAtivo.primeiroLogin, false, "reimportar um usuário JÁ ATIVO (que já concluiu o primeiro acesso) nunca pode voltar primeiroLogin para true sem exclusão de por meio — comportamento já existente, não alterado por esta correção");
    assert.equal(decryptSensitive(usuarioJaAtivo.email), "email-sync-3@example.test", "GAP REAL ENCONTRADO EM PRODUÇÃO: reimportar um usuário JÁ ATIVO (nem create, nem reativação) também precisa sincronizar Usuario.email — sem isso, um Usuario criado antes da 1a correção nunca é corrigido por reimportações futuras");
    console.log("PASS: reimportar um usuário já ativo sincroniza Usuario.email e NÃO reabre primeiroLogin.");

    // ─── senhaHash NUNCA muda só por sincronizar e-mail (usuário já ativo, sem exclusão) ───
    const senhaHashAntes = usuarioJaAtivo.senhaHash;
    const reimported3 = await upsertCadastroFornecedor({
      responsavel: nome, cnpj: "11111111111111", cnpjNormalizado: "11111111111111",
      razaoSocial: "Teste Email Sync", email: "email-sync-4@example.test", rawPayload: {},
    });
    cleanup.cadastroId = reimported3.cadastroId;
    const usuarioAposMaisUmaReimportacao = await prismaTest.usuario.findUniqueOrThrow({ where: { id: usuario1.id } });
    assert.equal(usuarioAposMaisUmaReimportacao.senhaHash, senhaHashAntes, "sincronizar e-mail NUNCA pode alterar senhaHash");
    assert.equal(decryptSensitive(usuarioAposMaisUmaReimportacao.email), "email-sync-4@example.test", "e-mail mudou entre reimportações -> Usuario precisa refletir o valor NOVO (b@empresa.com)");
    console.log("PASS: e-mail atualizado entre reimportações, senhaHash intacto.");

    // ─── Profissional/CadastroFornecedor também com o e-mail mais recente (mesma identidade canônica) ───
    const cadastroFinal = await prismaTest.cadastroFornecedor.findUniqueOrThrow({ where: { id: reimported3.cadastroId } });
    const profissionalFinal = await prismaTest.profissional.findUniqueOrThrow({ where: { codigo: reimported3.colaboradorCodigo } });
    assert.equal(decryptSensitive(cadastroFinal.email), "email-sync-4@example.test");
    assert.equal(decryptSensitive(profissionalFinal.email), "email-sync-4@example.test");
    console.log("PASS: CadastroFornecedor.email, Profissional.email e Usuario.email convergem para o mesmo valor (identidade canônica por colaboradorCodigo/usuario, nunca CNPJ).");

    // ─── FIRST_ACCESS consegue usar o e-mail agora sincronizado (sem fallback cadastral —
    // continua exigindo Usuario.email real) ───
    const firstAccessResult = await rotateAndSendFirstAccess({
      db: prismaTest,
      requestId: randomUUID(),
      usuarioId: usuario1.id,
      usuarioNome: usuarioAposMaisUmaReimportacao.nome,
      usuarioLogin: usuarioAposMaisUmaReimportacao.usuario,
      email: decryptSensitive(usuarioAposMaisUmaReimportacao.email),
      adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
    });
    assert.equal(firstAccessResult.ok, true, `FIRST_ACCESS precisa funcionar com o e-mail sincronizado: ${JSON.stringify(firstAccessResult)}`);
    console.log("PASS: FIRST_ACCESS envia com sucesso usando o Usuario.email agora sincronizado.");

    console.log("\n=== TODOS OS CENÁRIOS DE SINCRONIZAÇÃO DE E-MAIL PASSARAM ===");
  } finally {
    if (cleanup.cadastroId) await prismaTest.cadastroFornecedor.deleteMany({ where: { id: cleanup.cadastroId } });
    let usuarioId: string | undefined;
    if (cleanup.usuario) {
      const u = await prismaTest.usuario.findUnique({ where: { usuario: cleanup.usuario } });
      usuarioId = u?.id;
      await prismaTest.usuario.deleteMany({ where: { usuario: cleanup.usuario } });
    }
    await prismaTest.profissional.deleteMany({ where: { nome } });
    await prismaTest.adminAuditLog.deleteMany({ where: { adminId: admin.id } });
    if (usuarioId) {
      await prismaTest.emailLog.deleteMany({ where: { idempotencyKey: { startsWith: `first-access/${usuarioId}/` } } }).catch(() => {});
    }
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
