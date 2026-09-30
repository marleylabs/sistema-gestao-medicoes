"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Plus, Search } from "lucide-react";
import { contractParticipation, MapaItemActions, MapaPagamentoEditor, type Revisao } from "@/components/mapa-pagamento-table";
import type { ContratoResumo, DashboardData, MapaPagamentoItem, Profissional } from "@/components/types";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { formatCicloLabel } from "@/lib/ciclo";
import { getMapaPagamentoStatusMeta, getSgcDisplayStatusMeta, type SgcDisplayStatus, type SgcStatusEntry } from "@/lib/sgc-display-status";
import { FornecedorDrawer } from "./fornecedor-drawer";
import { displayStatusOf, FornecedoresKpis } from "./fornecedores-kpis";
import { FornecedoresTable } from "./fornecedores-table";

const CICLO_GERAL = "GERAL";
const ORDEM_STATUS: SgcDisplayStatus[] = ["AGUARDANDO_ENVIO", "AGUARDANDO", "DIVERGENCIA", "REVISAO_SOLICITADA", "AGUARDANDO_NF", "APROVADO", "PAGO", "CANCELADO"];

function cicloOptionLabel(ciclo: string) {
  try {
    return `${formatCicloLabel(ciclo)} · ${ciclo}`;
  } catch {
    return ciclo;
  }
}

/**
 * Tela operacional "Fornecedores" — a antiga "Operação por fornecedor" do Dashboard, com os mesmos
 * dados (GET /api/mapa-pagamento + GET /api/sgc/status), as mesmas ações (MapaItemActions) e o mesmo
 * cadastro/edição (MapaPagamentoEditor). Busca/filtros de status e alocação são só de apresentação.
 */
