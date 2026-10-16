import assert from "node:assert/strict";
import test from "node:test";
import { filtrarAliasesDaIdentidade } from "../lib/colaborador-alias-filtro";
import type { ResolucaoIdentidade } from "../lib/profissional-identidade";

// Resolver de mentira com o mesmo contrato do oficial (lib/profissional-identidade.ts).
const A = "prof-a";
const B = "prof-b";
const tabela: Record<string, ResolucaoIdentidade> = {
  P0000001: { status: "RESOLVIDO", via: "CODIGO", profissionalId: A, codigoCanonico: "P0000001" },
  "JOAO A SILVA": { status: "RESOLVIDO", via: "ALIAS", profissionalId: A, codigoCanonico: "P0000001" },
  P0000002: { status: "RESOLVIDO", via: "CODIGO", profissionalId: B, codigoCanonico: "P0000002" },
  "JOAO SILVA": { status: "AMBIGUO", valor: "JOAO SILVA", candidatos: [] },
  "JOAO DA SILVA": { status: "NAO_RESOLVIDO", valor: "JOAO DA SILVA" },
};
const resolver = async (valor: string): Promise<ResolucaoIdentidade> => tabela[valor] ?? { status: "NAO_RESOLVIDO", valor };

test("filtro: código e alias formal do próprio fornecedor ficam", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade(["P0000001", "JOAO A SILVA"], resolver, A), ["P0000001", "JOAO A SILVA"]);
});

test("filtro: código de outro fornecedor (V1/V2/V4) sai", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade(["P0000001", "P0000002"], resolver, A), ["P0000001"]);
});

test("filtro: nome ambíguo ou não resolvido (V3) sai", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade(["P0000001", "JOAO SILVA", "JOAO DA SILVA"], resolver, A), ["P0000001"]);
});

test("filtro: vazios e repetidos são ignorados", async () => {
  assert.deepEqual(await filtrarAliasesDaIdentidade([" P0000001 ", "P0000001", "", null, undefined], resolver, A), ["P0000001"]);
});
