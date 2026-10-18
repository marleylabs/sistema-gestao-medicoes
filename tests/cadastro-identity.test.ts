import assert from "node:assert/strict";
import test from "node:test";
import { selectCadastroForAuthenticatedUser } from "../lib/cadastro-identity";

const sharedCnpj = "11222333000181";
const candidates = [
  { id: "a", colaboradorCodigo: "TESTE-A", responsavel: "COLABORADOR A", cnpjNormalizado: sharedCnpj },
  { id: "b", colaboradorCodigo: "TESTE-B", responsavel: "Colaborador B", cnpjNormalizado: sharedCnpj },
];

test("seleciona cadastro pelo código (login P0), sem misturar CNPJ compartilhado", () => {
  assert.equal(selectCadastroForAuthenticatedUser(candidates, "TESTE-B").cadastro?.id, "b");
});

test("nunca escolhe cadastro pelo nome do responsável (decisão 012)", () => {
  assert.equal(selectCadastroForAuthenticatedUser(candidates, "COLABORADOR B").cadastro, null);
});

test("não escolhe cadastro somente pelo CNPJ", () => {
  assert.equal(selectCadastroForAuthenticatedUser([candidates[0]], sharedCnpj).cadastro, null);
});

test("dois cadastros com o mesmo código falham fechado", () => {
  assert.equal(selectCadastroForAuthenticatedUser([candidates[0], { ...candidates[1], colaboradorCodigo: "TESTE-A" }], "TESTE-A").cadastro, null);
});

test("retorna erro claro para usuário sem cadastro", () => {
  assert.match(selectCadastroForAuthenticatedUser([], "P0999999").error ?? "", /sem cadastro/i);
});
