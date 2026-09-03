import { createSimpleXlsx } from "../../lib/xlsx";

/**
 * Constrói um buffer .xlsx no formato real esperado por
 * lib/cadastro-fornecedor.ts:parseCadastroFornecedorWorkbook — cabeçalho "RESPONSAVEL"
 * localiza a linha de headers; a coluna "DOCUMENTO" é usada como âncora posicional para achar
 * INICIO/FINAL (os dois primeiros valores de data em colunas seguintes) e STATUS (primeiro texto
 * reconhecido depois delas) — não são colunas de header nomeadas, são posicionais, exatamente
 * como a planilha real "Consulta PJ".
 */
export type ConsultaPjRow = {
  responsavel: string;
  cnpj: string;
  razaoSocial: string;
  email?: string;
  telefone?: string;
  inicio: string; // dd/mm/yyyy
  final: string; // dd/mm/yyyy
  status?: "VALIDO" | "VENCIDO" | "PENDENTE";
  statusContrato?: string;
};

const HEADERS = ["STATUS CT", "RESPONSAVEL", "CARTAO CNPJ", "RAZAO SOCIAL", "E-MAIL", "TELEFONE", "DOCUMENTO", "INICIO_POS", "FINAL_POS", "STATUS"];

export function buildConsultaPjWorkbook(rows: ConsultaPjRow[]): Buffer {
  const body = rows.map((r) => [
    r.statusContrato ?? "ATIVO",
    r.responsavel,
    r.cnpj,
    r.razaoSocial,
    r.email ?? "",
    r.telefone ?? "",
    "DOC-MARK",
    r.inicio,
    r.final,
    r.status ?? "VALIDO",
  ]);
  return createSimpleXlsx(HEADERS, body, "CONTRATOS_ATIVOS");
}
