import assert from "node:assert/strict";
import test from "node:test";
import { shouldSendOnEnter } from "../lib/chat-composer";
import { isDisabledTeamChave, teamPerfilFromChave } from "../lib/chat-teams";
import { PRESENCE_HEARTBEAT_INTERVAL_MS, PRESENCE_ONLINE_WINDOW_MS, isOnline } from "../lib/presence";

function baseInput(overrides: Partial<Parameters<typeof shouldSendOnEnter>[0]> = {}) {
  return {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    draft: "Olá",
    sending: false,
    hasSelected: true,
    ...overrides,
  };
}

test("ENTER sem shift envia quando há texto e conversa selecionada", () => {
  assert.equal(shouldSendOnEnter(baseInput()), true);
});

test("SHIFT+ENTER nunca envia (quebra de linha)", () => {
  assert.equal(shouldSendOnEnter(baseInput({ shiftKey: true })), false);
});

test("ENTER durante composição de IME não envia", () => {
  assert.equal(shouldSendOnEnter(baseInput({ isComposing: true })), false);
});

test("ENTER com mensagem vazia não envia", () => {
  assert.equal(shouldSendOnEnter(baseInput({ draft: "" })), false);
});

test("ENTER com apenas espaços não envia", () => {
  assert.equal(shouldSendOnEnter(baseInput({ draft: "   " })), false);
});

test("ENTER enquanto já está enviando não dispara segundo envio (evita ENTER + clique duplicado)", () => {
  assert.equal(shouldSendOnEnter(baseInput({ sending: true })), false);
});

test("ENTER sem conversa selecionada não envia", () => {
  assert.equal(shouldSendOnEnter(baseInput({ hasSelected: false })), false);
});

test("outras teclas nunca disparam envio", () => {
  assert.equal(shouldSendOnEnter(baseInput({ key: "a" })), false);
});

test("Financeiro é a única equipe fixa desabilitada", () => {
  assert.equal(isDisabledTeamChave("TEAM:FINANCEIRO:ADMIN"), true);
  assert.equal(isDisabledTeamChave("TEAM:FINANCEIRO:algum-uuid-de-colaborador"), true);
});

test("Equipe de Medição e demais equipes continuam habilitadas", () => {
  assert.equal(isDisabledTeamChave("TEAM:MEDICAO:ADMIN"), false);
  assert.equal(isDisabledTeamChave("TEAM:MEDICAO:algum-uuid-de-colaborador"), false);
  assert.equal(isDisabledTeamChave("TEAM:ADMIN:MEDICAO"), false);
});

test("conversas diretas (DIRECT:...) nunca são tratadas como equipe desabilitada", () => {
  assert.equal(isDisabledTeamChave("DIRECT:usuarioA:usuarioB"), false);
});

test("teamPerfilFromChave extrai o perfil de uma chave TEAM e ignora chaves DIRECT", () => {
  assert.equal(teamPerfilFromChave("TEAM:MEDICAO:ADMIN"), "MEDICAO");
  assert.equal(teamPerfilFromChave("TEAM:FINANCEIRO:algum-uuid"), "FINANCEIRO");
  assert.equal(teamPerfilFromChave("DIRECT:a:b"), null);
});

// ─── Presença (isOnline) — atividade real via heartbeat, nunca sessão/hardcoded ───

test("usuário com heartbeat recente (dentro da janela) está online", () => {
  const now = Date.now();
  assert.equal(isOnline(new Date(now - 25_000)), true); // 25s atrás, dentro da janela de 90s
});

test("usuário sem heartbeat há mais tempo que a janela está offline", () => {
  const now = Date.now();
  assert.equal(isOnline(new Date(now - 4 * 60_000)), false); // 4 min atrás
});

test("exemplo do pedido: last_seen_at 25s atrás = ONLINE, 4min atrás = OFFLINE", () => {
  const agora = new Date("2026-08-27T15:00:00Z").getTime();
  const realNow = Date.now;
  (Date as any).now = () => agora;
  try {
    assert.equal(isOnline(new Date("2026-08-27T14:59:35Z")), true); // 25s atrás
    assert.equal(isOnline(new Date("2026-08-27T14:56:00Z")), false); // 4min atrás
  } finally {
    Date.now = realNow;
  }
});

test("onlineAt nulo/ausente nunca é online (nunca assume presença por padrão)", () => {
  assert.equal(isOnline(null), false);
  assert.equal(isOnline(undefined), false);
});

test("janela de corte é exatamente PRESENCE_ONLINE_WINDOW_MS, centralizada em uma constante", () => {
  const now = Date.now();
  assert.equal(isOnline(new Date(now - PRESENCE_ONLINE_WINDOW_MS + 1000)), true);
  assert.equal(isOnline(new Date(now - PRESENCE_ONLINE_WINDOW_MS - 1000)), false);
});

test("heartbeat é mais frequente que a janela online (garante folga contra 1 heartbeat perdido)", () => {
  assert.ok(PRESENCE_HEARTBEAT_INTERVAL_MS * 2 <= PRESENCE_ONLINE_WINDOW_MS);
});
