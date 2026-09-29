import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function DashboardKpiCard({
  title,
  value,
  detail,
  icon,
  tone = "neutral",
}: {
  title: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: "neutral" | "brand" | "warning" | "danger" | "success";
}) {
  const tones = {
    neutral: "bg-[#F4F4F2] text-[#52525B]",
    brand: "bg-[var(--primary-soft)] text-[var(--primary)]",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
    danger: "bg-[var(--error-soft)] text-[var(--error)]",
    success: "bg-[var(--success-soft)] text-[var(--success)]",
  } as const;

  return (
    <Card className="min-h-[112px] p-4 sm:p-5">
      <div className="flex h-full items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[var(--muted-foreground)]">{title}</p>
          <div className="mt-2 text-[24px] font-bold tracking-[-0.03em] text-[var(--foreground)]">
            {value}
          </div>
          <p className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{detail}</p>
        </div>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          {icon}
        </span>
      </div>
    </Card>
  );
}
