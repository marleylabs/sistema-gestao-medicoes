import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "./fixtures/test-with-error-guard";
import { LoginPage } from "./pages/login-page";
import { e2eUsers } from "./fixtures";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { buildConsultaPjWorkbook } from "./fixtures/administrativo-xlsx";

/**
 * AUDITORIA — módulo Administrativo/Fornecedores criava cadastros duplicados ao reimportar a
 * planilha "Consulta PJ". Causa raiz real (lib/cadastro-fornecedor.ts:upsertCadastroFornecedor):
 * a busca pelo cadastro existente exigia `cnpjNormalizado` IDÊNTICO como filtro obrigatório —
 * uma correção real de CNPJ entre duas importações (ex.: "Alexandre Augusto Gilli") fazia a busca
 * falhar e criar um segundo cadastro para a mesma pessoa. Corrigido com uma hierarquia de
 * identidade que NUNCA usa CNPJ como chave (só como evidência de apoio) — ver
 * `resolveFornecedorIdentity` no mesmo arquivo e tests/cadastro-fornecedor-identity.test.ts para
 * a cobertura do algoritmo em si. Esta suíte prova o comportamento fim-a-fim, através da UI real.
 */

test.beforeAll(assertConnectedToE2eDatabase);

async function loginAdministrativo(page: import("@playwright/test").Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
  await page.goto("/?section=administrativo");
  await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
}

// Exclusão em massa exige estritamente perfil ADMIN (mais restrito que o resto do módulo
// Administrativo, que também aceita ADMINISTRATIVO) — os cenários de bulk-delete usam esta conta.
async function loginAdmin(page: import("@playwright/test").Page) {
  const login = new LoginPage(page);
  await login.goto();
  await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
  await page.goto("/?section=administrativo");
  await expect(page.getByRole("heading", { name: "Painel Administrativo" })).toBeVisible();
  await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// O card exibe o nome via `displayText()` (title-case, ex.: "E2E" vira "E2e") — nunca compara com
// a string crua. O `<h3>` do card é a única ocorrência do nome como heading (a razão social, que
// costuma conter o mesmo nome, é um `<p>` sem role de heading) — evita ambiguidade de strict mode.
function fornecedorHeading(page: import("@playwright/test").Page, nome: string) {
  return page.getByRole("heading", { name: new RegExp(escapeRegExp(nome), "i") });
}

async function importWorkbook(page: import("@playwright/test").Page, buffer: Buffer, filename: string) {
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  const importResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Importar cadastros" }).click();
  const res = await importResponse;
  return res;
}

/**
 * Fluxo completo de exclusão via UI (checkboxes já marcados pelo chamador) — clica na barra de
 * ação em massa ("Excluir definitivamente"), espera o modal, preenche a confirmação forte
 * "EXCLUIR N" quando aplicável (2+ itens — ver BULK_CONFIRM_THRESHOLD no componente) e clica no
 * botão de confirmação DENTRO do modal (`.ds-dialog`) — nunca no botão da barra, que tem o MESMO
 * texto visível.
 */
async function deleteViaModal(page: import("@playwright/test").Page, count: number) {
  await page.getByRole("button", { name: "Excluir definitivamente" }).click();
  const dialog = page.locator(".ds-dialog");
  await expect(dialog.getByRole("heading")).toBeVisible();
  if (count >= 2) {
    await dialog.getByPlaceholder(`EXCLUIR ${count}`).fill(`EXCLUIR ${count}`);
  }
  const deleteResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/bulk-delete") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Excluir definitivamente" }).click();
  const res = await deleteResponse;
  return res.json();
}

