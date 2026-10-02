import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { avaliarElegibilidadePrimeiroAcesso } from "../lib/primeiro-acesso-elegibilidade";
import {
  INTERVALO_MINIMO_ENVIO_MS,
  LIMITE_PRIMEIRO_ACESSO_LOTE,
  normalizarIdsPrimeiroAcessoLote,
  processarPrimeiroAcessoEmLote,
  type CadastroPrimeiroAcesso,
  type EnvioPrimeiroAcesso,
} from "../lib/primeiro-acesso-lote";
import type { RotateAndSendFirstAccessResult } from "../lib/first-access";

/**
 * "Enviar primeiro acesso" em lote (Administrativo → Fornecedores). A regra é a do fluxo individual
 * (lib/primeiro-acesso-elegibilidade.ts + rotateAndSendFirstAccess); aqui a orquestração roda com
 * `carregar`/`enviar` falsos — nada toca banco nem provedor de e-mail.
 */

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
/** Só código: remove comentários de bloco e de linha (as guardas não podem casar com a documentação). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function cadastro(n: number, acesso: Partial<NonNullable<CadastroPrimeiroAcesso["acesso"]>> | null = {}, emailCadastral: string | null = null): CadastroPrimeiroAcesso {
  return {
    id: uuid(n),
    nome: `Fornecedor ${n}`,
    emailCadastral,
    acesso: acesso === null ? null : { id: `u-${n}`, nome: `Fornecedor ${n}`, usuario: `P00000${n}`, perfil: "COLABORADOR", primeiroLogin: true, email: `f${n}@example.test`, ...acesso },
  };
}

function cenario(cadastros: CadastroPrimeiroAcesso[], enviar?: (e: EnvioPrimeiroAcesso) => Promise<RotateAndSendFirstAccessResult>) {
  const envios: EnvioPrimeiroAcesso[] = [];
  const esperas: number[] = [];
  let emCurso = 0;
  let maxConcorrencia = 0;
  const run = (ids = cadastros.map((c) => c.id)) =>
    processarPrimeiroAcessoEmLote({
      ids,
      carregar: async (pedidos) => new Map(cadastros.filter((c) => pedidos.includes(c.id)).map((c) => [c.id, c])),
      enviar: async (e) => {
        emCurso += 1;
        maxConcorrencia = Math.max(maxConcorrencia, emCurso);
        envios.push(e);
        await new Promise((r) => setTimeout(r, 1));
        emCurso -= 1;
        return enviar ? enviar(e) : { ok: true, alreadyProcessed: false };
      },
      aguardar: async (ms) => { esperas.push(ms); },
    });
  return { run, envios, esperas, concorrencia: () => maxConcorrencia };
}

// ── Elegibilidade (mesma regra do botão individual e da rota PATCH) ───────────

test("elegibilidade: sem usuário vinculado, ADMIN, senha já definida e sem e-mail são inaptos; o resto é apto", () => {
  const base = { perfil: "COLABORADOR", primeiroLogin: true, email: "a@example.test" };
  assert.deepEqual(avaliarElegibilidadePrimeiroAcesso(base), { elegivel: true });
  assert.equal(avaliarElegibilidadePrimeiroAcesso(null).elegivel, false);
  assert.deepEqual(avaliarElegibilidadePrimeiroAcesso(null), { elegivel: false, motivo: "SEM_ACESSO", mensagem: "Sem usuário de acesso vinculado" });
  assert.equal((avaliarElegibilidadePrimeiroAcesso({ ...base, perfil: "ADMIN" }) as { motivo: string }).motivo, "PERFIL_ADMIN");
  assert.equal((avaliarElegibilidadePrimeiroAcesso({ ...base, primeiroLogin: false }) as { motivo: string }).motivo, "ACESSO_JA_DEFINIDO");
  assert.deepEqual(avaliarElegibilidadePrimeiroAcesso({ ...base, email: null }), { elegivel: false, motivo: "SEM_EMAIL", mensagem: "Sem e-mail cadastrado" });
  assert.deepEqual(avaliarElegibilidadePrimeiroAcesso({ ...base, email: "  " }, "cad@example.test"), { elegivel: false, motivo: "SEM_EMAIL", mensagem: "E-mail de acesso ainda não sincronizado" });
});

test("elegibilidade espelha o botão individual do detalhe (perfil !== ADMIN && primeiroLogin; desabilitado sem e-mail)", () => {
  const detalhe = read("components/administrativo/detalhes.tsx");
  assert.match(detalhe, /item\.acesso\.perfil !== "ADMIN" && item\.acesso\.primeiroLogin && \(/);
  assert.match(detalhe, /disabled=\{!item\.acesso\.email\}/);
  const rota = read("app/api/admin/usuarios/[id]/route.ts");
  assert.match(rota, /if \(user\.perfil === "ADMIN"\)/);
  assert.match(rota, /Este usuário não possui e-mail cadastrado\./);
});

// ── IDs ──────────────────────────────────────────────────────────────────────

test("IDs: exige array, descarta não-UUID, deduplica e respeita o limite por requisição", () => {
  assert.equal(normalizarIdsPrimeiroAcessoLote(undefined).ok, false);
  assert.equal(normalizarIdsPrimeiroAcessoLote("x").ok, false);
  assert.equal(normalizarIdsPrimeiroAcessoLote([]).ok, false, "nenhum selecionado → 400, nada processado");
  assert.equal(normalizarIdsPrimeiroAcessoLote(["1 OR 1=1", 7, null]).ok, false);
  assert.deepEqual(normalizarIdsPrimeiroAcessoLote([uuid(1), ` ${uuid(1)} `, uuid(2), "lixo"]), { ok: true, ids: [uuid(1), uuid(2)] });
  const muitos = Array.from({ length: LIMITE_PRIMEIRO_ACESSO_LOTE + 1 }, (_, i) => uuid(i + 1));
  assert.equal(normalizarIdsPrimeiroAcessoLote(muitos).ok, false);
  assert.equal(normalizarIdsPrimeiroAcessoLote(muitos.slice(0, LIMITE_PRIMEIRO_ACESSO_LOTE)).ok, true);
});

// ── Processamento ────────────────────────────────────────────────────────────

test("um selecionado apto: 1 envio com os dados do Usuario vinculado (não do cadastro)", async () => {
  const c = cenario([cadastro(1, { nome: "Nome no Usuario" })]);
  const r = await c.run();
  assert.deepEqual(c.envios, [{ usuarioId: "u-1", usuarioNome: "Nome no Usuario", usuarioLogin: "P000001", email: "f1@example.test" }]);
  assert.deepEqual({ ...r, resultados: undefined }, { totalSelecionados: 1, enviados: 1, ignorados: 0, falhas: 0, resultados: undefined });
  assert.deepEqual(r.resultados, [{ id: uuid(1), nome: "Fornecedor 1", status: "ENVIADO", motivo: "Acesso enviado" }]);
});

test("vários aptos: sucesso total, SEQUENCIAL (concorrência 1) e espaçado entre envios ao provedor", async () => {
  const c = cenario([cadastro(1), cadastro(2), cadastro(3)]);
  const r = await c.run();
  assert.equal(r.enviados, 3);
  assert.equal(c.concorrencia(), 1, "nunca Promise.all");
  assert.deepEqual(c.esperas, [INTERVALO_MINIMO_ENVIO_MS, INTERVALO_MINIMO_ENVIO_MS], "espera só ENTRE envios reais");
});

test("parcial: apto enviado, inapto ignorado com motivo real, falha do provedor e exceção viram FALHA — sem desfazer os enviados", async () => {
  const c = cenario(
    [cadastro(1), cadastro(2, { email: null }), cadastro(3), cadastro(4, { primeiroLogin: false }), cadastro(5), cadastro(6, null)],
    async (e) => {
      if (e.usuarioId === "u-3") return { ok: false, status: 502, error: "provider: invalid api key re_123", alreadyProcessed: false };
      if (e.usuarioId === "u-5") throw new Error("connection reset");
      return { ok: true, alreadyProcessed: false };
    },
  );
  const r = await c.run();
  assert.deepEqual([r.enviados, r.ignorados, r.falhas], [1, 3, 2]);
  assert.deepEqual(c.envios.map((e) => e.usuarioId), ["u-1", "u-3", "u-5"], "inaptos nunca chegam ao envio");
  const porId = Object.fromEntries(r.resultados.map((x) => [x.id, x]));
  assert.equal(porId[uuid(2)].motivo, "Sem e-mail cadastrado");
  assert.equal(porId[uuid(4)].motivo, "Acesso já ativado (senha definida pelo usuário)");
  assert.equal(porId[uuid(6)].motivo, "Sem usuário de acesso vinculado");
  assert.equal(porId[uuid(3)].status, "FALHA");
  assert.equal(porId[uuid(5)].status, "FALHA");
  assert.doesNotMatch(JSON.stringify(r), /re_123|invalid api key|connection reset/, "erro bruto do provedor nunca vai para a resposta");
});

test("falha total: todos FALHA, nenhum ENVIADO", async () => {
  const c = cenario([cadastro(1), cadastro(2)], async () => ({ ok: false, status: 502, error: "x", alreadyProcessed: false }));
  const r = await c.run();
  assert.deepEqual([r.enviados, r.ignorados, r.falhas], [0, 0, 2]);
});

test("revalidação no servidor: o estado de `carregar` (agora) vale, não o da seleção — removido e inapto são ignorados", async () => {
  // Selecionado às 10:00 como apto; às 10:01 alguém definiu a senha e outro cadastro foi excluído.
  const c = cenario([cadastro(1, { primeiroLogin: false })]);
  const r = await c.run([uuid(1), uuid(9)]);
  assert.equal(c.envios.length, 0);
  assert.deepEqual(r.resultados.map((x) => [x.status, x.motivo]), [
    ["IGNORADO", "Acesso já ativado (senha definida pelo usuário)"],
    ["IGNORADO", "Fornecedor não encontrado"],
  ]);
});

test("deduplicação: ID repetido conta uma vez; dois cadastros do MESMO Usuario enviam uma única vez", async () => {
  const c = cenario([cadastro(1), { ...cadastro(2), acesso: cadastro(1).acesso }]);
  const r = await c.run([uuid(1), uuid(1), uuid(2)]);
  assert.equal(r.totalSelecionados, 2);
  assert.equal(c.envios.length, 1);
  assert.deepEqual(r.resultados.map((x) => x.status), ["ENVIADO", "IGNORADO"]);
  assert.equal(r.resultados[1].motivo, "Mesmo acesso de outro fornecedor selecionado");
});

test("replay do mesmo requestId: 'já enviado nesta operação' (ENVIADO, sem nova rotação); 409 em andamento vira IGNORADO", async () => {
  const c = cenario([cadastro(1), cadastro(2)], async (e) =>
    e.usuarioId === "u-1" ? { ok: true, alreadyProcessed: true } : { ok: false, status: 409, error: "em andamento", alreadyProcessed: true });
  const r = await c.run();
  assert.deepEqual(r.resultados.map((x) => [x.status, x.motivo]), [
    ["ENVIADO", "Acesso já enviado nesta operação"],
    ["IGNORADO", "Envio já em andamento. Verifique novamente em instantes."],
  ]);
});

test("resposta estruturada nunca expõe e-mail, login, senha ou token — só id, nome, status e motivo", async () => {
  const c = cenario([cadastro(1), cadastro(2, { email: null })]);
  const r = await c.run();
  for (const item of r.resultados) assert.deepEqual(Object.keys(item).sort(), ["id", "motivo", "nome", "status"]);
  assert.doesNotMatch(JSON.stringify(r), /@example\.test|P00000|senha|token|u-1/i);
});

// ── Rota (guardas estáticas sobre o código real) ─────────────────────────────

const ROTA = "app/api/admin/administrativo/fornecedores/primeiro-acesso/route.ts";

test("rota: exige ADMIN literal (403) ANTES de ler o corpo e de qualquer envio — mesma permissão do envio individual", () => {
  const src = read(ROTA);
  const i403 = src.indexOf('admin.user?.perfil !== "ADMIN"');
  assert.ok(src.indexOf("requireAdmin()") > -1 && i403 > -1);
  assert.ok(i403 < src.indexOf("request.json()"), "403 antes de ler o corpo");
  assert.ok(i403 < src.indexOf("processarPrimeiroAcessoEmLote("), "403 antes de processar");
  assert.match(src, /status: 403/);
});

test("rota: requestId UUID validado antes de processar e repassado a cada envio (idempotência existente por usuarioId+requestId)", () => {
  const src = read(ROTA);
  assert.ok(src.indexOf("isUuid(requestId)") < src.indexOf("processarPrimeiroAcessoEmLote("));
  assert.match(src, /rotateAndSendFirstAccess\(\{[\s\S]*requestId,/);
});

test("rota: reutiliza a regra central — nenhuma rotação/hash/e-mail próprio, nenhum fetch ao endpoint individual", () => {
  const src = code(read(ROTA) + read("lib/primeiro-acesso-lote.ts"));
  assert.doesNotMatch(src, /generateTempPassword|hashPassword|notifyFirstAccess|sendTransactionalEmail|\/api\/admin\/usuarios/);
  assert.doesNotMatch(src, /Promise\.all/);
  assert.match(read(ROTA), /findColaboradorUsuarios\(/, "mesmo vínculo fornecedor↔acesso da listagem");
});

test("envio individual intocado: a action enviar_primeiro_acesso continua chamando rotateAndSendFirstAccess com o requestId do corpo", () => {
  const rota = read("app/api/admin/usuarios/[id]/route.ts");
  assert.match(rota, /action === "enviar_primeiro_acesso"/);
  assert.match(rota, /rotateAndSendFirstAccess\(\{\s*db: prisma,\s*requestId: body\?\.requestId,/);
  const painel = read("components/administrativo-panel.tsx");
  assert.match(painel, /body: JSON\.stringify\(\{ action: "enviar_primeiro_acesso", requestId \}\)/);
});

// ── Tela ─────────────────────────────────────────────────────────────────────

test("tela: requestId gerado uma vez por diálogo e trava síncrona contra duplo clique; sem window.confirm/alert", () => {
  const dialog = read("components/administrativo/primeiro-acesso-lote-dialog.tsx");
  assert.match(dialog, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
  assert.match(dialog, /if \(enviandoRef\.current/);
  assert.match(dialog, /role="alertdialog"/);
  assert.doesNotMatch(dialog + read("components/bulk-selection-bar.tsx"), /window\.confirm|\balert\(/);
});

test("tela: barra de seleção sem regra de negócio e sem coluna 'Ações' na tabela", () => {
  const barra = read("components/bulk-selection-bar.tsx");
  assert.doesNotMatch(barra, /primeiro|acesso|fetch\(/i);
  assert.doesNotMatch(read("components/administrativo/listagem.tsx"), /<Th[^>]*>\s*Ações/);
});
