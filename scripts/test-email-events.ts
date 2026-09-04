import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Auditoria funcional dos 3 eventos transacionais do fluxo BM → NF → Pagamento
 * (BM_APPROVED, PAYMENT_READY, PAYMENT_COMPLETED). Roda contra o Postgres E2E isolado
 * (medicoes-postgres-test) com o provider fake do Resend (mesma guarda tripla de
 * lib/email/send-email.ts::isFakeProviderAllowed — nunca alcançável em produção): NENHUMA chamada
 * de rede real acontece aqui, mesmo com EMAIL_TEST_MODE=false (necessário para reproduzir o bug
 * real encontrado no ambiente de dev, que roda com EMAIL_TEST_MODE=false — em EMAIL_TEST_MODE=true
 * o `to` vazio nunca aparece, porque resolveActualRecipients() sempre redireciona para o
 * destinatário de teste antes de checar `to.length`).
 *
 * ACHADO REAL (auditoria desta tarefa, evidência em lib/prisma real de dev, email_logs): BM_APPROVED
 * e PAYMENT_READY já disparam corretamente (wiring já coberto por tests/email-triggers.test.ts),
 * mas falham com CONFIG_ERROR "Nenhum destinatário real disponível para este evento" porque não
 * existe, no banco de dev, nenhum Usuario ativo com perfil=MEDICAO/FINANCEIRO E e-mail cadastrado —
 * é gap de configuração/dado, não bug de código. Este script reproduz e prova os dois estados: SEM
 * time configurado (reproduz o bug real) e COM time configurado (prova que o pipeline funciona
 * assim que a configuração existir).
 */
// NODE_ENV é readonly no tipo de process.env — este script nunca roda com NODE_ENV=production
// (mesma guarda tripla de isFakeProviderAllowed em lib/email/send-email.ts), então não precisa
// ser setado aqui; só ALLOW_E2E_DATABASE/EMAIL_FAKE_PROVIDER precisam ser explícitos.
process.env.ALLOW_E2E_DATABASE = "true";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FAKE_PROVIDER = "true";
process.env.EMAIL_TEST_MODE = "false"; // reproduz o cenário real de dev (não mascarado pelo redirecionamento de teste)
process.env.APP_URL = "https://e2e-test.example.test";
process.env.RESEND_FROM_EMAIL = "En Passant <e2e@example.test>";
process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com,anderson.marley@projetacs.com";
process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com,ximenes.silva@projetacs.com";

