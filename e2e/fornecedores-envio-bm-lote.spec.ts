import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Fornecedores → seleção + "Enviar BMs" em lote (um ciclo). Ciclos exclusivos desta suíte; tudo é
 * removido no fim e os flags de publicação do portal são restaurados. E-mail: EMAIL_TEST_MODE +
 * provider fake do webServer do Playwright — nada sai para endereço real.
 *   A, B — aptos (sem BM), enviados pelo lote; A também é fornecedor no portal;
 *   C    — BM já enviado (PENDENTE) → inapto, checkbox indisponível;
 *   D    — apto ao ser marcado, enviado por "outra pessoa" antes da confirmação → revalidado;
 *   E    — enviado pelo fluxo individual, para comparar a transição com a do lote;
 *   G    — apto, nunca enviado (troca de ciclo e larguras);
 *   F    — apto no OUTRO ciclo (troca de ciclo).
 */

test.beforeAll(assertConnectedToE2eDatabase);

const S = randomUUID().slice(0, 4).toUpperCase();
const CICLO_A = "2808";
const CICLO_B = "2807";
const PREFIXO = `E2E BMLOTE ${S}`;
const base = 980000 + Math.floor(Math.random() * 9000);
const L = ["A", "B", "C", "D", "E", "G", "F"] as const;
type Letra = (typeof L)[number];
const codigo = (l: Letra) => `P0${base + L.indexOf(l)}`;
const nome = (l: Letra) => `${PREFIXO} ${l}`;
const VALOR: Record<Letra, number> = { A: 1000, B: 2500.5, C: 300, D: 400, E: 500, G: 600, F: 700 };
const SENHA_A = `E2e-${randomBytes(6).toString("hex")}`;
const itemIds: Partial<Record<Letra, string>> = {};
let requestIdLote = "";
let flagsOriginais: { ciclo: string; ativoMedicao: boolean }[] = [];

const scrypt = promisify(scryptCallback);
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

async function entrar(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function abrirFornecedores(page: Page, ciclo = CICLO_A) {
  await page.goto("/fornecedores");
  // A tela começa em "Geral" e, quando os ciclos carregam, troca sozinha para o mais recente
  // (comportamento existente). Só escolhe o ciclo DEPOIS dessa troca — senão é sobrescrito.
  await expect(page.getByRole("combobox", { name: "Ciclo" })).not.toHaveValue("GERAL");
  await page.getByRole("combobox", { name: "Ciclo" }).selectOption(ciclo);
  await expect(page.getByRole("combobox", { name: "Ciclo" })).toHaveValue(ciclo);
  await page.getByPlaceholder("Nome, código ou empresa").fill(PREFIXO);
}

const linha = (page: Page, l: Letra) => page.locator("[data-testid=fornecedores-tabela]:visible, [data-testid=fornecedores-lista-mobile]:visible").first()
  .getByRole(page.viewportSize()!.width < 768 ? "listitem" : "row").filter({ hasText: nome(l) });
const checkbox = (page: Page, l: Letra) => linha(page, l).getByRole("checkbox");
const bm = (l: Letra, ciclo = CICLO_A) => prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: codigo(l), ciclo } } });

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
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
  await prisma.usuario.deleteMany({ where: { usuario: { in: codigos }, nome: { startsWith: PREFIXO } } });
  await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: [CICLO_A, CICLO_B] } } });
}

