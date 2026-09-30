"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, ChevronRight, FileStack, Layers, UserCheck, UserX } from "lucide-react";
import { DashboardKpiCard } from "@/components/dashboard-pilot/dashboard-kpi-card";
import { Badge, BlurValue } from "@/components/ui";
import { normalizeTipoCondicaoFixa } from "@/lib/condicao-fixa";
import { normalizeFonteMedicao } from "@/lib/fonte-medicao";
import { PERFIL_LABEL_LOOSE as PERFIL_LABEL } from "@/lib/perfis";
import {
  VALIDADE_BADGE,
  condicaoLabel,
  fonteMedicaoLabel,
  money,
  type CadastroFornecedor,
  type Funcionario,
} from "@/components/administrativo/shared";

const number = new Intl.NumberFormat("pt-BR");

/** Resumo do cadastro mestre — derivado só da lista já carregada (nenhum endpoint novo). */
export function AdministrativoKpis({ items, loading = false }: { items: CadastroFornecedor[]; loading?: boolean }) {
  const ativos = items.filter((item) => item.ativo);
  const condicionais = ativos.filter((item) => normalizeTipoCondicaoFixa(item.tipoCondicaoFixa) === "CONDICIONAL_PRODUCAO").length;
  const auxiliares = ativos.filter((item) => normalizeFonteMedicao(item.fonteMedicao) === "DOCUMENTOS_AUXILIARES").length;
  // Antes do primeiro carregamento nunca afirma "0".
  const fmt = (value: number) => (loading && items.length === 0 ? "–" : number.format(value));
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" data-testid="administrativo-kpis">
      <DashboardKpiCard compact title="Fornecedores ativos" value={fmt(ativos.length)} detail="Cadastros administrativos ativos" icon={<UserCheck size={17} />} tone="success" />
      <DashboardKpiCard compact title="Inativos" value={fmt(items.length - ativos.length)} detail="Preservados para histórico" icon={<UserX size={17} />} tone="neutral" />
      <DashboardKpiCard compact title="Condição condicional" value={fmt(condicionais)} detail="Valor depende de produção no ciclo" icon={<Layers size={17} />} tone="brand" />
      <DashboardKpiCard compact title="Documentos auxiliares" value={fmt(auxiliares)} detail="Medidos pela aba BM AUX" icon={<FileStack size={17} />} tone="neutral" />
    </div>
  );
}

function StatusBadge({ ativo }: { ativo: boolean }) {
  return <Badge variant={ativo ? "success" : "neutral"}>{ativo ? "Ativo" : "Inativo"}</Badge>;
}

function CondicaoCell({ item }: { item: CadastroFornecedor }) {
  const condicional = normalizeTipoCondicaoFixa(item.tipoCondicaoFixa) === "CONDICIONAL_PRODUCAO";
  return (
    <div className="min-w-0">
      <p className="text-[var(--foreground)]">{condicaoLabel(item.tipoCondicaoFixa)}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-[var(--muted-foreground)]">
        {condicional
          ? <BlurValue>{`${money(item.valorCondicaoFixaComProducao)} / ${money(item.valorCondicaoFixaSemProducao)}`}</BlurValue>
          : item.valorCondicaoFixa !== null ? <BlurValue>{money(item.valorCondicaoFixa)}</BlurValue> : "Sem valor"}
      </p>
    </div>
  );
}

function openOnKey(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
    event.preventDefault();
    open();
  }
}

function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`text-table-header border-b border-[var(--border)] px-3 py-2.5 text-left text-[var(--muted-foreground)] xl:px-4 ${className}`}>{children}</th>;
}

/**
 * Cadastro mestre de fornecedores — tabela limpa, sem coluna de botões: a linha abre o detalhe,
 * onde ficam as ações. Checkbox de seleção só para ADMIN (exclusão definitiva em lote, como antes).
 */
