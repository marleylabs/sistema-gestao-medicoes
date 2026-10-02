"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * Barra contextual de seleção em lote — SÓ apresentação (contagem, detalhe, limpar e as ações que a
 * tela passar como children). Não conhece regra de negócio nenhuma: cada tela decide o que é apto,
 * o que confirmar e qual rota chamar. Renderizada junto da tabela, apenas quando há seleção.
 */
export function BulkSelectionBar({
  count,
  singular,
  plural,
  detail,
  onClear,
  disabled = false,
  children,
}: {
  count: number;
  singular: string;
  plural: string;
  detail?: ReactNode;
  onClear: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Ações da seleção"
      data-testid="bulk-selection-bar"
      className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--primary-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <div className="min-w-0" aria-live="polite">
        <p className="text-[13px] font-bold text-[var(--foreground)]">
          {count} {count === 1 ? singular : plural}
        </p>
        {detail && <div className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{detail}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 [&>button]:h-10 [&>button]:flex-1 [&>button]:whitespace-nowrap sm:[&>button]:flex-none">
        <Button variant="secondary" onClick={onClear} disabled={disabled}>Limpar seleção</Button>
        {children}
      </div>
    </div>
  );
}
