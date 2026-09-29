import { ArrowRight } from "lucide-react";
import type { ContratoResumo, MapaPagamentoItem } from "@/components/types";
import { Badge, BlurValue, Card } from "@/components/ui";
import { formatCicloLabel } from "@/lib/ciclo";
import { getMapaPagamentoStatusMeta, type SgcStatusEntry } from "@/lib/sgc-display-status";

const LIMITE_RESUMO = 5;

function cicloLegivel(ciclo: string) {
  try {
    return formatCicloLabel(ciclo);
  } catch {
    return ciclo;
  }
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function principalContract(item: MapaPagamentoItem, contratos: ContratoResumo[]) {
  const principal = Object.entries(item.participacaoContratos ?? {}).sort(([, a], [, b]) => b - a)[0];
  if (!principal || principal[1] <= 0) return "Não classificado";
  return contratos.find((contrato) => contrato.id === principal[0])?.nome ?? "Contrato";
}

export function DashboardRecentBm({
  items,
  contratos,
  statuses,
  ciclo,
  onVerTodos,
}: {
  items: MapaPagamentoItem[];
  contratos: ContratoResumo[];
  statuses: Record<string, SgcStatusEntry>;
  ciclo: string;
  /** Leva à tela operacional completa (/fornecedores) — este bloco é só um resumo. */
  onVerTodos?: () => void;
}) {
  const recent = [...items]
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime || a.ordem - b.ordem;
    })
    .slice(0, LIMITE_RESUMO);

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6">
        <div>
          <p className="text-card-title text-[var(--foreground)]">BMs e fornecedores recentes</p>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Resumo operacional com os dados já carregados da medição</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-[var(--border)] bg-[#FAFAF8] px-2 py-1 font-technical text-[10px] text-[var(--muted-foreground)]">
            Ciclo {ciclo === "GERAL" ? "geral" : cicloLegivel(ciclo)}
          </span>
          {onVerTodos && (
            <button
              type="button"
              onClick={onVerTodos}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--primary)] hover:text-[var(--primary-hover,#8C1616)] focus-visible:outline-none focus-visible:underline"
            >
              Ver todos
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {recent.length ? (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-[#FAFAF8]">
              <tr>
                {[
                  ["Fornecedor", "text-left"],
                  ["Contrato", "text-left"],
                  ["Ciclo", "text-left"],
                  ["Valor", "text-right"],
                  ["Status", "text-right"],
                ].map(([label, align]) => <th key={label} className={`text-table-header border-b border-[var(--border)] px-5 py-2.5 text-[var(--muted-foreground)] ${align}`}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {recent.map((item) => {
                const codigo = item.projetistaCodigo ?? "";
                const status = statuses[codigo];
                const meta = getMapaPagamentoStatusMeta(status?.status ?? "AGUARDANDO_ENVIO", status?.statusConferencia);
                return (
                  <tr key={item.id} className="border-b border-[#EFEFED] last:border-0 hover:bg-[#FAFAF8]">
                    <td className="px-5 py-3">
                      <p className="max-w-[240px] truncate text-[12px] font-semibold text-[var(--foreground)]">{item.responsavel ?? codigo ?? "Fornecedor"}</p>
                      {codigo && <p className="mt-0.5 font-technical text-[9px] text-[var(--muted-foreground)]">{codigo}</p>}
                    </td>
                    <td className="max-w-[220px] truncate px-5 py-3 text-[11px] text-[var(--muted-foreground)]">{principalContract(item, contratos)}</td>
                    <td className="px-5 py-3 text-[11px] text-[var(--muted-foreground)]">{ciclo === "GERAL" ? "—" : cicloLegivel(ciclo)}</td>
                    <td className="px-5 py-3 text-right text-[11px] font-semibold tabular-nums text-[var(--foreground)]"><BlurValue>{currency.format(item.valor ?? 0)}</BlurValue></td>
                    <td className="px-5 py-3 text-right"><Badge variant={meta.badge}>{meta.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-6 py-10 text-center text-[11px] text-[var(--muted-foreground)]">Nenhum fornecedor disponível para este filtro.</div>
      )}
    </Card>
  );
}
