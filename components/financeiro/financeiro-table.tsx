"use client";

import { ChevronRight } from "lucide-react";
import { Badge, BlurValue } from "@/components/ui";
import { currency, fmtDate, mesmoTexto, statusInfo, valorAPagar, type FinanceiroItem } from "@/components/financeiro/shared";

function NotaFiscalCell({ item }: { item: FinanceiroItem }) {
  if (!item.nfArquivoNome) return <span className="text-[12px] text-[var(--muted-foreground)]">Não enviada</span>;
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-[var(--foreground)]">Recebida</p>
      <p className="whitespace-nowrap text-[11px] text-[var(--muted-foreground)]">{fmtDate(item.nfCarregadoAt)}</p>
    </div>
  );
}

/**
 * Fechamento financeiro do ciclo — tabela densa, sem coluna de botões: a linha abre o detalhe, onde
 * ficam Ver BM, NF, comprovante e "Marcar pago". Valor = mesma fonte do rodapé e dos KPIs.
 */
export function FinanceiroTable({ itens, onOpen }: { itens: FinanceiroItem[]; onOpen: (item: FinanceiroItem) => void }) {
  const total = itens.reduce((soma, item) => soma + valorAPagar(item), 0);
  return (
    <>
      <div className="hidden w-full max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="financeiro-tabela">
          <thead className="bg-[#FAFAF8]">
            <tr>
              {[
                ["Fornecedor", "text-left", ""],
                ["Empresa", "text-left", "hidden xl:table-cell"],
                ["Nota fiscal", "text-left", "hidden lg:table-cell"],
                ["Pagamento", "text-left", "hidden min-[1600px]:table-cell"],
                ["Valor a pagar", "text-right", ""],
                ["Status", "text-left", ""],
                ["", "", ""],
              ].map(([label, align, responsive], index) => (
                <th key={`${label}-${index}`} className={`text-table-header border-b border-[var(--border)] px-3 py-2.5 text-[var(--muted-foreground)] xl:px-4 ${align} ${responsive}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const status = statusInfo(item.status);
              return (
                <tr
                  key={item.id}
                  tabIndex={0}
                  onClick={() => onOpen(item)}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                      event.preventDefault();
                      onOpen(item);
                    }
                  }}
                  aria-label={`Abrir pagamento de ${item.colaboradorNome}`}
                  className="cursor-pointer border-b border-[#EFEFED] transition-colors last:border-0 hover:bg-[#FAFAF8] focus-visible:bg-[#FAFAF8] focus-visible:outline-none"
                >
                  <td className="px-3 py-3 xl:px-4">
                    <p className="max-w-[240px] truncate font-semibold text-[var(--foreground)] xl:max-w-[300px]">{item.colaboradorNome}</p>
                    {/* Código técnico só quando difere do nome exibido (canônico costuma ser igual). */}
                    {!mesmoTexto(item.colaboradorCodigo, item.colaboradorNome) && (
                      <p className="mt-0.5 max-w-[240px] truncate font-technical text-[10px] text-[var(--muted-foreground)]">{item.colaboradorCodigo}</p>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 xl:table-cell xl:px-4">
                    <p className="max-w-[220px] truncate text-[var(--foreground)]">{item.razaoSocial ?? "–"}</p>
                    <p className="mt-0.5 whitespace-nowrap font-technical text-[10px] text-[var(--muted-foreground)]"><BlurValue>{item.cpfCnpj ?? "–"}</BlurValue></p>
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell xl:px-4"><NotaFiscalCell item={item} /></td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-[12px] text-[var(--muted-foreground)] xl:px-4 min-[1600px]:table-cell">
                    {item.status === "PAGO" ? fmtDate(item.pagoAt) : "–"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-[var(--foreground)] xl:px-4">
                    <BlurValue>{currency.format(valorAPagar(item))}</BlurValue>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 xl:px-4"><Badge variant={status.badge}>{status.label}</Badge></td>
                  <td className="w-8 px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)] bg-[#FAFAF8]">
              <td className="px-3 py-2.5 text-[12px] text-[var(--muted-foreground)] xl:px-4">{itens.length} fornecedor(es)</td>
              <td className="hidden xl:table-cell" />
              <td className="hidden lg:table-cell" />
              <td className="hidden min-[1600px]:table-cell" />
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-[13px] font-bold tabular-nums text-[var(--foreground)] xl:px-4" data-testid="financeiro-total">
                <BlurValue>{currency.format(total)}</BlurValue>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="financeiro-lista-mobile">
        {itens.map((item) => {
          const status = statusInfo(item.status);
          return (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item)} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">{item.colaboradorNome}</p>
                  <p className="truncate text-[12px] text-[var(--muted-foreground)]">{item.razaoSocial ?? item.colaboradorCodigo}</p>
                  <div className="mt-1.5"><Badge variant={status.badge}>{status.label}</Badge></div>
                </div>
                <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]"><BlurValue>{currency.format(valorAPagar(item))}</BlurValue></p>
                <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
            </li>
          );
        })}
        <li className="flex items-center justify-between px-4 py-3 text-[12px] text-[var(--muted-foreground)]">
          <span>{itens.length} fornecedor(es)</span>
          <span className="font-bold tabular-nums text-[var(--foreground)]"><BlurValue>{currency.format(total)}</BlurValue></span>
        </li>
      </ul>
    </>
  );
}
