import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { avaliarElegibilidadeEnvioBm, MENSAGEM_CADASTRO_PENDENTE } from "../lib/bm-envio-elegibilidade";
import { elegibilidadeDaLinha } from "../lib/bm-envio-selecao";
import { processarEnvioBmEmLote } from "../lib/bm-envio-lote";
import { pareceNomeDeFornecedor } from "../lib/identidade-plausivel";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("heurística de apresentação: resíduo de parser nunca parece nome de fornecedor", () => {
  for (const lixo of [
    "GRD-T-SINT-SA-2026-0001-0001",
    "GRD-T-SINT-2025-0000-0002",
    "ORC-SINT-0001",
    "MC-SINT-C-00001",
    "HORAS DE ESTUDO PARA ADEQUACAO DO PROJETO DE TUBULACAO DA AREA",
    "",
    "  ",
    "AB",
  ]) {
    assert.equal(pareceNomeDeFornecedor(lixo), false, lixo);
  }
  for (const nome of ["FORNECEDOR ALFA TESTE", "JOSÉ DA SILVA", "EMPRESA SINTETICA ENGENHARIA", "ENGESINT", "D'ÁVILA SOUZA", "A1 ENGENHARIA SINTETICA", "3D PROJETOS SINT", "ENGENHARIA 360 SINT", "FORNECEDOR E2E TESTE"]) {
    assert.equal(pareceNomeDeFornecedor(nome), true, nome);
  }
});

test("BM: cadastro pendente nunca é elegível — botão, checkbox e lote usam a mesma regra", async () => {
  for (const status of [undefined, "AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"]) {
    assert.deepEqual(avaliarElegibilidadeEnvioBm({ status, cadastroPendente: true }), { elegivel: false, motivo: "CADASTRO_PENDENTE", mensagem: MENSAGEM_CADASTRO_PENDENTE });
  }
  assert.equal(avaliarElegibilidadeEnvioBm({ status: undefined, cadastroPendente: false }).elegivel, true);
  assert.equal(elegibilidadeDaLinha({ id: "x", projetistaCodigo: "NOME DA PLANILHA", cadastroPendente: true }, undefined, null).elegivel, false);

  let enviados = 0;
  const resumo = await processarEnvioBmEmLote({
    ids: ["00000000-0000-4000-8000-000000000001"],
    ciclo: "2610",
    intervaloMs: 0,
    carregar: async (ids) => new Map(ids.map((id) => [id, { id, ciclo: "2610", colaboradorCodigo: "NOME DA PLANILHA", nome: "NOME DA PLANILHA", atualizadoEm: null, bm: null, cadastroPendente: true }])),
    enviar: async () => { enviados += 1; return { ok: true, alreadyProcessed: false, emailOk: true }; },
  });
  assert.equal(enviados, 0);
  assert.deepEqual(resumo.resultados.map((r) => [r.status, r.motivo]), [["IGNORADO", MENSAGEM_CADASTRO_PENDENTE]]);
});

test("rotas de escrita/busca exigem ADMIN no backend; listagem aceita MEDICAO/ADMIN e é só leitura", () => {
  const base = path.join("app", "api", "admin", "importacao", "identidades");
  for (const rota of [["[id]", "vincular"], ["[id]", "descartar"], ["linhas", "descartar"], ["fornecedores"]]) {
    const src = read(path.join(base, ...rota, "route.ts"));
    assert.match(src, /requireAdmin\(\)/, rota.join("/"));
    assert.match(src, /perfil !== "ADMIN"[\s\S]*status: 403/, rota.join("/"));
  }
  const listagem = read(path.join(base, "route.ts"));
  assert.match(listagem, /requireAdmin\(\)/);
  assert.doesNotMatch(listagem, /\.(create|update|upsert|delete)\w*\(/);
  // Service do envio individual recusa pendente antes de qualquer leitura/escrita do BM.
  const servico = read("lib/bm-envio.ts");
  assert.ok(servico.indexOf("\"CADASTRO_PENDENTE\" }") < servico.indexOf("pg_advisory_xact_lock(hashtext"));
});

test("UI de resolução nunca usa window.confirm e não reimporta sozinha", () => {
  const src = read(path.join("components", "importacao", "identidades-pendentes.tsx"));
  assert.doesNotMatch(src, /window\.confirm|confirm\(/);
  assert.doesNotMatch(src, /\/api\/admin\/etl/);
  assert.match(src, /Sugestão \(não aplicada\)/);
});

test("identidades pendentes no PostgreSQL E2E (total, BM, vínculo, descarte, concorrência, alias futuro no ETL)", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-identidade-importacao.ts"], {
    cwd: ROOT, encoding: "utf8", timeout: 180000,
  });
  assert.match(output, /PASS: identidades pendentes da importação/);
});
