"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "@/components/types";
import { BlurValue, Card } from "@/components/ui";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function DashboardEvolutionChart({ data }: { data: DashboardData["porCiclo"] }) {
  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-card-title text-[var(--foreground)]">Evolução das medições</p>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Valor medido por ciclo disponível no filtro atual</p>
        </div>
        <span className="rounded-md border border-[var(--border)] bg-[#FAFAF8] px-2 py-1 font-technical text-[10px] text-[var(--muted-foreground)]">
          {data.length} ciclo{data.length === 1 ? "" : "s"}
        </span>
      </div>

      {data.length ? (
        <BlurValue className="block h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 720, height: 250 }}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboardMeasurementFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#AF1B1B" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#AF1B1B" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#ECECEA" strokeDasharray="3 3" />
              <XAxis dataKey="ciclo" axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} dy={8} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} tickFormatter={(value) => currency.format(Number(value))} width={72} />
              <Tooltip
                cursor={{ stroke: "#D4D4D0", strokeDasharray: "3 3" }}
                contentStyle={{ border: "1px solid #E4E4E7", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.08)", fontSize: 11 }}
                formatter={(value) => [currency.format(Number(value ?? 0)), "Valor medido"]}
                labelFormatter={(label) => `Ciclo ${label}`}
              />
              <Area
                type="monotone"
                dataKey="totalMedido"
                stroke="#AF1B1B"
                strokeWidth={2}
                fill="url(#dashboardMeasurementFill)"
                dot={{ r: 3, fill: "#FFFFFF", stroke: "#AF1B1B", strokeWidth: 2 }}
                activeDot={{ r: 4, fill: "#AF1B1B", stroke: "#FFFFFF", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </BlurValue>
      ) : (
        <div className="flex h-[250px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[#FAFAF8] text-[11px] text-[var(--muted-foreground)]">
          Nenhuma medição disponível para este filtro.
        </div>
      )}
    </Card>
  );
}
