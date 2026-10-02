import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Envio INDIVIDUAL de BM alinhado ao lote: mesmo ciclo real (nunca "GERAL"), mesma elegibilidade
 * (`avaliarElegibilidadeEnvioBm`) — CANCELADO e revisão sem alteração bloqueados também por
 * chamada direta. Ciclo exclusivo desta suíte, tudo removido no fim. E-mail: provider fake.
 *   H — apto (sem BM): bloqueado na visão "Geral", enviado no ciclo real;
 *   K — CANCELADO;
 *   R — REVISAO_SOLICITADA (sem alteração → bloqueado; com alteração → reenviado);
 *   M — apto, enviado pelo lote (o lote continua funcionando);
 *   W — REVISAO_SOLICITADA com DUAS linhas: uma antiga, outra alterada depois → apto (lote);
 *   X — REVISAO_SOLICITADA com DUAS linhas, ambas antigas → bloqueado (individual e lote).
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 4).toUpperCase();
const CICLO = "2804";
const PREFIXO = `E2E BMIND ${S}`;
const base = 970000 + Math.floor(Math.random() * 9000);
const L = ["H", "K", "R", "M", "W", "X"] as const;
type Letra = (typeof L)[number];
const codigo = (l: Letra) => `P0${base + L.indexOf(l)}`;
const nome = (l: Letra) => `${PREFIXO} ${l}`;
const itemIds: Partial<Record<Letra, string>> = {};
const pedidoRevisao = new Date(Date.now() - 60 * 60 * 1000);

const bm = (l: Letra) => prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: codigo(l), ciclo: CICLO } } });

async function entrar(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function abrirDetalhe(page: Page, ciclo: string, l: Letra) {
  // A tela troca "Geral" pelo ciclo mais recente assim que GET /api/ciclos responde (comportamento
  // existente): só escolhe o ciclo depois disso, senão a escolha é sobrescrita.
  const ciclosCarregados = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/ciclos" && r.request().method() === "GET");
  await page.goto("/fornecedores");
  await ciclosCarregados;
  await page.getByRole("combobox", { name: "Ciclo" }).selectOption(ciclo);
  await expect(page.getByRole("combobox", { name: "Ciclo" })).toHaveValue(ciclo);
  await page.getByPlaceholder("Nome, código ou empresa").fill(PREFIXO);
  await page.getByTestId("fornecedores-tabela").locator("tr", { hasText: nome(l) }).locator("td:not(:has(input[type=checkbox]))").first().click();
  const detalhe = page.getByRole("dialog", { name: `Detalhe de ${nome(l)}` });
  await expect(detalhe).toBeVisible();
  return detalhe;
}

async function semEfeito(l: Letra, acao: () => Promise<void>) {
  const antes = (await bm(l))!;
  const logs = await prisma.sgcLog.count({ where: { sgcId: antes.id } });
  const emails = await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: { startsWith: `bm-available/${antes.id}/` } } });
  const div = await prisma.divergenciaMedicao.count({ where: { sgcId: antes.id } });
  await acao();
  const depois = (await bm(l))!;
  expect([depois.status, depois.revisaoNumero, depois.updatedAt.getTime()], `${l}: status/revisão intocados`).toEqual([antes.status, antes.revisaoNumero, antes.updatedAt.getTime()]);
  expect(await prisma.sgcLog.count({ where: { sgcId: antes.id } }), `${l}: sem log`).toBe(logs);
  expect(await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: { startsWith: `bm-available/${antes.id}/` } } }), `${l}: sem e-mail`).toBe(emails);
  expect(await prisma.divergenciaMedicao.count({ where: { sgcId: antes.id } }), `${l}: divergências preservadas`).toBe(div);
}

async function limpar() {
  const codigos = L.map(codigo);
  const sgcs = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: { in: codigos } }, select: { id: true } });
  const ids = sgcs.map((s) => s.id);
  await prisma.emailLog.deleteMany({ where: { OR: ids.map((id) => ({ idempotencyKey: { startsWith: `bm-available/${id}/` } })) } });
  await prisma.sgcLog.deleteMany({ where: { sgcId: { in: ids } } });
  await prisma.divergenciaMedicao.deleteMany({ where: { sgcId: { in: ids } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { id: { in: ids } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { in: codigos } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: PREFIXO } } });
  await prisma.profissional.deleteMany({ where: { codigo: { in: codigos } } });
  await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: CICLO } });
}

