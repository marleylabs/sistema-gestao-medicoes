export type CicloEntry = { ciclo: string; mesReferencia: string | null; updatedAt: string };

/** Item de GET /api/admin/financeiro (SgcAprovacaoMedicao + valor do mapa de pagamento do ciclo). */
export type FinanceiroItem = {
  id: string;
  colaboradorCodigo: string;
  colaboradorNome: string;
  status: string;
  nfArquivoNome: string | null;
  nfCarregadoAt: string | null;
  pagoAt: string | null;
  comprovanteArquivoNome: string | null;
  comprovanteCarregadoAt: string | null;
  valor: number;
  rev: number;
  cpfCnpj: string | null;
  razaoSocial: string | null;
};

export function mesmoTexto(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
}

export const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function fmtDate(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Valor a pagar do fornecedor no ciclo — a MESMA conta de sempre do Painel Financeiro
 * (mapaPagamentoItem.valor + rev, devolvidos pela API). Fonte única para lista, KPIs e detalhe.
 */
export function valorAPagar(item: Pick<FinanceiroItem, "valor" | "rev">) {
  return item.valor + item.rev;
}

/** Mapper visual dos status reais (sem renomear status internos nem criar novos). */
export function statusInfo(status: string) {
  if (status === "PAGO")         return { label: "Concluído",       badge: "success" as const };
  if (status === "APROVADO")     return { label: "Aguardando pgto.", badge: "brand"   as const };
  return                                { label: "Aguardando NF",   badge: "warning"  as const };
}

/** Os 3 status que a API financeira devolve, na ordem do fluxo. */
export const STATUS_FINANCEIROS = ["AGUARDANDO_NF", "APROVADO", "PAGO"] as const;

export const STATUS_FILTRO_LABEL: Record<string, string> = {
  AGUARDANDO_NF: "Aguardando NF",
  APROVADO: "Aguardando pgto.",
  PAGO: "Concluído",
};
