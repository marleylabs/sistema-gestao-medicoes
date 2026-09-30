import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { problemasDaMascaraMedicoes } from "../tests/support/mascara-medicoes";

/**
 * Hotfix pós-redesign:
 *  A) a máscara de importação servida pelo sistema nasce limpa (download real, XLSX aberto e inspecionado);
 *  B) os rótulos do eixo Y de "Evolução das medições" nunca são cortados, em qualquer largura/escala;
 *  C) o painel "Filtros" do Dashboard fica inteiro dentro da viewport.
 */

const MARGEM = 8;
const LARGURAS = [375, 432, 768, 1024, 1280, 1440, 1600];

async function login(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem scroll horizontal global").toBeLessThanOrEqual(o.c);
}

/** Troca só a série do gráfico na resposta REAL de /api/dashboard (teste de layout, não de cálculo). */
async function comSerie(page: Page, serie: { ciclo: string; totalMedido: number }[]) {
  await page.route("**/api/dashboard?**", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.porCiclo = serie.map((p) => ({ ...p, periodoInicio: "", periodoFim: "", totalHoras: 0, totalRegistros: 1 }));
    await route.fulfill({ response: res, json });
  });
}

async function rotulosYDentroDoCard(page: Page) {
  const card = page.getByText("Evolução das medições", { exact: true }).locator("xpath=ancestor::div[.//*[local-name()='svg' and contains(@class,'recharts-surface')]][1]");
  await expect(card.locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value").first()).toBeVisible();
  // Mede tudo num único instante (os ticks podem ser recriados entre awaits).
  const medida = await card.evaluate((el) => {
    const svg = el.querySelector("svg.recharts-surface")!.getBoundingClientRect();
    const cardBox = el.getBoundingClientRect();
    const ticks = Array.from(el.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")).map((t) => {
      const r = (t as SVGGraphicsElement).getBoundingClientRect();
      return { texto: t.textContent ?? "", left: r.left, right: r.right };
    });
    return { svgLeft: svg.left, svgRight: svg.right, cardLeft: cardBox.left, cardRight: cardBox.right, ticks };
  });
  expect(medida.ticks.length).toBeGreaterThan(0);
  for (const t of medida.ticks) {
    expect(t.left, `rótulo "${t.texto}" começa dentro do SVG`).toBeGreaterThanOrEqual(medida.svgLeft - 0.5);
    expect(t.left, `rótulo "${t.texto}" dentro do card`).toBeGreaterThanOrEqual(medida.cardLeft);
    expect(t.right, `rótulo "${t.texto}" dentro do card`).toBeLessThanOrEqual(medida.cardRight);
  }
  return medida.ticks.map((t) => t.texto);
}