test.describe.serial("Administrativo — importação idempotente, sem duplicar fornecedores", () => {
  const responsavel = "Fornecedor Dedupe E2E";
  const email = "fornecedor.dedupe@example.test";
  const telefone = "(94) 99134-6773";
  const razaoSocial = "Dedupe Engenharia LTDA";
  const cnpjOriginal = "35.094.673/0001-32";
  const cnpjNovo = "35.094.700/0000-00";

  test("CENÁRIO A+B — reimportar com CNPJ alterado e nova vigência atualiza o MESMO cadastro (nunca cria um segundo); VENCIDO -> VÁLIDO sem F5", async ({ page }) => {
    await loginAdministrativo(page);

    const before = await prisma.cadastroFornecedor.count();

    // 1ª importação: cadastro novo, vigência VENCIDA (ano passado).
    const wb1 = buildConsultaPjWorkbook([
      { responsavel, cnpj: cnpjOriginal, razaoSocial, email, telefone, inicio: "12/08/2020", final: "12/08/2021", status: "VENCIDO" },
    ]);
    const res1 = await importWorkbook(page, wb1, "consulta-pj-1.xlsx");
    expect(res1.ok()).toBeTruthy();
    const payload1 = await res1.json();
    expect(payload1.criados).toBe(1);
    expect(payload1.atualizados).toBe(0);
    expect(payload1.conflitos ?? 0).toBe(0);

    await expect(fornecedorHeading(page, responsavel)).toBeVisible();
    await expect(page.getByText(/Vencido/i).first()).toBeVisible();

    const afterFirst = await prisma.cadastroFornecedor.count();
    expect(afterFirst).toBe(before + 1);

    const cadastroAposPrimeiraImportacao = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const idOriginal = cadastroAposPrimeiraImportacao.id;

    // 2ª importação: MESMA pessoa (mesmo nome/e-mail/telefone/razão social), CNPJ CORRIGIDO e
    // nova vigência VÁLIDA — antes da correção, isso criava um SEGUNDO cadastro.
    const wb2 = buildConsultaPjWorkbook([
      { responsavel, cnpj: cnpjNovo, razaoSocial, email, telefone, inicio: "12/09/2026", final: "12/09/2027", status: "VALIDO" },
    ]);
    const res2 = await importWorkbook(page, wb2, "consulta-pj-2.xlsx");
    expect(res2.ok()).toBeTruthy();
    const payload2 = await res2.json();
    expect(payload2.criados, "reimportar a mesma pessoa com CNPJ diferente precisa ser UPDATE, nunca CREATE").toBe(0);
    expect(payload2.atualizados).toBe(1);
    expect(payload2.conflitos ?? 0).toBe(0);

    const afterSecond = await prisma.cadastroFornecedor.count();
    expect(afterSecond, "total de fornecedores não pode crescer — é o MESMO cadastro atualizado").toBe(afterFirst);

    const cadastroAposSegundaImportacao = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    expect(cadastroAposSegundaImportacao.id, "precisa ser a MESMA linha (mesmo id), não uma nova").toBe(idOriginal);
    expect(cadastroAposSegundaImportacao.cnpjNormalizado).toBe("35094700000000");

    // UI: card atualizado SEM F5 — sai de "Vencido" e passa a "Válido", só um card para o nome.
    await expect(fornecedorHeading(page, responsavel)).toHaveCount(1);
    await expect(page.getByText(/Válido/i).first()).toBeVisible();

    const totalCards = await fornecedorHeading(page, responsavel).count();
    expect(totalCards, "nunca pode existir um segundo card para a mesma pessoa").toBe(1);

    await page.request.post("/api/auth/logout");
  });

  test("CENÁRIO F — reimportar a MESMA planilha (idêntica) duas vezes não cria fornecedores adicionais", async ({ page }) => {
    await loginAdministrativo(page);
    const responsavelRepeticao = "Fornecedor Repeticao E2E";
    const wb = buildConsultaPjWorkbook([
      { responsavel: responsavelRepeticao, cnpj: "40.111.222/0001-33", razaoSocial: "Repeticao LTDA", email: "repeticao@example.test", telefone: "11988887777", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);

    const before = await prisma.cadastroFornecedor.count();
    const res1 = await importWorkbook(page, wb, "repeticao.xlsx");
    const payload1 = await res1.json();
    expect(payload1.criados).toBe(1);
    const afterFirst = await prisma.cadastroFornecedor.count();
    expect(afterFirst).toBe(before + 1);

    const res2 = await importWorkbook(page, wb, "repeticao.xlsx");
    const payload2 = await res2.json();
    expect(payload2.criados, "segunda importação da MESMA planilha nunca pode criar de novo").toBe(0);
    expect(payload2.atualizados).toBe(1);
    const afterSecond = await prisma.cadastroFornecedor.count();
    expect(afterSecond, "total não pode crescer ao reimportar a mesma planilha").toBe(afterFirst);

    await page.request.post("/api/auth/logout");
  });

  test("CENÁRIO E — dois fornecedores com nomes distintos compartilhando o MESMO CNPJ permanecem distintos após reimportação", async ({ page }) => {
    await loginAdministrativo(page);
    const cnpjCompartilhado = "50.111.222/0001-99";
    const nomeC = "Fornecedor CNPJ Compartilhado C E2E";
    const nomeD = "Fornecedor CNPJ Compartilhado D E2E";
    const wb = buildConsultaPjWorkbook([
      { responsavel: nomeC, cnpj: cnpjCompartilhado, razaoSocial: "Empresa C LTDA", email: "compartilhado.c@example.test", telefone: "11911112222", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
      { responsavel: nomeD, cnpj: cnpjCompartilhado, razaoSocial: "Empresa D LTDA", email: "compartilhado.d@example.test", telefone: "11933334444", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);

    const res1 = await importWorkbook(page, wb, "cnpj-compartilhado.xlsx");
    const payload1 = await res1.json();
    expect(payload1.criados).toBe(2);

    // Reimporta a MESMA planilha — nunca deve mesclar/rejeitar/sobrescrever um pelo outro.
    const res2 = await importWorkbook(page, wb, "cnpj-compartilhado.xlsx");
    const payload2 = await res2.json();
    expect(payload2.criados).toBe(0);
    expect(payload2.atualizados).toBe(2);

    const cadastroC = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: nomeC } });
    const cadastroD = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: nomeD } });
    expect(cadastroC.cnpjNormalizado).toBe(cadastroD.cnpjNormalizado);
    expect(cadastroC.id).not.toBe(cadastroD.id);
    expect(cadastroC.colaboradorCodigo).not.toBe(cadastroD.colaboradorCodigo);

    await page.request.post("/api/auth/logout");
  });
});

