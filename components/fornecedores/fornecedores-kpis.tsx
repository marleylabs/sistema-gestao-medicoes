import { CircleCheckBig, ClipboardList, Banknote, Users } from "lucide-react";
import { DashboardKpiCard } from "@/components/dashboard-pilot/dashboard-kpi-card";
import type { MapaPagamentoItem } from "@/components/types";
import { BlurValue } from "@/components/ui";
import { getMapaPagamentoDisplayStatus, type SgcDisplayStatus, type SgcStatusEntry } from "@/lib/sgc-display-status";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR");

/** Status canônicos em que a próxima ação é da Equipe de Medição (enviar BM, resolver divergência, responder revisão). */
export const PENDENCIAS_EQUIPE: SgcDisplayStatus[] = ["AGUARDANDO_ENVIO", "DIVERGENCIA", "REVISAO_SOLICITADA"];

export function displayStatusOf(item: MapaPagamentoItem, statuses: Record<string, SgcStatusEntry>) {
  const entry = statuses[item.projetistaCodigo ?? ""];
  return getMapaPagamentoDisplayStatus(entry?.status ?? "AGUARDANDO_ENVIO", entry?.statusConferencia);
}

/**
 * Indicadores do ciclo, derivados só de dados já carregados (GET /api/mapa-pagamento e
 * GET /api/sgc/status) — nunca da busca/filtros da toolbar. "Valor medido" usa a mesma definição
 * do KPI do Dashboard: soma de mapaPagamentoItem.valor > 0.
 */
export function FornecedoresKpis({ itens, statuses }: { itens: MapaPagamentoItem[]; statuses: Record<string, SgcStatusEntry> }) {
  const displayStatuses = itens.map((item) => displayStatusOf(item, statuses));
  const pendencias = displayStatuses.filter((status) => PENDENCIAS_EQUIPE.includes(status)).length;
  const pagos = displayStatuses.filter((status) => status === "PAGO").length;
  const valorMedido = itens.reduce((total, item) => total + (item.valor > 0 ? item.valor : 0), 0);

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" data-testid="fornecedores-kpis">
      <DashboardKpiCard
        compact
        title="Fornecedores no ciclo"
        value={number.format(itens.length)}
        detail="Com pagamento no mapa do ciclo"
        icon={<Users size={17} />}
        tone="neutral"
      />
      <DashboardKpiCard
        compact
        title="Pendências da equipe"
        value={number.format(pendencias)}
        detail="Envio, divergência ou revisão"
        icon={<ClipboardList size={17} />}
        tone={pendencias ? "warning" : "neutral"}
      />
      <DashboardKpiCard
        compact
        title="Valor medido"
        value={<BlurValue>{currency.format(valorMedido)}</BlurValue>}
        detail="Soma dos pagamentos do mapa"
        icon={<Banknote size={17} />}
        tone="brand"
      />
      <DashboardKpiCard
        compact
        title="Pagos"
        value={number.format(pagos)}
        detail={`de ${number.format(itens.length)} fornecedores no ciclo`}
        icon={<CircleCheckBig size={17} />}
        tone="success"
      />
    </div>
  );
}
