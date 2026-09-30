import { headerOf, readXlsx, rowOf } from "./xlsx-reader";

/** Cabeçalhos esperados — os mesmos de etl/test_import_mask.py (contrato do importador). */
export const DOCUMENTOS_HEADERS = ["Número da Medição", "Projeto Referente", "Título Primário", "Centro de Custo", "Coordenador", "Líder Responsável", "Número do Documento", "Evidência", "Data de Cadastro", "Formato", "Quantidade", "Multiplicador", "Equivalente (A1 ou Horas)", "Porcentagem de Revisão", "Emissão Inicial", "Retorno Vale", "Arquivamento", "Medido (Horas)", "Valor do Reajuste 3º", "Item da QQP", "Valor Unitário", "Valor Bruto", "Valor do Reajuste", "Valor Total", "OBS", "FUNÇÃO", "Localização", "Motivo Desconto", "Valor Desconto", "CICLO", "PROJETISTA", "REFERÊNCIA", "% EMISSÃO", "CONTRATO", "TIPO", "CONDIÇÃO", "VALOR DE MEDIÇÃO"];
export const DOCUMENTOS_AUXILIARES_HEADERS = ["Projeto", "Fase", "Num_Cliente", "Responsavel", "Auxiliar", "Data_Entrega", "Tipo_Revisao", "Tipo_Emissao", "Data_Emissao", "Evidencia_Emissao", "Status_Retorno", "Formato", "Quantidade", "Perc_Revisao", "Equivalente_Revisado", "Tipo_Doc", "Contrato", "Orçamento", "Ordem_Emissao", "Ultima_Emissao", "Ciclo", "Ciclo Retorno", "Mesclado", "Valor", "% Emissão", "Valor De Medição"];

/** Dados históricos que já contaminaram a máscara (ciclo 2607) — nunca podem voltar num arquivo novo. */
const MARCADORES_HISTORICOS = ["CRISTIANO JEFERSON", "MAURICIO SPINDOLA", "2607", "SE-KN-2025"];

/**
 * Valida uma máscara de importação NOVA: abas e cabeçalhos preservados (estrutura, não uma planilha
 * zerada) e NENHUM dado abaixo do cabeçalho nas abas de entrada. Devolve a lista de problemas.
 */
export function problemasDaMascaraMedicoes(buffer: Buffer): string[] {
  const problemas: string[] = [];
  const { sheets, entries } = readXlsx(buffer);
  const porNome = new Map(sheets.map((s) => [s.name, s]));
  for (const nome of ["Instruções", "Documentos", "Documentos Auxiliares"]) {
    if (!porNome.has(nome)) problemas.push(`aba ausente: ${nome}`);
  }
  const instrucoes = porNome.get("Instruções");
  if (instrucoes && instrucoes.cells.size < 4) problemas.push("aba Instruções sem o conteúdo de orientação");

  for (const [nome, esperado] of [["Documentos", DOCUMENTOS_HEADERS], ["Documentos Auxiliares", DOCUMENTOS_AUXILIARES_HEADERS]] as const) {
    const aba = porNome.get(nome);
    if (!aba) continue;
    const cabecalho = headerOf(aba);
    if (JSON.stringify(cabecalho) !== JSON.stringify(esperado)) problemas.push(`${nome}: cabeçalho divergente (${cabecalho.length} colunas)`);
    const dados = Array.from(aba.cells.keys()).filter((ref) => rowOf(ref) > 1);
    if (dados.length) problemas.push(`${nome}: ${dados.length} célula(s) com dado abaixo do cabeçalho (ex.: ${dados.slice(0, 3).join(", ")})`);
    if (!/<pane\b[^>]*topLeftCell="A2"/.test(aba.xml)) problemas.push(`${nome}: cabeçalho não está congelado em A2`);
  }

  // Nenhum resto de dado histórico em QUALQUER parte do pacote (inclusive strings compartilhadas órfãs).
  const pacote = Array.from(entries.values()).map((b) => b.toString("utf8")).join("\n");
  for (const marcador of MARCADORES_HISTORICOS) {
    if (pacote.includes(marcador)) problemas.push(`dado histórico presente no arquivo: ${marcador}`);
  }
  return problemas;
}