test.describe.serial("Administrativo — exclusão em massa", () => {
  test("CENÁRIO C — selecionar 3 fornecedores sem vínculos, excluir em massa, confirmar modal, TOTAL atualizado sem F5", async ({ page }) => {
    await loginAdmin(page);
    const nomes = ["E2E BulkDelete Um", "E2E BulkDelete Dois", "E2E BulkDelete Tres"];
    const wb = buildConsultaPjWorkbook(
      nomes.map((responsavel, i) => ({
        responsavel,
        cnpj: `60.000.00${i}/0001-0${i}`,
        razaoSocial: `${responsavel} LTDA`,
        email: `bulkdelete.${i}@example.test`,
        telefone: `1190000000${i}`,
        inicio: "01/01/2026",
        final: "01/01/2027",
        status: "VALIDO" as const,
      })),
    );
    await importWorkbook(page, wb, "bulk-delete.xlsx");
    await expect(fornecedorHeading(page, nomes[0])).toBeVisible();

    const totalAntes = await page.locator("p.text-stat-value").first().innerText();

    for (const nome of nomes) {
      await page.getByRole("checkbox", { name: `Selecionar ${nome}` }).check();
    }

    await expect(page.getByText("3 fornecedores selecionados")).toBeVisible();
    await page.getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page.getByRole("heading", { name: "Excluir 3 fornecedores definitivamente?" })).toBeVisible();
    // Confirmação forte por digitação — obrigatória para exclusão em massa (2+ itens).
    const dialog = page.locator(".ds-dialog");
    const confirmButton = dialog.getByRole("button", { name: "Excluir definitivamente" });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByPlaceholder("EXCLUIR 3").fill("EXCLUIR 3");
    await expect(confirmButton).toBeEnabled();

    const deleteResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/bulk-delete") && r.request().method() === "POST");
    await confirmButton.click();
    const res = await deleteResponse;
    expect(res.ok()).toBeTruthy();
    const resultado = await res.json();
    expect(resultado.requested).toBe(3);
    expect(resultado.administrativeDeleted).toBe(3);
    expect(resultado.errors.length).toBe(0);

    for (const nome of nomes) {
      await expect(fornecedorHeading(page, nome)).toHaveCount(0);
    }

    await expect
      .poll(async () => Number(await page.locator("p.text-stat-value").first().innerText()), {
        message: "TOTAL precisa recalcular sozinho após a exclusão em massa, sem F5",
      })
      .toBe(Number(totalAntes) - 3);

    const remaining = await prisma.cadastroFornecedor.count({ where: { responsavel: { in: nomes } } });
    expect(remaining).toBe(0);

    await page.request.post("/api/auth/logout");
  });

  test("CENÁRIO C2 — NOVA POLÍTICA: fornecedor com histórico (SGC) é EXCLUÍDO definitivamente (não mais bloqueado) — cadastro/acesso removidos, Profissional preservado, SGC intacto", async ({ page }) => {
    await loginAdmin(page);
    const responsavel = "E2E BulkDelete Com Historico";
    const wb = buildConsultaPjWorkbook([
      { responsavel, cnpj: "61.000.000/0001-11", razaoSocial: `${responsavel} LTDA`, email: "bulkdelete.historico@example.test", telefone: "11900000099", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);
    await importWorkbook(page, wb, "bulk-delete-historico.xlsx");
    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const profissional = await prisma.profissional.findFirstOrThrow({ where: { codigo: cadastro.colaboradorCodigo! } });
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { nome: { equals: responsavel, mode: "insensitive" } } });

    // Cria histórico real para este colaboradorCodigo — precisa ser PRESERVADO (nunca apagado),
    // mesmo que o cadastro administrativo seja removido definitivamente pelo ADMIN.
    await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: cadastro.colaboradorCodigo!, ciclo: "9999", status: "PENDENTE" },
    });

    await page.getByRole("checkbox", { name: `Selecionar ${responsavel}` }).check();
    const resultado = await deleteViaModal(page, 1);

    expect(resultado.administrativeDeleted).toBe(1);
    expect(resultado.professionalsPreservedForHistory).toBe(1);
    expect(resultado.professionalsDeleted).toBe(0);
    expect(resultado.usersDeactivated).toBe(1);

    const cadastroApagado = await prisma.cadastroFornecedor.findUnique({ where: { id: cadastro.id } });
    expect(cadastroApagado, "cadastro administrativo PRECISA ser removido mesmo com histórico — nova política").toBeNull();

    const profissionalPreservado = await prisma.profissional.findUnique({ where: { id: profissional.id } });
    expect(profissionalPreservado, "Profissional NUNCA é apagado quando há histórico de medição").toBeTruthy();
    expect(profissionalPreservado!.codigo, "codigo/nome/nomeCompleto continuam intactos (identidade histórica mínima)").toBe(profissional.codigo);
    expect(profissionalPreservado!.email, "campos operacionais são limpos ao preservar por histórico").toBeNull();
    expect(profissionalPreservado!.cnpj).toBeNull();
    expect(profissionalPreservado!.razaoSocial).toBeNull();

    const usuarioDesativado = await prisma.usuario.findUnique({ where: { id: usuario.id } });
    expect(usuarioDesativado!.ativo).toBe(false);
    expect(usuarioDesativado!.excluidoAt).toBeTruthy();

    const sgcAindaExiste = await prisma.sgcAprovacaoMedicao.findFirst({ where: { colaboradorCodigo: cadastro.colaboradorCodigo! } });
    expect(sgcAindaExiste, "o histórico de SGC nunca pode ser apagado").toBeTruthy();

    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: cadastro.colaboradorCodigo! } });
    await prisma.profissional.deleteMany({ where: { id: profissional.id } });
    await prisma.usuario.deleteMany({ where: { id: usuario.id } });
  });

  test("CENÁRIO D — bulk-delete chamado por perfil não autorizado (ADMINISTRATIVO, não ADMIN) é rejeitado com 403", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);

    const res = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: { ids: ["00000000-0000-0000-0000-000000000000"] } });
    expect(res.status()).toBe(403);

    await page.request.post("/api/auth/logout");
  });

  test("CENÁRIO D2 — bulk-delete com payload vazio/inválido é rejeitado com 400, nunca 500", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

    const resVazio = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: { ids: [] } });
    expect(resVazio.status()).toBe(400);

    const resSemIds = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: {} });
    expect(resSemIds.status()).toBe(400);
    const malicioso = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: { ids: ["' OR 1=1 --", { id: "qualquer" }], perfil: "ADMIN" } });
    expect(malicioso.status()).toBe(400);

    await page.request.post("/api/auth/logout");
  });
});

test("Exclusão: sem sessão e perfis MEDICAO/COLABORADOR não podem forjar ADMIN", async ({ page }) => {
  const target = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel: "E2E Fornecedor A" } });
  const endpoint = "/api/admin/administrativo/fornecedores/bulk-delete";
  const data = { ids: [target.id], perfil: "ADMIN", role: "ADMIN" };
  const anonymous = await page.request.post(endpoint, { data });
  expect([401, 403]).toContain(anonymous.status());
  for (const credentials of [e2eUsers.medicao, e2eUsers.fornecedorA]) {
    const login = await page.request.post("/api/auth/login", { data: credentials });
    expect(login.status()).toBe(200);
    expect((await page.request.post(endpoint, { data })).status()).toBe(403);
    await page.request.post("/api/auth/logout");
  }
  expect(await prisma.cadastroFornecedor.count({ where: { id: target.id } })).toBe(1);
});

