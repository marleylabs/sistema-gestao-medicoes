"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge, BlurValue } from "@/components/ui";
import { formatParticipacao } from "@/components/mapa-pagamento-table";
import type { ContratoHistorico, FornecedorHistorico, MedicaoHistorico } from "@/components/historico/dados";

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function onKey(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
    event.preventDefault();
    open();
  }
}

function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`text-table-header border-b border-[var(--border)] px-3 py-2.5 text-left text-[var(--muted-foreground)] xl:px-4 ${className}`}>{children}</th>;
}

function Linha({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <tr
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => onKey(e, onOpen)}
      className="cursor-pointer border-b border-[#EFEFED] transition-colors last:border-0 hover:bg-[#FAFAF8] focus-visible:bg-[#FAFAF8] focus-visible:outline-none"
    >
      {children}
      <td className="w-8 px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
    </tr>
  );
}

function ItemMobile({ onOpen, titulo, subtitulo, meta, valor }: { onOpen: () => void; titulo: string; subtitulo?: ReactNode; meta?: ReactNode; valor?: ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">{titulo}</p>
          {subtitulo && <p className="truncate text-[12px] text-[var(--muted-foreground)]">{subtitulo}</p>}
          {meta && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
        {valor && <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">{valor}</p>}
        <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
      </button>
    </li>
  );
}

function Contratos({ participacoes, nomes, max = 2 }: { participacoes: Record<string, number>; nomes: Map<string, string>; max?: number }) {
  const lista = Object.entries(participacoes).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
  if (!lista.length) return <span className="text-[11px] text-[var(--muted-foreground)]">Não classificado</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {lista.slice(0, max).map(([id, p]) => (
        <span key={id} className="inline-flex max-w-[170px] items-center gap-1 rounded-md border border-[var(--border)] bg-[#FAFAF8] px-1.5 py-0.5 text-[11px]" title={`${nomes.get(id) ?? id}: ${formatParticipacao(p)}`}>
          <span className="truncate">{nomes.get(id) ?? id}</span>
          <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{formatParticipacao(p)}</span>
        </span>
      ))}
      {lista.length > max && <span className="text-[11px] text-[var(--muted-foreground)]">+{lista.length - max}</span>}
    </div>
  );
}

/** Medições: uma linha por BM (fornecedor × ciclo). */
export function MedicoesLista({ itens, nomesContrato, onOpen }: { itens: MedicaoHistorico[]; nomesContrato: Map<string, string>; onOpen: (m: MedicaoHistorico) => void }) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="historico-medicoes">
          <thead className="bg-[#FAFAF8]">
            <tr>
              <Th className="w-20">Ciclo</Th>
              <Th>Fornecedor</Th>
              <Th className="hidden xl:table-cell">Contratos</Th>
              <Th className="text-right">Valor</Th>
              <Th>Status</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((m) => (
              <Linha key={m.key} label={`Abrir medição de ${m.nome} no ciclo ${m.ciclo}`} onOpen={() => onOpen(m)}>
                <td className="px-3 py-3 font-technical text-[12.5px] text-[var(--foreground)] xl:px-4">{m.ciclo}</td>
                <td className="px-3 py-3 xl:px-4">
                  <p className="max-w-[300px] truncate font-semibold text-[var(--foreground)]">{m.nome}</p>
                  <p className="mt-0.5 max-w-[300px] truncate text-[12px] text-[var(--muted-foreground)]">{m.empresa ?? "–"}</p>
                </td>
                <td className="hidden px-3 py-3 xl:table-cell xl:px-4"><Contratos participacoes={m.participacoes} nomes={nomesContrato} /></td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-[var(--foreground)] xl:px-4"><BlurValue>{brl.format(m.valor)}</BlurValue></td>
                <td className="whitespace-nowrap px-3 py-3 xl:px-4"><Badge variant={m.status.badge}>{m.status.label}</Badge></td>
              </Linha>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="historico-medicoes-mobile">
        {itens.map((m) => (
          <ItemMobile
            key={m.key}
            onOpen={() => onOpen(m)}
            titulo={m.nome}
            subtitulo={<><span className="font-technical">{m.ciclo}</span> · {m.empresa ?? "–"}</>}
            meta={<Badge variant={m.status.badge}>{m.status.label}</Badge>}
            valor={<BlurValue>{brl.format(m.valor)}</BlurValue>}
          />
        ))}
      </ul>
    </>
  );
}

/** Fornecedores: trajetória histórica por identidade canônica. */
export function FornecedoresLista({ itens, onOpen }: { itens: FornecedorHistorico[]; onOpen: (f: FornecedorHistorico) => void }) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="historico-fornecedores">
          <thead className="bg-[#FAFAF8]">
            <tr>
              <Th>Fornecedor</Th>
              <Th className="text-right">Total histórico</Th>
              <Th className="text-right">Ciclos</Th>
              <Th className="hidden lg:table-cell">Última medição</Th>
              <Th className="hidden lg:table-cell text-right">Contratos</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((f) => (
              <Linha key={f.codigo} label={`Abrir histórico de ${f.nome}`} onOpen={() => onOpen(f)}>
                <td className="px-3 py-3 xl:px-4">
                  <p className="max-w-[320px] truncate font-semibold text-[var(--foreground)]">{f.nome}</p>
                  <p className="mt-0.5 max-w-[320px] truncate text-[12px] text-[var(--muted-foreground)]">{f.empresa ?? "–"}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-[var(--foreground)] xl:px-4"><BlurValue>{brl.format(f.total)}</BlurValue></td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--foreground)] xl:px-4">{f.ciclos.length}</td>
                <td className="hidden px-3 py-3 font-technical text-[12.5px] text-[var(--foreground)] lg:table-cell xl:px-4">{f.ultimo}</td>
                <td className="hidden px-3 py-3 text-right tabular-nums text-[var(--foreground)] lg:table-cell xl:px-4">{f.contratoIds.length}</td>
              </Linha>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="historico-fornecedores-mobile">
        {itens.map((f) => (
          <ItemMobile
            key={f.codigo}
            onOpen={() => onOpen(f)}
            titulo={f.nome}
            subtitulo={f.empresa ?? "–"}
            meta={<span className="text-[11px] text-[var(--muted-foreground)]">{f.ciclos.length} ciclo(s) · última {f.ultimo}</span>}
            valor={<BlurValue>{brl.format(f.total)}</BlurValue>}
          />
        ))}
      </ul>
    </>
  );
}

/** Contratos: o contrato como eixo histórico (somente consulta). */
export function ContratosLista({ itens, onOpen }: { itens: ContratoHistorico[]; onOpen: (c: ContratoHistorico) => void }) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="historico-contratos">
          <thead className="bg-[#FAFAF8]">
            <tr>
              <Th>Contrato</Th>
              <Th className="text-right">Valor atribuído</Th>
              <Th className="text-right">Fornecedores</Th>
              <Th className="hidden lg:table-cell text-right">Ciclos</Th>
              <Th className="hidden lg:table-cell text-right">Medições</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((c) => (
              <Linha key={c.id} label={`Abrir contrato ${c.nome}`} onOpen={() => onOpen(c)}>
                <td className="px-3 py-3 font-semibold text-[var(--foreground)] xl:px-4">{c.nome}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-[var(--foreground)] xl:px-4"><BlurValue>{brl.format(c.valorAtribuido)}</BlurValue></td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--foreground)] xl:px-4">{c.fornecedores.length}</td>
                <td className="hidden px-3 py-3 text-right tabular-nums text-[var(--foreground)] lg:table-cell xl:px-4">{c.ciclos.length}</td>
                <td className="hidden px-3 py-3 text-right tabular-nums text-[var(--foreground)] lg:table-cell xl:px-4">{c.medicoes.length}</td>
              </Linha>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="historico-contratos-mobile">
        {itens.map((c) => (
          <ItemMobile
            key={c.id}
            onOpen={() => onOpen(c)}
            titulo={c.nome}
            meta={<span className="text-[11px] text-[var(--muted-foreground)]">{c.fornecedores.length} fornecedor(es) · {c.ciclos.length} ciclo(s)</span>}
            valor={<BlurValue>{brl.format(c.valorAtribuido)}</BlurValue>}
          />
        ))}
      </ul>
    </>
  );
}
