/**
 * Regras de APRESENTAÇÃO do Portal do Fornecedor (components/colaborador-app.tsx). Valores e
 * composição do BM NÃO são calculados aqui: vêm do cálculo canônico (lib/boletim-calculo.ts), o
 * mesmo do editor de pagamento, do BM/PDF, do Histórico, das Evidências e do Financeiro.
 *
 * Os rótulos do fornecedor são propositalmente diferentes dos internos (lib/sgc-display-status.ts):
 * o fornecedor nunca vê "Divergência" nem "Aguardando fornecedor".
 */

export type PortalStatusBadge = "brand" | "success" | "warning" | "neutral";

export type PortalStatusMeta = { label: string; badge: PortalStatusBadge };

export function getPortalStatusMeta(status: string): PortalStatusMeta {
  if (status === "PAGO")               return { label: "Medição concluída",      badge: "success" };
  if (status === "APROVADO")           return { label: "Aguardando pagamento",   badge: "brand" };
  if (status === "AGUARDANDO_NF")      return { label: "Aguardando envio da NF", badge: "warning" };
  if (status === "REVISAO_SOLICITADA") return { label: "Revisão solicitada",     badge: "warning" };
  if (status === "AGUARDANDO_ENVIO")   return { label: "Aguardando envio do BM", badge: "neutral" };
  if (status === "CANCELADO")          return { label: "BM cancelado",           badge: "neutral" };
  return                                      { label: "Pendente de validação",  badge: "neutral" };
}

/** APROVADO/PAGO: o acompanhamento segue em "Minhas Medições" (composição e documentos ficam ocultos no portal). */
export function isFinancialFollowUpStatus(status: string) {
  return status === "APROVADO" || status === "PAGO";
}
