"use client";

import { useSyncExternalStore } from "react";
import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "@/components/types";
import { BlurValue, Card } from "@/components/ui";
import { cicloToMesReferencia, formatCicloLabel } from "@/lib/ciclo";

const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const MOBILE_QUERY = "(max-width: 639px)";
const MAX_LABELS_MOBILE = 4;

function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}

/** O eixo nunca pode derrubar o Dashboard por um ciclo fora do contrato YYMM — exibe o valor bruto. */
function safeCiclo(ciclo: string, format: (value: string) => string) {
  try {
    return format(ciclo);
  } catch {
    return ciclo;
  }
}

export function DashboardEvolutionChart({ data }: { data: DashboardData["porCiclo"] }) {
  const isMobile = useIsMobile();
  // Ordem cronológica pelo próprio YYMM (4 dígitos: ordem textual = ordem temporal), nunca pelo rótulo.
  const pontos = [...data].sort((a, b) => a.ciclo.localeCompare(b.ciclo));
  // No mobile, com muitos pontos, mantém o último ciclo e espaça os demais para evitar sobreposição.
  const passoLabels = isMobile && pontos.length > MAX_LABELS_MOBILE ? Math.ceil(pontos.length / MAX_LABELS_MOBILE) : 1;
  const mostrarLabel = (index: number) => (pontos.length - 1 - index) % passoLabels === 0;

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-card-title text-[var(--foreground)]">Evolução das medições</p>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Valor medido por ciclo disponível no filtro atual</p>
        </div>
        <span className="rounded-md border border-[var(--border)] bg-[#FAFAF8] px-2 py-1 font-technical text-[10px] text-[var(--muted-foreground)]">
          {pontos.length} ciclo{pontos.length === 1 ? "" : "s"}
        </span>
      </div>

      {pontos.length ? (
        <BlurValue className="block h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 720, height: 250 }}>
            {/* left ≥ 0: margem negativa empurrava o início do eixo Y para fora do SVG e cortava os rótulos
                longos ("R$ 800,0 mil"). O eixo mede a própria largura pelos rótulos (width="auto"). */}
            <AreaChart data={pontos} margin={{ top: 24, right: 16, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboardMeasurementFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#AF1B1B" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#AF1B1B" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#ECECEA" strokeDasharray="3 3" />
              <XAxis
                dataKey="ciclo"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#71717A", fontSize: 10 }}
                tickFormatter={(ciclo) => safeCiclo(String(ciclo), formatCicloLabel)}
                padding={{ left: 36, right: 36 }}
                dy={8}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#71717A", fontSize: 10 }} tickFormatter={(value) => compactCurrency.format(Number(value))} width="auto" tickMargin={6} />
              <Tooltip
                cursor={{ stroke: "#D4D4D0", strokeDasharray: "3 3" }}
                contentStyle={{ border: "1px solid #E4E4E7", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.08)", fontSize: 11 }}
                formatter={(value) => [currency.format(Number(value ?? 0)), "Valor medido"]}
                labelFormatter={(ciclo) => safeCiclo(String(ciclo), cicloToMesReferencia)}
              />
              <Area
                type="monotone"
                dataKey="totalMedido"
                stroke="#AF1B1B"
                strokeWidth={2}
                fill="url(#dashboardMeasurementFill)"
                dot={{ r: 3, fill: "#FFFFFF", stroke: "#AF1B1B", strokeWidth: 2 }}
                activeDot={{ r: 4, fill: "#AF1B1B", stroke: "#FFFFFF", strokeWidth: 2 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="totalMedido"
                  content={({ x, y, value, index }) =>
                    typeof index === "number" && mostrarLabel(index) ? (
                      <text x={Number(x)} y={Number(y) - 10} textAnchor="middle" fill="#1A1A1A" fontSize={10} fontWeight={600} stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke" data-testid="evolution-data-label">
                        {compactCurrency.format(Number(value ?? 0))}
                      </text>
                    ) : null
                  }
                />
              </Area>
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