export function FornecedoresCadastroTable({
  itens,
  isAdmin,
  selectedIds,
  allSelected,
  onToggleSelected,
  onToggleAll,
  onOpen,
}: {
  itens: CadastroFornecedor[];
  isAdmin: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (item: CadastroFornecedor) => void;
}) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="administrativo-tabela">
          <thead className="bg-[#FAFAF8]">
            <tr>
              {isAdmin && (
                <Th className="w-10 pr-0">
                  <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Selecionar todos os fornecedores filtrados" className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]" />
                </Th>
              )}
              <Th>Fornecedor</Th>
              <Th className="hidden min-[1400px]:table-cell">CNPJ</Th>
              <Th>Medição</Th>
              <Th className="hidden xl:table-cell">Condição</Th>
              <Th className="hidden xl:table-cell">Vigência</Th>
              <Th>Status</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr
                key={item.id}
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(event) => openOnKey(event, () => onOpen(item))}
                aria-label={`Abrir cadastro de ${item.responsavel}`}
                className={`cursor-pointer border-b border-[#EFEFED] transition-colors last:border-0 hover:bg-[#FAFAF8] focus-visible:bg-[#FAFAF8] focus-visible:outline-none ${selectedIds.has(item.id) ? "bg-[#FDF6F6]" : ""}`}
              >
                {isAdmin && (
                  <td className="w-10 py-3 pl-3 pr-0 xl:pl-4" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => onToggleSelected(item.id)}
                      aria-label={`Selecionar ${item.responsavel}`}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)]"
                    />
                  </td>
                )}
                <td className="px-3 py-3 xl:px-4">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="max-w-[220px] truncate font-semibold text-[var(--foreground)] xl:max-w-[300px]">{item.responsavel}</p>
                    {item.pendencias.length > 0 && (
                      <span className="shrink-0 text-[var(--warning)]" title={`Pendência: ${item.pendencias.join(", ")}`} aria-label="Possui pendência cadastral">
                        <AlertTriangle size={13} />
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 max-w-[220px] truncate text-[12px] text-[var(--muted-foreground)] xl:max-w-[300px]">{item.razaoSocial || "–"}</p>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 font-technical text-[12px] text-[var(--foreground)] xl:px-4 min-[1400px]:table-cell">{item.cnpj ?? "–"}</td>
                <td className="px-3 py-3 xl:px-4">
                  <span className={normalizeFonteMedicao(item.fonteMedicao) === "DOCUMENTOS_AUXILIARES" ? "font-semibold text-[var(--primary)]" : "text-[var(--foreground)]"}>
                    {fonteMedicaoLabel(item.fonteMedicao)}
                  </span>
                </td>
                <td className="hidden px-3 py-3 xl:table-cell xl:px-4"><CondicaoCell item={item} /></td>
                <td className="hidden px-3 py-3 xl:table-cell xl:px-4"><Badge variant={VALIDADE_BADGE[item.validadeTone]} className="whitespace-nowrap">{item.validadeLabel}</Badge></td>
                <td className="px-3 py-3 xl:px-4">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge ativo={item.ativo} />
                    {/* Sem a coluna Vigência (<1280px), a situação da vigência acompanha o status. */}
                    <span className="xl:hidden"><Badge variant={VALIDADE_BADGE[item.validadeTone]} className="whitespace-nowrap">{item.validadeLabel}</Badge></span>
                  </div>
                </td>
                <td className="px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="administrativo-lista-mobile">
        {itens.map((item) => (
          <li key={item.id} className="flex items-stretch">
            {isAdmin && (
              <label className="flex items-center pl-4">
                <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggleSelected(item.id)} aria-label={`Selecionar ${item.responsavel}`} className="h-4 w-4 accent-[var(--primary)]" />
              </label>
            )}
            <button type="button" onClick={() => onOpen(item)} aria-label={`Abrir cadastro de ${item.responsavel}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">{item.responsavel}</p>
                <p className="truncate text-[12px] text-[var(--muted-foreground)]">{item.razaoSocial || "–"}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusBadge ativo={item.ativo} />
                  <Badge variant={VALIDADE_BADGE[item.validadeTone]}>{item.validadeLabel}</Badge>
                  <span className="text-[11px] text-[var(--muted-foreground)]">{fonteMedicaoLabel(item.fonteMedicao)}</span>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Usuários internos — mesma listagem (antes em cards), linha abre o detalhe. */
export function FuncionariosTable({ itens, onOpen }: { itens: Funcionario[]; onOpen: (item: Funcionario) => void }) {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="administrativo-funcionarios-tabela">
          <thead className="bg-[#FAFAF8]">
            <tr>
              <Th>Funcionário</Th>
              <Th>Login</Th>
              <Th>Perfil</Th>
              <Th>Acesso</Th>
              <Th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr
                key={item.id}
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(event) => openOnKey(event, () => onOpen(item))}
                aria-label={`Abrir cadastro de ${item.nome}`}
                className="cursor-pointer border-b border-[#EFEFED] transition-colors last:border-0 hover:bg-[#FAFAF8] focus-visible:bg-[#FAFAF8] focus-visible:outline-none"
              >
                <td className="px-3 py-3 xl:px-4">
                  <p className="max-w-[280px] truncate font-semibold text-[var(--foreground)]">{item.nome}</p>
                  <p className="mt-0.5 max-w-[280px] truncate text-[12px] text-[var(--muted-foreground)]">{item.email ?? "Sem e-mail cadastrado"}</p>
                </td>
                <td className="px-3 py-3 font-technical text-[12px] text-[var(--foreground)] xl:px-4">{item.usuario}</td>
                <td className="px-3 py-3 text-[var(--foreground)] xl:px-4">{PERFIL_LABEL[item.perfil] ?? item.perfil}</td>
                <td className="px-3 py-3 xl:px-4">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge ativo={item.ativo} />
                    {item.primeiroLogin && <span className="text-[10px] text-[#92400E]">1º acesso pendente</span>}
                  </div>
                </td>
                <td className="px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="administrativo-funcionarios-lista-mobile">
        {itens.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen(item)} aria-label={`Abrir cadastro de ${item.nome}`} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">{item.nome}</p>
                <p className="truncate text-[12px] text-[var(--muted-foreground)]">{PERFIL_LABEL[item.perfil] ?? item.perfil} · <span className="font-technical">{item.usuario}</span></p>
                <div className="mt-1.5"><StatusBadge ativo={item.ativo} /></div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
