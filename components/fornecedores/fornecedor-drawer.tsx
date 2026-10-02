"use client";

import { useEffect, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import { formatParticipacao, money } from "@/components/mapa-pagamento-table";
import type { ContratoResumo, DashboardData, MapaPagamentoItem } from "@/components/types";
import { Badge, BlurValue, IconButton } from "@/components/ui";
import { formatCicloLabel } from "@/lib/ciclo";
import { getMapaPagamentoStatusMeta, type SgcStatusEntry } from "@/lib/sgc-display-status";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function cicloLegivel(ciclo: string) {
  try {
    return formatCicloLabel(ciclo);
  } catch {
    return ciclo === "GERAL" ? "Geral" : ciclo;
  }
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-[var(--border)] px-6 py-4 first:border-t-0">
      <h3 className="text-label text-[var(--muted-foreground)]">{titulo}</h3>
      {children}
    </section>
  );
}

function Dado({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[11px] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-[var(--foreground)]">{children}</dd>
    </div>
  );
}

/**
 * Detalhe do fornecedor no ciclo — somente leitura + as MESMAS ações da linha da tabela
 * (recebidas prontas em `actions`), nunca botões novos sem ação real no sistema.
 * "Tipos e preços" usa `tiposPrecos` do /api/dashboard (mesma regra da antiga tabela do
 * Dashboard: sem DESCONTO, agrupado pelo código do fornecedor).
 */
export function FornecedorDrawer({
  item,
  contratos,
  sgcEntry,
  ciclo,
  tiposPrecos,
  actions,
  onClose,
}: {
  item: MapaPagamentoItem;
  contratos: ContratoResumo[];
  sgcEntry?: SgcStatusEntry;
  ciclo: string;
  tiposPrecos: DashboardData["tiposPrecos"];
  actions: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const codigo = item.projetistaCodigo ?? "";
  const meta = getMapaPagamentoStatusMeta(sgcEntry?.status ?? "AGUARDANDO_ENVIO", sgcEntry?.statusConferencia);
  const nome = item.responsavel ?? codigo ?? "Fornecedor";
  const precos = codigo
    ? tiposPrecos.filter((preco) => preco.codigo === codigo && preco.tipo2?.trim().toUpperCase() !== "DESCONTO")
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Detalhe de ${nome}`}>
      <button type="button" aria-label="Fechar detalhe" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-[var(--surface)] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-6 py-5">
          <div className="min-w-0">
            <p className="text-eyebrow mb-1 text-[var(--primary)]">Fornecedor</p>
            <h2 className="text-section-title break-words text-[var(--foreground)]">{nome}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.cadastroPendente
                ? <Badge variant="warning" className="whitespace-nowrap">Cadastro pendente</Badge>
                : <Badge variant={meta.badge} className="whitespace-nowrap">{meta.label}</Badge>}
              {sgcEntry && sgcEntry.revisaoNumero > 0 && <span className="font-technical text-[11px] text-[var(--muted-foreground)]">Rev. {sgcEntry.revisaoNumero}</span>}
              {codigo && <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{codigo}</span>}
            </div>
          </div>
          <IconButton onClick={onClose} title="Fechar"><X size={16} /></IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Secao titulo="Resumo">
            <dl className="grid grid-cols-3 gap-4">
              <Dado label="Ciclo">
                {cicloLegivel(ciclo)}
                {ciclo !== "GERAL" && <span className="block font-technical text-[10px] text-[var(--muted-foreground)]">{ciclo}</span>}
              </Dado>
              <Dado label="Pagamento"><span className="font-semibold tabular-nums"><BlurValue>{money(item.valor)}</BlurValue></span></Dado>
              <Dado label="Alocação">{item.alocacao ?? "–"}</Dado>
            </dl>
          </Secao>

          <Secao titulo="Empresa">
            <dl className="grid gap-3">
              <Dado label="Razão social">{item.fornecedor?.razaoSocial ?? item.razaoSocial ?? "–"}</Dado>
              <Dado label="CNPJ"><span className="font-technical text-[12px]"><BlurValue>{item.fornecedor?.cpfCnpj ?? item.cpfCnpj ?? "–"}</BlurValue></span></Dado>
            </dl>
          </Secao>

          <Secao titulo="Distribuição por contrato">
            {contratos.length ? (
              <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]">
                {contratos.map((contrato) => (
                  <li key={contrato.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-[var(--foreground)]">{contrato.nome}</span>
                    <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{formatParticipacao(item.participacaoContratos[contrato.id])}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Nenhum contrato identificado no ciclo.</p>
            )}
            {item.documentosPendentesContrato > 0 && (
              <p className="flex items-start gap-1.5 text-[12px] text-[#D97706]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {item.documentosPendentesContrato} documento(s) sem contrato (CTO) válido — {money(item.valorNaoClassificadoContrato)} ainda não classificado.
              </p>
            )}
          </Secao>

          <section className="border-t border-[var(--border)] px-6 py-4">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between text-label text-[var(--muted-foreground)] [&::-webkit-details-marker]:hidden">
                <span>Tipos e preços <span className="font-technical text-[10px]">({precos.length})</span></span>
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              {precos.length ? (
                <ul className="mt-2 divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]">
                  {precos.map((preco, index) => (
                    <li key={`${preco.tipo2}-${preco.condicao}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-[var(--foreground)]">{preco.tipo2}</span>
                      <span className="tabular-nums text-[var(--foreground)]"><BlurValue>{currency.format(parseFloat(preco.condicao) || 0)}</BlurValue></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">Nenhum tipo/preço registrado para este fornecedor no filtro atual.</p>
              )}
            </details>
          </section>
        </div>

        <footer className="border-t border-[var(--border)] px-6 py-4">
          <p className="text-label mb-2 text-[var(--muted-foreground)]">Ações</p>
          {actions}
        </footer>
      </aside>
    </div>
  );
}
