"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";
import { formatParticipacao, money } from "@/components/mapa-pagamento-table";
import type { ContratoResumo, MapaPagamentoItem } from "@/components/types";
import { Badge, BlurValue } from "@/components/ui";
import { getMapaPagamentoStatusMeta, type SgcStatusEntry } from "@/lib/sgc-display-status";

const MAX_CONTRATOS_VISIVEIS = 2;

/** Participações > 0 do item, maior primeiro — mesmos percentuais de item.participacaoContratos. */
function participacoes(item: MapaPagamentoItem, contratos: ContratoResumo[]) {
  return contratos
    .map((contrato) => ({ contrato, valor: item.participacaoContratos[contrato.id] }))
    .filter((p): p is { contrato: ContratoResumo; valor: number } => typeof p.valor === "number" && p.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

function Distribuicao({ item, contratos }: { item: MapaPagamentoItem; contratos: ContratoResumo[] }) {
  const lista = participacoes(item, contratos);
  const visiveis = lista.slice(0, MAX_CONTRATOS_VISIVEIS);
  const ocultos = lista.slice(MAX_CONTRATOS_VISIVEIS);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visiveis.length ? visiveis.map(({ contrato, valor }) => (
        <span key={contrato.id} className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-[var(--border)] bg-[#FAFAF8] px-1.5 py-0.5 text-[11px] text-[var(--foreground)]" title={`${contrato.nome}: ${formatParticipacao(valor)}`}>
          <span className="truncate">{contrato.nome}</span>
          <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{formatParticipacao(valor)}</span>
        </span>
      )) : <span className="text-[11px] text-[var(--muted-foreground)]">Não classificado</span>}
      {ocultos.length > 0 && (
        <span className="text-[11px] text-[var(--muted-foreground)]" title={ocultos.map(({ contrato, valor }) => `${contrato.nome}: ${formatParticipacao(valor)}`).join(" · ")}>
          +{ocultos.length}
        </span>
      )}
      {item.documentosPendentesContrato > 0 && (
        <span
          className="text-[#D97706]"
          title={`${item.documentosPendentesContrato} documento(s) sem contrato (CTO) válido — ${money(item.valorNaoClassificadoContrato)} ainda não classificado. Os contratos identificados continuam corretos.`}
        >
          <AlertTriangle size={13} />
        </span>
      )}
    </div>
  );
}

function StatusCell({ sgcEntry }: { sgcEntry?: SgcStatusEntry }) {
  const meta = getMapaPagamentoStatusMeta(sgcEntry?.status ?? "AGUARDANDO_ENVIO", sgcEntry?.statusConferencia);
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={meta.badge} className="shrink-0 whitespace-nowrap">{meta.label}</Badge>
      {sgcEntry && sgcEntry.revisaoNumero > 0 && <span className="font-technical text-[10px] text-[var(--muted-foreground)]">Rev. {sgcEntry.revisaoNumero}</span>}
    </div>
  );
}

export function FornecedoresTable({
  itens,
  contratos,
  sgcStatus,
  onOpen,
}: {
  itens: MapaPagamentoItem[];
  contratos: ContratoResumo[];
  sgcStatus: Record<string, SgcStatusEntry>;
  onOpen: (item: MapaPagamentoItem) => void;
}) {
  if (!itens.length) {
    return <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Nenhum fornecedor encontrado com os filtros aplicados.</div>;
  }

  return (
    <>
      {/* Desktop/tablet: tabela só de leitura; a linha inteira abre o detalhe, onde ficam as ações. */}
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="fornecedores-tabela">
          <thead className="bg-[#FAFAF8]">
            <tr>
              {[
                ["Fornecedor", "text-left", ""],
                ["Empresa", "text-left", "hidden min-[1400px]:table-cell"],
                ["Contrato", "text-left", "hidden xl:table-cell"],
                ["Alocação", "text-left", "hidden min-[1400px]:table-cell"],
                ["Valor", "text-right", ""],
                ["Status", "text-left", ""],
              ].map(([label, align, responsive]) => (
                <th key={label} className={`text-table-header border-b border-[var(--border)] px-2.5 py-2.5 text-[var(--muted-foreground)] xl:px-4 ${align} ${responsive}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const codigo = item.projetistaCodigo ?? "";
              return (
                <tr
                  key={item.id}
                  tabIndex={0}
                  onClick={() => onOpen(item)}
                  aria-label={`Abrir detalhe de ${item.responsavel ?? codigo ?? "fornecedor"}`}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                      event.preventDefault();
                      onOpen(item);
                    }
                  }}
                  className="cursor-pointer border-b border-[#EFEFED] transition-colors last:border-0 hover:bg-[#FAFAF8] focus-visible:bg-[#FAFAF8] focus-visible:outline-none"
                >
                  <td className="px-2.5 py-3 xl:px-4">
                    <p className="max-w-[160px] truncate font-semibold text-[var(--foreground)] xl:max-w-[260px]">{item.responsavel ?? codigo ?? "–"}</p>
                    {codigo && <p className="mt-0.5 font-technical text-[10px] text-[var(--muted-foreground)]">{codigo}</p>}
                  </td>
                  <td className="hidden px-2.5 py-3 xl:px-4 min-[1400px]:table-cell">
                    <p className="max-w-[240px] truncate text-[var(--foreground)]">{item.fornecedor?.razaoSocial ?? item.razaoSocial ?? "–"}</p>
                    <p className="mt-0.5 font-technical text-[10px] text-[var(--muted-foreground)]"><BlurValue>{item.fornecedor?.cpfCnpj ?? item.cpfCnpj ?? "–"}</BlurValue></p>
                  </td>
                  <td className="hidden px-2.5 py-3 xl:table-cell xl:px-4"><Distribuicao item={item} contratos={contratos} /></td>
                  <td className="hidden px-2.5 py-3 text-[var(--muted-foreground)] xl:px-4 min-[1400px]:table-cell">{item.alocacao ?? "–"}</td>
                  <td className="whitespace-nowrap px-2.5 py-3 text-right font-semibold tabular-nums text-[var(--foreground)] xl:px-4"><BlurValue>{money(item.valor)}</BlurValue></td>
                  <td className="px-2.5 py-3 xl:px-4"><StatusCell sgcEntry={sgcStatus[codigo]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: linhas compactas; ações e detalhes completos ficam no drawer. */}
      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="fornecedores-lista-mobile">
        {itens.map((item) => {
          const codigo = item.projetistaCodigo ?? "";
          return (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item)} aria-label={`Abrir detalhe de ${item.responsavel ?? codigo ?? "fornecedor"}`} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">{item.responsavel ?? codigo ?? "–"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusCell sgcEntry={sgcStatus[codigo]} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]"><BlurValue>{money(item.valor)}</BlurValue></p>
                  <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{item.alocacao ?? ""}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