test.describe.serial("Administrativo — exclusão + reimportação (estado coerente, sem ressurreição/duplicidade)", () => {
  test("CENÁRIO G — excluir fornecedor SEM histórico mantém tombstone explícito, desativa usuário e bloqueia reimportação", async ({ page }) => {
    await loginAdmin(page);
    const responsavel = "E2E Exclusao Reimportacao";
    const email = "exclusao.reimportacao@example.test";
    const telefone = "11955556666";
    const razaoSocial = `${responsavel} LTDA`;

    const wb1 = buildConsultaPjWorkbook([
      { responsavel, cnpj: "70.111.222/0001-11", razaoSocial, email, telefone, inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);
    await importWorkbook(page, wb1, "exclusao-1.xlsx");
    await expect(fornecedorHeading(page, responsavel)).toBeVisible();

    const cadastroOriginal = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const colaboradorCodigo = cadastroOriginal.colaboradorCodigo!;
    const profissionalOriginal = await prisma.profissional.findFirstOrThrow({ where: { codigo: colaboradorCodigo } });
    const usuarioOriginal = await prisma.usuario.findFirstOrThrow({ where: { nome: { equals: responsavel, mode: "insensitive" } } });

    // 1) Exclui via UI (sem histórico -> sem nada a preservar em Profissional).
    await page.getByRole("checkbox", { name: `Selecionar ${responsavel}` }).check();
    const deleteResultado = await deleteViaModal(page, 1);
    expect(deleteResultado.administrativeDeleted).toBe(1);
    expect(deleteResultado.professionalsDeleted, "sem histórico -> Profissional é excluído operacionalmente").toBe(1);
    expect(deleteResultado.professionalsPreservedForHistory).toBe(0);
    await expect(fornecedorHeading(page, responsavel)).toHaveCount(0);

    // 2) Cadastro administrativo some, mas Profissional permanece como tombstone explícito,
    // sem dados pessoais. Isso impede reativação silenciosa por importação.
    const cadastroApagado = await prisma.cadastroFornecedor.findUnique({ where: { id: cadastroOriginal.id } });
    expect(cadastroApagado, "CadastroFornecedor precisa ter sido realmente excluído").toBeNull();
    const profissionalApagado = await prisma.profissional.findUniqueOrThrow({ where: { id: profissionalOriginal.id } });
    expect(profissionalApagado.deletedAt).toBeTruthy();
    expect(profissionalApagado.nome).toBe(`EXCLUIDO-${profissionalOriginal.id}`);
    expect(profissionalApagado.nomeCompleto).toBeNull();
    expect(profissionalApagado.email).toBeNull();
    expect(profissionalApagado.cnpj).toBeNull();
    expect(profissionalApagado.cpf).toBeNull();
    const usuarioDesativado = await prisma.usuario.findUnique({ where: { id: usuarioOriginal.id } });
    expect(usuarioDesativado, "Usuario nunca é apagado fisicamente — sempre desativado").toBeTruthy();
    expect(usuarioDesativado!.ativo).toBe(false);
    expect(usuarioDesativado!.excluidoAt).toBeTruthy();

    // 3) Reimportar a mesma identidade deve gerar conflito controlado, nunca restaurar/criar.
    const wb2 = buildConsultaPjWorkbook([
      { responsavel, cnpj: "70.111.222/0001-11", razaoSocial, email, telefone, inicio: "02/01/2026", final: "02/01/2027", status: "VALIDO" },
    ]);
    const res2 = await importWorkbook(page, wb2, "exclusao-2.xlsx");
    const payload2 = await res2.json();
    expect(payload2.criados ?? 0).toBe(0);
    expect(payload2.bloqueados ?? 0).toBeGreaterThanOrEqual(1);
    expect(payload2.conflitos ?? 0).toBe(0);

    const cadastrosFinais = await prisma.cadastroFornecedor.findMany({ where: { responsavel } });
    expect(cadastrosFinais.length, "identidade excluída não pode voltar à operação").toBe(0);

    const profissionaisFinais = await prisma.profissional.count({ where: { codigo: colaboradorCodigo } });
    expect(profissionaisFinais, "tombstone técnico continua único").toBe(1);

    await expect(fornecedorHeading(page, responsavel)).toHaveCount(0);

    await page.request.post("/api/auth/logout");
  });
});

test.describe.serial("Administrativo — duplicado real pré-existente (legado): auditoria detecta, reimportação NUNCA cria um terceiro", () => {
  test("CENÁRIO H — dois CadastroFornecedor legados (mesmo nome/e-mail/telefone/empresa, CNPJ e ID diferentes) são detectados como PROVAVEL_DUPLICADO pela auditoria read-only; reimportar uma nova linha da mesma pessoa vira CONFLICT, nunca um terceiro cadastro", async ({ page }) => {
    const nome = "E2E Duplicado Legado Original";
    const email = "duplicado.legado@example.test";
    const telefone = "11977778888";
    const razaoSocial = `${nome} LTDA`;

    // Seed DIRETO via Prisma (bypassa upsertCadastroFornecedor de propósito) — simula exatamente
    // o estado real encontrado em produção: dois cadastros legados da MESMA pessoa, criados antes
    // desta correção, sem colaboradorCodigo vinculado, cada um com um CNPJ diferente.
    await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: nome } });
    const legado1 = await prisma.cadastroFornecedor.create({
      data: { responsavel: nome, razaoSocial, email, telefone, cnpjNormalizado: "71111111000111", colaboradorCodigo: null },
    });
    const legado2 = await prisma.cadastroFornecedor.create({
      data: { responsavel: nome, razaoSocial, email, telefone, cnpjNormalizado: "71111111000199", colaboradorCodigo: null },
    });

    // 1) Auditoria READ-ONLY real (processo separado, banco E2E) precisa classificar o grupo como
    // PROVAVEL_DUPLICADO — nunca decide sozinha o que fazer, só relata.
    const scriptPath = path.join(__dirname, "..", "scripts", "audit-fornecedor-duplicates.ts");
    // Invoca o CLI do tsx diretamente via `node <cli.mjs> <script>` (sem "npx"/shell) — evita tanto
    // o problema de resolução "npx" vs "npx.cmd" no Windows quanto a quebra de argumentos com
    // espaço (o caminho real do projeto contém "01 - Desenvolvimento") que shell:true introduziria.
    const tsxCliPath = require.resolve("tsx/cli");
    const output = execFileSync(process.execPath, [tsxCliPath, scriptPath], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
      encoding: "utf8",
    });
    expect(output).toContain(nome.toUpperCase());
    expect(output).toContain("PROVAVEL_DUPLICADO");
    const countAfterAudit = await prisma.cadastroFornecedor.count({ where: { responsavel: nome } });
    expect(countAfterAudit, "a auditoria é READ-ONLY — nunca altera dado nenhum").toBe(2);

    // 2) Reimportar uma nova linha da MESMA pessoa (mesmos sinais fortes, batendo com AMBOS os
    // candidatos legados igualmente) precisa virar CONFLICT — nunca escolhe um dos dois
    // arbitrariamente, e sobretudo nunca cria um TERCEIRO cadastro.
    await loginAdministrativo(page);
    const wb = buildConsultaPjWorkbook([
      { responsavel: nome, cnpj: "71.111.111/0001-50", razaoSocial, email, telefone, inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);
    const res = await importWorkbook(page, wb, "duplicado-legado.xlsx");
    const payload = await res.json();
    expect(payload.criados, "nunca pode criar um terceiro cadastro quando há ambiguidade real").toBe(0);
    expect(payload.atualizados).toBe(0);
    expect(payload.conflitos).toBe(1);
    expect(payload.conflitosDetalhe[0].candidatos.length).toBe(2);

    const totalFinal = await prisma.cadastroFornecedor.count({ where: { responsavel: nome } });
    expect(totalFinal, "continua exatamente 2 — nunca 3").toBe(2);

    await page.request.post("/api/auth/logout");
    await prisma.cadastroFornecedor.deleteMany({ where: { id: { in: [legado1.id, legado2.id] } } });
  });
});

