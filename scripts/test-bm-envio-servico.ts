import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * `enviarBoletimFornecedor` (lib/bm-envio.ts) contra o Postgres E2E isolado, com o provider fake do
 * Resend (mesma guarda tripla dos outros scripts). Prova que o envio individual e o envio em lote
 * produzem a MESMA transição, que o replay da mesma confirmação não refaz nada e que dois envios
 * simultâneos do mesmo BM nunca transicionam duas vezes.
 */
process.env.ALLOW_E2E_DATABASE = "true";
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_FAKE_PROVIDER = "true";
process.env.EMAIL_TEST_MODE = "true";
process.env.EMAIL_TEST_RECIPIENT = "e2e-test-recipient@example.test";
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
  const { enviarBoletimFornecedor } = require("../lib/bm-envio");
  Module._load = originalLoad;

  const run = randomUUID().slice(0, 6).toUpperCase();
  const ciclo = "2805"; // ciclo real (YYMM, mês 01–12) exclusivo deste script
  const codigos = ["A", "B", "C", "D", "E", "F", "G"].map((l) => `BM SVC ${run} ${l}`);
  // Usuário real (o log do BM referencia usuarios.id — logBmAction engole erro de FK em silêncio).
  const admin = await prismaTest.usuario.findFirstOrThrow({ where: { perfil: "ADMIN", excluidoAt: null }, select: { id: true, nome: true } });
  const usuario = { id: admin.id, nome: admin.nome };

  try {
    for (const codigo of codigos) {
      await prismaTest.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: codigo } });
      await prismaTest.cadastroFornecedor.create({ data: { responsavel: codigo, razaoSocial: `${codigo} LTDA`, colaboradorCodigo: codigo, cnpjNormalizado: `6${String(Date.now()).slice(-13)}`, email: `${codigo.replace(/\s+/g, "-").toLowerCase()}@example.test` } });
    }
    const [A, B, C, D, E, F, G] = codigos;

    // ─── 1+2: individual e lote, mesmo estado inicial (sem BM) → mesma transição ───
    const individual = await enviarBoletimFornecedor({ colaboradorCodigo: A, ciclo, usuario, telaOrigem: "Medições / Admin" });
    const requestId = randomUUID();
    const lote = await enviarBoletimFornecedor({ colaboradorCodigo: B, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId });
    assert.ok(individual.ok && lote.ok);
    const bmA = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: A, ciclo } } });
    const bmB = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: B, ciclo } } });
    for (const campo of ["status", "statusConferencia", "revisaoNumero", "conferenciaArquivo", "aprovadoAt", "pontosDiscordancia"] as const) {
      assert.deepEqual(bmB[campo], bmA[campo], `mesma transição em ${campo}`);
    }
    assert.equal(bmA.status, "PENDENTE");
    assert.equal(bmA.statusConferencia, "AGUARDANDO_UPLOAD");
    const acoes = async (sgcId: string) => (await prismaTest.sgcLog.findMany({ where: { sgcId }, orderBy: { createdAt: "asc" }, select: { acao: true, telaOrigem: true, observacao: true, statusAnterior: true, statusNovo: true } }));
    const logsA = await acoes(bmA.id);
    const logsB = await acoes(bmB.id);
    assert.deepEqual(logsA.map((l: { acao: string }) => l.acao), ["ENVIAR_BM", "EMAIL_ENVIADO"]);
    assert.deepEqual(logsB.map((l: { acao: string }) => l.acao), ["ENVIAR_BM", "EMAIL_ENVIADO"]);
    assert.equal(logsA[0].observacao, null, "individual: sem marca de lote (como antes)");
    assert.equal(logsB[0].observacao, `lote:${requestId}`);
    assert.equal(logsB[0].telaOrigem, "Fornecedores / Envio em lote");
    for (const bm of [bmA, bmB]) {
      const emails = await prismaTest.emailLog.findMany({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${bm.id}/0` } });
      assert.deepEqual(emails.map((e: { status: string }) => e.status), ["SENT"], "um BM_AVAILABLE, mesma chave de idempotência");
    }
    console.log("PASS: individual e lote produzem a mesma transição (PENDENTE/AGUARDANDO_UPLOAD/rev 0), mesmos logs e o mesmo BM_AVAILABLE.");

    // ─── 3: replay da MESMA confirmação → já enviado nesta operação, nada refeito ───
    const replay = await enviarBoletimFornecedor({ colaboradorCodigo: B, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId });
    assert.ok(replay.ok && replay.alreadyProcessed);
    assert.equal((await acoes(bmB.id)).length, 2, "replay não cria log");
    assert.equal(await prismaTest.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: { startsWith: `bm-available/${bmB.id}/` } } }), 1, "replay não envia e-mail");
    console.log("PASS: replay da mesma confirmação → 'já enviado nesta operação', sem log nem e-mail novos.");

    // ─── 4: outra confirmação para BM já enviado → 409 JA_ENVIADO ───
    const outra = await enviarBoletimFornecedor({ colaboradorCodigo: B, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() });
    assert.ok(!outra.ok && outra.httpStatus === 409 && outra.motivo === "JA_ENVIADO");
    const semMarca = await enviarBoletimFornecedor({ colaboradorCodigo: A, ciclo, usuario, telaOrigem: "Medições / Admin" });
    assert.ok(!semMarca.ok && semMarca.httpStatus === 409, "individual: retry de BM já enviado continua 409");
    console.log("PASS: BM já enviado → 409 'BM já enviado (…)' (individual e lote).");

    // ─── 5: dois REENVIOS simultâneos de uma revisão → uma única transição ───
    await prismaTest.sgcAprovacaoMedicao.update({ where: { id: bmA.id }, data: { status: "REVISAO_SOLICITADA", revisaoSolicitadaAt: new Date() } });
    const [r1, r2] = await Promise.all([
      enviarBoletimFornecedor({ colaboradorCodigo: A, ciclo, usuario, telaOrigem: "Medições / Admin" }),
      enviarBoletimFornecedor({ colaboradorCodigo: A, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() }),
    ]);
    assert.equal([r1, r2].filter((r) => r.ok).length, 1, `exatamente um reenvio: ${JSON.stringify([r1, r2].map((r) => r.ok))}`);
    const depois = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: bmA.id } });
    assert.equal(depois.revisaoNumero, 1, "revisaoNumero sobe UMA vez (antes da trava podia subir duas)");
    assert.equal((await acoes(bmA.id)).filter((l: { acao: string }) => l.acao === "REENVIAR_BM").length, 1);
    assert.equal(await prismaTest.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${bmA.id}/1` } }), 1);
    console.log("PASS: dois reenvios simultâneos da revisão → 1 transição, revisaoNumero 0→1, 1 REENVIAR_BM, 1 e-mail.");

    // ─── 6: fornecedor inexistente → 400, nada criado ───
    const invalido = await enviarBoletimFornecedor({ colaboradorCodigo: `NAO EXISTE ${run}`, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() });
    assert.ok(!invalido.ok && invalido.httpStatus === 400 && invalido.motivo === "FORNECEDOR_INVALIDO");
    assert.equal(await prismaTest.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: `NAO EXISTE ${run}` } }), 0);
    console.log("PASS: fornecedor inexistente → 400, nenhum BM criado.");

    // ─── 8: ciclo "GERAL" ou malformado forjado → 400 CICLO_INVALIDO, nenhum BM ───
    for (const cicloRuim of ["GERAL", "", "2026-08", "260", "ABC1", "2613"]) {
      const r = await enviarBoletimFornecedor({ colaboradorCodigo: C, ciclo: cicloRuim, usuario, telaOrigem: "Medições / Admin" });
      assert.ok(!r.ok && r.httpStatus === 400 && r.motivo === "CICLO_INVALIDO", `ciclo ${JSON.stringify(cicloRuim)}`);
    }
    assert.equal(await prismaTest.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: C } }), 0, "nenhum BM em ciclo inválido");
    console.log("PASS: ciclo GERAL/vazio/malformado/mês inválido → 400, nenhum BM criado.");

    // Efeito colateral zero de uma recusa: status, revisão, divergências, logs e e-mails intocados.
    async function semEfeito(colaboradorCodigo: string, tentar: () => Promise<{ ok: boolean; httpStatus?: number; motivo?: string }>, motivoEsperado: string) {
      const antes = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } } });
      const div = await prismaTest.divergenciaMedicao.count({ where: { sgcId: antes.id } });
      const logs = await prismaTest.sgcLog.count({ where: { sgcId: antes.id } });
      const emails = await prismaTest.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: { startsWith: `bm-available/${antes.id}/` } } });
      const r = await tentar();
      assert.ok(!r.ok && r.httpStatus === 409 && r.motivo === motivoEsperado, `${motivoEsperado}: ${JSON.stringify(r)}`);
      const depois = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: antes.id } });
      assert.deepEqual([depois.status, depois.revisaoNumero, depois.updatedAt.getTime()], [antes.status, antes.revisaoNumero, antes.updatedAt.getTime()], "status/revisão intocados");
      assert.equal(await prismaTest.divergenciaMedicao.count({ where: { sgcId: antes.id } }), div, "divergências não removidas");
      assert.equal(await prismaTest.sgcLog.count({ where: { sgcId: antes.id } }), logs, "sem log de envio");
      assert.equal(await prismaTest.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: { startsWith: `bm-available/${antes.id}/` } } }), emails, "sem BM_AVAILABLE");
    }

    // ─── 9: CANCELADO forjado → 409 CANCELADO, nada muda (individual e lote) ───
    const cancelado = await prismaTest.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: C, colaboradorNome: C, ciclo, status: "CANCELADO", statusConferencia: "AGUARDANDO_UPLOAD", revisaoNumero: 2 } });
    await prismaTest.divergenciaMedicao.create({ data: { sgcId: cancelado.id, colaboradorCodigo: C, ciclo, nrVale: `NR-${run}-C`, documentoNaoMapeado: true, fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC" } });
    await semEfeito(C, () => enviarBoletimFornecedor({ colaboradorCodigo: C, ciclo, usuario, telaOrigem: "Medições / Admin" }), "CANCELADO");
    await semEfeito(C, () => enviarBoletimFornecedor({ colaboradorCodigo: C, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() }), "CANCELADO");
    console.log("PASS: CANCELADO forjado → 409 'BM cancelado neste ciclo' (individual e lote), sem transição, revisão, log, e-mail ou perda de divergência.");

    // ─── 10: REVISAO_SOLICITADA sem alteração no pagamento → 409 REVISAO_SEM_ALTERACAO ───
    const pedidoRevisao = new Date();
    await prismaTest.mapaPagamentoItem.create({ data: { ciclo, ordem: 1, projetistaCodigo: D, responsavel: D, valor: 100, sourceRowHash: `bm-svc-${run}-D`, updatedAt: new Date(pedidoRevisao.getTime() - 60_000) } });
    const revD = await prismaTest.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: D, colaboradorNome: D, ciclo, status: "REVISAO_SOLICITADA", statusConferencia: "CONCLUIDA", revisaoNumero: 0, revisaoSolicitadaAt: pedidoRevisao } });
    await prismaTest.divergenciaMedicao.create({ data: { sgcId: revD.id, colaboradorCodigo: D, ciclo, nrVale: `NR-${run}-D`, documentoNaoMapeado: true, fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC" } });
    await semEfeito(D, () => enviarBoletimFornecedor({ colaboradorCodigo: D, ciclo, usuario, telaOrigem: "Medições / Admin" }), "REVISAO_SEM_ALTERACAO");
    await semEfeito(D, () => enviarBoletimFornecedor({ colaboradorCodigo: D, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() }), "REVISAO_SEM_ALTERACAO");
    console.log("PASS: revisão sem alteração → 409 'altere o pagamento antes de reenviar' (individual e lote), sem efeito colateral.");

    // ─── 11: REVISAO_SOLICITADA com alteração posterior → reenvio: +1, divergências limpas, 1 log, 1 e-mail ───
    await prismaTest.mapaPagamentoItem.updateMany({ where: { projetistaCodigo: D, ciclo }, data: { updatedAt: new Date(pedidoRevisao.getTime() + 60_000) } });
    const reenvio = await enviarBoletimFornecedor({ colaboradorCodigo: D, ciclo, usuario, telaOrigem: "Medições / Admin" });
    assert.ok(reenvio.ok, JSON.stringify(reenvio));
    const revDepois = await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: revD.id } });
    assert.deepEqual([revDepois.status, revDepois.statusConferencia, revDepois.revisaoNumero], ["PENDENTE", "AGUARDANDO_UPLOAD", 1], "revisaoNumero exatamente +1");
    assert.equal(await prismaTest.divergenciaMedicao.count({ where: { sgcId: revD.id } }), 0, "divergências da rodada anterior limpas");
    assert.equal(await prismaTest.sgcLog.count({ where: { sgcId: revD.id, acao: "REENVIAR_BM" } }), 1);
    assert.equal(await prismaTest.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${revD.id}/1` } }), 1);
    console.log("PASS: revisão com alteração → PENDENTE/AGUARDANDO_UPLOAD, revisaoNumero 0→1, divergências limpas, 1 REENVIAR_BM, 1 e-mail.");

    // ─── 12: AGUARDANDO_ENVIO explícito (ex.: depois de "Retornar BM") → enviado ───
    await prismaTest.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: E, colaboradorNome: E, ciclo, status: "AGUARDANDO_ENVIO", statusConferencia: "AGUARDANDO_UPLOAD" } });
    const aguardando = await enviarBoletimFornecedor({ colaboradorCodigo: E, ciclo, usuario, telaOrigem: "Medições / Admin" });
    assert.ok(aguardando.ok && aguardando.status === "PENDENTE");
    console.log("PASS: AGUARDANDO_ENVIO → enviado (PENDENTE).");

    // ─── 13: "alterado após a revisão" com MAIS DE UMA linha do fornecedor no ciclo ───
    // Regra: a alteração mais recente entre TODAS as linhas do BM (fornecedor + ciclo) no mapa.
    const pedido2 = new Date();
    const antes2 = new Date(pedido2.getTime() - 60_000);
    const depois2 = new Date(pedido2.getTime() + 60_000);
    // F: linha 1 antiga, linha 2 alterada depois do pedido → elegível (basta uma linha alterada).
    await prismaTest.mapaPagamentoItem.create({ data: { ciclo, ordem: 1, projetistaCodigo: F, responsavel: F, valor: 100, sourceRowHash: `bm-svc-${run}-F1`, updatedAt: antes2 } });
    await prismaTest.mapaPagamentoItem.create({ data: { ciclo, ordem: 2, projetistaCodigo: F, responsavel: F, valor: 200, sourceRowHash: `bm-svc-${run}-F2`, updatedAt: depois2 } });
    await prismaTest.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: F, colaboradorNome: F, ciclo, status: "REVISAO_SOLICITADA", statusConferencia: "CONCLUIDA", revisaoSolicitadaAt: pedido2 } });
    // G: as duas linhas antigas → bloqueado.
    await prismaTest.mapaPagamentoItem.create({ data: { ciclo, ordem: 1, projetistaCodigo: G, responsavel: G, valor: 100, sourceRowHash: `bm-svc-${run}-G1`, updatedAt: antes2 } });
    await prismaTest.mapaPagamentoItem.create({ data: { ciclo, ordem: 2, projetistaCodigo: G, responsavel: G, valor: 200, sourceRowHash: `bm-svc-${run}-G2`, updatedAt: new Date(antes2.getTime() - 60_000) } });
    await prismaTest.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: G, colaboradorNome: G, ciclo, status: "REVISAO_SOLICITADA", statusConferencia: "CONCLUIDA", revisaoSolicitadaAt: pedido2 } });
    await semEfeito(G, () => enviarBoletimFornecedor({ colaboradorCodigo: G, ciclo, usuario, telaOrigem: "Medições / Admin" }), "REVISAO_SEM_ALTERACAO");
    await semEfeito(G, () => enviarBoletimFornecedor({ colaboradorCodigo: G, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() }), "REVISAO_SEM_ALTERACAO");
    const multi = await enviarBoletimFornecedor({ colaboradorCodigo: F, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId: randomUUID() });
    assert.ok(multi.ok, JSON.stringify(multi));
    assert.equal((await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: F, ciclo } } })).revisaoNumero, 1);
    console.log("PASS: multilinha — basta UMA linha do fornecedor alterada após o pedido (F reenviado, rev 0→1); todas antigas → bloqueado (G), individual e lote.");

    // ─── 7: o CANCELADO continua CANCELADO depois de tudo (nenhum efeito colateral entre fornecedores) ───
    assert.equal((await prismaTest.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: C, ciclo } } })).status, "CANCELADO");
    console.log("\n=== TODOS OS CENÁRIOS DO SERVICE DE ENVIO DE BM PASSARAM ===");
  } finally {
    const bms = await prismaTest.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: { in: codigos } }, select: { id: true } });
    const ids = bms.map((b: { id: string }) => b.id);
    await prismaTest.emailLog.deleteMany({ where: { OR: ids.map((id: string) => ({ idempotencyKey: { startsWith: `bm-available/${id}/` } })) } }).catch(() => {});
    await prismaTest.sgcLog.deleteMany({ where: { sgcId: { in: ids } } }).catch(() => {});
    await prismaTest.divergenciaMedicao.deleteMany({ where: { sgcId: { in: ids } } }).catch(() => {});
    await prismaTest.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { in: codigos } } }).catch(() => {});
    await prismaTest.sgcAprovacaoMedicao.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await prismaTest.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: codigos } } }).catch(() => {});
    await prismaTest.profissional.deleteMany({ where: { codigo: { in: codigos } } }).catch(() => {});
    await prismaTest.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
