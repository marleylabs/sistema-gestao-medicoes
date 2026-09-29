import { Badge, Card } from "@/components/ui";
import {
  getMapaPagamentoDisplayStatus,
  getMapaPagamentoStatusMeta,
  type SgcDisplayStatus,
  type SgcStatusEntry,
} from "@/lib/sgc-display-status";

const order: SgcDisplayStatus[] = [
  "DIVERGENCIA",
  "REVISAO_SOLICITADA",
  "AGUARDANDO",
  "AGUARDANDO_ENVIO",
  "AGUARDANDO_NF",
  "APROVADO",
  "PAGO",
  "CANCELADO",
];

export function DashboardStatusList({ statuses }: { statuses: Record<string, SgcStatusEntry> }) {
  const counts = Object.values(statuses).reduce<Partial<Record<SgcDisplayStatus, number>>>((acc, entry) => {
    const key = getMapaPagamentoDisplayStatus(entry.status, entry.statusConferencia);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const visible = order.filter((key) => counts[key]);

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div>
        <p className="text-card-title text-[var(--foreground)]">Status dos BMs</p>
        <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Estados canônicos do workflow no ciclo</p>
      </div>

      {visible.length ? (
        <div className="mt-4 grid gap-2.5">
          {visible.map((key) => {
            const sample = Object.values(statuses).find((entry) => getMapaPagamentoDisplayStatus(entry.status, entry.statusConferencia) === key)!;
            const meta = getMapaPagamentoStatusMeta(sample.status, sample.statusConferencia);
            return (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-[#EFEFED] px-3 py-2.5">
                <Badge variant={meta.badge}>{meta.label}</Badge>
                <span className="font-technical text-[13px] font-bold text-[var(--foreground)]">{counts[key]}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 flex h-[150px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[#FAFAF8] text-[11px] text-[var(--muted-foreground)]">
          Nenhum BM disponível neste ciclo.
        </div>
      )}
    </Card>
  );
}
