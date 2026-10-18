"use client";

import { AlertTriangle, Banknote, CircleCheckBig, Clock3 } from "lucide-react";
import type { ContratoResumo, DashboardData, MapaPagamentoItem } from "@/components/types";
import { CountUp, Stagger, StaggerGrupo, StaggerItem } from "@/components/motion";
import { BlurValue, Skeleton } from "@/components/ui";
import { getMapaPagamentoDisplayStatus, type SgcStatusEntry } from "@/lib/sgc-display-status";
import { DashboardContractDistribution } from "./dashboard-contract-distribution";
import { DashboardEvolutionChart } from "./dashboard-evolution-chart";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { DashboardRecentBm } from "./dashboard-recent-bm";
import { DashboardStatusList } from "./dashboard-status-list";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function DashboardPilot({
  data,
  mapaItens,
  contratos,
  statuses,
  ciclo,
  onVerTodosFornecedores,
}: {
  data: DashboardData | null;
  mapaItens: MapaPagamentoItem[];
  contratos: ContratoResumo[];
  statuses: Record<string, SgcStatusEntry>;
  ciclo: string;
  onVerTodosFornecedores?: () => void;
}) {
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[112px] rounded-xl" />
        ))}
      </div>
    );
  }

  const displayStatuses = Object.values(statuses).map((entry) => getMapaPagamentoDisplayStatus(entry.status, entry.statusConferencia));
  const aguardandoFornecedor = displayStatuses.filter((status) => status === "AGUARDANDO").length;
  const divergencias = displayStatuses.filter((status) => status === "DIVERGENCIA").length;
  const aguardandoPagamento = displayStatuses.filter((status) => status === "APROVADO").length;

  return (
    <section className="min-w-0">
      <Stagger className="grid min-w-0 gap-5 sm:gap-6">
        <StaggerGrupo className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StaggerItem className="grid">
            <DashboardKpiCard
              realce
              title="Valor medido"
              value={<BlurValue><CountUp valor={data.cards.totalMedido} formatar={currency.format} /></BlurValue>}
              detail={`${data.cards.totalRegistros} registros · ${number.format(data.cards.totalHoras)} HH`}
              icon={<Banknote size={17} />}
              tone="brand"
            />
          </StaggerItem>
          <StaggerItem className="grid">
            <DashboardKpiCard
              realce
              title="Aguardando fornecedor"
              value={<CountUp valor={aguardandoFornecedor} formatar={number.format} />}
              detail={`${displayStatuses.length} BMs acompanhados no ciclo`}
              icon={<Clock3 size={17} />}
              tone="warning"
            />
          </StaggerItem>
          <StaggerItem className="grid">
            <DashboardKpiCard
              realce
              title="Divergências"
              value={<CountUp valor={divergencias} formatar={number.format} />}
              detail={divergencias ? "Requerem análise da equipe" : "Nenhuma pendência identificada"}
              icon={<AlertTriangle size={17} />}
              tone={divergencias ? "danger" : "neutral"}
            />
          </StaggerItem>
          <StaggerItem className="grid">
            <DashboardKpiCard
              realce
              title="Aguardando pagamento"
              value={<CountUp valor={aguardandoPagamento} formatar={number.format} />}
              detail="BMs aprovados com NF validada"
              icon={<CircleCheckBig size={17} />}
              tone="success"
            />
          </StaggerItem>
        </StaggerGrupo>

        <StaggerItem className="min-w-0">
          <DashboardEvolutionChart data={data.porCiclo} />
        </StaggerItem>

        <StaggerItem className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <DashboardContractDistribution contexto={data.contextoMapa} />
          <DashboardStatusList statuses={statuses} />
        </StaggerItem>

        <StaggerItem className="min-w-0">
          <DashboardRecentBm items={mapaItens} contratos={contratos} statuses={statuses} ciclo={ciclo} onVerTodos={onVerTodosFornecedores} />
        </StaggerItem>
      </Stagger>
    </section>
  );
}
