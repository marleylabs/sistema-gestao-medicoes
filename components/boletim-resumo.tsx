"use client";

import type { ReactNode } from "react";
import { BlurValue } from "@/components/ui";
import { resumoBoletim, type BmData } from "@/components/boletim-medicao";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function LinhaValor({ label, children, forte, negativo }: { label: string; children: ReactNode; forte?: boolean; negativo?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-sm ${forte ? "border-t border-[var(--border)] pt-2.5 font-semibold" : ""}`}>
      <span className={forte ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{label}</span>
      <span className={`whitespace-nowrap tabular-nums ${negativo ? "text-[var(--error)]" : "text-[var(--foreground)]"}`}>{children}</span>
    </div>
  );
}

/**
 * Composição compacta do BM (Condições fixas, Documentos medidos, Descontos, Total medido líquido) —
 * sempre pela função única `resumoBoletim`, a mesma que alimenta o BoletimMedicao completo. Usada
 * nos painéis de detalhe do Histórico e de Evidências.
 */
export function ComposicaoBoletim({ bm, testId }: { bm: BmData; testId?: string }) {
  const resumo = resumoBoletim(bm);
  return (
    <div data-testid={testId}>
      <LinhaValor label="Condições fixas"><BlurValue>{brl.format(resumo.ccFixoClt + resumo.ccFixoPj)}</BlurValue></LinhaValor>
      <LinhaValor label="Documentos medidos"><BlurValue>{brl.format(resumo.totalDocumentosMedidos)}</BlurValue></LinhaValor>
      <LinhaValor label="Descontos" negativo={resumo.ccDescontos > 0}>{resumo.ccDescontos > 0 ? <BlurValue>{`- ${brl.format(resumo.ccDescontos)}`}</BlurValue> : "–"}</LinhaValor>
      <LinhaValor label="Total medido líquido" forte><BlurValue>{brl.format(resumo.totalMedidoLiquido || resumo.totalMedicao)}</BlurValue></LinhaValor>
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{resumo.documentosProdutivos.length} documento(s) medido(s){resumo.documentosDesconto.length ? ` · ${resumo.documentosDesconto.length} desconto(s)` : ""}.</p>
    </div>
  );
}