test.describe("Hotfix — máscara limpa, gráfico e filtros responsivos", () => {
  test("MÁSCARA: o download real (GET /api/admin/templates/medicoes) nasce limpo e é o template versionado", async ({ page }) => {
    await login(page, e2eUsers.admin);
    await page.goto("/?section=importar");
    const link = page.getByRole("link", { name: /máscara/i }).first();
    await expect(link).toHaveAttribute("href", "/api/admin/templates/medicoes");
    const res = await page.request.get("/api/admin/templates/medicoes");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
    expect(res.headers()["content-disposition"]).toContain("Mascara_Importacao_Medicoes.xlsx");
    const corpo = Buffer.from(await res.body());
    expect(problemasDaMascaraMedicoes(corpo)).toEqual([]);
    const template = fs.readFileSync(path.join(__dirname, "..", "app-assets", "templates", "Mascara_Importacao_Medicoes.xlsx"));
    expect(corpo.equals(template), "o endpoint serve exatamente o arquivo versionado").toBe(true);
    await page.request.post("/api/auth/logout");

    await login(page, e2eUsers.financeiro);
    expect((await page.request.get("/api/admin/templates/medicoes")).status(), "permissão preservada").toBe(403);
    await page.request.post("/api/auth/logout");
  });

  test("GRÁFICO: rótulos do eixo Y inteiros (vazio, 1 ciclo, vários, baixo e alto) em todas as larguras", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, e2eUsers.admin);
    const cenarios = [
      { nome: "alto", serie: [{ ciclo: "2601", totalMedido: 950_000 }, { ciclo: "2602", totalMedido: 1_200_000 }, { ciclo: "2603", totalMedido: 2_500_000 }, { ciclo: "2604", totalMedido: 800_000 }] },
      { nome: "baixo", serie: [{ ciclo: "2601", totalMedido: 0 }, { ciclo: "2602", totalMedido: 12.5 }] },
      { nome: "um ciclo", serie: [{ ciclo: "2608", totalMedido: 724_020.67 }] },
    ];
    for (const c of cenarios) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await comSerie(page, c.serie);
      for (const largura of LARGURAS) {
        await page.setViewportSize({ width: largura, height: 900 });
        await page.goto("/?section=visao");
        const textos = await rotulosYDentroDoCard(page);
        expect(textos.every((t) => t.startsWith("R$")), `${c.nome}@${largura}: formato monetário preservado (${textos.join(" | ")})`).toBe(true);
        await semOverflow(page);
      }
    }
    // Tooltip continua funcionando.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?section=visao");
    const evolucao = page.getByText("Evolução das medições", { exact: true }).locator("xpath=ancestor::div[.//*[local-name()='svg' and contains(@class,'recharts-surface')]][1]");
    const box = (await evolucao.locator("svg.recharts-surface").first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(evolucao.locator(".recharts-tooltip-wrapper")).toContainText("Valor medido");

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await comSerie(page, []);
    await page.goto("/?section=visao");
    await expect(page.getByText("Nenhuma medição disponível para este filtro.")).toBeVisible();
    await page.request.post("/api/auth/logout");
  });

  test("FILTROS: painel do Dashboard inteiro na viewport (Produção, ATO, rodapé) e sem overflow", async ({ page }) => {
    await login(page, e2eUsers.admin);
    for (const largura of [375, 432, 768, 1024, 1440]) {
      await page.setViewportSize({ width: largura, height: 900 });
      await page.goto("/?section=visao");
      // Espera o cabeçalho assentar (a etiqueta do ciclo aparece depois que os ciclos carregam).
      await expect(page.getByRole("button", { name: /^Ciclo: / }).or(page.getByText(/^Ciclo: /)).first()).toBeVisible();
      await page.getByRole("button", { name: /^Filtros/ }).click();
      const painel = page.getByTestId("dashboard-filtros");
      await expect(painel).toBeVisible();
      const vw = await page.evaluate(() => document.documentElement.clientWidth);
      const box = (await painel.boundingBox())!;
      expect(box.x, `${largura}: borda esquerda`).toBeGreaterThanOrEqual(MARGEM);
      expect(box.x + box.width, `${largura}: borda direita`).toBeLessThanOrEqual(vw - MARGEM);
      for (const rotulo of ["Produção", "ATO"]) await expect(painel.getByText(rotulo, { exact: true })).toBeVisible();
      const campos = painel.locator('input[type="date"]');
      await expect(campos).toHaveCount(2);
      for (const campo of await campos.all()) {
        const c = (await campo.boundingBox())!;
        expect(c.x, `${largura}: data dentro do painel`).toBeGreaterThanOrEqual(box.x);
        expect(c.x + c.width, `${largura}: data dentro do painel`).toBeLessThanOrEqual(box.x + box.width + 0.5);
      }
      for (const acao of ["Limpar filtros", "Concluído"]) {
        const b = (await painel.getByRole("button", { name: acao }).boundingBox())!;
        expect(b.x + b.width, `${largura}: "${acao}" visível`).toBeLessThanOrEqual(vw - MARGEM);
        expect(b.x).toBeGreaterThanOrEqual(MARGEM);
      }
      await semOverflow(page);
      await painel.getByRole("button", { name: "Concluído" }).click();
      await expect(painel).toHaveCount(0);
    }
    await page.request.post("/api/auth/logout");
  });

  test("FILTROS (regressão): popovers de Histórico, Evidências e Administrativo continuam dentro da viewport", async ({ page }) => {
    await login(page, e2eUsers.admin);
    for (const largura of [375, 768, 1440]) {
      await page.setViewportSize({ width: largura, height: 900 });
      for (const secao of ["historico", "evidencias", "administrativo"]) {
        await page.goto(`/?section=${secao}`);
        await page.getByRole("button", { name: /^Filtros/ }).first().click();
        const painel = page.locator("div.absolute.z-40").filter({ hasText: "Limpar filtros" }).first();
        await expect(painel).toBeVisible();
        const vw = await page.evaluate(() => document.documentElement.clientWidth);
        const box = (await painel.boundingBox())!;
        expect(box.x, `${secao}@${largura}`).toBeGreaterThanOrEqual(MARGEM);
        expect(box.x + box.width, `${secao}@${largura}`).toBeLessThanOrEqual(vw - MARGEM);
        await semOverflow(page);
      }
    }
    await page.request.post("/api/auth/logout");
  });
});
