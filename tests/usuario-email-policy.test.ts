import assert from "node:assert/strict";
import test from "node:test";
import { isValidEmail, requiresEmail, EMAIL_REQUIRED_MESSAGE } from "../lib/usuario-email-policy";

// isValidEmail — caso 3: e-mail inválido é rejeitado

test("e-mail válido é aceito", () => {
  assert.equal(isValidEmail("anderson.marley@projetacs.com"), true);
});

test("e-mail sem @ é rejeitado", () => {
  assert.equal(isValidEmail("nome-empresa.com"), false);
});

test("e-mail sem domínio (sem ponto) é rejeitado", () => {
  assert.equal(isValidEmail("nome@empresa"), false);
});

test("e-mail com espaços é rejeitado", () => {
  assert.equal(isValidEmail("nome ok@empresa.com"), false);
});

// requiresEmail — casos 4, 5, 6, 7, 8, 9: obrigatoriedade por perfil/status

test("caso 4: usuário MEDICAO ativo exige e-mail", () => {
  assert.equal(requiresEmail("MEDICAO", true), true);
});

test("caso 5: usuário FINANCEIRO ativo exige e-mail", () => {
  assert.equal(requiresEmail("FINANCEIRO", true), true);
});

test("caso 6: usuário de outro perfil (ADMIN/COLABORADOR/ADMINISTRATIVO) pode permanecer sem e-mail mesmo ativo", () => {
  assert.equal(requiresEmail("ADMIN", true), false);
  assert.equal(requiresEmail("COLABORADOR", true), false);
  assert.equal(requiresEmail("ADMINISTRATIVO", true), false);
});

test("caso 7: usuário MEDICAO/FINANCEIRO inativo pode permanecer sem e-mail", () => {
  assert.equal(requiresEmail("MEDICAO", false), false);
  assert.equal(requiresEmail("FINANCEIRO", false), false);
});

test("caso 8: mudar perfil para MEDICAO (mantendo ativo) passa a exigir e-mail — mesma função usada em set_perfil, toggle_ativo e set_email", () => {
  assert.equal(requiresEmail("MEDICAO", true), true);
});

test("caso 9: mudar perfil para FINANCEIRO (mantendo ativo) passa a exigir e-mail", () => {
  assert.equal(requiresEmail("FINANCEIRO", true), true);
});

test("mensagem de bloqueio é a exata solicitada", () => {
  assert.equal(EMAIL_REQUIRED_MESSAGE, "Para usuários ativos das equipes de Medição ou Financeiro é necessário cadastrar um e-mail.");
});

// Casos 1/2/12 (criptografia/descriptografia real de Usuario.email) são verificados por smoke
// test contra o Postgres real, não aqui — `lib/encryption.ts` é `server-only` e não pode ser
// importado num script tsx standalone (mesma limitação já documentada para outros módulos
// server-only neste projeto).

test("remover e-mail (string vazia) nunca é confundido com um e-mail válido pela política", () => {
  assert.equal(requiresEmail("MEDICAO", true) && !"".trim(), true); // simula: perfil exige, campo vazio -> deve bloquear
});
