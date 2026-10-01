import { calcularBoletim, type CondicoesFixasBoletim, type DocumentoBoletim } from "@/lib/boletim-calculo";
import { formatCicloLabel } from "@/lib/ciclo";
import { getPortalStatusMeta } from "@/lib/portal-fornecedor";

/**
 * "Minhas Medições" (Portal do Fornecedor) — regras de APRESENTAÇÃO sobre o payload de
 * GET /api/colaborador/medicoes (BMs já aprovados pelo fornecedor: AGUARDANDO_NF, APROVADO, PAGO,
 * ordenados pelo backend por aprovação, mais recente primeiro). Valores pelo cálculo canônico
 * (lib/boletim-calculo.ts); status pelos rótulos do portal (lib/portal-fornecedor.ts). Nenhuma data
 * ou etapa é inferida: só entram eventos com data gravada.
 */

export type MedicaoFornecedor = {
  id: string;
  ciclo: string;
  status?: string;
  revisaoLabel: string | null;
  aprovadoAt: string | null;
  nfArquivoNome?: string | null;
  nfCarregadoAt?: string | null;
  comprovanteArquivoNome?: string | null;
  comprovanteCarregadoAt?: string | null;
  pagamento: { valor: number; rev: number; condicoesFixas?: CondicoesFixasBoletim } | null;
  documentos: DocumentoBoletim[];
};

/** Status possíveis nesta lista (o backend só devolve BMs já aprovados pelo fornecedor). */
export const STATUS_MINHAS_MEDICOES = ["AGUARDANDO_NF", "APROVADO", "PAGO"] as const;

export function competenciaCiclo(ciclo: string) {
  try {
    return formatCicloLabel(ciclo);
  } catch {
    return null;
  }
}

export function valoresMedicao(m: MedicaoFornecedor) {
  return calcularBoletim({
    documentos: m.documentos,
    condicoesFixas: m.pagamento?.condicoesFixas,
    valorInformado: m.pagamento?.valor ?? null,
    rev: m.pagamento?.rev ?? 0,
  });
}

/** Data mais recente entre os eventos gravados (aprovação, NF, comprovante); null se nenhum. */
export function ultimaAtualizacao(m: MedicaoFornecedor) {
  const datas = [m.aprovadoAt, m.nfCarregadoAt, m.comprovanteCarregadoAt].filter((d): d is string => !!d);
  return datas.length ? datas.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
}

export type EventoMedicao = { chave: string; titulo: string; data: string | null; concluido: boolean };

/**
 * Linha do tempo com o que de fato está gravado: aprovação, NF e comprovante (cada um só com sua
 * data real), mais o estado atual. Sem etapa nem data inventada.
 */
export function eventosMedicao(m: MedicaoFornecedor): EventoMedicao[] {
  const eventos: EventoMedicao[] = [];
  if (m.aprovadoAt) eventos.push({ chave: "aprovado", titulo: "Boletim aprovado", data: m.aprovadoAt, concluido: true });
  if (m.nfCarregadoAt) eventos.push({ chave: "nf", titulo: "Nota fiscal recebida", data: m.nfCarregadoAt, concluido: true });
  if (m.comprovanteCarregadoAt) eventos.push({ chave: "comprovante", titulo: "Comprovante de pagamento disponível", data: m.comprovanteCarregadoAt, concluido: true });
  if (m.status === "AGUARDANDO_NF") eventos.push({ chave: "atual", titulo: "Aguardando nota fiscal", data: null, concluido: false });
  else if (m.status === "APROVADO") eventos.push({ chave: "atual", titulo: "Aguardando pagamento", data: null, concluido: false });
  else if (m.status === "PAGO") eventos.push({ chave: "atual", titulo: "Pagamento concluído", data: null, concluido: true });
  return eventos;
}

/** "O que acontece agora?" — mensagem curta pelo status real. */
export function proximoPasso(status: string | undefined) {
  if (status === "AGUARDANDO_NF") return "Seu boletim foi aprovado. Envie a nota fiscal para continuar.";
  if (status === "APROVADO") return "Nota fiscal recebida. A medição está aguardando o pagamento.";
  if (status === "PAGO") return "Pagamento concluído.";
  return null;
}

export function resumoPorStatus(medicoes: MedicaoFornecedor[]) {
  return STATUS_MINHAS_MEDICOES.map((status) => ({
    status,
    label: getPortalStatusMeta(status).label,
    total: medicoes.filter((m) => m.status === status).length,
  }));
}

/** Filtro por status e busca por ciclo/competência — preserva a ordem do backend. */
export function filtrarMedicoes(medicoes: MedicaoFornecedor[], status: string, busca: string) {
  const termo = busca.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return medicoes.filter((m) => {
    if (status !== "todos" && m.status !== status) return false;
    if (!termo) return true;
    const alvo = `${m.ciclo} ${competenciaCiclo(m.ciclo) ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return alvo.includes(termo);
  });
}