test.describe.serial("Validação direcionada — exceção de duplicata redundante COM histórico", () => {
  test("CENÁRIO I — A e B são a MESMA identidade canônica (colaboradorCodigo) com histórico real: excluir só A NÃO toca Profissional (B ainda ativo); excluir B depois (último cadastro) PRESERVA Profissional para histórico e desativa Usuario", async ({ page }) => {
    const codigo = "E2E FORNECEDOR REDUNDANTE";
    const responsavel = "E2E Fornecedor Redundante";

    await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: codigo } });
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: codigo } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: codigo } });
    await prisma.profissional.deleteMany({ where: { codigo } });
    await prisma.usuario.deleteMany({ where: { nome: responsavel } });

    // Seed direto — simula exatamente o estado real de produção: 2 CadastroFornecedor para a
    // MESMA identidade canônica (colaboradorCodigo), com Profissional único (nunca duplicado) e
    // histórico real de SGC + MapaPagamentoItem.
    await prisma.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: responsavel, email: "redundante@example.test" } });
    const usuario = await prisma.usuario.create({
      data: { usuario: "P0999901", nome: responsavel, perfil: "COLABORADOR", senhaHash: "x", ativo: true },
    });
    const cadastroA = await prisma.cadastroFornecedor.create({
      data: { responsavel, razaoSocial: `${responsavel} LTDA`, colaboradorCodigo: codigo, cnpjNormalizado: "81111111000181", email: "redundante@example.test" },
    });
    const cadastroB = await prisma.cadastroFornecedor.create({
      data: { responsavel, razaoSocial: `${responsavel} LTDA`, colaboradorCodigo: codigo, cnpjNormalizado: "81111111000199", email: "redundante@example.test" },
    });
    const sgc = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo, ciclo: "9998", status: "PAGO" } });
    const mapaItem = await prisma.mapaPagamentoItem.create({
      data: { ciclo: "9998", ordem: 1, projetistaCodigo: codigo, responsavel, sourceRowHash: `e2e-redundante-${Date.now()}` },
    });

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await expect(fornecedorHeading(page, responsavel)).toHaveCount(2);

    // 1) Excluir SOMENTE A — B ainda é um cadastro ativo para a mesma identidade, então
    // Profissional/Usuario ficam COMPLETAMENTE intocados (a pessoa continua uma fornecedora ativa).
    const resDeleteA = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: { ids: [cadastroA.id] } });
    const resultadoA = await resDeleteA.json();
    expect(resultadoA.administrativeDeleted).toBe(1);
    expect(resultadoA.professionalsPreservedForHistory, "B ainda existe — Profissional não é reavaliado").toBe(0);
    expect(resultadoA.professionalsDeleted).toBe(0);
    expect(resultadoA.usersDeactivated).toBe(0);

    // 2) Estado coerente: A sumiu; B, Profissional (ATIVO, campos operacionais intactos), Usuario
    // (ATIVO), SGC, MapaPagamentoItem TODOS intactos.
    const aApagado = await prisma.cadastroFornecedor.findUnique({ where: { id: cadastroA.id } });
    expect(aApagado).toBeNull();
    const bAindaExiste = await prisma.cadastroFornecedor.findUnique({ where: { id: cadastroB.id } });
    expect(bAindaExiste, "B precisa continuar existindo").toBeTruthy();
    const profissionalAindaAtivo = await prisma.profissional.findUnique({ where: { codigo } });
    expect(profissionalAindaAtivo, "Profissional continua existindo").toBeTruthy();
    const usuarioAindaAtivo = await prisma.usuario.findUnique({ where: { id: usuario.id } });
    expect(usuarioAindaAtivo!.ativo, "B ainda ativo -> Usuario continua com acesso").toBe(true);
    const sgcAindaExiste = await prisma.sgcAprovacaoMedicao.findUnique({ where: { id: sgc.id } });
    expect(sgcAindaExiste, "histórico de SGC precisa permanecer intacto").toBeTruthy();
    expect(sgcAindaExiste!.status).toBe("PAGO");
    const mapaItemAindaExiste = await prisma.mapaPagamentoItem.findUnique({ where: { id: mapaItem.id } });
    expect(mapaItemAindaExiste, "MapaPagamentoItem precisa permanecer intacto").toBeTruthy();

    // Identidade continua resolvível: buscar o cadastro pelo colaboradorCodigo ainda encontra B.
    const cadastroPorCodigo = await prisma.cadastroFornecedor.findFirst({ where: { colaboradorCodigo: codigo } });
    expect(cadastroPorCodigo?.id).toBe(cadastroB.id);

    await page.reload();
    await expect(fornecedorHeading(page, responsavel)).toHaveCount(1);

    // 3) Excluir B agora — é o ÚLTIMO cadastro desta identidade COM histórico -> NOVA POLÍTICA:
    // permitido; Profissional é PRESERVADO (nunca apagado, campos operacionais limpos); Usuario é desativado.
    const resDeleteB = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: { ids: [cadastroB.id] } });
    const resultadoB = await resDeleteB.json();
    expect(resultadoB.administrativeDeleted, "último cadastro da identidade também pode ser excluído — nova política").toBe(1);
    expect(resultadoB.professionalsPreservedForHistory).toBe(1);
    expect(resultadoB.usersDeactivated).toBe(1);

    const bApagado = await prisma.cadastroFornecedor.findUnique({ where: { id: cadastroB.id } });
    expect(bApagado, "B precisa ter sido removido — o ADMIN pode excluir mesmo o último cadastro").toBeNull();
    const profissionalPreservado = await prisma.profissional.findUnique({ where: { codigo } });
    expect(profissionalPreservado, "Profissional NUNCA é apagado quando há histórico").toBeTruthy();
    expect(profissionalPreservado!.email, "campos operacionais limpos ao preservar por histórico").toBeNull();
    const usuarioDesativado = await prisma.usuario.findUnique({ where: { id: usuario.id } });
    expect(usuarioDesativado!.ativo).toBe(false);
    const sgcAindaExisteDepois = await prisma.sgcAprovacaoMedicao.findUnique({ where: { id: sgc.id } });
    expect(sgcAindaExisteDepois, "histórico de SGC preservado mesmo após excluir o ÚLTIMO cadastro").toBeTruthy();

    await page.request.post("/api/auth/logout");
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { id: sgc.id } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { id: mapaItem.id } });
    await prisma.profissional.deleteMany({ where: { codigo } });
    await prisma.usuario.deleteMany({ where: { id: usuario.id } });
  });

  test("CENÁRIO J — selecionar TODOS os cadastros de uma identidade com histórico de uma vez -> PERMITIDO (nunca mais DUPLICATE_REQUIRES_SELECTION), Profissional preservado", async ({ page }) => {
    const codigo = "E2E FORNECEDOR REDUNDANTE J";
    const responsavel = "E2E Fornecedor Redundante J";
    await prisma.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: responsavel, email: "redundante-j@example.test" } });
    const cadastroA = await prisma.cadastroFornecedor.create({
      data: { responsavel, razaoSocial: `${responsavel} LTDA`, colaboradorCodigo: codigo, cnpjNormalizado: "82111111000182" },
    });
    const cadastroB = await prisma.cadastroFornecedor.create({
      data: { responsavel, razaoSocial: `${responsavel} LTDA`, colaboradorCodigo: codigo, cnpjNormalizado: "82111111000199" },
    });
    const sgc = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigo, ciclo: "9997", status: "PAGO" } });

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);

    const res = await page.request.post("/api/admin/administrativo/fornecedores/bulk-delete", { data: { ids: [cadastroA.id, cadastroB.id] } });
    const resultado = await res.json();
    expect(resultado.administrativeDeleted, "excluir os 2 cadastros de uma identidade com histórico de uma vez é permitido pela nova política").toBe(2);
    expect(resultado.professionalsPreservedForHistory, "identidade processada uma única vez (A e B compartilham o mesmo colaboradorCodigo)").toBe(1);
    expect(resultado.errors.length).toBe(0);

    const restantes = await prisma.cadastroFornecedor.count({ where: { colaboradorCodigo: codigo } });
    expect(restantes, "ambos foram excluídos").toBe(0);
    const profissionalPreservado = await prisma.profissional.findUnique({ where: { codigo } });
    expect(profissionalPreservado, "Profissional preservado por causa do histórico, mesmo com os 2 cadastros excluídos de uma vez").toBeTruthy();
    expect(profissionalPreservado!.email, "campos operacionais limpos ao preservar por histórico").toBeNull();

    await page.request.post("/api/auth/logout");
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { id: sgc.id } });
    await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: codigo } });
    await prisma.profissional.deleteMany({ where: { codigo } });
  });
});

