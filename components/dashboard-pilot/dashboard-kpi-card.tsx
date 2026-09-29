import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function DashboardKpiCard({
  title,
  value,
  detail,
  icon,
  tone = "neutral",
  compact = false,
}: {
  title: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: "neutral" | "brand" | "warning" | "danger" | "success";
  /** Abaixo de sm: card menor para caber em grade 2×2 (título, valor, ícone e detalhe preservados). */
  compact?: boolean;
}) {
  const tones = {
    neutral: "bg-[#F4F4F2] text-[#52525B]",
    brand: "bg-[var(--primary-soft)] text-[var(--primary)]",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
    danger: "bg-[var(--error-soft)] text-[var(--error)]",
    success: "bg-[var(--success-soft)] text-[var(--success)]",
  } as const;

  return (
    <Card className={compact ? "min-h-0 p-3 sm:min-h-[112px] sm:p-5" : "min-h-[112px] p-4 sm:p-5"}>
      <div className={`flex h-full items-start justify-between ${compact ? "gap-2 sm:gap-3" : "gap-3"}`}>
        <div className="min-w-0">
          <p className={`font-semibold text-[var(--muted-foreground)] ${compact ? "text-[10px] leading-tight sm:text-[11px]" : "text-[11px]"}`}>{title}</p>
          <div className={`font-bold tracking-[-0.03em] text-[var(--foreground)] ${compact ? "mt-1.5 text-[17px] sm:mt-2 sm:text-[24px]" : "mt-2 text-[24px]"}`}>
            {value}
          </div>
          <p className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{detail}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center justify-center rounded-lg ${compact ? "h-7 w-7 sm:h-9 sm:w-9 [&>svg]:h-3.5 [&>svg]:w-3.5 sm:[&>svg]:h-[17px] sm:[&>svg]:w-[17px]" : "h-9 w-9"} ${tones[tone]}`}>
          {icon}
        </span>
      </div>
    </Card>
  );
}