test.describe.serial("Fornecedores — envio em lote de BMs", () => {
  test.beforeAll(async () => {
    flagsOriginais = await prisma.mapaPagamentoContexto.findMany({ select: { ciclo: true, ativoMedicao: true } });
    await limpar();
    for (const c of [CICLO_A, CICLO_B]) await prisma.mapaPagamentoContexto.create({ data: { ciclo: c, mesReferencia: `E2E BM Lote ${c}`, atoCiclo: c } });
    for (const l of L) {
      const ciclo = l === "F" ? CICLO_B : CICLO_A;
      await prisma.profissional.create({ data: { nome: codigo(l), codigo: codigo(l), nomeCompleto: nome(l) } });
      await prisma.cadastroFornecedor.create({ data: { responsavel: nome(l), razaoSocial: `${nome(l)} LTDA`, colaboradorCodigo: codigo(l), cnpjNormalizado: `5${base}${L.indexOf(l)}000101`.slice(0, 14), email: `bmlote-${l.toLowerCase()}-${S.toLowerCase()}@example.test` } });
      const item = await prisma.mapaPagamentoItem.create({ data: { ciclo, ordem: 9900 + L.indexOf(l), projetistaCodigo: codigo(l), responsavel: nome(l), valor: VALOR[l], sourceRowHash: `e2e-bmlote-${S}-${l}` } });
      itemIds[l] = item.id;
    }
    await prisma.usuario.create({ data: { usuario: codigo("A"), nome: nome("A"), perfil: "COLABORADOR", senhaHash: await hashPassword(SENHA_A), ativo: true, primeiroLogin: false } });
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo("C"), colaboradorNome: nome("C"), ciclo: CICLO_A, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" } });
  });

  test.afterAll(async () => {
    await limpar();
    for (const f of flagsOriginais) await prisma.mapaPagamentoContexto.updateMany({ where: { ciclo: f.ciclo }, data: { ativoMedicao: f.ativoMedicao } });
  });

  test("seleção de aptos, confirmação com prévia e total, duplo clique = 1 operação, resultado e transição real", async ({ page }) => {
    await entrar(page, e2eUsers.medicao);
    await abrirFornecedores(page);
    await expect(linha(page, "A")).toBeVisible();

    // Nenhum selecionado → sem barra. C (já enviado) fica indisponível, com o motivo.
    const barra = page.getByTestId("bulk-selection-bar");
    await expect(barra).toHaveCount(0);
    await expect(checkbox(page, "C")).toBeDisabled();
    await expect(checkbox(page, "C")).toHaveAccessibleName(`Selecionar ${nome("C")} (indisponível: BM já enviado (Aguardando fornecedor))`);

    // Clicar no checkbox nunca abre o detalhe.
    await checkbox(page, "A").check();
    await expect(page.getByRole("dialog", { name: `Detalhe de ${nome("A")}` })).toHaveCount(0);
    await expect(barra).toContainText("1 BM selecionado");
    const cabecalho = page.getByRole("checkbox", { name: "Selecionar todos os BMs aptos da visualização" }).first();
    expect(await cabecalho.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);

    await checkbox(page, "B").check();
    await expect(barra).toContainText("2 BMs selecionados");
    await expect(barra.getByTestId("bulk-aptos-envio-bm")).toHaveText("2 aptos para envio");

    await barra.getByRole("button", { name: "Enviar 2 BMs" }).click();
    const dialogo = page.getByTestId("envio-bm-lote-dialog");
    await expect(dialogo.getByRole("heading", { name: "Enviar 2 boletins?" })).toBeVisible();
    const previa = dialogo.getByTestId("envio-bm-lote-previa");
    await expect(previa).toContainText("Selecionados2");
    await expect(previa).toContainText("Aptos para envio2");
    await expect(dialogo.getByTestId("envio-bm-lote-total")).toHaveText(/R\$\s*3\.500,50/);

    let posts = 0;
    page.on("request", (r) => { if (r.url().endsWith("/api/sgc/enviar/lote") && r.method() === "POST") posts += 1; });
    const reqPromise = page.waitForRequest((r) => r.url().endsWith("/api/sgc/enviar/lote") && r.method() === "POST");
    const resPromise = page.waitForResponse((r) => r.url().endsWith("/api/sgc/enviar/lote") && r.request().method() === "POST");
    await dialogo.getByRole("button", { name: "Enviar 2 BMs" }).dblclick();
    requestIdLote = (await reqPromise).postDataJSON().requestId;
    const res = await resPromise;
    expect(res.status()).toBe(200);
    const corpo = await res.json();
    expect(corpo).toMatchObject({ totalSelecionados: 2, enviados: 2, ignorados: 0, falhas: 0, semNotificacao: 0 });
    expect(JSON.stringify(corpo), "resposta sem e-mail/credencial").not.toMatch(/@example\.test|senha|token/i);

    await expect(dialogo.getByRole("heading", { name: "Envio concluído" })).toBeVisible();
    await expect(dialogo.getByTestId("envio-bm-lote-resumo")).toContainText("2 boletins enviados.");
    await dialogo.getByRole("button", { name: "Ver detalhes" }).click();
    await expect(dialogo.getByTestId("envio-bm-lote-detalhes").locator('[data-status="ENVIADO"]')).toHaveCount(2);
    expect(posts).toBe(1);

    // Transição real, a mesma do envio individual (PENDENTE + AGUARDANDO_UPLOAD, rev 0), com log e e-mail.
    for (const l of ["A", "B"] as const) {
      const b = (await bm(l))!;
      expect([b.status, b.statusConferencia, b.revisaoNumero]).toEqual(["PENDENTE", "AGUARDANDO_UPLOAD", 0]);
      const logs = await prisma.sgcLog.findMany({ where: { sgcId: b.id }, select: { acao: true, telaOrigem: true, observacao: true } });
      expect(logs.find((x) => x.acao === "ENVIAR_BM")).toMatchObject({ telaOrigem: "Fornecedores / Envio em lote", observacao: `lote:${requestIdLote}` });
      const emails = await prisma.emailLog.findMany({ where: { event: "BM_AVAILABLE", idempotencyKey: `bm-available/${b.id}/0` } });
      expect(emails.map((e) => e.status)).toEqual(["SENT"]);
      expect(emails[0].actualRecipients, "EMAIL_TEST_MODE: nunca o endereço do fornecedor").toEqual(["e2e-test-recipient@example.test"]);
    }
    expect(await bm("G"), "não selecionado → intocado").toBeNull();

    // Fechar: seleção processada limpa; ciclo e busca preservados; lista atualizada sem refresh.
    await dialogo.getByRole("button", { name: "Fechar" }).click();
    await expect(barra).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Ciclo" })).toHaveValue(CICLO_A);
    await expect(page.getByPlaceholder("Nome, código ou empresa")).toHaveValue(PREFIXO);
    await expect(linha(page, "A")).toContainText("Aguardando fornecedor");
    await expect(checkbox(page, "A")).toBeDisabled();
    await page.request.post("/api/auth/logout");
  });

  test("individual e lote: mesma transição para o mesmo estado inicial; portal do fornecedor vê o BM", async ({ page, browser }) => {
    await entrar(page, e2eUsers.medicao);
    const individual = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo("E"), ciclo: CICLO_A } });
    expect(individual.status()).toBe(200);
    const [a, e] = [(await bm("A"))!, (await bm("E"))!];
    for (const campo of ["status", "statusConferencia", "revisaoNumero", "conferenciaArquivo", "aprovadoAt"] as const) expect(e[campo], campo).toEqual(a[campo]);
    expect((await prisma.sgcLog.findFirst({ where: { sgcId: e.id, acao: "ENVIAR_BM" } }))?.observacao ?? null, "individual sem marca de lote").toBeNull();
    await page.request.post("/api/auth/logout");

    // Portal: o fornecedor A enxerga o BM do ciclo publicado exatamente como no envio individual.
    await prisma.mapaPagamentoContexto.updateMany({ data: { ativoMedicao: false } });
    await prisma.mapaPagamentoContexto.update({ where: { ciclo: CICLO_A }, data: { ativoMedicao: true } });
    const ctx = await browser.newContext();
    const portal = await ctx.newPage();
    await entrar(portal, { usuario: codigo("A"), senha: SENHA_A });
    const me = await (await portal.request.get("/api/colaborador/me")).json();
    expect(me.cicloAtivo).toBe(CICLO_A);
    expect([me.sgc?.status, me.sgc?.statusConferencia]).toEqual(["PENDENTE", "AGUARDANDO_UPLOAD"]);
    await portal.goto("/");
    // Mesmo efeito do envio individual: o fornecedor começa pela conferência documental do ciclo.
    await expect(portal.getByRole("heading", { name: "Conferência da Medição" })).toBeVisible();
    await expect(portal.getByText("Ciclo da medição")).toBeVisible();
    await expect(portal.getByText(CICLO_A, { exact: true })).toBeVisible();
    await ctx.close();
    for (const f of flagsOriginais) await prisma.mapaPagamentoContexto.updateMany({ where: { ciclo: f.ciclo }, data: { ativoMedicao: f.ativoMedicao } });
    await prisma.mapaPagamentoContexto.update({ where: { ciclo: CICLO_A }, data: { ativoMedicao: false } });
  });

  test("selecionar todos = só aptos; status muda no servidor antes da confirmação → revalidado, sem transição; replay e 403", async ({ page }) => {
    await entrar(page, e2eUsers.medicao);
    await abrirFornecedores(page);
    const barra = page.getByTestId("bulk-selection-bar");
    // Aptos na visualização: D e G (A, B, E enviados; C já estava).
    await page.getByRole("checkbox", { name: "Selecionar todos os BMs aptos da visualização" }).first().check();
    await expect(barra).toContainText("2 BMs selecionados");
    await expect(checkbox(page, "D")).toBeChecked();
    await expect(checkbox(page, "G")).toBeChecked();
    await checkbox(page, "G").uncheck();

    // Outra pessoa envia o BM de D depois da seleção (a tela ainda o mostra como apto).
    await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo("D"), colaboradorNome: nome("D"), ciclo: CICLO_A, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" } });
    const antes = (await bm("D"))!;
    await barra.getByRole("button", { name: "Enviar 1 BM" }).click();
    const dialogo = page.getByTestId("envio-bm-lote-dialog");
    const resPromise = page.waitForResponse((r) => r.url().endsWith("/api/sgc/enviar/lote"));
    await dialogo.getByRole("button", { name: "Enviar 1 BM" }).click();
    const corpo = await (await resPromise).json();
    expect(corpo).toMatchObject({ enviados: 0, ignorados: 1, falhas: 0 });
    expect(corpo.resultados[0].status).toBe("IGNORADO");
    const depois = (await bm("D"))!;
    expect([depois.updatedAt.getTime(), depois.revisaoNumero]).toEqual([antes.updatedAt.getTime(), antes.revisaoNumero]);
    expect(await prisma.sgcLog.count({ where: { sgcId: depois.id } }), "nenhuma transição/log").toBe(0);
    await expect(dialogo.getByTestId("envio-bm-lote-resumo")).toContainText("1 não foi enviado.");
    await dialogo.getByRole("button", { name: "Fechar" }).click();

    // Replay da 1ª confirmação (A, B): "já enviado nesta operação", sem log/e-mail novos.
    const a = (await bm("A"))!;
    const logsAntes = await prisma.sgcLog.count({ where: { sgcId: a.id } });
    const replay = await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO_A, ids: [itemIds.A, itemIds.B], requestId: requestIdLote } });
    const r = await replay.json();
    expect(r.resultados.map((x: { status: string; motivo: string }) => [x.status, x.motivo])).toEqual([["ENVIADO", "BM já enviado nesta operação"], ["ENVIADO", "BM já enviado nesta operação"]]);
    expect(await prisma.sgcLog.count({ where: { sgcId: a.id } })).toBe(logsAntes);
    expect(await prisma.emailLog.count({ where: { event: "BM_AVAILABLE", idempotencyKey: { startsWith: `bm-available/${a.id}/` } } })).toBe(1);
    // Outra confirmação (novo requestId) para BM já enviado: ignorado, nunca reenviado.
    const outra = await (await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO_A, ids: [itemIds.A], requestId: randomUUID() } })).json();
    expect(outra.resultados[0]).toMatchObject({ status: "IGNORADO", motivo: "BM já enviado (Aguardando fornecedor)" });
    // Item de outro ciclo no payload: nunca enviado.
    const cruzado = await (await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO_A, ids: [itemIds.F], requestId: randomUUID() } })).json();
    expect(cruzado.resultados[0]).toMatchObject({ status: "IGNORADO", motivo: "Não pertence ao ciclo selecionado" });
    expect(await bm("F", CICLO_B)).toBeNull();
    expect(await bm("F", CICLO_A)).toBeNull();
    // Validação: "Geral" e IDs inválidos → 400.
    expect((await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: "GERAL", ids: [itemIds.G], requestId: randomUUID() } })).status()).toBe(400);
    expect((await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO_A, ids: ["x"], requestId: randomUUID() } })).status()).toBe(400);
    await page.request.post("/api/auth/logout");

    // Perfil sem permissão do envio individual (FINANCEIRO): 403, nenhum efeito.
    await entrar(page, e2eUsers.financeiro);
    const negado = await page.request.post("/api/sgc/enviar/lote", { data: { ciclo: CICLO_A, ids: [itemIds.G], requestId: randomUUID() } });
    expect(negado.status()).toBe(403);
    expect(await bm("G")).toBeNull();
    await page.request.post("/api/auth/logout");
  });

  test("trocar de ciclo zera a seleção (nunca IDs invisíveis de outro ciclo); 'Geral' não permite seleção", async ({ page }) => {
    await entrar(page, e2eUsers.medicao);
    await abrirFornecedores(page, CICLO_B);
    await checkbox(page, "F").check();
    await expect(page.getByTestId("bulk-selection-bar")).toContainText("1 BM selecionado");
    await page.getByRole("combobox", { name: "Ciclo" }).selectOption(CICLO_A);
    await expect(page.getByTestId("bulk-selection-bar")).toHaveCount(0);
    await checkbox(page, "G").check();
    await page.getByRole("combobox", { name: "Ciclo" }).selectOption(CICLO_B);
    await expect(page.getByTestId("bulk-selection-bar")).toHaveCount(0);
    await expect(checkbox(page, "F")).not.toBeChecked();
    await page.getByRole("combobox", { name: "Ciclo" }).selectOption("GERAL");
    await expect(page.getByRole("checkbox", { name: /^Selecionar/ })).toHaveCount(0);
    await page.request.post("/api/auth/logout");
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: seleção, barra, diálogo e inaptos sem overflow`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await entrar(page, e2eUsers.medicao);
      await abrirFornecedores(page);
      await checkbox(page, "G").check();
      const barra = page.getByTestId("bulk-selection-bar");
      await expect(barra.getByRole("button", { name: "Enviar 1 BM" })).toBeVisible();
      await semOverflow(page);
      await barra.getByRole("button", { name: "Enviar 1 BM" }).click();
      const dialogo = page.getByTestId("envio-bm-lote-dialog");
      await expect(dialogo.getByRole("button", { name: "Enviar 1 BM" })).toBeVisible();
      await semOverflow(page);
      await page.keyboard.press("Escape");
      await expect(dialogo).toHaveCount(0);
      expect(await bm("G"), "nada enviado").toBeNull();
      await page.request.post("/api/auth/logout");
    });
  }
});