test.describe.serial("Validação direcionada — homônimo real na camada Profissional (diferenciado por código canônico)", () => {
  test("CENÁRIO K — dois Profissional DISTINTOS (mesma nomeCompleto, codigo/nome diferentes — padrão real de importação ETL) permanecem isolados: reimportar A atualiza só A, reimportar B atualiza só B, sem overwrite nem Usuario compartilhado", async ({ page }) => {
    const nomeCompleto = "Fornecedor Homônimo Profissional E2E";
    const codigoA = "HOMONIMO-PROF-CODIGO-X";
    const codigoB = "HOMONIMO-PROF-CODIGO-Y";
    await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [codigoA, codigoB] } } });
    await prisma.profissional.deleteMany({ where: { codigo: { in: [codigoA, codigoB] } } });
    await prisma.usuario.deleteMany({ where: { nome: { in: [codigoA, codigoB] } } });

    // Dois Profissional REAIS distintos com o MESMO nomeCompleto (nome de exibição), mas
    // codigo/nome (a identidade canônica de fato) diferentes — exatamente como o ETL de medições
    // já produz para homônimos reais (Profissional.nome/codigo são @unique; nomeCompleto não é).
    await prisma.profissional.create({ data: { nome: codigoA, codigo: codigoA, nomeCompleto, email: "homonimo.x@example.test", cnpj: "83111111000183" } });
    await prisma.profissional.create({ data: { nome: codigoB, codigo: codigoB, nomeCompleto, email: "homonimo.y@example.test", cnpj: "83222222000183" } });

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);

    // Importa duas linhas — cada uma identificada pelo CÓDIGO canônico específico (não pelo nome
    // de exibição compartilhado, que sozinho seria ambíguo entre os dois) — cada uma resolve
    // exclusivamente ao Profissional correspondente.
    const wb = buildConsultaPjWorkbook([
      { responsavel: codigoA, cnpj: "83.111.111/0001-83", razaoSocial: "Homonimo X LTDA", email: "homonimo.x@example.test", telefone: "11900001111", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
      { responsavel: codigoB, cnpj: "83.222.222/0001-83", razaoSocial: "Homonimo Y LTDA", email: "homonimo.y@example.test", telefone: "11900002222", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);
    const res1 = await importWorkbook(page, wb, "homonimo-profissional-1.xlsx");
    const payload1 = await res1.json();
    expect(payload1.criados).toBe(2);
    expect(payload1.conflitos ?? 0).toBe(0);

    const cadastroA = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { colaboradorCodigo: codigoA } });
    const cadastroB = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { colaboradorCodigo: codigoB } });
    expect(cadastroA.id).not.toBe(cadastroB.id);
    expect(cadastroA.cnpjNormalizado).not.toBe(cadastroB.cnpjNormalizado);

    // Usuario: cada linha cria/usa seu próprio Usuario (nome = responsavel = código específico) —
    // nunca compartilhado entre os dois homônimos.
    const usuarioA = await prisma.usuario.findFirst({ where: { nome: { equals: codigoA, mode: "insensitive" } } });
    const usuarioB = await prisma.usuario.findFirst({ where: { nome: { equals: codigoB, mode: "insensitive" } } });
    expect(usuarioA, "Usuario de A precisa existir").toBeTruthy();
    expect(usuarioB, "Usuario de B precisa existir").toBeTruthy();
    expect(usuarioA!.id).not.toBe(usuarioB!.id);

    // Reimportar SÓ A (com um dado novo) atualiza SOMENTE A — B intocado.
    const wbSoA = buildConsultaPjWorkbook([
      { responsavel: codigoA, cnpj: "83.111.111/0001-83", razaoSocial: "Homonimo X Atualizado LTDA", email: "homonimo.x@example.test", telefone: "11900001111", inicio: "02/01/2026", final: "02/01/2027", status: "VALIDO" },
    ]);
    const res2 = await importWorkbook(page, wbSoA, "homonimo-profissional-2.xlsx");
    const payload2 = await res2.json();
    expect(payload2.criados).toBe(0);
    expect(payload2.atualizados).toBe(1);
    expect(payload2.conflitos ?? 0).toBe(0);

    const cadastroAAtualizado = await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroA.id } });
    expect(cadastroAAtualizado.razaoSocial).toBe("Homonimo X Atualizado LTDA");
    const cadastroBIntocado = await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: cadastroB.id } });
    expect(cadastroBIntocado.razaoSocial, "reimportar A nunca pode alterar B").toBe("Homonimo Y LTDA");

    await page.request.post("/api/auth/logout");
    await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [codigoA, codigoB] } } });
    await prisma.profissional.deleteMany({ where: { codigo: { in: [codigoA, codigoB] } } });
    await prisma.usuario.deleteMany({ where: { nome: { in: [codigoA, codigoB] } } });
  });
});

