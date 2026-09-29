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

export type SgcStatusApiEntry = {
  sgcId: string;
  colaboradorCodigo: string;
  ciclo: string;
  status: string;
  revisaoNumero: number;
  statusConferencia: string | null;
};

export type SgcStatusEntry = {
  id: string;
  status: string;
  revisaoNumero: number;
  statusConferencia: string | null;
};

/** Converte o contrato em lista de GET /api/sgc/status no índice usado pela tabela do ciclo. */
export function indexSgcStatusByColaborador(entries: SgcStatusApiEntry[]): Record<string, SgcStatusEntry> {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.colaboradorCodigo,
      {
        id: entry.sgcId,
        status: entry.status,
        revisaoNumero: entry.revisaoNumero,
        statusConferencia: entry.statusConferencia,
      },
    ]),
  );
}

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

export type SgcStatusMeta = {
  label: string;
  badge: "brand" | "success" | "warning" | "danger" | "neutral";
  rowTone: "neutral" | "warning" | "danger" | "success";
  final: boolean;
};

const STATUS_META: Record<SgcDisplayStatus, SgcStatusMeta> = {
  AGUARDANDO_ENVIO: { label: "Aguardando envio", badge: "neutral", rowTone: "neutral", final: false },
  AGUARDANDO: { label: "Aguardando fornecedor", badge: "warning", rowTone: "warning", final: false },
  DIVERGENCIA: { label: "Divergência", badge: "danger", rowTone: "danger", final: false },
  REVISAO_SOLICITADA: { label: "Revisão solicitada", badge: "warning", rowTone: "warning", final: false },
  AGUARDANDO_NF: { label: "Aguardando NF", badge: "warning", rowTone: "warning", final: false },
  APROVADO: { label: "Aguardando pagamento", badge: "brand", rowTone: "success", final: false },
  PAGO: { label: "Pago", badge: "success", rowTone: "success", final: true },
  CANCELADO: { label: "Cancelado", badge: "neutral", rowTone: "neutral", final: true },
};

export function getMapaPagamentoStatusMeta(
  status: string,
  statusConferencia: string | null | undefined,
): SgcStatusMeta {
  return STATUS_META[getMapaPagamentoDisplayStatus(status, statusConferencia)];
}

/** Metadados de um status de apresentação já resolvido (ex.: opções de filtro) — mesmo mapa STATUS_META. */
export function getSgcDisplayStatusMeta(status: SgcDisplayStatus): SgcStatusMeta {
  return STATUS_META[status];
}
