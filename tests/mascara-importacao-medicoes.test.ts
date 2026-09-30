import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { problemasDaMascaraMedicoes } from "./support/mascara-medicoes";

const TEMPLATE = path.join(__dirname, "..", "app-assets", "templates", "Mascara_Importacao_Medicoes.xlsx");
const ROTA = path.join(__dirname, "..", "app", "api", "admin", "templates", "[tipo]", "route.ts");

test("máscara de importação de medições nasce limpa: abas e cabeçalhos preservados, sem dado abaixo do cabeçalho", () => {
  assert.deepEqual(problemasDaMascaraMedicoes(fs.readFileSync(TEMPLATE)), []);
});

test("o validador da máscara reprova um arquivo com dados históricos (não é um teste que sempre passa)", () => {
  // Cópia sintética da máscara com 1 linha fictícia (ciclo 2607) em Documentos Auxiliares — nunca dados reais.
  const contaminada = path.join(__dirname, "fixtures", "mascara-medicoes-contaminada.xlsx");
  const problemas = problemasDaMascaraMedicoes(fs.readFileSync(contaminada));
  assert.ok(problemas.some((p) => p.startsWith("Documentos Auxiliares:") && p.includes("abaixo do cabeçalho")), problemas.join("\n"));
  assert.ok(problemas.some((p) => p === "dado histórico presente no arquivo: 2607"), problemas.join("\n"));
  assert.ok(!problemas.some((p) => p.startsWith("Documentos:")), "a aba Documentos da cópia continua válida");
});

test("GET /api/admin/templates/medicoes serve o arquivo estático do template, sem transformação nem cache", () => {
  const rota = fs.readFileSync(ROTA, "utf8");
  assert.match(rota, /filename: "Mascara_Importacao_Medicoes\.xlsx"/);
  assert.match(rota, /path\.join\(process\.cwd\(\), "app-assets", "templates", template\.filename\)/);
  assert.match(rota, /"Cache-Control": "no-store"/);
});