test.describe.serial("Validação direcionada — restrição de perfil e efeitos colaterais da exclusão definitiva", () => {
  test("Botão de exclusão NÃO aparece para perfil ADMINISTRATIVO (só ADMIN pode ver/usar)", async ({ page }) => {
    await loginAdministrativo(page);
    const wb = buildConsultaPjWorkbook([
      { responsavel: "E2E Sem Botao Exclusao", cnpj: "84.000.000/0001-84", razaoSocial: "E2E Sem Botao LTDA", inicio: "01/01/2026", final: "01/01/2027", status: "VALIDO" },
    ]);
    await importWorkbook(page, wb, "sem-botao.xlsx");
    await expect(fornecedorHeading(page, "E2E Sem Botao Exclusao")).toBeVisible();

    await expect(page.getByRole("checkbox", { name: /Selecionar/ })).toHaveCount(0);
    await expect(page.getByTitle("Excluir fornecedor definitivamente")).toHaveCount(0);

    await page.request.post("/api/auth/logout");
    await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: "E2E Sem Botao Exclusao" } });
    await prisma.profissional.deleteMany({ where: { nomeCompleto: "E2E Sem Botao Exclusao" } });
  });

  test("identidade excluída não aparece em GET /api/profissionais", async ({ page }) => {
    const codigo = "E2E FORNECEDOR SELETOR EXCLUIDO";
    await prisma.profissional.deleteMany({ where: { codigo } });
    const profissional = await prisma.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: null, deletedAt: new Date() } });

    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.medicao.usuario, e2eUsers.medicao.senha);
    const res = await page.request.get("/api/profissionais");
    const lista: { codigo: string | null }[] = await res.json();
    expect(lista.some((p) => p.codigo === codigo), "excluído nunca pode aparecer no seletor operacional").toBe(false);
    const before = await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: codigo } });
    expect((await page.request.post("/api/mapa-pagamento", { data: { projetistaCodigo: codigo, ciclo: "2612", valor: 100 } })).status()).toBe(400);
    expect(await prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: codigo } })).toBe(before);
    expect((await page.request.post("/api/mapa-pagamento/documentos", { data: { codigo, ciclo: "2612", numeroDocumento: "NAO-CRIAR" } })).status()).toBe(404);
    expect((await page.request.post("/api/sgc/enviar", { data: { colaboradorCodigo: codigo, ciclo: "2612" } })).status()).toBe(400);
    const projeto = await prisma.projeto.findFirstOrThrow();
    expect((await page.request.post("/api/medicoes", { data: { numeroMedicao: "NAO-CRIAR", idProjeto: projeto.id, idProfissional: profissional.id } })).status()).toBe(400);
    expect(await prisma.medicao.count({ where: { idProfissional: profissional.id } })).toBe(0);

    await page.request.post("/api/auth/logout");
    await prisma.profissional.deleteMany({ where: { codigo } });
  });

  test("CENÁRIO L — cenário completo: fornecedor com CadastroFornecedor+Profissional+Usuario+SGC+MapaPagamentoItem+NF+comprovante; ADMIN exclui definitivamente; tudo histórico permanece, login passa a falhar, cadastro some do Administrativo", async ({ page }) => {
    const responsavel = "E2E Cenario Completo L";
    const email = "cenario.completo.l@example.test";

    // 1) Cria o fornecedor via cadastro manual real (para obter uma senha temporária REAL e
    // provar login antes/depois com credenciais genuínas, não simuladas).
    const login = new LoginPage(page);
    await login.goto();
    await login.login(e2eUsers.administrativo.usuario, e2eUsers.administrativo.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await page.getByRole("button", { name: "Novo fornecedor" }).click();
    await page.getByLabel("Nome / Responsável").fill(responsavel);
    await page.getByLabel("CNPJ", { exact: true }).fill("85.000.000/0001-85");
    await page.getByLabel("Razão social").fill(`${responsavel} LTDA`);
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    const criarResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/administrativo/fornecedores/manual") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    const criarPayload = await (await criarResponse).json();
    const senhaTemporaria: string = criarPayload.usuarioCriado.senha;
    const usuarioLogin: string = criarPayload.usuarioCriado.usuario;
    await page.request.post("/api/auth/logout");

    const cadastro = await prisma.cadastroFornecedor.findFirstOrThrow({ where: { responsavel } });
    const colaboradorCodigo = cadastro.colaboradorCodigo!;
    const profissional = await prisma.profissional.findFirstOrThrow({ where: { codigo: colaboradorCodigo } });
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { usuario: usuarioLogin } });

    // 2) Seed de histórico real: SGC PAGO com NF e comprovante (bytes reais, ainda que pequenos —
    // o que importa é provar que a exclusão administrativa nunca apaga essas colunas) e um
    // MapaPagamentoItem (linha real de "Pagamentos por Fornecedor"). O seletor de ciclo em
    // Evidências (GET /api/ciclos) lê de MapaPagamentoContexto, não de SgcAprovacaoMedicao —
    // sem este registro o ciclo "9996" nunca aparece na lista de opções.
    await prisma.mapaPagamentoContexto.create({
      data: { ciclo: "9996", mesReferencia: "E2E Cenario L", producaoInicio: new Date("2026-01-01"), producaoFim: new Date("2026-01-31"), atoCiclo: "9996" },
    });
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: {
        colaboradorCodigo,
        ciclo: "9996",
        status: "PAGO",
        colaboradorNome: responsavel,
        nfArquivo: Buffer.from("nf-fake-pdf-bytes"),
        nfArquivoNome: "nf-teste.pdf",
        comprovanteArquivo: Buffer.from("comprovante-fake-pdf-bytes"),
        comprovanteArquivoNome: "comprovante-teste.pdf",
        pagoAt: new Date(),
      },
    });
    const mapaItem = await prisma.mapaPagamentoItem.create({
      data: { ciclo: "9996", ordem: 1, projetistaCodigo: colaboradorCodigo, responsavel, valor: 1000, sourceRowHash: `e2e-cenario-l-${Date.now()}` },
    });

    // 3) Login do fornecedor ANTES da exclusão — precisa funcionar (prova que a credencial é real).
    const loginAntesRes = await page.request.post("/api/auth/login", { data: { usuario: usuarioLogin, senha: senhaTemporaria } });
    expect(loginAntesRes.status(), "login precisa funcionar ANTES da exclusão, com a senha temporária real gerada pelo cadastro manual").toBe(200);
    await page.request.post("/api/auth/logout");

    // 4) ADMIN exclui definitivamente pela UI real.
    await login.goto();
    await login.login(e2eUsers.admin.usuario, e2eUsers.admin.senha);
    await page.goto("/?section=administrativo");
    await expect(page.getByText("Carregando cadastros...")).toHaveCount(0);
    await expect(fornecedorHeading(page, responsavel)).toBeVisible();
    await page.getByRole("checkbox", { name: `Selecionar ${responsavel}` }).check();
    const resultado = await deleteViaModal(page, 1);
    expect(resultado.administrativeDeleted).toBe(1);
    expect(resultado.professionalsPreservedForHistory, "SGC com histórico -> Profissional precisa ser preservado").toBe(1);
    expect(resultado.usersDeactivated).toBe(1);

    const editarExcluido = await page.request.patch(`/api/mapa-pagamento/${mapaItem.id}`, { data: { projetistaCodigo: colaboradorCodigo, valor: 9999 } });
    expect(editarExcluido.status()).toBe(400);

    // 5) Administrativo: fornecedor desaparece.
    await expect(fornecedorHeading(page, responsavel)).toHaveCount(0);
    await page.reload();
    await expect(fornecedorHeading(page, responsavel)).toHaveCount(0);

    // 6) Login: fornecedor não entra mais.
    const loginDepoisRes = await page.request.post("/api/auth/login", { data: { usuario: usuarioLogin, senha: senhaTemporaria } });
    expect(loginDepoisRes.status(), "login precisa falhar DEPOIS da exclusão, mesmo com a senha correta").not.toBe(200);

    // 7) Pagamentos por Fornecedor (MapaPagamentoItem): linha continua EXATAMENTE igual.
    const mapaItemDepois = await prisma.mapaPagamentoItem.findUniqueOrThrow({ where: { id: mapaItem.id } });
    expect(mapaItemDepois.projetistaCodigo).toBe(colaboradorCodigo);
    expect(Number(mapaItemDepois.valor)).toBe(1000);

    // 8) SGC, NF e comprovante: continuam intactos.
    const sgcDepois = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgc.id } });
    expect(sgcDepois.status).toBe("PAGO");
    expect(sgcDepois.nfArquivo).toBeTruthy();
    expect(sgcDepois.nfArquivoNome).toBe("nf-teste.pdf");
    expect(sgcDepois.comprovanteArquivo).toBeTruthy();
    expect(sgcDepois.comprovanteArquivoNome).toBe("comprovante-teste.pdf");

    // 9) Evidências: o fornecedor continua aparecendo (dado histórico de SGC, nunca dependeu do
    // CadastroFornecedor administrativo, que já foi excluído neste ponto).
    await page.goto("/?section=evidencias");
    const cicloSelect = page.locator("select").filter({ has: page.locator('option[value="__todos__"]') });
    await cicloSelect.selectOption("9996");
    const fornecedorSelect = page.locator("select").filter({ has: page.locator("option", { hasText: /Selecione…|Nenhum Boletim/ }) });
    await expect(fornecedorSelect.locator("option", { hasText: responsavel })).toHaveCount(1);

    // 10) Profissional preservado como tombstone técnico; nome pessoal e campos operacionais limpos.
    const profissionalDepois = await prisma.profissional.findUniqueOrThrow({ where: { id: profissional.id } });
    expect(profissionalDepois.codigo).toBe(profissional.codigo);
    expect(profissionalDepois.nome).toBe(`EXCLUIDO-${profissional.id}`);
    expect(profissionalDepois.nomeCompleto).toBeNull();
    expect(profissionalDepois.deletedAt).toBeTruthy();
    expect(profissionalDepois.email).toBeNull();
    expect(profissionalDepois.cnpj).toBeNull();
    expect(profissionalDepois.razaoSocial).toBeNull();
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { targetId: profissional.id, action: "FORNECEDOR_EXCLUSAO_DEFINITIVA" } });
    expect(audit.adminUsuario).toBe(e2eUsers.admin.usuario);
    expect(audit.createdAt).toBeTruthy();
    const usuarioDepois = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(usuarioDepois.ativo).toBe(false);
    expect(usuarioDepois.excluidoAt).toBeTruthy();

    await page.request.post("/api/auth/logout");
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { id: sgc.id } });
    await prisma.mapaPagamentoItem.deleteMany({ where: { id: mapaItem.id } });
    await prisma.mapaPagamentoContexto.deleteMany({ where: { ciclo: "9996" } });
    await prisma.profissional.deleteMany({ where: { id: profissional.id } });
    await prisma.usuario.deleteMany({ where: { id: usuario.id } });
  });
});