export function FornecedoresPage({
  itens,
  contratos,
  profissionais,
  revisoes,
  sgcStatus,
  isAdmin,
  ciclo,
  ciclos,
  contratoSelecionado,
  tiposPrecos,
  onCicloChange,
  onContratoChange,
  onChanged,
  onEnviarBm,
  onRetornarBm,
  onDivergenciaResolvida,
}: {
  itens: MapaPagamentoItem[];
  contratos: ContratoResumo[];
  profissionais: Profissional[];
  revisoes: Revisao[];
  sgcStatus: Record<string, SgcStatusEntry>;
  isAdmin: boolean;
  ciclo: string;
  ciclos: string[];
  contratoSelecionado: string;
  tiposPrecos: DashboardData["tiposPrecos"];
  onCicloChange: (ciclo: string) => void;
  onContratoChange: (contrato: string) => void;
  onChanged: () => Promise<void> | void;
  onEnviarBm: (colaboradorCodigo: string) => Promise<void>;
  onRetornarBm: (sgcId: string) => Promise<void>;
  onDivergenciaResolvida: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [alocacaoFiltro, setAlocacaoFiltro] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [editingItem, setEditingItem] = useState<MapaPagamentoItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const adicionarRef = useRef<HTMLDivElement>(null);
  const focarAdicionar = () => requestAnimationFrame(() => adicionarRef.current?.querySelector("button")?.focus());

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const revisaoMap = useMemo(() => new Map(revisoes.map((r) => [r.colaboradorCodigo, r])), [revisoes]);
  const statusDisponiveis = useMemo(() => {
    const presentes = new Set(itens.map((item) => displayStatusOf(item, sgcStatus)));
    return ORDEM_STATUS.filter((status) => presentes.has(status));
  }, [itens, sgcStatus]);
  const alocacoes = useMemo(
    () => Array.from(new Set(itens.map((item) => item.alocacao).filter((a): a is string => !!a))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [itens],
  );

  const filtrados = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    const result = itens.filter((item) => {
      const matchContrato = contratoSelecionado ? contractParticipation(item, contratoSelecionado, contratos) > 0 : true;
      const matchStatus = statusFiltro ? displayStatusOf(item, sgcStatus) === statusFiltro : true;
      const matchAlocacao = alocacaoFiltro ? item.alocacao === alocacaoFiltro : true;
      const searchable = [item.ato, item.projetistaCodigo, item.responsavel, item.cpfCnpj, item.razaoSocial, item.fornecedor?.cpfCnpj, item.fornecedor?.razaoSocial]
        .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return matchContrato && matchStatus && matchAlocacao && (!q || searchable.includes(q));
    });
    // Mesmas opções/regras de ordenação da antiga tabela "Pagamentos por fornecedor".
    if (!sortOrder) return result;
    if (sortOrder === "asc" || sortOrder === "desc") {
      return [...result].sort((a, b) => {
        const cmp = (a.responsavel ?? a.projetistaCodigo ?? "").localeCompare(b.responsavel ?? b.projetistaCodigo ?? "", "pt-BR", { sensitivity: "base" });
        return sortOrder === "desc" ? -cmp : cmp;
      });
    }
    return [...result].sort((a, b) => {
      const aValid = typeof a.valor === "number" && Number.isFinite(a.valor);
      const bValid = typeof b.valor === "number" && Number.isFinite(b.valor);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return sortOrder === "valor-desc" ? b.valor - a.valor : a.valor - b.valor;
    });
  }, [itens, search, contratoSelecionado, contratos, statusFiltro, alocacaoFiltro, sgcStatus, sortOrder]);

  const detalhe = detalheId ? itens.find((item) => item.id === detalheId) ?? null : null;
  // Modo do painel lateral: "details" (drawer compacto) ou "edit-payment" (editor largo do mesmo fornecedor).
  const editandoDoDetalhe = !!(editingItem && detalhe && editingItem.id === detalhe.id);
  const contextoEditor = (item: MapaPagamentoItem) => {
    const entry = sgcStatus[item.projetistaCodigo ?? ""];
    const meta = getMapaPagamentoStatusMeta(entry?.status ?? "AGUARDANDO_ENVIO", entry?.statusConferencia);
    return { nome: item.responsavel ?? item.projetistaCodigo, statusLabel: meta.label, statusBadge: meta.badge, cicloLabel: cicloOptionLabel(ciclo).split(" · ")[0] };
  };
  // Ações só no detalhe (drawer) — a tabela é leitura. Mesmas regras de sempre (MapaItemActions).
  const renderActions = (item: MapaPagamentoItem) => (
    <MapaItemActions
      item={item}
      itens={itens}
      sgcEntry={sgcStatus[item.projetistaCodigo ?? ""]}
      revisao={revisaoMap.get(item.projetistaCodigo ?? "")}
      revisoes={revisoes}
      isAdmin={isAdmin}
      onEnviarBm={onEnviarBm}
      onRetornarBm={onRetornarBm}
      onEdit={(alvo) => { setOpenDropdownId(null); setEditingItem(alvo); }}
      onChanged={onChanged}
      dropdownOpen={openDropdownId === item.id}
      onToggleDropdown={() => setOpenDropdownId(openDropdownId === item.id ? null : item.id)}
      onOpenDropdownFor={setOpenDropdownId}
      ciclo={ciclo}
    />
  );

  return (
    <div className="grid gap-6 pb-24">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
        <PageHeader eyebrow="Operação" title="Fornecedores" description="Gestão operacional dos fornecedores e das medições do ciclo." />
        {isAdmin && (
          // "GERAL" nunca é um ciclo real — mesma trava de sempre (o backend também rejeita).
          <div ref={adicionarRef} className="shrink-0" title={ciclo === CICLO_GERAL ? "Selecione um ciclo específico (não \"Geral\") para cadastrar um novo pagamento." : undefined}>
            <Button onClick={() => setIsCreating(true)} disabled={ciclo === CICLO_GERAL}>
              <Plus size={15} />
              Adicionar
            </Button>
          </div>
        )}
      </div>

      <FornecedoresKpis itens={itens} statuses={sgcStatus} />

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[#FAFAF8] px-5 py-3">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Fluxo medição</span>
          {[
            { label: "Envio do BM", bg: "bg-[#F3F4F6]", color: "text-[#555555]" },
            { label: "Validação", bg: "bg-[#FFFBEB]", color: "text-[#D97706]" },
            { label: "Conclusão", bg: "bg-[#F0FDF4]", color: "text-[#16A34A]" },
          ].map((etapa, index, lista) => (
            <div key={etapa.label} className="flex items-center gap-1">
              <span className={`rounded-lg ${etapa.bg} px-2.5 py-1 text-[11px] font-semibold ${etapa.color}`}>{etapa.label}</span>
              {index < lista.length - 1 && <ArrowRight size={12} className="text-[#9CA3AF]" />}
            </div>
          ))}
        </div>

        <div className="grid gap-3 border-b border-[var(--border)] px-5 py-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-[minmax(220px,1.6fr)_repeat(5,minmax(0,1fr))]">
          <label className="grid gap-1.5 text-label text-[var(--muted-foreground)] sm:col-span-2 md:col-span-3 xl:col-span-1">
            Pesquisar
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
              <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, código ou empresa" />
            </span>
          </label>
          <label className="grid gap-1.5 text-label text-[var(--muted-foreground)]">
            Ciclo
            <Select value={ciclo} onChange={(e) => onCicloChange(e.target.value)} aria-label="Ciclo">
              <option value={CICLO_GERAL}>Geral</option>
              {ciclos.map((c) => <option key={c} value={c}>{cicloOptionLabel(c)}</option>)}
              {ciclo !== CICLO_GERAL && !ciclos.includes(ciclo) && <option value={ciclo}>{cicloOptionLabel(ciclo)}</option>}
            </Select>
          </label>
          <label className="grid gap-1.5 text-label text-[var(--muted-foreground)]">
            Contrato
            <Select value={contratoSelecionado} onChange={(e) => onContratoChange(e.target.value)} aria-label="Contrato">
              <option value="">Todos</option>
              {contratos.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </Select>
          </label>
          <label className="grid gap-1.5 text-label text-[var(--muted-foreground)]">
            Status
            <Select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} aria-label="Status">
              <option value="">Todos</option>
              {statusDisponiveis.map((status) => (
                <option key={status} value={status}>{getSgcDisplayStatusMeta(status).label}</option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1.5 text-label text-[var(--muted-foreground)]">
            Alocação
            <Select value={alocacaoFiltro} onChange={(e) => setAlocacaoFiltro(e.target.value)} aria-label="Alocação">
              <option value="">Todas</option>
              {alocacoes.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </label>
          <label className="grid gap-1.5 text-label text-[var(--muted-foreground)]">
            Ordenar por
            <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} aria-label="Ordenar por">
              <option value="">Ordem padrão</option>
              <option value="asc">Nome — A a Z</option>
              <option value="desc">Nome — Z a A</option>
              <option value="valor-desc">Maior valor</option>
              <option value="valor-asc">Menor valor</option>
            </Select>
          </label>
        </div>

        <FornecedoresTable
          itens={filtrados}
          contratos={contratos}
          sgcStatus={sgcStatus}
          onOpen={(item) => setDetalheId(item.id)}
        />

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted-foreground)]">
          <span>{filtrados.length === itens.length ? `${itens.length} fornecedores` : `${filtrados.length} de ${itens.length} fornecedores`}</span>
          <span className="font-technical text-[11px]">{ciclo === CICLO_GERAL ? "Todos os ciclos" : cicloOptionLabel(ciclo)}</span>
        </div>
      </Card>

      {detalhe && !editandoDoDetalhe && (
        <FornecedorDrawer
          item={detalhe}
          contratos={contratos}
          sgcEntry={sgcStatus[detalhe.projetistaCodigo ?? ""]}
          ciclo={ciclo}
          tiposPrecos={tiposPrecos}
          actions={renderActions(detalhe)}
          onClose={() => { setDetalheId(null); setOpenDropdownId(null); }}
        />
      )}

      {isAdmin && (isCreating || editingItem) && (
        <MapaPagamentoEditor
          item={editingItem}
          ciclo={ciclo}
          profissionais={profissionais}
          contratos={contratos}
          contexto={editingItem ? contextoEditor(editingItem) : { cicloLabel: cicloOptionLabel(ciclo).split(" · ")[0] }}
          // Aberto pelo detalhe: Voltar/Cancelar/Esc retornam ao detalhe; o X fecha tudo.
          onBack={editandoDoDetalhe ? () => setEditingItem(null) : undefined}
          onClose={() => {
            const eraCadastro = isCreating;
            setIsCreating(false);
            setEditingItem(null);
            setDetalheId(null);
            if (eraCadastro) focarAdicionar();
          }}
          onSaved={async (mensagem, id) => {
            // Edição a partir do detalhe: volta ao detalhe (atualizado por onChanged).
            // Cadastro: abre o detalhe do fornecedor recém-criado, já na lista atualizada.
            const eraCadastro = isCreating;
            setIsCreating(false);
            setEditingItem(null);
            setToast(mensagem);
            await onChanged();
            if (eraCadastro && id) setDetalheId(id);
          }}
          onDivergenciaResolvida={onDivergenciaResolvida}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-lg bg-[#16A34A] px-4 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
