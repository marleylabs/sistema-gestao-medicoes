/**
 * Gera as máscaras XLSX de teste E2E usando o MESMO escritor OOXML que a aplicação usa para gerar
 * a máscara real (lib/xlsx.ts:createSimpleXlsx) — garante compatibilidade byte-a-byte com o
 * parser real (lib/xlsx.ts:parseSimpleXlsx / lib/conferencia-medicao.ts:parseFornecedorPlanilha),
 * nunca uma planilha "aproximada". Colunas exatamente como em
 * app/api/colaborador/conferencia/mascara/route.ts: NR VALE, Formato, A1eq/HH, % Emissão, TIPO DG/DOC/HH.
 *
 * Uso: npx tsx scripts/generate-e2e-fixtures.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createSimpleXlsx } from "../lib/xlsx";

const outDir = path.join(process.cwd(), "tests", "fixtures", "e2e", "conferencia");
fs.mkdirSync(outDir, { recursive: true });

const headers = ["NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH"];

// Reproduz EXATAMENTE o documento medido do Fornecedor A no seed (scripts/seed-e2e.ts):
// numeroDocumento=E2E-DOC-001, formato=PDF, equivalenteA1Horas=10, percentualEmissao=1 (100%), tipo2=DOC.
// Resultado esperado no upload: 0 divergências, statusConferencia = CONCLUIDA.
const mascaraValida = createSimpleXlsx(headers, [
  ["E2E-DOC-001", "PDF", 10, 100, "DOC"],
], "Documentos");
fs.writeFileSync(path.join(outDir, "mascara-valida.xlsx"), mascaraValida);

// Divergente contra o documento medido do Fornecedor B (E2E-DOC-002: formato=PDF, a1eq=15,
// percentual=1, tipo2=DOC) — diverge A1eq/HH, % Emissão e TIPO no mesmo NR VALE (as 3 comparações
// numéricas/texto do lib/conferencia-medicao.ts batidas numa única DivergenciaCandidata), mais
// um documento extra não mapeado (documentoNaoMapeado=true).
const mascaraDivergente = createSimpleXlsx(headers, [
  ["E2E-DOC-002", "PDF", 99, 50, "HH"],
  ["E2E-DOC-EXTRA", "PDF", 5, 100, "DOC"],
], "Documentos");
fs.writeFileSync(path.join(outDir, "mascara-divergente.xlsx"), mascaraDivergente);

console.log("[generate-e2e-fixtures] Gerado:");
console.log(`  ${path.join(outDir, "mascara-valida.xlsx")}`);
console.log(`  ${path.join(outDir, "mascara-divergente.xlsx")}`);