test.describe.serial("Fornecedores — envio individual de BM alinhado ao lote", () => {
  test.beforeAll(async () => {
    await limpar();
    await prisma.mapaPagamentoContexto.create({ data: { ciclo: CICLO, mesReferencia: `E2E BM Individual ${CICLO}`, atoCiclo: CICLO } });
    for (const l of L) {
      await prisma.profissional.create({ data: { nome: codigo(l), codigo: codigo(l), nomeCompleto: nome(l) } });
      await prisma.cadastroFornecedor.create({ data: { responsavel: nome(l), razaoSocial: `${nome(l)} LTDA`, colaboradorCodigo: codigo(l), cnpjNormalizado: `3${base}${L.indexOf(l)}000101`.slice(0, 14), email: `bmind-${l.toLowerCase()}-${S.toLowerCase()}@example.test` } });
      // R: pagamento NÃO alterado depois do pedido de revisão (updatedAt anterior).
      const item = await prisma.mapaPagamentoItem.create({
        data: { ciclo: CICLO, ordem: 9700 + L.indexOf(l), projetistaCodigo: codigo(l), responsavel: nome(l), valor: 1000, sourceRowHash: `e2e-bmind-${S}-${l}`, ...(l === "R" ? { updatedAt: new Date(pedidoRevisao.getTime() - 60_000) } : {}) },
      });
      itemIds[l] = item.id;
    }
    // Segunda linha no mesmo ciclo para W (alterada depois do pedido) e X (antiga).
    for (const [l, quando] of [["W", new Date()], ["X", new Date(pedidoRevisao.getTime() - 120_000)]] as const) {
      await prisma.mapaPagamentoItem.update({ where: { id: itemIds[l] }, data: { updatedAt: new Date(pedidoRevisao.getTime() - 60_000) } });
      await prisma.mapaPagamentoItem.create({ data: { ciclo: CICLO, ordem: 9750 + L.indexOf(l), projetistaCodigo: codigo(l), responsavel: nome(l), valor: 500, sourceRowHash: `e2e-bmind-${S}-${l}-2`, updatedAt: quando } });
      await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo(l), colaboradorNome: nome(l), ciclo: CICLO, status: "REVISAO_SOLICITADA", statusConferencia: "CONCLUIDA", revisaoNumero: 0, revisaoSolicitadaAt: pedidoRevisao } });
    }
    const k = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo("K"), colaboradorNome: nome("K"), ciclo: CICLO, status: "CANCELADO", statusConferencia: "AGUARDANDO_UPLOAD", revisaoNumero: 1 } });
    await prisma.divergenciaMedicao.create({ data: { sgcId: k.id, colaboradorCodigo: codigo("K"), ciclo: CICLO, nrVale: `NR-${S}-K`, documentoNaoMapeado: true, fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC" } });
    const r = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo("R"), colaboradorNome: nome("R"), ciclo: CICLO, status: "REVISAO_SOLICITADA", statusConferencia: "CONCLUIDA", revisaoNumero: 0, revisaoSolicitadaAt: pedidoRevisao } });
    await prisma.divergenciaMedicao.create({ data: { sgcId: r.id, colaboradorCodigo: codigo("R"), ciclo: CICLO, nrVale: `NR-${S}-R`, documentoNaoMapeado: true, fornecedorFormato: "A1", fornecedorA1eqHh: 1, fornecedorPercentualEmissao: 1, fornecedorTipo: "DOC" } });
  });

  test.afterAll(limpar);

  test("visão Geral: sem ação funcional de Enviar/Reenviar BM; ciclo real: envio individual funciona", async ({ page }) => {
    await entrar(page, e2eUsers.medicao);
    let posts = 0;
    page.on("request", (r) => { if (r.url().endsWith("/api/sgc/enviar") && r.method() === "POST") posts += 1; });

    const geral = await abrirDetalhe(page, "GERAL", "H");
    await expect(geral.getByRole("button", { name: /^(Enviar|Reenviar) BM$/ })).toHaveCount(0);
    await expect(geral.getByTestId("envio-bm-requer-ciclo")).toHaveText("Selecione um ciclo específico para enviar o boletim.");
    await page.keyboard.press("Escape");
    expect(posts, "nenhuma chamada saiu da visão Geral").toBe(0);

    const detalhe = await abrirDetalhe(page, CICLO, "H");
    await expect(detalhe.getByTestId("envio-bm-requer-ciclo")).toHaveCount(0);
    const resposta = page.waitForResponse((r) => r.url().endsWith("/api/sgc/enviar") && r.request().method() === "POST");
    await detalhe.getByRole("button", { name: "Enviar BM", exact: true }).click();
    const res = await resposta;
    expect(res.status()).toBe(200);
    expect(res.request().postDataJSON()).toEqual({ colaboradorCodigo: codigo("H"), ciclo: CICLO });
    const h = (await bm("H"))!;
    expect([h.status, h.statusConferencia, h.revisaoNumero]).toEqual(["PENDENTE", "AGUARDANDO_UPLOAD", 0]);
    expect(await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", status: "SENT", idempotencyKey: `bm-available/${h.id}/0` } })).toBe(1);
    expect(await prisma.sgcAprovacaoMedicao.count({ where: { ciclo: "GERAL" } }), "nunca um BM em 'GERAL'").toBe(0);
    await page.request.post("/api/auth/logout");
  });

  test("chamadas forjadas: GERAL/malformado 400; CANCELADO e revisão sem alteração 409 sem efeito; revisão alterada aceita (+1); lote com a mesma resposta", async ({ page }) => {
    await entrar(page, e2eUsers.medicao);
    const enviar = (colaboradorCodigo: string, ciclo: string) => page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo, ciclo } });

    for (const ciclo of ["GERAL", "", "2026-08", "260", "ABC1", "2613", "9996"]) {
      const r = await enviar(codigo("M"), ciclo);
      expect(r.status(), `ciclo ${JSON.stringify(ciclo)}`).toBe(400);
      expect((await r.json()).error).toBe("Selecione um ciclo específico para enviar o boletim.");
    }
    expect(await prisma.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: codigo("M") } })).toBe(0);

    await semEfeito("K", async () => {
      const r = await enviar(codigo("K"), CICLO);
      expect(r.status()).toBe(409);
      expect((await r.json()).error).toBe("BM cancelado neste ciclo");
    });
    await semEfeito("R", async () => {
      const r = await enviar(codigo("R"), CICLO);
      expect(r.status()).toBe(409);
      expect((await r.json()).error).toBe("Revisão solicitada: altere o pagamento antes de reenviar");
    });

    // Lote: mesma decisão, mesmos motivos (paridade).
    const lote = await (await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO, ids: [itemIds.K, itemIds.R], requestId: randomUUID() } })).json();
    expect(lote.resultados.map((x: { status: string; motivo: string }) => [x.status, x.motivo])).toEqual([
      ["IGNORADO", "BM cancelado neste ciclo"],
      ["IGNORADO", "Revisão solicitada: altere o pagamento antes de reenviar"],
    ]);
    expect((await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: "GERAL", ids: [itemIds.M], requestId: randomUUID() } })).status()).toBe(400);

    // Revisão COM alteração posterior: reenvio aceito, revisaoNumero +1, divergências limpas, 1 log, 1 e-mail.
    await prisma.mapaPagamentoItem.update({ where: { id: itemIds.R }, data: { updatedAt: new Date() } });
    const reenvio = await enviar(codigo("R"), CICLO);
    expect(reenvio.status()).toBe(200);
    const r = (await bm("R"))!;
    expect([r.status, r.statusConferencia, r.revisaoNumero]).toEqual(["PENDENTE", "AGUARDANDO_UPLOAD", 1]);
    expect(await prisma.divergenciaMedicao.count({ where: { sgcId: r.id } })).toBe(0);
    expect(await prisma.sgcLog.count({ where: { sgcId: r.id, acao: "REENVIAR_BM" } })).toBe(1);
    expect(await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${r.id}/1` } })).toBe(1);

    // Multilinha: "alterado após a revisão" = alteração mais recente entre TODAS as linhas do BM.
    // X (todas antigas): bloqueado no individual e no lote, mesmo motivo, sem efeito.
    await semEfeito("X", async () => {
      const r = await enviar(codigo("X"), CICLO);
      expect(r.status()).toBe(409);
      expect((await r.json()).error).toBe("Revisão solicitada: altere o pagamento antes de reenviar");
      const l = await (await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO, ids: [itemIds.X], requestId: randomUUID() } })).json();
      expect(l.resultados[0]).toMatchObject({ status: "IGNORADO", motivo: "Revisão solicitada: altere o pagamento antes de reenviar" });
    });
    // W (linha marcada é a ANTIGA; a outra foi alterada depois): o lote reenvia pela regra do BM.
    const w = await (await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO, ids: [itemIds.W], requestId: randomUUID() } })).json();
    expect(w.resultados[0]).toMatchObject({ status: "ENVIADO", motivo: "BM reenviado" });
    expect((await bm("W"))?.revisaoNumero).toBe(1);

    // Já enviado: retry individual bloqueado (409) com o motivo da regra.
    const repetido = await enviar(codigo("H"), CICLO);
    expect(repetido.status()).toBe(409);
    expect((await repetido.json()).error).toBe("BM já enviado (Aguardando fornecedor)");

    // O lote continua funcionando para um apto.
    const ok = await (await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO, ids: [itemIds.M], requestId: randomUUID() } })).json();
    expect(ok).toMatchObject({ enviados: 1, ignorados: 0, falhas: 0 });
    expect((await bm("M"))?.status).toBe("PENDENTE");
    await page.request.post("/api/auth/logout");

    // Permissão inalterada: FINANCEIRO não envia (403), nem individual nem lote.
    await entrar(page, e2eUsers.financeiro);
    expect((await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo("K"), ciclo: CICLO } })).status()).toBe(403);
    expect((await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO, ids: [itemIds.K], requestId: randomUUID() } })).status()).toBe(403);
    expect((await bm("K"))?.status).toBe("CANCELADO");
    await page.request.post("/api/auth/logout");
  });
});
