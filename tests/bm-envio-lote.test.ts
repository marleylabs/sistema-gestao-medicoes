import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { avaliarElegibilidadeEnvioBm } from "../lib/bm-envio-elegibilidade";
import { alternarTodosAptos, elegibilidadeDaLinha, estadoCabecalho, previaEnvioBm } from "../lib/bm-envio-selecao";
import {
  INTERVALO_ENVIO_BM_MS,
  LIMITE_ENVIO_BM_LOTE,
  normalizarPedidoEnvioBmLote,
  processarEnvioBmEmLote,
  type EnvioBmResultado,
  type ItemEnvioBm,
} from "../lib/bm-envio-lote";

/**
 * "Enviar BMs" em lote (Fornecedores). A regra é a do envio individual (lib/bm-envio.ts +
 * lib/bm-envio-elegibilidade.ts); aqui a orquestração roda com `carregar`/`enviar` falsos — nada
 * toca banco nem provedor de e-mail. Independente do primeiro acesso em lote.
 */

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CICLO = "2610";

function item(n: number, over: Partial<ItemEnvioBm> = {}): ItemEnvioBm {
  return { id: uuid(n), ciclo: CICLO, colaboradorCodigo: `F${n}`, nome: `Fornecedor ${n}`, atualizadoEm: "2026-10-10T00:00:00Z", bm: null, ...over };
}

function cenario(itens: ItemEnvioBm[], enviar?: (a: { colaboradorCodigo: string; ciclo: string }) => Promise<EnvioBmResultado>) {
  const envios: { colaboradorCodigo: string; ciclo: string }[] = [];
  const esperas: number[] = [];
  let emCurso = 0;
  let max = 0;
  const run = (ids = itens.map((i) => i.id)) => processarEnvioBmEmLote({
    ids,
    ciclo: CICLO,
    carregar: async (pedidos) => new Map(itens.filter((i) => pedidos.includes(i.id)).map((i) => [i.id, i])),
    enviar: async (alvo) => {
      emCurso += 1; max = Math.max(max, emCurso); envios.push(alvo);
      await new Promise((r) => setTimeout(r, 1));
      emCurso -= 1;
      return enviar ? enviar(alvo) : { ok: true, alreadyProcessed: false, emailOk: true };
    },
    aguardar: async (ms) => { esperas.push(ms); },
  });
  return { run, envios, esperas, concorrencia: () => max };
}

// ── Elegibilidade (= botão individual "Enviar BM"/"Reenviar BM") ──────────────

