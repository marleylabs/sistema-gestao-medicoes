import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Fluxo completo de identidades na importação — com o ETL REAL (etl/server.py, subido por este spec
 * em 127.0.0.1:4011 apontando para o Postgres E2E) e uma planilha SINTÉTICA
 * (e2e/fixtures/planilha_identidades.py):
 *   erro estrutural bloqueia → descarte consciente → importação conclui com AUTO_MATCH, linha vazia
 *   ignorada e cadastros pendentes no ciclo (cinza, BM indisponível) → vínculo sem reimportar (BM
 *   liberado) → descarte de outro pendente (sai do total) → reimportação reconhece o alias.
 */

test.beforeAll(assertConnectedToE2eDatabase);

const ROOT = path.join(__dirname, "..");
const CICLO = "2806"; // ciclo real (YYMM) exclusivo deste spec
const S = randomUUID().replace(/[^a-f]/g, "").slice(0, 6).toUpperCase().padEnd(6, "X");
const RESOLVIDO = `FORNECEDOR E2E ${S} RESOLVIDO`;
const MARIA_CANONICA = `MARIA ${S} FERNANDA LIMA COSTA`;
const ROMERO_CANONICO = `ROMERO ${S} CARVALHO`;
const ROMERO = `ROMERO ${S} PINTO`;
const CARLOS = `CARLOS ${S} NUNES`;
const ETL_PORT = 4011;
let etl: ChildProcess | null = null;
let planilha = "";