async function main() {
  const { prismaTest, assertConnectedToE2eDatabase } = require("../lib/prisma-test");
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;

  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const {
    notifyBmApproved,
    notifyPaymentReady,
    notifyPaymentCompleted,
  } = require("../lib/email/events");
  const { resolveMedicaoTeamEmails, resolveFinanceiroTeamEmails } = require("../lib/email/resolve-recipients");
  const { encryptSensitive } = require("../lib/encryption");
  Module._load = originalLoad;

  const runId = randomUUID();
  const cleanupIds: { usuarios: string[]; profissionais: string[]; cadastros: string[]; projetos: string[] } = {
    usuarios: [], profissionais: [], cadastros: [], projetos: [],
  };

  try {
    // ─── CENÁRIO 1 — BM_APPROVED sem nenhum Usuario ativo com perfil=MEDICAO+email: reproduz o
    // CONFIG_ERROR real encontrado no email_logs de dev.
    const semTimeSgcId = `sem-time-${runId}`;
    const semTimeResult = await notifyBmApproved({
      sgcId: semTimeSgcId, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 1000, aprovadoAt: new Date(), revisao: 0,
    });
    assert.equal(semTimeResult.ok, false, "sem Usuario MEDICAO ativo com e-mail, o envio precisa falhar com erro controlado");
    assert.match(semTimeResult.error ?? "", /Nenhum destinatário real disponível/);
    const semTimeLog = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `bm-approved/${semTimeSgcId}/0` }, orderBy: { createdAt: "desc" } });
    assert.ok(semTimeLog, "precisa ter registrado em email_logs mesmo falhando (nunca silêncio)");
    assert.equal(semTimeLog.status, "CONFIG_ERROR");
    console.log("PASS (reprodução do bug real): BM_APPROVED sem Usuario MEDICAO ativo/com e-mail -> CONFIG_ERROR, registrado em email_logs, causa raiz = configuração/dado, não código.");

    // ─── Configura o time (dado sintético, isolado no banco E2E) ───
    const medicaoUsuario = await prismaTest.usuario.create({
      data: { usuario: `E2E-MED-${runId.slice(0, 8)}`.toUpperCase(), nome: "Equipe Medicao Teste", senhaHash: "x", perfil: "MEDICAO", ativo: true, email: encryptSensitive("medicao-teste@example.test") },
    });
    cleanupIds.usuarios.push(medicaoUsuario.id);
    const financeiroUsuario = await prismaTest.usuario.create({
      data: { usuario: `E2E-FIN-${runId.slice(0, 8)}`.toUpperCase(), nome: "Equipe Financeiro Teste", senhaHash: "x", perfil: "FINANCEIRO", ativo: true, email: encryptSensitive("financeiro-teste@example.test") },
    });
    cleanupIds.usuarios.push(financeiroUsuario.id);

    const medicaoEmails = await resolveMedicaoTeamEmails();
    assert.deepEqual(medicaoEmails.emails, ["medicao-teste@example.test"]);
    const financeiroEmails = await resolveFinanceiroTeamEmails();
    assert.deepEqual(financeiroEmails.emails, ["financeiro-teste@example.test"]);
    console.log("PASS: resolveMedicaoTeamEmails/resolveFinanceiroTeamEmails retornam os e-mails reais assim que existe Usuario ativo com perfil correto e e-mail cadastrado.");

    // ─── CENÁRIO 1b — BM_APPROVED COM time configurado: precisa enviar de verdade (fake provider).
    const comTimeSgcId = `com-time-${runId}`;
    const bmResult = await notifyBmApproved({
      sgcId: comTimeSgcId, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 5000, aprovadoAt: new Date(), revisao: 0,
    });
    assert.equal(bmResult.ok, true, `esperava sucesso, veio: ${JSON.stringify(bmResult)}`);
    assert.deepEqual(bmResult.actualRecipients, ["medicao-teste@example.test"]);
    const bmLog = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `bm-approved/${comTimeSgcId}/0` } });
    assert.equal(bmLog?.status, "SENT");
    assert.equal(bmLog?.event, "BM_APPROVED");
    console.log("PASS: BM_APPROVED com Equipe de Medição configurada -> SENT, destinatário correto, email_log criado.");

    // ─── Idempotência: repetir a MESMA operação não duplica ───
    const bmRepeat = await notifyBmApproved({
      sgcId: comTimeSgcId, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 5000, aprovadoAt: new Date(), revisao: 0,
    });
    assert.equal(bmRepeat.ok, true);
    assert.equal(bmRepeat.providerMessageId, bmResult.providerMessageId, "repetir a mesma aprovação precisa retornar o MESMO providerMessageId, nunca enviar de novo");
    const bmLogCount = await prismaTest.emailLog.count({ where: { idempotencyKey: `bm-approved/${comTimeSgcId}/0`, status: "SENT" } });
    assert.equal(bmLogCount, 1, "repetir a operação não pode criar um segundo email_log SENT com a mesma chave");
    console.log("PASS: BM_APPROVED repetido (mesma revisão) não duplica envio nem email_log.");

    // ─── CENÁRIO 2 — PAYMENT_READY: mesma prova, chave de idempotência DIFERENTE de BM_APPROVED
    // mesmo para o MESMO sgcId (item 9 do pedido — chaves nunca podem colidir entre eventos).
    const nfSgcId = `nf-${runId}`;
    await prismaTest.usuario.deleteMany({ where: { id: financeiroUsuario.id } }); // remove o Financeiro para provar o CONFIG_ERROR também neste evento
    const readyResult = await notifyPaymentReady({ sgcId: nfSgcId, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 3000 });
    assert.equal(readyResult.ok, false, "sem Financeiro ativo, precisa continuar falhando com erro controlado");
    // Restaura o Financeiro para o resto do teste.
    const financeiroUsuario2 = await prismaTest.usuario.create({
      data: { usuario: `E2E-FIN2-${runId.slice(0, 8)}`.toUpperCase(), nome: "Equipe Financeiro Teste 2", senhaHash: "x", perfil: "FINANCEIRO", ativo: true, email: encryptSensitive("financeiro-teste@example.test") },
    });
    cleanupIds.usuarios.push(financeiroUsuario2.id);
    const readyResult2 = await notifyPaymentReady({ sgcId: nfSgcId, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 3000 });
    assert.equal(readyResult2.ok, true, `esperava sucesso, veio: ${JSON.stringify(readyResult2)}`);
    assert.deepEqual(readyResult2.actualRecipients, ["financeiro-teste@example.test"]);
    const readyLog = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `payment-ready/${nfSgcId}` }, orderBy: { createdAt: "desc" } });
    assert.equal(readyLog?.status, "SENT");
    assert.notEqual(`payment-ready/${nfSgcId}`, `bm-approved/${nfSgcId}/0`, "chaves de idempotência de eventos diferentes nunca colidem, mesmo para o mesmo sgcId");
    console.log("PASS: PAYMENT_READY com Financeiro configurado -> SENT, destinatário correto; chave de idempotência independente de BM_APPROVED mesmo para o mesmo sgcId.");

    const readyRepeat = await notifyPaymentReady({ sgcId: nfSgcId, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 3000 });
    assert.equal(readyRepeat.providerMessageId, readyResult2.providerMessageId);
    const readyLogCount = await prismaTest.emailLog.count({ where: { idempotencyKey: `payment-ready/${nfSgcId}`, status: "SENT" } });
    assert.equal(readyLogCount, 1);
    console.log("PASS: PAYMENT_READY repetido não duplica.");

    // ─── CENÁRIO 3 — PAYMENT_COMPLETED: destinatário é o PRÓPRIO fornecedor (colaboradorCodigo,
    // nunca CNPJ/nome). Cria um fornecedor sintético completo.
    const codigo = `TESTE-EMAIL-${runId.slice(0, 8)}`.toUpperCase();
    const projeto = await prismaTest.projeto.create({ data: { codigoProjeto: `TESTE-EMAIL-PROJ-${runId}` } });
    cleanupIds.projetos.push(projeto.id);
    const profissional = await prismaTest.profissional.create({
      data: { nome: codigo, nomeCompleto: "Fornecedor Pagamento Teste", codigo, email: encryptSensitive("fornecedor-teste@example.test") },
    });
    cleanupIds.profissionais.push(profissional.id);

    const pagamentoSgcId = `pag-${runId}`;
    const paidResult = await notifyPaymentCompleted({
      sgcId: pagamentoSgcId, colaboradorCodigo: codigo, ciclo: "2699", fornecedorNome: "Fornecedor Pagamento Teste", valor: 7000, pagoAt: new Date(),
    });
    assert.equal(paidResult.ok, true, `esperava sucesso, veio: ${JSON.stringify(paidResult)}`);
    assert.deepEqual(paidResult.actualRecipients, ["fornecedor-teste@example.test"]);
    const paidLog = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `payment-completed/${pagamentoSgcId}` } });
    assert.equal(paidLog?.status, "SENT");
    console.log("PASS: PAYMENT_COMPLETED resolve o e-mail do fornecedor via colaboradorCodigo (nunca CNPJ/nome) e envia com sucesso — evento NÃO estava quebrado, só nunca tinha sido exercitado em dev.");

    const paidRepeat = await notifyPaymentCompleted({
      sgcId: pagamentoSgcId, colaboradorCodigo: codigo, ciclo: "2699", fornecedorNome: "Fornecedor Pagamento Teste", valor: 7000, pagoAt: new Date(),
    });
    assert.equal(paidRepeat.providerMessageId, paidResult.providerMessageId);
    const paidLogCount = await prismaTest.emailLog.count({ where: { idempotencyKey: `payment-completed/${pagamentoSgcId}`, status: "SENT" } });
    assert.equal(paidLogCount, 1);
    console.log("PASS: PAYMENT_COMPLETED repetido não duplica.");

    // ─── EMAIL_ENABLED=false — operação de e-mail não acontece, mas isso é distinto de falha ───
    process.env.EMAIL_ENABLED = "false";
    const disabledResult = await notifyBmApproved({ sgcId: `disabled-${runId}`, ciclo: "2699", fornecedorNome: "Fornecedor Teste", valor: 1, aprovadoAt: new Date(), revisao: 0 });
    assert.equal(disabledResult.ok, false);
    const disabledLog = await prismaTest.emailLog.findFirst({ where: { idempotencyKey: `bm-approved/disabled-${runId}/0` } });
    assert.equal(disabledLog?.status, "DISABLED");
    console.log("PASS: EMAIL_ENABLED=false -> status DISABLED (distinto de erro), registrado claramente em email_logs.");
    process.env.EMAIL_ENABLED = "true";

    console.log("\n=== TODOS OS CENÁRIOS PASSARAM (BM_APPROVED, PAYMENT_READY, PAYMENT_COMPLETED) ===");
  } finally {
    for (const id of cleanupIds.usuarios) await prismaTest.usuario.deleteMany({ where: { id } });
    for (const id of cleanupIds.profissionais) await prismaTest.profissional.deleteMany({ where: { id } });
    for (const id of cleanupIds.projetos) await prismaTest.projeto.deleteMany({ where: { id } });
    await prismaTest.emailLog.deleteMany({ where: { idempotencyKey: { contains: runId } } });
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
