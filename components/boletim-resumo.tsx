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
 * Composição compacta do BM (Condições fixas, Documentos medidos, Descontos, Total da medição e,
 * com REV, Total a pagar) — pelo cálculo canônico (lib/boletim-calculo.ts via `resumoBoletim`), o
 * mesmo do Portal, do editor de pagamento e do BoletimMedicao. Usada nos detalhes do Histórico e
 * de Evidências; o total da medição é o mesmo valor mostrado nas listas (valor gravado do mapa).
 */
export function ComposicaoBoletim({ bm, testId }: { bm: BmData; testId?: string }) {
  const resumo = resumoBoletim(bm);
  return (
    <div data-testid={testId}>
      <LinhaValor label="Condições fixas"><BlurValue>{brl.format(resumo.totalCondicoesFixas)}</BlurValue></LinhaValor>
      <LinhaValor label="Documentos medidos"><BlurValue>{brl.format(resumo.totalDocumentos)}</BlurValue></LinhaValor>
      <LinhaValor label="Descontos" negativo={resumo.totalDescontos > 0}>{resumo.totalDescontos > 0 ? <BlurValue>{`- ${brl.format(resumo.totalDescontos)}`}</BlurValue> : "–"}</LinhaValor>
      <LinhaValor label="Total da medição" forte><BlurValue>{brl.format(resumo.totalMedicao)}</BlurValue></LinhaValor>
      {resumo.rev !== 0 && (
        <>
          <LinhaValor label="REV / Ajustes"><BlurValue>{brl.format(resumo.rev)}</BlurValue></LinhaValor>
          <LinhaValor label="Total a pagar" forte><BlurValue>{brl.format(resumo.totalAPagar)}</BlurValue></LinhaValor>
        </>
      )}
      {resumo.diferencaValorGravado !== null && resumo.diferencaValorGravado !== 0 && (
        <p className="mt-1 text-[11px] text-[var(--warning)]">A composição atual não corresponde ao valor gravado no mapa. Confira o pagamento.</p>
      )}
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{resumo.documentosProdutivos.length} documento(s) medido(s){resumo.documentosDesconto.length ? ` · ${resumo.documentosDesconto.length} desconto(s)` : ""}.</p>
    </div>
  );
}