test("elegibilidade: sem BM ou AGUARDANDO_ENVIO envia; REVISAO_SOLICITADA só com alteração posterior; demais já enviados; CANCELADO não", () => {
  assert.deepEqual(avaliarElegibilidadeEnvioBm({ status: null }), { elegivel: true, reenvio: false });
  assert.deepEqual(avaliarElegibilidadeEnvioBm({ status: "AGUARDANDO_ENVIO" }), { elegivel: true, reenvio: false });
  assert.deepEqual(avaliarElegibilidadeEnvioBm({ status: "REVISAO_SOLICITADA", revisaoSolicitadaAt: "2026-10-01", itemAtualizadoEm: "2026-10-02" }), { elegivel: true, reenvio: true });
  assert.deepEqual(avaliarElegibilidadeEnvioBm({ status: "REVISAO_SOLICITADA", revisaoSolicitadaAt: "2026-10-02", itemAtualizadoEm: "2026-10-01" }),
    { elegivel: false, motivo: "REVISAO_SEM_ALTERACAO", mensagem: "Revisão solicitada: altere o pagamento antes de reenviar" });
  assert.deepEqual(avaliarElegibilidadeEnvioBm({ status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" }), { elegivel: false, motivo: "JA_ENVIADO", mensagem: "BM já enviado (Aguardando fornecedor)" });
  assert.equal((avaliarElegibilidadeEnvioBm({ status: "APROVADO" }) as { mensagem: string }).mensagem, "BM já enviado (Aguardando pagamento)");
  assert.equal((avaliarElegibilidadeEnvioBm({ status: "PAGO" }) as { motivo: string }).motivo, "JA_ENVIADO");
  assert.deepEqual(avaliarElegibilidadeEnvioBm({ status: "CANCELADO" }), { elegivel: false, motivo: "CANCELADO", mensagem: "BM cancelado neste ciclo" });
});

test("paridade: botão individual (MapaItemActions), service individual e lote decidem pela MESMA regra e pelo MESMO ciclo", () => {
  const botao = code(read("components/mapa-pagamento-table.tsx"));
  assert.match(botao, /const elegibilidadeEnvio = avaliarElegibilidadeEnvioBm\(\{/);
  assert.match(botao, /const podeEnviar = !!onEnviarBm && cicloReal && elegibilidadeEnvio\.elegivel;/);
  assert.match(botao, /const cicloReal = isCicloValido\(ciclo\);/);
  assert.doesNotMatch(botao, /\["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"\]\.includes/, "sem lista de status paralela no botão");
  // O service individual decide pela MESMA função (sem lista paralela de status que aceitava CANCELADO).
  const svc = code(read("lib/bm-envio.ts"));
  assert.match(svc, /avaliarElegibilidadeEnvioBm\(\{/);
  assert.doesNotMatch(svc, /STATUS_REENVIAVEIS|\["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"/);
  assert.match(svc, /if \(!isCicloValido\(ciclo\)\)/, "service: defesa em profundidade do ciclo");
  // Ciclo: individual e lote pela MESMA regra (lib/ciclo.ts), nenhuma regex própria.
  assert.match(code(read("app/api/sgc/enviar/route.ts")), /if \(!isCicloValido\(ciclo\)\)/);
  const lote = code(read("lib/bm-envio-lote.ts"));
  assert.match(lote, /if \(!isCicloValido\(ciclo\)\)/);
  assert.doesNotMatch(lote + code(read("app/api/sgc/enviar/route.ts")), /\d\{4\}/, "nenhuma regex de ciclo duplicada");
  assert.doesNotMatch(code(read("lib/bm-envio-elegibilidade.ts")), /"Aguardando envio"/, "regra pelo enum, nunca pelo rótulo");
});

test("ciclo: isCicloValido aceita só YYMM real (mês 01–12); GERAL, vazio e malformados recusados", () => {
  const { isCicloValido } = require("../lib/ciclo") as typeof import("../lib/ciclo");
  for (const ok of ["2608", "2601", "2612", "2911"]) assert.equal(isCicloValido(ok), true, ok);
  for (const ruim of ["GERAL", "", " ", "2026-08", "260", "26081", "ABC1", "2613", "2600", "9996", null, undefined, 2608]) {
    assert.equal(isCicloValido(ruim as unknown), false, String(ruim));
  }
  assert.equal(normalizarPedidoEnvioBmLote({ ids: [uuid(1)], ciclo: "9996" }).ok, false, "lote: mês inválido recusado (antes só exigia 4 dígitos)");
  assert.equal(normalizarPedidoEnvioBmLote({ ids: [uuid(1)], ciclo: "GERAL" }).ok, false);
});

test("tela: em 'Geral' o botão individual não existe (mensagem de contexto) e o handler nunca chama a rota sem ciclo real", () => {
  const botao = code(read("components/mapa-pagamento-table.tsx"));
  assert.match(botao, /\{cicloReal && onEnviarBm && \(podeEnviar \|\| \(isRevisaoEnvio && !temAlteracao\)\) && \(/);
  assert.match(botao, /Selecione um ciclo específico para enviar o boletim\./);
  assert.match(code(read("components/medicoes-app.tsx")), /async function enviarBm\(colaboradorCodigo: string\) \{\s*if \(!isCicloValido\(activeCiclo\)\) return;/);
});

// ── Seleção (tela) ───────────────────────────────────────────────────────────

test("cabeçalho: nenhum/parte/todos os APTOS visíveis → unchecked/indeterminate/checked; inaptos não contam", () => {
  assert.equal(estadoCabecalho([], new Set()), "unchecked");
  assert.equal(estadoCabecalho(["a", "b"], new Set()), "unchecked");
  assert.equal(estadoCabecalho(["a", "b"], new Set(["a"])), "indeterminate");
  assert.equal(estadoCabecalho(["a", "b"], new Set(["a", "b", "x"])), "checked", "selecionado fora da visualização não muda o cabeçalho");
});

test("selecionar todos marca só os aptos visíveis e preserva a seleção fora da visualização; segundo clique desmarca só os visíveis", () => {
  const marcados = alternarTodosAptos(["a", "b"], new Set(["x"]));
  assert.deepEqual([...marcados].sort(), ["a", "b", "x"]);
  assert.deepEqual([...alternarTodosAptos(["a", "b"], marcados)], ["x"]);
  assert.deepEqual([...alternarTodosAptos([], new Set())], [], "nenhum apto → nada selecionado");
});

test("prévia: inaptos com motivo real, mesma pessoa em duas linhas = um BM, sem código = inapto", () => {
  const linhas = [
    { id: "1", projetistaCodigo: "A", updatedAt: null },
    { id: "2", projetistaCodigo: "A", updatedAt: null },
    { id: "3", projetistaCodigo: "B", updatedAt: null },
    { id: "4", projetistaCodigo: null, updatedAt: null },
  ];
  const status: Record<string, { status: string }> = { B: { status: "PENDENTE" } };
  const p = previaEnvioBm(linhas, (l) => elegibilidadeDaLinha(l, status[l.projetistaCodigo ?? ""], null));
  assert.deepEqual(p.map((x) => [x.item.id, x.elegivel, x.motivo ?? null]), [
    ["1", true, null],
    ["2", false, "Mesmo BM de outra linha selecionada"],
    ["3", false, "BM já enviado (Aguardando fornecedor)"],
    ["4", false, "Fornecedor sem código no mapa de pagamento"],
  ]);
});

test("tela: trocar de ciclo zera a seleção; 'Geral' nunca permite seleção; BulkSelectionBar reutilizada; checkbox não abre o detalhe", () => {
  const pagina = read("components/fornecedores/index.tsx");
  assert.match(pagina, /if \(cicloDaSelecao !== ciclo\) \{\s*setCicloDaSelecao\(ciclo\);\s*setSelecionados\(new Set\(\)\);/);
  assert.match(pagina, /const podeSelecionar = isAdmin && ciclo !== CICLO_GERAL;/);
  assert.match(pagina, /import \{ BulkSelectionBar \} from "@\/components\/bulk-selection-bar";/);
  assert.match(pagina, /const idsAtuais = new Set\(itens\.filter\(\(item\) => elegibilidadeDe\(item\)\.elegivel\)\.map\(\(item\) => item\.id\)\);/,
    "seleção só guarda BMs aptos pelo estado atual (status carregado depois da marcação nunca deixa inapto selecionado)");
  assert.doesNotMatch(pagina, /aria-label="Ações da seleção"/, "a barra é reutilizada, não copiada");
  const tabela = read("components/fornecedores/fornecedores-table.tsx");
  assert.match(tabela, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(tabela, /disabled=\{!avaliacao\.elegivel\}/, "inapto fica com checkbox indisponível (seleção exclusiva do lote de BM)");
  assert.match(tabela, /el\.indeterminate = selecao\.cabecalho === "indeterminate"/);
  assert.doesNotMatch(tabela, />\s*Ações\s*</, "sem coluna Ações");
});

// ── Pedido (IDs/ciclo) ───────────────────────────────────────────────────────

test("pedido: ciclo real obrigatório (nunca 'GERAL'), IDs UUID deduplicados, lote vazio e acima do limite recusados", () => {
  assert.equal(normalizarPedidoEnvioBmLote({ ids: [uuid(1)], ciclo: "GERAL" }).ok, false);
  assert.equal(normalizarPedidoEnvioBmLote({ ids: [uuid(1)] }).ok, false);
  assert.equal(normalizarPedidoEnvioBmLote({ ids: "x", ciclo: CICLO }).ok, false);
  assert.equal(normalizarPedidoEnvioBmLote({ ids: [], ciclo: CICLO }).ok, false);
  assert.equal(normalizarPedidoEnvioBmLote({ ids: ["1; DROP", 3, null], ciclo: CICLO }).ok, false);
  assert.deepEqual(normalizarPedidoEnvioBmLote({ ids: [uuid(1), ` ${uuid(1)} `, uuid(2)], ciclo: ` ${CICLO} ` }), { ok: true, ids: [uuid(1), uuid(2)], ciclo: CICLO });
  const muitos = Array.from({ length: LIMITE_ENVIO_BM_LOTE + 1 }, (_, i) => uuid(i + 1));
  assert.equal(normalizarPedidoEnvioBmLote({ ids: muitos, ciclo: CICLO }).ok, false);
  assert.equal(normalizarPedidoEnvioBmLote({ ids: muitos.slice(0, LIMITE_ENVIO_BM_LOTE), ciclo: CICLO }).ok, true);
});

// ── Processamento ────────────────────────────────────────────────────────────

test("um e vários aptos: sucesso total, sequencial (concorrência 1) e espaçado só entre envios reais", async () => {
  const c = cenario([item(1), item(2), item(3)]);
  const r = await c.run();
  assert.deepEqual([r.enviados, r.ignorados, r.falhas, r.semNotificacao], [3, 0, 0, 0]);
  assert.deepEqual(c.envios, [1, 2, 3].map((n) => ({ colaboradorCodigo: `F${n}`, ciclo: CICLO })));
  assert.equal(c.concorrencia(), 1);
  assert.deepEqual(c.esperas, [INTERVALO_ENVIO_BM_MS, INTERVALO_ENVIO_BM_MS]);
  assert.equal(r.resultados[0].motivo, "BM enviado");
});

test("parcial: enviado, inapto, outro ciclo, já enviado por outro usuário (revalidado), fornecedor inválido, exceção e e-mail falho — sem desfazer os enviados", async () => {
  const c = cenario([
    item(1),
    item(2, { bm: { status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD", revisaoSolicitadaAt: null } }),
    item(3, { ciclo: "2609" }),
    item(4),
    item(5),
    item(6),
    item(7),
    item(8, { bm: { status: "REVISAO_SOLICITADA", statusConferencia: null, revisaoSolicitadaAt: "2026-10-01T00:00:00Z" } }),
  ], async ({ colaboradorCodigo }) => {
    if (colaboradorCodigo === "F4") return { ok: false, motivo: "JA_ENVIADO", mensagem: "BM já enviado (Aguardando fornecedor)", statusAtual: "PENDENTE" };
    if (colaboradorCodigo === "F5") return { ok: false, motivo: "FORNECEDOR_INVALIDO", mensagem: "Fornecedor inexistente ou excluído definitivamente." };
    if (colaboradorCodigo === "F6") throw new Error("connection reset re_secret_123");
    if (colaboradorCodigo === "F7") return { ok: true, alreadyProcessed: false, emailOk: false };
    return { ok: true, alreadyProcessed: false, emailOk: true };
  });
  const r = await c.run();
  const por = Object.fromEntries(r.resultados.map((x) => [x.id, x]));
  assert.deepEqual([r.enviados, r.ignorados, r.falhas, r.semNotificacao], [3, 4, 1, 1]);
  assert.deepEqual(c.envios.map((e) => e.colaboradorCodigo), ["F1", "F4", "F5", "F6", "F7", "F8"], "inapto e outro ciclo nunca chegam ao service");
  assert.equal(por[uuid(2)].motivo, "BM já enviado (Aguardando fornecedor)");
  assert.equal(por[uuid(3)].motivo, "Não pertence ao ciclo selecionado");
  assert.equal(por[uuid(4)].motivo, "BM já não estava mais aguardando envio");
  assert.equal(por[uuid(5)].motivo, "Fornecedor inexistente ou excluído definitivamente");
  assert.equal(por[uuid(6)].status, "FALHA");
  assert.deepEqual([por[uuid(7)].status, por[uuid(7)].aviso], ["ENVIADO", "O e-mail de aviso ao fornecedor não foi enviado"]);
  assert.equal(por[uuid(8)].motivo, "BM reenviado");
  assert.doesNotMatch(JSON.stringify(r), /re_secret|connection reset/);
});

test("falha total: todos FALHA, nenhum ENVIADO", async () => {
  const c = cenario([item(1), item(2)], async () => { throw new Error("x"); });
  const r = await c.run();
  assert.deepEqual([r.enviados, r.ignorados, r.falhas], [0, 0, 2]);
});

test("deduplicação pela identidade do BM: ID repetido conta uma vez; duas linhas do mesmo fornecedor no ciclo enviam uma vez; fornecedores distintos nunca colapsam", async () => {
  const c = cenario([item(1), item(2, { colaboradorCodigo: "F1" }), item(3)]);
  const r = await c.run([uuid(1), uuid(1), uuid(2), uuid(3)]);
  assert.equal(r.totalSelecionados, 3);
  assert.deepEqual(c.envios.map((e) => e.colaboradorCodigo), ["F1", "F3"]);
  assert.equal(r.resultados[1].motivo, "Mesmo BM de outra linha selecionada");
});

test("replay pelo registro da operação: BM já PENDENTE enviado por esta confirmação → ENVIADO 'já enviado nesta operação', sem chamar o service", async () => {
  const c = cenario([item(1, { bm: { status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD", revisaoSolicitadaAt: null }, enviadoNestaOperacao: true }), item(2, { bm: { status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD", revisaoSolicitadaAt: null } })]);
  const r = await c.run();
  assert.deepEqual(r.resultados.map((x) => [x.status, x.motivo]), [["ENVIADO", "BM já enviado nesta operação"], ["IGNORADO", "BM já enviado (Aguardando fornecedor)"]]);
  assert.equal(c.envios.length, 0, "nada refeito");
});

test("replay da mesma confirmação: 'já enviado nesta operação' (ENVIADO, nada refeito); ID inexistente ignorado", async () => {
  const c = cenario([item(1)], async () => ({ ok: true, alreadyProcessed: true, emailOk: true }));
  const r = await c.run([uuid(1), uuid(99)]);
  assert.deepEqual(r.resultados.map((x) => [x.status, x.motivo]), [["ENVIADO", "BM já enviado nesta operação"], ["IGNORADO", "Pagamento não encontrado"]]);
});

test("resposta: só id, nome, status, motivo (e aviso) — sem e-mail, código interno de erro ou credencial", async () => {
  const c = cenario([item(1), item(2, { bm: { status: "PAGO", statusConferencia: null, revisaoSolicitadaAt: null } })]);
  const r = await c.run();
  for (const x of r.resultados) for (const k of Object.keys(x)) assert.ok(["id", "nome", "status", "motivo", "aviso"].includes(k), k);
  assert.doesNotMatch(JSON.stringify(r), /@|senha|token|statusAtual/i);
});

// ── Rotas e service (guardas estáticas) ──────────────────────────────────────

test("lote: mesma permissão do individual (requireAdmin), antes de ler o corpo; requestId UUID antes de processar", () => {
  const lote = code(read("app/api/sgc/enviar/lote/route.ts"));
  const individual = code(read("app/api/sgc/enviar/route.ts"));
  assert.match(individual, /const admin = await requireAdmin\(\);\s*if \(admin\.response\) return admin\.response;/);
  assert.match(lote, /const admin = await requireAdmin\(\);\s*if \(admin\.response\) return admin\.response;/);
  assert.ok(lote.indexOf("requireAdmin()") < lote.indexOf("request.json()"));
  assert.ok(lote.indexOf("isUuid(requestId)") < lote.indexOf("processarEnvioBmEmLote("));
});

test("individual e lote usam o MESMO service; nenhuma transição/e-mail/log próprios no lote", () => {
  const individual = code(read("app/api/sgc/enviar/route.ts"));
  const lote = code(read("app/api/sgc/enviar/lote/route.ts")) + code(read("lib/bm-envio-lote.ts"));
  assert.match(individual, /enviarBoletimFornecedor\(\{/);
  assert.match(lote, /enviarBoletimFornecedor\(\{ colaboradorCodigo, ciclo, usuario, telaOrigem: "Fornecedores \/ Envio em lote", requestId \}\)/);
  assert.doesNotMatch(lote, /sgcAprovacaoMedicao\.(upsert|update)|notifyBmAvailable|logBmAction|\/api\/sgc\/enviar"|Promise\.all/);
  assert.doesNotMatch(individual, /sgcAprovacaoMedicao\.upsert|notifyBmAvailable/, "a rota individual não tem mais uma cópia da regra");
});

test("service: status relido e transição feitas dentro de transação curta com advisory lock por BM; e-mail fora dela", () => {
  const svc = code(read("lib/bm-envio.ts"));
  const tx = svc.indexOf("prisma.$transaction(async (tx)");
  const lock = svc.indexOf("pg_advisory_xact_lock(hashtext(${lockKey}))", tx);
  const leitura = svc.indexOf("tx.sgcAprovacaoMedicao.findUnique(", tx);
  const upsert = svc.indexOf("tx.sgcAprovacaoMedicao.upsert(", tx);
  const fimTx = svc.indexOf("});", svc.indexOf("return { bloqueado: false as const", tx));
  const email = svc.indexOf("notifyBmAvailable(");
  assert.ok(tx > -1 && lock > tx && leitura > lock && upsert > leitura, "trava → releitura → transição");
  assert.ok(email > fimTx, "e-mail nunca dentro da transação");
  assert.match(svc, /lockKey = `bm-envio\/\$\{colaboradorCodigo\}\/\$\{ciclo\}`/);
});

test("regras de BM independentes do primeiro acesso", () => {
  for (const rel of ["lib/bm-envio.ts", "lib/bm-envio-lote.ts", "lib/bm-envio-elegibilidade.ts", "lib/bm-envio-selecao.ts", "app/api/sgc/enviar/lote/route.ts", "components/fornecedores/envio-bm-lote-dialog.tsx"]) {
    assert.doesNotMatch(read(rel), /primeiro-acesso|first-access|PrimeiroAcesso/, rel);
  }
});

test("diálogo: requestId único por confirmação, trava síncrona contra duplo clique, sem window.confirm/alert, total = soma da coluna Valor", () => {
  const d = code(read("components/fornecedores/envio-bm-lote-dialog.tsx"));
  assert.match(d, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
  assert.match(d, /if \(enviandoRef\.current/);
  assert.doesNotMatch(d, /window\.confirm|\balert\(/);
  assert.match(d, /p\.item\.valor/, "total vem do valor gravado (coluna Valor), sem recalcular o BM");
  assert.doesNotMatch(d, /calcularBoletim/);
});

// ── Paridade visual: detalhe/seleção avaliam o BM pela alteração mais recente do fornecedor no ciclo ──

test("multilinha: ultimaAlteracaoDoBm = maior updatedAt das linhas do MESMO fornecedor (outras ignoradas)", () => {
  const { ultimaAlteracaoDoBm } = require("../lib/bm-envio-elegibilidade") as typeof import("../lib/bm-envio-elegibilidade");
  const linhas = [
    { projetistaCodigo: "X", updatedAt: "2026-08-01T10:00:00Z" },
    { projetistaCodigo: "X", updatedAt: "2026-08-03T10:00:00Z" },
    { projetistaCodigo: "Y", updatedAt: "2026-09-30T10:00:00Z" },
    { projetistaCodigo: "X", updatedAt: null },
  ];
  assert.equal(ultimaAlteracaoDoBm(linhas, "X")?.toISOString(), "2026-08-03T10:00:00.000Z");
  assert.equal(ultimaAlteracaoDoBm(linhas, "Z"), null);
  assert.equal(ultimaAlteracaoDoBm(linhas, null), null);
});

test("multilinha: linha antiga + linha nova → Reenviar disponível mesmo abrindo pela linha antiga; todas antigas → bloqueado com o mesmo motivo", () => {
  const revisao = "2026-08-02T10:00:00Z";
  const bm = { status: "REVISAO_SOLICITADA", statusConferencia: "CONCLUIDA" };
  const antiga = { id: "a", projetistaCodigo: "X", updatedAt: "2026-08-01T10:00:00Z" };
  const nova = { id: "b", projetistaCodigo: "X", updatedAt: "2026-08-03T10:00:00Z" };
  const outraAntiga = { id: "c", projetistaCodigo: "X", updatedAt: "2026-07-30T10:00:00Z" };
  assert.deepEqual(elegibilidadeDaLinha(antiga, bm, revisao, [antiga, nova]), { elegivel: true, reenvio: true }, "A: linha antiga, BM alterado");
  assert.deepEqual(elegibilidadeDaLinha(nova, bm, revisao, [antiga, nova]), { elegivel: true, reenvio: true });
  assert.deepEqual(elegibilidadeDaLinha(antiga, bm, revisao, [antiga, outraAntiga]),
    { elegivel: false, motivo: "REVISAO_SEM_ALTERACAO", mensagem: "Revisão solicitada: altere o pagamento antes de reenviar" }, "B: todas antigas");
  // Mesma decisão do servidor: helper alimentado com o MAX das linhas (o que o service/lote calculam no banco).
  assert.deepEqual(elegibilidadeDaLinha(antiga, bm, revisao, [antiga, nova]),
    avaliarElegibilidadeEnvioBm({ status: bm.status, statusConferencia: bm.statusConferencia, revisaoSolicitadaAt: revisao, itemAtualizadoEm: nova.updatedAt }));
  // D/E preservados: CANCELADO bloqueado em qualquer combinação de linhas.
  assert.equal(elegibilidadeDaLinha(antiga, { status: "CANCELADO" }, revisao, [antiga, nova]).elegivel, false);
});

test("paridade: botão do detalhe, seleção do lote, service e rota do lote usam o MESMO dado agregado (alteração mais recente do fornecedor no ciclo)", () => {
  const botao = code(read("components/mapa-pagamento-table.tsx"));
  assert.match(botao, /itemAtualizadoEm: ultimaAlteracaoDoBm\(itens, codigo\) \?\? item\.updatedAt,/, "detalhe: não só a linha aberta");
  assert.match(code(read("components/fornecedores/index.tsx")), /revisaoMap\.get\(item\.projetistaCodigo \?\? ""\)\?\.revisaoSolicitadaAt, itens\);/, "seleção: linhas do ciclo carregado");
  assert.match(code(read("lib/bm-envio-selecao.ts")), /itemAtualizadoEm: ultimaAlteracaoDoBm\(linhasDoCiclo, item\.projetistaCodigo\)/);
  assert.match(code(read("lib/bm-envio.ts")), /tx\.mapaPagamentoItem\.aggregate\(\{\s*where: \{ ciclo, projetistaCodigo: colaboradorCodigo \},\s*_max: \{ updatedAt: true \},/, "service: MAX no banco dentro da trava");
  assert.match(code(read("app/api/sgc/enviar/lote/route.ts")), /groupBy\(\{\s*by: \["projetistaCodigo"\],[\s\S]*?_max: \{ updatedAt: true \}/, "lote: MAX por fornecedor");
  assert.doesNotMatch(botao, /new Date\(item\.updatedAt\) > new Date\(revisao/, "sem comparação própria da linha no botão");
  // "Geral" continua sem ação (D) — preservado.
  assert.match(botao, /\{cicloReal && onEnviarBm && \(podeEnviar \|\| \(isRevisaoEnvio && !temAlteracao\)\) && \(/);
});
