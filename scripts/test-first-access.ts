import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Auditoria funcional do evento FIRST_ACCESS ("Enviar primeiro acesso" no Painel Administrativo),
 * mesmo padrão de scripts/test-email-events.ts: roda contra o Postgres E2E isolado com o provider
 * fake do Resend (guarda tripla real de lib/email/send-email.ts::isFakeProviderAllowed — nunca
 * alcançável em produção). Cobre os cenários do pedido que não dependem de rota HTTP real
 * (cenários A/B/G/H/I) — cenários C/D/E/F (rejeição de ADMIN, e-mail ausente, invalidação de senha
 * anterior, login funcionando com a senha nova) são cobertos por tests/first-access.test.ts
 * (checagem estática do código-fonte da rota) e por teste manual, já que exigem o servidor HTTP
 * real de ponta a ponta.
 */
process.env.ALLOW_E2E_DATABASE = "true";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FAKE_PROVIDER = "true";
process.env.EMAIL_TEST_MODE = "false";
process.env.APP_URL = "https://e2e-test.example.test";
process.env.RESEND_FROM_EMAIL = "En Passant <e2e@example.test>";
// Propositalmente configurados: prova que FIRST_ACCESS NUNCA usa CC, mesmo com as duas variáveis
// preenchidas (diferente de BM_APPROVED/PAYMENT_READY, que usariam uma delas).
process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com";
process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com";

async function main() {
  const { prismaTest, assertConnectedToE2eDatabase } = require("../lib/prisma-test");
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;

  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { notifyFirstAccess } = require("../lib/email/events");
  const { encryptSensitive } = require("../lib/encryption");
  Module._load = originalLoad;

  const runId = randomUUID();
  const usuarioIds: string[] = [];

  try {
    const usuario = await prismaTest.usuario.create({
      data: {
        usuario: `E2E-FA-${runId.slice(0, 8)}`.toUpperCase(),
        nome: "Colaborador Primeiro Acesso Teste",
        senhaHash: "x",
        perfil: "COLABORADOR",
        primeiroLogin: true,
        email: encryptSensitive("colaborador-teste@example.test"),
      },
    });
    usuarioIds.push(usuario.id);

    // ─── CENÁRIO A/B — SENT, TO = e-mail do próprio usuário, CC = nenhum (nunca EMAIL_BM_CC/
    // EMAIL_FINANCE_CC, mesmo os dois configurados acima) ───
    // credentialVersion é o requestId (UUID) gerado pelo frontend por confirmação — nunca mais um
    // timestamp (ver lib/first-access.ts e scripts/test-first-access-concurrency.ts).
    const v1 = randomUUID();
    const result1 = await notifyFirstAccess({
      usuarioId: usuario.id, nome: usuario.nome, usuario: usuario.usuario,
      email: "colaborador-teste@example.test", senhaTemporaria: "Ab3$xZ", credentialVersion: v1,
    });
    assert.equal(result1.ok, true, `esperava sucesso, veio: ${JSON.stringify(result1)}`);
    assert.deepEqual(result1.actualRecipients, ["colaborador-teste@example.test"]);
    assert.deepEqual(result1.actualCc, [], "FIRST_ACCESS nunca deve ter CC, mesmo com EMAIL_BM_CC/EMAIL_FINANCE_CC configurados");
    console.log("PASS: FIRST_ACCESS -> SENT, TO = e-mail do usuário, CC = nenhum.");

    // ─── CENÁRIO G — senha nunca aparece em email_logs (nem em metadata, nem em nenhum campo) ───
    const log1 = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `first-access/${usuario.id}/${v1}` } });
    assert.ok(log1, "precisa existir email_log para o envio");
    const serializedLog = JSON.stringify(log1);
    assert.doesNotMatch(serializedLog, /Ab3\$xZ/, "a senha temporária NUNCA pode aparecer em nenhum campo de email_logs");
    assert.deepEqual(Object.keys(log1.metadata ?? {}).sort(), ["actualBcc", "actualCc", "intendedBcc", "intendedCc", "usuarioId"].sort());
    console.log("PASS: senha temporária não aparece em nenhum campo de email_logs (metadata só guarda usuarioId + CC/BCC).");

    // ─── CENÁRIO I — idempotência por ROTAÇÃO: repetir com a MESMA credentialVersion não duplica ───
    const repeat1 = await notifyFirstAccess({
      usuarioId: usuario.id, nome: usuario.nome, usuario: usuario.usuario,
      email: "colaborador-teste@example.test", senhaTemporaria: "Ab3$xZ", credentialVersion: v1,
    });
    assert.equal(repeat1.providerMessageId, result1.providerMessageId, "mesma rotação (mesma credentialVersion) não pode gerar um segundo envio");
    const countV1 = await prismaTest.emailLog.count({ where: { idempotencyKey: `first-access/${usuario.id}/${v1}`, status: "SENT" } });
    assert.equal(countV1, 1);
    console.log("PASS: repetir a MESMA rotação (mesma credentialVersion) não duplica envio.");

    // ─── Uma NOVA rotação (novo clique confirmado em "Enviar primeiro acesso", nova senha, novo
    // requestId/credentialVersion) precisa poder enviar de novo — ação explicitamente repetível.
    const v2 = randomUUID();
    const result2 = await notifyFirstAccess({
      usuarioId: usuario.id, nome: usuario.nome, usuario: usuario.usuario,
      email: "colaborador-teste@example.test", senhaTemporaria: "Zq9!kM", credentialVersion: v2,
    });
    assert.equal(result2.ok, true);
    assert.notEqual(result2.providerMessageId, result1.providerMessageId, "uma nova rotação precisa gerar um envio novo, nunca reaproveitar o anterior");
    console.log("PASS: uma nova rotação (nova credentialVersion) gera um novo envio — ação repetível conforme item 21 do pedido.");

    // ─── CENÁRIO H — EMAIL_TEST_MODE=true: o destinatário REAL (com a senha) nunca recebe ───
    process.env.EMAIL_TEST_MODE = "true";
    process.env.EMAIL_TEST_RECIPIENT = "qa-inbox@example.test";
    const v3 = randomUUID();
    const testModeResult = await notifyFirstAccess({
      usuarioId: usuario.id, nome: usuario.nome, usuario: usuario.usuario,
      email: "colaborador-teste@example.test", senhaTemporaria: "Nn5&wP", credentialVersion: v3,
    });
    assert.equal(testModeResult.ok, true);
    assert.deepEqual(testModeResult.actualRecipients, ["qa-inbox@example.test"], "em EMAIL_TEST_MODE=true, o destinatário real NUNCA pode receber a senha — só o endereço de teste");
    assert.equal(testModeResult.testMode, true);
    console.log("PASS: EMAIL_TEST_MODE=true redireciona para EMAIL_TEST_RECIPIENT — o fornecedor/funcionário real não recebe a senha durante testes.");
    process.env.EMAIL_TEST_MODE = "false";

    console.log("\n=== TODOS OS CENÁRIOS DE FIRST_ACCESS PASSARAM ===");
  } finally {
    for (const id of usuarioIds) await prismaTest.usuario.deleteMany({ where: { id } });
    await prismaTest.emailLog.deleteMany({ where: { idempotencyKey: { contains: runId } } }).catch(() => {});
    await prismaTest.emailLog.deleteMany({ where: { metadata: { path: ["usuarioId"], equals: usuarioIds[0] } } }).catch(() => {});
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
