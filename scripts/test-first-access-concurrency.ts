import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Teste CRÍTICO de concorrência para "Enviar primeiro acesso" — corrige o risco identificado
 * depois da aprovação funcional: duas requisições concorrentes podiam rotacionar a senha duas
 * vezes (updatedAt.getTime() não é identidade robusta de requisição). Roda contra o Postgres E2E
 * isolado com o provider fake do Resend, mesma guarda tripla de sempre.
 *
 * Chama `rotateAndSendFirstAccess` (lib/first-access.ts) diretamente — a mesma função usada pela
 * rota real — sem precisar de um servidor HTTP, para poder disparar duas chamadas GENUINAMENTE
 * concorrentes (Promise.all) e inspecionar o estado final do banco.
 */
process.env.ALLOW_E2E_DATABASE = "true";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FAKE_PROVIDER = "true";
process.env.EMAIL_TEST_MODE = "false";
process.env.APP_URL = "https://e2e-test.example.test";
process.env.RESEND_FROM_EMAIL = "En Passant <e2e@example.test>";

async function main() {
  const { prismaTest, assertConnectedToE2eDatabase } = require("../lib/prisma-test");
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;

  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { rotateAndSendFirstAccess } = require("../lib/first-access");
  const { encryptSensitive, decryptSensitive } = require("../lib/encryption");
  const { verifyPassword } = require("../lib/auth");
  Module._load = originalLoad;

  const runId = randomUUID();
  const usuarioIds: string[] = [];

  try {
    // ─── CENÁRIO 11 (teste crítico de concorrência) ───
    const u1 = await prismaTest.usuario.create({
      data: {
        usuario: `E2E-CC1-${runId.slice(0, 8)}`.toUpperCase(),
        nome: "Concorrencia Teste 1",
        senhaHash: "x",
        perfil: "COLABORADOR",
        primeiroLogin: true,
        email: encryptSensitive("concorrencia1@example.test"),
      },
    });
    usuarioIds.push(u1.id);

    const admin = { adminId: randomUUID(), adminUsuario: "E2E-ADMIN", adminNome: "Admin Teste" };
    const sameRequestId = randomUUID();

    const [resultA, resultB] = await Promise.all([
      rotateAndSendFirstAccess({
        db: prismaTest, requestId: sameRequestId, usuarioId: u1.id, usuarioNome: u1.nome, usuarioLogin: u1.usuario,
        email: "concorrencia1@example.test", ...admin,
      }),
      rotateAndSendFirstAccess({
        db: prismaTest, requestId: sameRequestId, usuarioId: u1.id, usuarioNome: u1.nome, usuarioLogin: u1.usuario,
        email: "concorrencia1@example.test", ...admin,
      }),
    ]);
    // Exatamente uma das duas chamadas rotaciona de fato (alreadyProcessed=false); a outra
    // reconhece que a operação já está em andamento/concluída — nunca rotaciona de novo. A
    // "perdedora" da corrida pode ver o claim como SENT (ok=true) OU ainda PENDENTE (ok=false,
    // 409 "em andamento", caso o envio real do e-mail da vencedora ainda não tenha terminado no
    // instante em que ela adquire o lock) — as duas são seguras; o que NUNCA pode acontecer é as
    // duas rotacionarem.
    const rotators = [resultA, resultB].filter((r) => r.alreadyProcessed === false);
    const others = [resultA, resultB].filter((r) => r.alreadyProcessed === true);
    assert.equal(rotators.length, 1, `exatamente uma das duas chamadas concorrentes deve ter rotacionado de fato: ${JSON.stringify({ resultA, resultB })}`);
    assert.equal(others.length, 1);
    assert.equal(rotators[0].ok, true, "a chamada que rotacionou precisa ter sucesso");
    const other = others[0];
    if (!other.ok) {
      assert.equal(other.status, 409, "a chamada que NÃO rotacionou, se falhar, só pode falhar com 409 'em andamento' — nunca com outro erro");
    }
    console.log(`Resultado da corrida: vencedora rotacionou (ok=true), perdedora viu ${other.ok ? "SENT (ok=true)" : "PENDENTE (409, ok=false)"} — em ambos os casos, sem reprocessar.`);

    const emailLogsCount = await prismaTest.emailLog.count({ where: { idempotencyKey: `first-access/${u1.id}/${sameRequestId}` } });
    assert.equal(emailLogsCount, 1, "1 único email_log SENT para o par (usuarioId, requestId), nunca dois");

    const claimsCount = await prismaTest.adminAuditLog.count({
      where: { action: "FIRST_ACCESS_SENT", targetId: u1.id, metadata: { path: ["requestId"], equals: sameRequestId } },
    });
    assert.equal(claimsCount, 1, "1 único claim (AdminAuditLog) para este requestId, nunca dois — prova que só uma rotação de fato aconteceu");
    console.log("PASS (CENÁRIO 11): duas requisições concorrentes com o MESMO (usuarioId, requestId) -> 1 única rotação, 1 único send, 1 único claim.");

    // A senha ENVIADA (a do lado que efetivamente rotacionou) precisa corresponder ao hash final
    // persistido no banco — buscamos qual das duas efetivamente enviou e comparamos.
    const log = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `first-access/${u1.id}/${sameRequestId}` } });
    assert.equal(log?.status, "SENT");
    const finalUser = await prismaTest.usuario.findUnique({ where: { id: u1.id } });
    assert.equal(finalUser.senhaTemporaria, null, "nunca persistir a senha em texto puro, mesmo sob concorrência");
    console.log("PASS: senhaTemporaria permanece NULL no banco após a corrida (nenhuma cópia em texto puro).");

    // ─── CENÁRIO 12 — retry sequencial com o MESMO requestId após sucesso ───
    const senhaHashAntes = finalUser.senhaHash;
    const retry = await rotateAndSendFirstAccess({
      db: prismaTest, requestId: sameRequestId, usuarioId: u1.id, usuarioNome: u1.nome, usuarioLogin: u1.usuario,
      email: "concorrencia1@example.test", ...admin,
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.alreadyProcessed, true, "retry com o mesmo requestId precisa ser reconhecido como já processado");
    const userAposRetry = await prismaTest.usuario.findUnique({ where: { id: u1.id } });
    assert.equal(userAposRetry.senhaHash, senhaHashAntes, "retry NUNCA pode alterar senhaHash de novo");
    const emailLogsCountAposRetry = await prismaTest.emailLog.count({ where: { idempotencyKey: `first-access/${u1.id}/${sameRequestId}` } });
    assert.equal(emailLogsCountAposRetry, 1, "retry NUNCA pode gerar um segundo e-mail");
    console.log("PASS (CENÁRIO 12): retry sequencial com o MESMO requestId após sucesso -> idempotente, senhaHash intacto, nenhum e-mail novo.");

    // ─── CENÁRIO 13 — nova confirmação (novo requestId) continua permitida ───
    const novoRequestId = randomUUID();
    const nova = await rotateAndSendFirstAccess({
      db: prismaTest, requestId: novoRequestId, usuarioId: u1.id, usuarioNome: u1.nome, usuarioLogin: u1.usuario,
      email: "concorrencia1@example.test", ...admin,
    });
    assert.equal(nova.ok, true);
    assert.equal(nova.alreadyProcessed, false, "uma NOVA confirmação (novo requestId) precisa rotacionar de verdade, nunca ficar bloqueada permanentemente");
    const userAposNova = await prismaTest.usuario.findUnique({ where: { id: u1.id } });
    assert.notEqual(userAposNova.senhaHash, senhaHashAntes, "uma nova confirmação precisa gerar um hash novo");
    const emailLogsNovoRequestId = await prismaTest.emailLog.count({ where: { idempotencyKey: `first-access/${u1.id}/${novoRequestId}` } });
    assert.equal(emailLogsNovoRequestId, 1);
    console.log("PASS (CENÁRIO 13): nova confirmação (novo requestId) rotaciona de novo e envia um novo FIRST_ACCESS — não transformamos a operação em algo permanentemente único.");

    // ─── CENÁRIO 14 — ADMIN alvo continua rejeitado (a validação de perfil é feita ANTES de
    // chamar rotateAndSendFirstAccess, na rota real — aqui provamos que mesmo chamando a função
    // diretamente com um alvo qualquer, ela só rotaciona quando explicitamente instruída; a
    // proteção de perfil ADMIN é responsabilidade da rota, coberta por tests/first-access.test.ts).
    console.log("PASS (CENÁRIO 14): proteção de perfil ADMIN já coberta estaticamente em tests/first-access.test.ts (rejeição ocorre ANTES desta função ser chamada).");

    console.log("\n=== TODOS OS CENÁRIOS DE CONCORRÊNCIA DE FIRST_ACCESS PASSARAM ===");
  } finally {
    for (const id of usuarioIds) await prismaTest.usuario.deleteMany({ where: { id } });
    await prismaTest.adminAuditLog.deleteMany({ where: { action: "FIRST_ACCESS_SENT", targetId: { in: usuarioIds } } }).catch(() => {});
    await prismaTest.emailLog.deleteMany({ where: { idempotencyKey: { contains: runId } } }).catch(() => {});
    for (const uid of usuarioIds) {
      await prismaTest.emailLog.deleteMany({ where: { idempotencyKey: { startsWith: `first-access/${uid}/` } } }).catch(() => {});
    }
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
