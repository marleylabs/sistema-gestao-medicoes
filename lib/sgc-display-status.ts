/**
 * Status "de apresentação" do workflow do BM — uma única regra, reusada por qualquer tela que
 * precise decidir o que mostrar para MEDICAO/ADMIN a partir de (status, statusConferencia).
 * Nunca inventa um novo valor de banco: `status` continua PENDENTE até o fornecedor aprovar
 * explicitamente (ver app/api/sgc/enviar/route.ts e app/api/colaborador/sgc/route.ts) — isto aqui
 * só decide qual rótulo mostrar em cima desse mesmo dado.
 */
export type SgcDisplayStatus =
  | "AGUARDANDO_ENVIO"
  | "DIVERGENCIA"
  | "AGUARDANDO"
  | "REVISAO_SOLICITADA"
  | "AGUARDANDO_NF"
  | "APROVADO"
  | "PAGO"
  | "CANCELADO";

export function getMapaPagamentoDisplayStatus(
  status: string,
  statusConferencia: string | null | undefined,
): SgcDisplayStatus {
  if (status === "PENDENTE") {
    // Enquanto existir ao menos uma divergência PENDENTE, a conferência continua DIVERGENCIA —
    // liberarConferenciaSeCompleta (lib/conferencia-resolucao.ts) é quem recalcula isso a cada
    // Incluir/Descartar, nunca assumido aqui.
    return statusConferencia === "DIVERGENCIA" ? "DIVERGENCIA" : "AGUARDANDO";
  }
  const known: SgcDisplayStatus[] = ["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA", "AGUARDANDO_NF", "APROVADO", "PAGO", "CANCELADO"];
  return (known as string[]).includes(status) ? (status as SgcDisplayStatus) : "AGUARDANDO";
}
