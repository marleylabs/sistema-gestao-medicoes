"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { DashboardData } from "@/components/types";
import { BlurValue, Card } from "@/components/ui";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const palette = ["#AF1B1B", "#D85B5B", "#6B7280", "#A1A1AA", "#D97706", "#16A34A"];

export function DashboardContractDistribution({ contexto }: { contexto: DashboardData["contextoMapa"] }) {
  const items = (contexto?.contratos ?? [])
    .filter((item) => item.contrato !== "TOTAL" && item.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const total = items.reduce((sum, item) => sum + item.valor, 0) + (contexto?.valorNaoClassificado ?? 0);
  const chartData = [
    ...items.map((item) => ({ name: item.contrato, value: item.valor })),
    ...((contexto?.valorNaoClassificado ?? 0) > 0 ? [{ name: "Não classificado", value: contexto!.valorNaoClassificado }] : []),
  ];

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div>
        <p className="text-card-title text-[var(--foreground)]">Distribuição por contrato</p>
        <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Participação dinâmica sobre o valor medido</p>
      </div>

      {chartData.length ? (
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
          <BlurValue className="relative mx-auto block h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 150, height: 150 }}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={46}
                  outerRadius={68}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {chartData.map((item, index) => <Cell key={item.name} fill={palette[index % palette.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => currency.format(Number(value ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-[var(--foreground)]">
              {currency.format(total)}
            </span>
          </BlurValue>

          <div className="grid min-w-0 gap-2.5">
            {chartData.slice(0, 6).map((item, index) => (
              <div key={item.name} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                <span className="truncate text-[10px] text-[var(--muted-foreground)]" title={item.name}>{item.name}</span>
                <span className="font-technical text-[10px] font-semibold text-[var(--foreground)]">
                  {total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : "0%"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex h-[150px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[#FAFAF8] text-[11px] text-[var(--muted-foreground)]">
          Sem distribuição disponível neste ciclo.
        </div>
      )}
    </Card>
  );
}