function etlDatabaseUrl() {
  return (process.env.DATABASE_URL_TEST ?? "").replace(/^postgres(ql)?:\/\//, "postgresql+psycopg://").replace(/\?.*$/, "");
}

async function esperarEtl() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${ETL_PORT}/health`);
      if (res.ok) return;
    } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("ETL da suíte não respondeu em 127.0.0.1:4011");
}

async function login(page: Page, usuario: { usuario: string; senha: string }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.login(usuario.usuario, usuario.senha);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function importar(page: Page) {
  await page.goto("/?section=importar");
  // O input escondido só reage depois da hidratação do React: repete até o arquivo aparecer.
  await expect(async () => {
    // Limpa antes: repetir o MESMO arquivo não dispara "change" de novo no navegador.
    await page.locator("#etl-file-input").setInputFiles([]);
    await page.locator("#etl-file-input").setInputFiles(planilha);
    await expect(page.getByText("planilha-identidades.xlsx")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByPlaceholder("Ou digite (ex: 2607)").fill(CICLO);
  const post = page.waitForResponse((r) => r.url().endsWith("/api/admin/etl") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Iniciar importação" }).click();
  expect((await post).status()).toBe(202);
  // Fim real do processamento: a mensagem final do polling (concluída ou bloqueada).
  await expect(page.getByText(/Importação concluída com sucesso!|Importação bloqueada\. Revise as linhas/)).toBeVisible({ timeout: 90_000 });
}

const somaMapa = async () => Number((await prisma.mapaPagamentoItem.aggregate({ where: { ciclo: CICLO }, _sum: { valor: true } }))._sum.valor ?? 0);

async function semOverflow(page: Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, "sem rolagem horizontal").toBeLessThanOrEqual(o.c + 1);
}

async function limparCiclo() {
  await prisma.sgcLog.deleteMany({ where: { ciclo: CICLO } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: CICLO } });
  await prisma.medicao.deleteMany({ where: { ciclo: CICLO } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { ciclo: CICLO } });
  await prisma.importacaoIdentidade.deleteMany({ where: { ciclo: CICLO } });
  await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: CICLO } });
}

test.describe.serial("Importação — identidades pendentes, automáticas e descartadas (ETL real)", () => {
  test.beforeAll(async () => {
    planilha = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-ident-")), "planilha-identidades.xlsx");
    execFileSync(process.env.PYTHON ?? "python", [path.join(ROOT, "e2e", "fixtures", "planilha_identidades.py"), planilha, S], { cwd: ROOT });
    await limparCiclo();
    for (const codigo of [RESOLVIDO, MARIA_CANONICA, ROMERO_CANONICO]) {
      await prisma.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: codigo } });
      await prisma.cadastroFornecedor.create({
        data: { cnpjNormalizado: "11222333000181", colaboradorCodigo: codigo, responsavel: codigo, razaoSocial: `${codigo} LTDA`, email: `${codigo.replace(/\s+/g, "-").toLowerCase()}@example.test`, rawPayload: {} },
      });
    }
    etl = spawn(process.env.PYTHON ?? "python", [path.join(ROOT, "etl", "server.py")], {
      cwd: path.join(ROOT, "etl"),
      env: { ...process.env, ETL_SERVER_PORT: String(ETL_PORT), ETL_SERVER_HOST: "127.0.0.1", ETL_DATABASE_URL: etlDatabaseUrl(), PYTHONIOENCODING: "utf-8" },
      // Saída do ETL da suíte num arquivo temporário (diagnóstico de falha; nunca no console).
      stdio: ["ignore", fs.openSync(path.join(os.tmpdir(), "e2e-etl-identidades.log"), "w"), fs.openSync(path.join(os.tmpdir(), "e2e-etl-identidades.err.log"), "w")],
    });
    await esperarEtl();
  });

  test.afterAll(async () => {
    etl?.kill();
    await limparCiclo();
    const codigos = [RESOLVIDO, MARIA_CANONICA, ROMERO_CANONICO];
    const ids = (await prisma.profissional.findMany({ where: { codigo: { in: codigos } }, select: { id: true } })).map((p) => p.id);
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { targetCodigo: { contains: S } }, { action: "IDENTIDADE_IMPORTACAO_DESCARTADA", targetType: "ImportacaoLinha", createdAt: { gte: new Date(Date.now() - 3_600_000) } }] } });
    await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
    await prisma.profissional.deleteMany({ where: { id: { in: ids } } }); // aliases em cascata
    await prisma.projeto.deleteMany({ where: { codigoProjeto: "PRJ-E2E-IDENT", medicoes: { none: {} } } });
  });

  test("ADMIN: bloqueio estrutural → descarte → importação com auto-match e pendentes → vínculo → descarte → reimportação", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, e2eUsers.admin);

    // 1) Linha com dados sem PROJETISTA bloqueia; nada é gravado.
    await importar(page);
    await expect(page.getByText(/1 linha\(s\) possuem dados de medição, mas não têm PROJETISTA válido/)).toBeVisible();
    await expect(page.getByTestId("identidades-sem-projetista")).toContainText(`DOC-${S}-SEM`);
    expect(await prisma.medicao.count({ where: { ciclo: CICLO } })).toBe(0);
    expect(await prisma.profissionalAlias.count({ where: { profissional: { codigo: MARIA_CANONICA } } })).toBe(0);

    // 2) Descarte consciente (diálogo do design system), depois reimporta.
    await page.getByRole("button", { name: "Descartar estas linhas" }).click();
    const dialogo = page.getByTestId("linhas-descartar-dialog");
    await expect(dialogo).toContainText(`DOC-${S}-SEM`);
    await dialogo.getByRole("button", { name: "Descartar linhas" }).dblclick();
    await expect(page.getByText(/linha\(s\) descartada\(s\) deste ciclo\. Reimporte a medição/)).toBeVisible();
    expect(await prisma.importacaoIdentidade.count({ where: { ciclo: CICLO, tipo: "LINHA_SEM_PROJETISTA", status: "DESCARTADO" } })).toBe(1);

    await importar(page);
    const resumo = page.getByTestId("etl-resumo-identidades");
    await expect(resumo).toContainText("Importação concluída");
    await expect(resumo).toContainText("1 correspondência(s) resolvida(s) automaticamente");
    await expect(resumo).toContainText("2 cadastro(s) pendente(s) de vínculo");
    await expect(resumo).toContainText("o envio de BM ficará indisponível até o vínculo cadastral");
    await resumo.getByText("Resolvidos automaticamente").click();
    await expect(page.getByTestId("etl-correspondencias-automaticas")).toContainText(`MARIA ${S} COSTA → ${MARIA_CANONICA}`);
    // Linhas vazias nunca viraram ocorrência; pendentes estão no ciclo (sem Profissional) e no total.
    expect(await prisma.medicao.count({ where: { ciclo: CICLO } })).toBe(5);
    expect(await somaMapa()).toBe(190); // 100 + 10 + 50 + 30 (a linha descartada, 7, não entra)
    expect(await prisma.profissional.count({ where: { OR: [{ codigo: ROMERO }, { nome: ROMERO }] } })).toBe(0);

    const painel = page.getByTestId("identidades-do-ciclo");
    await expect(painel.getByTestId("identidades-contador")).toHaveText("2 cadastro(s) pendente(s) de vínculo");
    await expect(painel.locator(`[data-testid="identidade-card"][data-valor="${ROMERO}"]`)).toContainText("Cadastro pendente");

    // 3) Fornecedores: linha cinza, badge, BM indisponível (UI e API).
    await page.goto(`/fornecedores?ciclo=${CICLO}`);
    const linhaRomero = page.locator("tr", { hasText: ROMERO });
    await expect(linhaRomero).toHaveAttribute("data-cadastro-pendente", "true");
    await expect(linhaRomero).toContainText("Cadastro pendente");
    await expect(linhaRomero).toContainText("BM indisponível");
    await expect(linhaRomero.getByRole("checkbox")).toBeDisabled();
    await expect(linhaRomero.getByRole("checkbox")).toHaveAttribute("title", /Vincule este registro a um cadastro/);
    await expect(page.getByTestId("fornecedores-cadastros-pendentes")).toContainText("2 cadastros pendentes de vínculo");
    const forjado = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: ROMERO, ciclo: CICLO } });
    expect(forjado.status()).toBe(409);
    expect(await prisma.sgcAprovacaoMedicao.count({ where: { ciclo: CICLO, colaboradorCodigo: ROMERO } })).toBe(0);

    // 4) Vincular pelo próprio registro pendente (drawer) — sem reimportar.
    await linhaRomero.click();
    const detalhe = page.getByTestId("cadastro-pendente-detalhe");
    await expect(detalhe).toBeVisible();
    await detalhe.getByRole("button", { name: "Vincular cadastro" }).click();
    const vincular = page.getByTestId("identidade-vincular-dialog");
    await vincular.getByLabel("Buscar cadastro").fill(`ROMERO ${S}`);
    await vincular.getByTestId("identidade-busca-resultados").getByRole("button", { name: new RegExp(ROMERO_CANONICO) }).click();
    await expect(vincular.getByTestId("identidade-alvo")).toContainText(ROMERO_CANONICO);
    await vincular.getByRole("button", { name: "Confirmar vínculo" }).dblclick();
    await expect(page.getByText(`"${ROMERO}" vinculado a ${ROMERO_CANONICO}.`)).toBeVisible();
    const linhaVinculada = page.locator("tr", { hasText: ROMERO_CANONICO });
    await expect(linhaVinculada).not.toHaveAttribute("data-cadastro-pendente", "true");
    await expect(linhaVinculada.getByRole("checkbox")).toBeEnabled();
    expect(await somaMapa()).toBe(190); // vínculo nunca muda valor
    expect(await prisma.profissionalAlias.count({ where: { aliasNormalizado: ROMERO, profissional: { codigo: ROMERO_CANONICO } } })).toBe(1);
    const enviar = await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: ROMERO_CANONICO, ciclo: CICLO } });
    expect(enviar.ok(), "BM liberado sem reimportação").toBe(true);

    // 5) Descartar o outro pendente: confirmação com impacto; sai do total.
    await page.locator("tr", { hasText: CARLOS }).click();
    await page.getByTestId("cadastro-pendente-detalhe").getByRole("button", { name: "Descartar" }).click();
    const descartar = page.getByTestId("identidade-descartar-dialog");
    await expect(descartar).toContainText(`Descartar ${CARLOS} desta medição?`);
    await expect(descartar).toContainText("1 ocorrência(s) serão desconsideradas");
    await expect(descartar).toContainText("R$ 30,00");
    await descartar.getByRole("button", { name: "Descartar" }).click();
    await expect(page.getByText(`"${CARLOS}" descartado deste ciclo.`)).toBeVisible();
    await expect(page.locator("tr", { hasText: CARLOS })).toHaveCount(0);
    expect(await somaMapa()).toBe(160);
    await expect(page.getByTestId("fornecedores-cadastros-pendentes")).toHaveCount(0);

    // 6) Reimportação do mesmo arquivo: alias reconhecido, descarte respeitado, nada duplica.
    await importar(page);
    await expect(page.getByTestId("etl-resumo-identidades")).toContainText("0 cadastro(s) pendente(s) de vínculo");
    await expect(page.getByTestId("etl-resumo-identidades")).toContainText("2 item(ns) descartado(s) (1 linha(s) sem PROJETISTA)");
    expect(await somaMapa()).toBe(160);
    expect(await prisma.medicao.count({ where: { ciclo: CICLO } })).toBe(4);
    await page.request.post("/api/auth/logout");
  });

  test("MEDICAO: vê pendências, não resolve; backend recusa vínculo/descarte", async ({ page }) => {
    const pendente = await prisma.importacaoIdentidade.create({
      data: { ciclo: CICLO, tipo: "IDENTIDADE", chave: `OUTRO ${S} PENDENTE`, valorBruto: `OUTRO ${S} PENDENTE`, origem: "Documentos", status: "PENDENTE", ocorrencias: 1 },
    });
    await login(page, e2eUsers.medicao);
    const lista = await page.request.get(`/api/admin/importacao/identidades?ciclo=${CICLO}`);
    expect(lista.ok()).toBe(true);
    expect((await lista.json()).podeResolver).toBe(false);
    expect((await page.request.post(`/api/admin/importacao/identidades/${pendente.id}/vincular`, { data: { codigoCanonico: RESOLVIDO } })).status()).toBe(403);
    expect((await page.request.post(`/api/admin/importacao/identidades/${pendente.id}/descartar`)).status()).toBe(403);
    expect((await page.request.post("/api/admin/importacao/identidades/linhas/descartar", { data: { ciclo: CICLO, linhas: [{ chave: "b".repeat(64) }] } })).status()).toBe(403);
    expect((await prisma.importacaoIdentidade.findUniqueOrThrow({ where: { id: pendente.id } })).status).toBe("PENDENTE");
    await page.request.post("/api/auth/logout");
  });

  for (const largura of [375, 432, 768, 1024, 1280, 1440]) {
    test(`responsivo ${largura}px: pendente, ações e diálogo de descarte sem overflow`, async ({ page }) => {
      const pendente = await prisma.importacaoIdentidade.findFirstOrThrow({ where: { ciclo: CICLO, chave: `OUTRO ${S} PENDENTE` } });
      const mapa = await prisma.mapaPagamentoItem.findFirst({ where: { ciclo: CICLO, identidadeImportacaoId: pendente.id } })
        ?? await prisma.mapaPagamentoItem.create({ data: { ciclo: CICLO, ordem: 99, projetistaCodigo: pendente.valorBruto, responsavel: pendente.valorBruto, valor: 5, sourceRowHash: `e2e-ident-resp-${S}`, identidadeImportacaoId: pendente.id } });
      await page.setViewportSize({ width: largura, height: 900 });
      await login(page, e2eUsers.admin);
      await page.goto(`/fornecedores?ciclo=${CICLO}`);
      await expect(page.getByTestId("fornecedores-cadastros-pendentes")).toBeVisible();
      await semOverflow(page);
      const alvo = largura < 768
        ? page.getByTestId("fornecedores-lista-mobile").locator("li", { hasText: pendente.valorBruto }).getByRole("button", { name: /Abrir detalhe/ })
        : page.locator("tr", { hasText: pendente.valorBruto });
      await alvo.click();
      await expect(page.getByTestId("cadastro-pendente-detalhe").getByTestId("identidade-acoes")).toBeVisible();
      await semOverflow(page);
      await page.getByTestId("cadastro-pendente-detalhe").getByRole("button", { name: "Descartar" }).click();
      await expect(page.getByTestId("identidade-descartar-dialog")).toBeVisible();
      await semOverflow(page);
      await page.getByTestId("identidade-descartar-dialog").getByRole("button", { name: "Cancelar" }).click();
      await page.goto("/?section=importar");
      await semOverflow(page);
      expect(mapa.id).toBeTruthy();
      await page.request.post("/api/auth/logout");
    });
  }
});
