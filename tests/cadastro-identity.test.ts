import assert from "node:assert/strict";
import test from "node:test";
import { selectCadastroForAuthenticatedUser } from "../lib/cadastro-identity";

const sharedCnpj = "11222333000181";
const candidates = [
  { id: "a", colaboradorCodigo: "TESTE-A", responsavel: "COLABORADOR A", cnpjNormalizado: sharedCnpj },
  { id: "b", colaboradorCodigo: "TESTE-B", responsavel: "Colaborador B", cnpjNormalizado: sharedCnpj },
];

test("seleciona cadastro pelo código interno antes do CNPJ", () => {
  assert.equal(selectCadastroForAuthenticatedUser(candidates, "TESTE-B", "COLABORADOR B").cadastro?.id, "b");
});

test("seleciona por nome do usuário P0 sem misturar CNPJ compartilhado", () => {
  assert.equal(selectCadastroForAuthenticatedUser(candidates, "P0456789", "COLABORADOR B").cadastro?.id, "b");
});

test("não escolhe cadastro somente pelo CNPJ", () => {
  assert.equal(selectCadastroForAuthenticatedUser([candidates[0]], sharedCnpj, null).cadastro, null);
});

test("retorna erro claro para usuário sem cadastro", () => {
  assert.match(selectCadastroForAuthenticatedUser([], "P0999999", "SEM CADASTRO").error ?? "", /sem cadastro/i);
});
