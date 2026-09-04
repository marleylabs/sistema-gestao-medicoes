"use client";

import { type ReactNode, useCallback, useEffect, useRef, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCheck, Edit3, MessageCircle, Mic, Plus, RotateCcw, Search, Send, StopCircle, Trash2, X } from "lucide-react";
import { Badge, BlurValue, Button, Card, Field, IconButton, Input, Select, Textarea } from "@/components/ui";
import type { ContratoResumo, MapaPagamentoItem, Profissional } from "@/components/types";
import { getMapaPagamentoDisplayStatus } from "@/lib/sgc-display-status";
import { resolveCondicaoFixa, toCondicaoFixaConfig } from "@/lib/condicao-fixa";

type Revisao = {
  id: string;
  colaboradorCodigo: string;
  colaboradorNome: string | null;
  status?: string;
  proximaRevisaoLabel: string;
  pontosDiscordancia: string | null;
  respostaAdmin: string | null;
  observacaoColaborador: string | null;
  mensagens: SgcChatMessage[];
  revisaoSolicitadaAt: string | null;
  colaboradorAvatarUrl?: string | null;
  colaboradorOnline?: boolean;
};

type SgcChatMessage = {
  id: string;
  autor: "MEDICAO" | "FORNECEDOR";
  autorNome: string;
  autorAvatarUrl: string | null;
  texto: string;
  tipo: "TEXTO" | "AUDIO";
  audioUrl: string | null;
  audioMime: string | null;
  audioNome: string | null;
  lidoAt: string | null;
  criadoAt: string;
  enviando?: boolean;
};

type SgcStatusEntry = {
  status: string;
  revisaoNumero: number;
  id: string;
  statusConferencia?: string;
};

type DivergenciaLinha = {
  id: string;
  nrVale: string;
  idMedicaoExistente: string | null;
  documentoNaoMapeado: boolean;
  comparacaoAmbigua: boolean;
  formatoDivergente: boolean;
  a1eqDivergente: boolean;
  emissaoDivergente: boolean;
  tipoDivergente: boolean;
  equipe: { formato: string | null; a1eqHh: number | null; percentualEmissao: number | null; tipo: string | null };
  fornecedor: { formato: string; a1eqHh: number; percentualEmissao: number; tipo: string };
  status: "PENDENTE" | "INCLUIDA" | "DESCARTADA";
  observacao: string | null;
  resolvidoPorNome: string | null;
  resolvidoEm: string | null;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function normalizeText(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function money(value: number) {
  return value ? currency.format(value) : "–";
}

function hasUnreadFornecedorMessages(messages: SgcChatMessage[]) {
  return messages.some((message) => message.autor === "FORNECEDOR" && !message.lidoAt);
}

function ChatReceipt({ read, sending }: { read: boolean; sending?: boolean }) {
  if (sending) return <Check size={13} className="text-[#9CA3AF]" />;
  return <CheckCheck size={13} className={read ? "text-[#2563EB]" : "text-[#9CA3AF]"} />;
}

function chatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function conversationTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function initials(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function ChatAvatar({
  name,
  src,
  unread,
  className = "h-9 w-9",
}: {
  name: string | null | undefined;
  src?: string | null;
  unread?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${className} ${unread ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#EFF6FF] text-[#2563EB]"}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

function latestMessage(revisao: Revisao) {
  return revisao.mensagens.at(-1) ?? null;
}

function currencyInputValue(value: number) {
  return currency.format(value || 0);
}

function formatCurrencyInput(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return currencyInputValue(0);
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return currencyInputValue(Number.isFinite(parsed) ? parsed : 0);
}

function parseCurrencyNumber(value: string) {
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(value: number) {
  return value ? percent.format(value) : "–";
}

/** Distingue "sem documento classificado nesse contrato" (undefined → "–") de "0% real" (documento existe, valor zero). */
function formatParticipacao(value: number | undefined) {
  return value === undefined ? "–" : percent.format(value / 100);
}

/**
 * Elegibilidade de um item para o filtro "Contrato" (toolbar) — usa a MESMA participação dinâmica
 * já calculada no backend (`item.participacaoContratos`, vindo de
 * lib/participacao-contratos.ts::getParticipacaoPorFornecedorCiclo) e já usada para exibir o
 * percentual por contrato nesta mesma tabela. Nunca mais os 4 contratos fixos hardcoded
 * (Intr. Sossego/Salobo/ACG/Escadas Alumar) — funciona com qualquer contrato descoberto no ciclo.
 */
function contractParticipation(item: MapaPagamentoItem, contrato: string, contratos: ContratoResumo[]) {
  const contratoId = contratos.find((c) => c.nome === contrato)?.id;
  if (!contratoId) return 0;
  return item.participacaoContratos?.[contratoId] ?? 0;
}

export function MapaPagamentoTable({
  itens,
  contratos = [],
  profissionais = [],
  selectedCodigo,
  selectedContrato,
  isAdmin = false,
  onChanged,
  revisoes = [],
  sgcStatus = {},
  onEnviarBm,
  onRetornarBm,
  onDivergenciaResolvida,
  ciclo = "2605",
}: {
  itens: MapaPagamentoItem[];
  contratos?: ContratoResumo[];
  profissionais?: Profissional[];
  selectedCodigo: string;
  selectedContrato: string;
  isAdmin?: boolean;
  onChanged?: () => Promise<void> | void;
  revisoes?: Revisao[];
  sgcStatus?: Record<string, SgcStatusEntry>;
  onEnviarBm?: (colaboradorCodigo: string) => Promise<void>;
  onRetornarBm?: (sgcId: string) => Promise<void>;
  /** Refresh imediato de sgcStatus (fora deste componente) depois de Incluir/Descartar. */
  onDivergenciaResolvida?: () => void;
  ciclo?: string;
}) {
  const [search, setSearch]           = useState("");
  const [sortOrder, setSortOrder]     = useState("");
  const [editingItem, setEditingItem] = useState<MapaPagamentoItem | null>(null);
  const [isCreating, setIsCreating]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [paymentToast, setPaymentToast] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [enviandoCodigo, setEnviandoCodigo] = useState<string | null>(null);
  const [retornandoId, setRetornandoId] = useState<string | null>(null);

  useEffect(() => {
    if (!paymentToast) return;
    const timer = setTimeout(() => setPaymentToast(null), 4000);
    return () => clearTimeout(timer);
  }, [paymentToast]);

  const revisaoMap = useMemo(
    () => new Map(revisoes.map((r) => [r.colaboradorCodigo, r])),
    [revisoes],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    const result = itens.filter((item) => {
      const matchColab       = selectedCodigo ? item.projetistaCodigo === selectedCodigo : true;
      const matchContract    = selectedContrato ? contractParticipation(item, selectedContrato, contratos) > 0 : true;
      const searchable       = [item.ato, item.projetistaCodigo, item.responsavel, item.cpfCnpj, item.razaoSocial, item.fornecedor?.cpfCnpj, item.fornecedor?.razaoSocial]
        .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return matchColab && matchContract && (!q || searchable.includes(q));
    });

    // "" ("Ordem padrão") = nenhuma ordenação adicional, mantém a ordem original recebida em
    // `itens` (mesma regra de sempre — só o nome/terminologia da opção mudou, nunca a ordem).
    if (!sortOrder) return result;

    if (sortOrder === "asc" || sortOrder === "desc") {
      return [...result].sort((a, b) => {
        const an = a.responsavel ?? a.projetistaCodigo ?? "";
        const bn = b.responsavel ?? b.projetistaCodigo ?? "";
        const cmp = an.localeCompare(bn, "pt-BR", { sensitivity: "base" });
        return sortOrder === "desc" ? -cmp : cmp;
      });
    }

    // Maior/menor valor usam `item.valor` — mesmo campo exibido na coluna "Pagamento" da tabela
    // (a medida de valor que a tela já mostra por fornecedor). Registro sem valor válido
    // (null/undefined/NaN) sempre vai para o final, nas duas direções — nunca deixa a ordenação
    // instável nem finge que "sem valor" é zero.
    return [...result].sort((a, b) => {
      const av = a.valor;
      const bv = b.valor;
      const aValid = typeof av === "number" && Number.isFinite(av);
      const bValid = typeof bv === "number" && Number.isFinite(bv);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return sortOrder === "valor-desc" ? bv - av : av - bv;
    });
  }, [itens, search, selectedCodigo, selectedContrato, sortOrder, contratos]);

  const filterDescription = selectedContrato
    ? `${filteredItems.length} participantes alocados em ${selectedContrato}`
    : `${filteredItems.length} participantes com pagamento no ciclo atual`;

  return (
    <Card className="overflow-hidden">
      {/* ── Fluxo do processo ── */}
      <div className="border-b border-[#E5E7EB] bg-[#FAFAFA] px-5 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Fluxo Medição</span>
          {[
            { label: "Envio do BM",  bg: "bg-[#F3F4F6]",  color: "text-[#555555]" },
            { label: "Validação",    bg: "bg-[#FFFBEB]",   color: "text-[#D97706]" },
            { label: "Conclusão",    bg: "bg-[#F0FDF4]",   color: "text-[#16A34A]" },
          ].map((s, i, arr) => (
            <div key={i} className="flex items-center gap-1">
              <span className={`rounded-lg ${s.bg} px-2.5 py-1 text-[11px] font-semibold ${s.color}`}>{s.label}</span>
              {i < arr.length - 1 && <ArrowRight size={12} className="text-[#9CA3AF]" />}
            </div>
          ))}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="border-b border-[#E5E7EB] bg-white px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1A1A1A]">Pagamentos por fornecedor</h2>
            <p className="mt-0.5 text-sm text-[#555555]">{filterDescription}</p>
          </div>
          <div className="flex flex-1 flex-wrap items-end gap-3 xl:justify-end">
            <label className="grid min-w-[200px] flex-1 gap-1.5 text-label text-[var(--muted-foreground)]">
              Pesquisar
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
                <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, nome ou empresa" />
              </span>
            </label>
            <label className="grid min-w-[160px] gap-1.5 text-label text-[var(--muted-foreground)]">
              Ordenar por
              <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="">Ordem padrão</option>
                <option value="asc">Nome — A a Z</option>
                <option value="desc">Nome — Z a A</option>
                <option value="valor-desc">Maior valor</option>
                <option value="valor-asc">Menor valor</option>
              </Select>
            </label>
            {isAdmin && (
              // "GERAL" é só o filtro do Dashboard para "ver todos os ciclos" — nunca um ciclo real
              // em que um pagamento possa existir. Criar aqui gerava um item com `ciclo: "GERAL"`
              // que a própria listagem (agregada por ciclos realmente cadastrados) nunca conseguia
              // exibir de novo — sucesso real no banco, invisível para sempre (bug crítico
              // corrigido também no backend, que agora rejeita essa criação de qualquer forma).
              <div className="relative shrink-0" title={ciclo === "GERAL" ? "Selecione um ciclo específico (não \"Geral\") para cadastrar um novo pagamento." : undefined}>
                <Button onClick={() => setIsCreating(true)} disabled={ciclo === "GERAL"} className="shrink-0">
                  <Plus size={15} />
                  Adicionar
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Payment modal ── */}
      {isAdmin && (isCreating || editingItem) && (
        <PaymentModal
          item={editingItem}
          ciclo={ciclo}
          saving={saving}
          profissionais={profissionais}
          contratos={contratos}
          onCancel={() => { setIsCreating(false); setEditingItem(null); }}
          onSave={async (payload) => {
            setSaving(true);
            try {
              const url = editingItem ? `/api/mapa-pagamento/${editingItem.id}` : "/api/mapa-pagamento";
              const res = await fetch(url, {
                method: editingItem ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, ciclo }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || "Não foi possível cadastrar o pagamento. Tente novamente.");
              }
              const wasCreating = !editingItem;
              setIsCreating(false);
              setEditingItem(null);
              setPaymentToast(wasCreating ? "Pagamento cadastrado com sucesso." : "Pagamento atualizado com sucesso.");
              await onChanged?.();
            } finally {
              setSaving(false);
            }
          }}
          onDivergenciaResolvida={onDivergenciaResolvida}
        />
      )}

      {/* ── Table ── */}
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1380px] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F9FAFB]">
              {[
                // "Alocação" NÃO foi renomeada para "Contrato": auditei a fonte (lib/mapa-pagamento.ts)
                // e esta coluna mostra `cadastro?.tipoCt` (Tipo CT do cadastro administrativo do
                // fornecedor) — nunca um contrato real. Renomear para "Contrato" seria exatamente a
                // troca de rótulo sem alinhar o dado que a tarefa pediu para nunca fazer.
                { label: "Alocação", align: "left" },
                { label: "Nome", align: "left" },
                { label: "CNPJ", align: "left" },
                { label: "Razão social", align: "left" },
                ...contratos.map((c) => ({ label: c.nome, align: "right" as const })),
                { label: "Pagamento", align: "right" },
                { label: "Revisão", align: "right" },
                ...(isAdmin ? [{ label: "Ações", align: "right" }] : []),
              ].map(({ label, align }) => (
                <th
                  key={label}
                  className={`text-table-header border-b border-[#E5E7EB] px-4 py-2.5 text-[var(--muted-foreground)] text-${align}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, i) => {
              const codigo = item.projetistaCodigo ?? "";
              const revisao = revisaoMap.get(codigo);
              const hasRevisao = !!revisao;
              const dropdownOpen = openDropdownId === item.id;
              const sgcEntry = sgcStatus[codigo];
              const sgcStatusValue = sgcEntry?.status ?? "AGUARDANDO_ENVIO";
              const isRevisaoEnvio = sgcStatusValue === "REVISAO_SOLICITADA";
              const temAlteracao = isRevisaoEnvio && revisao?.revisaoSolicitadaAt && item.updatedAt
                ? new Date(item.updatedAt) > new Date(revisao.revisaoSolicitadaAt)
                : true;
              const enviando = enviandoCodigo === codigo;
              const isConcluido = ["APROVADO", "AGUARDANDO_NF", "PAGO"].includes(sgcStatusValue);
              const isPendente = sgcStatusValue === "PENDENTE";
              // Fonte única de verdade para "o que mostrar" (lib/sgc-display-status.ts) — nunca
              // reconstruir esta regra localmente de novo (foi daí que veio o bug de status
              // "DIVERGÊNCIA" preso mesmo depois de resolvida a última divergência pendente).
              const isDivergente = getMapaPagamentoDisplayStatus(sgcStatusValue, sgcEntry?.statusConferencia) === "DIVERGENCIA";
              const podeEnviar = isAdmin && onEnviarBm && ["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"].includes(sgcStatusValue) && temAlteracao && !isConcluido;
              const podeRetornar = isAdmin && onRetornarBm && sgcEntry?.id && ["PENDENTE", "REVISAO_SOLICITADA"].includes(sgcStatusValue);

              return (
                <tr
                  key={item.id}
                  className={`border-b last:border-0 transition-colors ${
                    isConcluido
                      ? "border-[#BBF7D0] bg-[#F0FDF4] hover:bg-[#DCFCE7]"
                      : isDivergente
                      ? "border-[#FCA5A5] bg-[#FEF2F2] hover:bg-[#FEE2E2]"
                      : isPendente
                      ? "border-[#D1D5DB] bg-[#E5E7EB] hover:bg-[#D1D5DB]"
                      : hasRevisao
                      ? "border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7]"
                      : `border-[#F3F4F6] hover:bg-[#F9FAFB] ${i % 2 !== 0 ? "bg-[#FAFAFA]" : "bg-white"}`
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-[#1A1A1A]">{item.alocacao ?? "–"}</td>
                  <td className="px-4 py-3 font-semibold text-[#1A1A1A]">
                    <div className="flex items-center gap-2">
                      {item.responsavel ?? item.projetistaCodigo ?? "–"}
                      {isConcluido && (
                        <Badge variant="success" className="shrink-0">Concluído</Badge>
                      )}
                      {isPendente && (
                        isDivergente
                          ? <Badge variant="danger" className="shrink-0">Divergência</Badge>
                          : <Badge variant="neutral" className="shrink-0">Aguardando</Badge>
                      )}
                      {!isConcluido && !isPendente && hasRevisao && (
                        <Badge variant="warning" className="shrink-0">Revisão</Badge>
                      )}
                      {item.documentosPendentesContrato > 0 && (
                        <span
                          className="shrink-0 text-[#D97706]"
                          title={`${item.documentosPendentesContrato} documento(s) sem contrato (CTO) válido — ${money(item.valorNaoClassificadoContrato)} (${percent.format(item.percentualNaoClassificadoContrato / 100)}) do total ainda não classificado. Os contratos identificados abaixo continuam corretos.`}
                        >
                          <AlertTriangle size={13} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="font-technical px-4 py-3 text-[#555555]"><BlurValue>{item.fornecedor?.cpfCnpj ?? item.cpfCnpj ?? "–"}</BlurValue></td>
                  <td className="px-4 py-3 text-[#555555]">{item.fornecedor?.razaoSocial ?? item.razaoSocial ?? "–"}</td>
                  {contratos.map((c) => (
                    <td key={c.id} className="px-4 py-3 text-right tabular-nums text-[#555555]">
                      {formatParticipacao(item.participacaoContratos[c.id])}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#1A1A1A]"><BlurValue>{money(item.valor)}</BlurValue></td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">
                    {sgcEntry && sgcEntry.revisaoNumero > 0 ? `Rev. ${sgcEntry.revisaoNumero}` : "–"}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {podeRetornar && (
                          <Button
                            disabled={retornandoId === sgcEntry.id}
                            title="Retornar BM para aguardando envio"
                            onClick={async () => {
                              setRetornandoId(sgcEntry.id);
                              try { await onRetornarBm!(sgcEntry.id); } finally { setRetornandoId(null); }
                            }}
                            className="h-8 shrink-0 gap-1 whitespace-nowrap border border-[#FCA5A5] bg-[#FEF2F2] px-2 text-xs font-semibold !text-[#DC2626] hover:border-[#F87171] hover:bg-[#FEE2E2]"
                            variant="ghost"
                          >
                            <RotateCcw size={12} />
                            {retornandoId === sgcEntry.id ? "Retornando..." : "Retornar BM"}
                          </Button>
                        )}
                        {(podeEnviar || (isRevisaoEnvio && !temAlteracao)) && (
                          <Button
                            disabled={enviando || !temAlteracao}
                            title={
                              !temAlteracao
                                ? "Faça alguma alteração no pagamento antes de reenviar"
                                : isRevisaoEnvio
                                ? "Reenviar medição revisada"
                                : "Enviar BM para o fornecedor"
                            }
                            onClick={async () => {
                              setEnviandoCodigo(codigo);
                              try { await onEnviarBm!(codigo); } finally { setEnviandoCodigo(null); }
                            }}
                            className={`h-8 shrink-0 gap-1 whitespace-nowrap px-2 text-xs font-semibold ${
                              isRevisaoEnvio
                                ? "border border-[#FCD34D] bg-[#FFFBEB] !text-[#D97706] hover:bg-[#FEF3C7]"
                                : "border border-[#BFDBFE] bg-[#EFF6FF] !text-[#2563EB] hover:bg-[#DBEAFE]"
                            }`}
                            variant="ghost"
                          >
                            <Send size={12} />
                            {enviando ? "Enviando…" : isRevisaoEnvio ? "Reenviar BM" : "Enviar BM"}
                          </Button>
                        )}
                        {hasRevisao && (
                          <div className="relative">
                            <IconButton
                              className={hasUnreadFornecedorMessages(revisao.mensagens)
                                ? "border-[#86EFAC] bg-[#F0FDF4] text-[#16A34A] hover:border-[#22C55E] hover:bg-[#DCFCE7]"
                                : "border-[#FCD34D] bg-[#FFFBEB] text-[#D97706] hover:border-[#F59E0B] hover:bg-[#FEF3C7]"}
                              title="Ver comentário do fornecedor"
                              onClick={() => setOpenDropdownId(dropdownOpen ? null : item.id)}
                            >
                              <MessageCircle size={14} />
                            </IconButton>
                            {dropdownOpen && (
                              <ComentarioDropdown
                                revisao={revisao}
                                conversas={revisoes}
                                onClose={() => setOpenDropdownId(null)}
                                onRespondido={onChanged}
                                onSelectRevisao={(next) => {
                                  const target = itens.find((it) => it.projetistaCodigo === next.colaboradorCodigo);
                                  if (target) setOpenDropdownId(target.id);
                                }}
                                ciclo={ciclo}
                              />
                            )}
                          </div>
                        )}
                        <IconButton
                          className="hover:border-[#2563EB] hover:text-[#2563EB]"
                          title="Editar pagamento"
                          onClick={() => setEditingItem(item)}
                        >
                          <Edit3 size={14} />
                        </IconButton>
                        <IconButton
                          className="hover:border-[#DC2626] hover:text-[#DC2626]"
                          title="Excluir pagamento"
                          onClick={async () => {
                            if (!window.confirm("Excluir este pagamento?")) return;
                            const res = await fetch(`/api/mapa-pagamento/${item.id}`, { method: "DELETE" });
                            if (!res.ok) throw new Error("Falha ao excluir pagamento.");
                            await onChanged?.();
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!filteredItems.length && (
              <tr>
                <td colSpan={(isAdmin ? 7 : 6) + contratos.length} className="px-4 py-12 text-center text-sm text-[#9CA3AF]">
                  Nenhuma linha encontrada com os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paymentToast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-lg bg-[#16A34A] px-4 py-3 text-sm font-semibold text-white shadow-lg">
          {paymentToast}
        </div>
      )}
    </Card>
  );
}

// ─── ComentarioDropdown ───────────────────────────────────────────────────────

export function ComentarioDropdown({
  revisao,
  conversas = [revisao],
  onClose,
  onRespondido,
  onSelectRevisao,
  ciclo = "2605",
}: {
  revisao: Revisao;
  conversas?: Revisao[];
  onClose: () => void;
  onRespondido?: () => void;
  onSelectRevisao?: (revisao: Revisao) => void;
  ciclo?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const markedReadRef = useRef<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<(SgcChatMessage & { enviando?: boolean }) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unreadKey = revisao.mensagens.filter((message) => message.autor === "FORNECEDOR" && !message.lidoAt).map((message) => message.id).join(",");

  useEffect(() => {
    fetch("/api/usuario/me", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((profile: { avatarUrl?: string | null } | null) => setCurrentAvatarUrl(profile?.avatarUrl ?? null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  useEffect(() => {
    if (!unreadKey) return;
    const markKey = `${revisao.id}:${unreadKey}`;
    if (markedReadRef.current === markKey) return;
    markedReadRef.current = markKey;
    fetch("/api/sgc/chat/lido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sgcId: revisao.id }),
    }).then(() => onRespondido?.()).catch(() => undefined);
  }, [onRespondido, revisao.id, unreadKey]);

  async function enviarResposta() {
    const texto = resposta.trim();
    if (!texto || revisao.status !== "REVISAO_SOLICITADA") return;
    setPendingMessage({
      id: "pending-admin-message",
      autor: "MEDICAO",
      autorNome: "Equipe de Medição",
      autorAvatarUrl: currentAvatarUrl,
      texto,
      tipo: "TEXTO",
      audioUrl: null,
      audioMime: null,
      audioNome: null,
      lidoAt: null,
      criadoAt: new Date().toISOString(),
      enviando: true,
    });
    setEnviando(true);
    await fetch("/api/sgc/responder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colaboradorCodigo: revisao.colaboradorCodigo, resposta: texto, ciclo }),
    });
    setEnviando(false);
    setPendingMessage(null);
    setResposta("");
    onRespondido?.();
  }

  async function enviarAudio(blob: Blob) {
    if (revisao.status !== "REVISAO_SOLICITADA") return;
    const localUrl = URL.createObjectURL(blob);
    setPendingMessage({
      id: "pending-admin-audio",
      autor: "MEDICAO",
      autorNome: "Equipe de Medição",
      autorAvatarUrl: currentAvatarUrl,
      texto: "Áudio",
      tipo: "AUDIO",
      audioUrl: localUrl,
      audioMime: blob.type || "audio/webm",
      audioNome: "audio.webm",
      lidoAt: null,
      criadoAt: new Date().toISOString(),
      enviando: true,
    });
    const form = new FormData();
    form.append("sgcId", revisao.id);
    form.append("audio", blob, "audio.webm");
    await fetch("/api/sgc/chat/audio", { method: "POST", body: form });
    URL.revokeObjectURL(localUrl);
    setPendingMessage(null);
    onRespondido?.();
  }

  async function toggleGravacao() {
    if (gravando) {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setGravando(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (blob.size > 0) void enviarAudio(blob);
    };
    recorder.start();
    setGravando(true);
  }

  const mensagens = pendingMessage ? [...revisao.mensagens, pendingMessage] : revisao.mensagens;
  const lastMessageKey = mensagens.at(-1)?.id ?? revisao.id;
  const filteredConversas = useMemo(() => {
    const term = normalizeText(chatSearch);
    if (!term) return conversas;
    return conversas.filter((conversa) => {
      const latest = latestMessage(conversa);
      return [
        conversa.colaboradorCodigo,
        conversa.colaboradorNome,
        latest?.texto,
      ].some((value) => normalizeText(value ?? null).includes(term));
    });
  }, [chatSearch, conversas]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessageKey, revisao.id]);

  return (
    <div
      ref={ref}
      className="fixed bottom-5 right-5 z-50 grid h-[min(560px,calc(100vh-40px))] min-h-0 w-[min(860px,calc(100vw-24px))] grid-cols-1 overflow-hidden rounded-xl border border-[#D1D5DB] bg-white shadow-2xl md:grid-cols-[300px_1fr]"
    >
      <aside className="hidden min-h-0 min-w-0 border-r border-[#E5E7EB] bg-white md:flex md:flex-col">
        <div className="border-b border-[#E5E7EB] px-4 py-3">
          <p className="text-base font-bold text-[#1A1A1A]">Conversas</p>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-xs text-[#9CA3AF]">
            <Search size={14} />
            <input
              className="min-w-0 flex-1 bg-transparent text-xs text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF]"
              placeholder="Pesquise usuário ou mensagem"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredConversas.length ? filteredConversas.map((conversa) => {
            const latest = latestMessage(conversa);
            const unread = hasUnreadFornecedorMessages(conversa.mensagens);
            const active = conversa.id === revisao.id;
            return (
              <button
                key={conversa.id}
                className={`flex w-full gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left transition ${active ? "bg-[#EFF6FF]" : "hover:bg-[#F9FAFB]"}`}
                onClick={() => onSelectRevisao?.(conversa)}
              >
                <ChatAvatar
                  name={conversa.colaboradorNome ?? conversa.colaboradorCodigo}
                  src={conversa.colaboradorAvatarUrl}
                  unread={unread}
                  className="h-10 w-10"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-[#1A1A1A]">{conversa.colaboradorNome ?? conversa.colaboradorCodigo}</p>
                    <span className="shrink-0 text-[10px] text-[#9CA3AF]">{conversationTime(latest?.criadoAt ?? conversa.revisaoSolicitadaAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[#6B7280]">{latest?.texto ?? "Sem mensagens."}</p>
                </div>
              </button>
            );
          }) : (
            <p className="px-4 py-6 text-sm text-[#9CA3AF]">Nenhuma conversa encontrada.</p>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChatAvatar
              name={revisao.colaboradorNome ?? revisao.colaboradorCodigo}
              src={revisao.colaboradorAvatarUrl}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#1A1A1A]">{revisao.colaboradorNome ?? revisao.colaboradorCodigo}</p>
              <p className={`text-xs ${revisao.colaboradorOnline ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>
                {revisao.colaboradorOnline ? "online" : "offline"}
              </p>
            </div>
          </div>
          <button className="rounded-full p-1 text-[#9CA3AF] hover:bg-white hover:text-[#1A1A1A]" onClick={onClose} aria-label="Fechar chat">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F3F4F6] px-4 py-4">
          {mensagens.length ? (
            mensagens.map((mensagem) => {
              const isMedicao = mensagem.autor === "MEDICAO";
              return (
                <div key={mensagem.id} className={`flex items-end gap-2 ${isMedicao ? "justify-end" : "justify-start"}`}>
                  {!isMedicao && (
                    <ChatAvatar
                      name={mensagem.autorNome}
                      src={mensagem.autorAvatarUrl ?? revisao.colaboradorAvatarUrl}
                      className="h-7 w-7 text-[10px]"
                    />
                  )}
                  <div className={`max-w-[82%] rounded-xl px-3 py-2 text-sm shadow-sm ${isMedicao ? "rounded-br-sm bg-[#DCFCE7] text-[#14532D]" : "rounded-bl-sm bg-white text-[#1A1A1A]"}`}>
                    <p className={`mb-1 text-[11px] font-bold ${isMedicao ? "text-[#15803D]" : "text-[#2563EB]"}`}>
                      {mensagem.autorNome}
                    </p>
                    {mensagem.tipo === "AUDIO" && mensagem.audioUrl ? (
                      <div className="min-w-52">
                        <audio controls preload="metadata" src={mensagem.audioUrl} className="h-9 w-full" />
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{mensagem.texto}</p>
                    )}
                    <div className={`mt-1.5 flex items-center gap-1 text-[10px] font-semibold opacity-70 ${isMedicao ? "justify-end" : "justify-start"}`}>
                      <span>{chatTime(mensagem.criadoAt)}</span>
                      {isMedicao && <ChatReceipt read={!!mensagem.lidoAt} sending={mensagem.enviando} />}
                    </div>
                  </div>
                  {isMedicao && (
                    <ChatAvatar
                      name={mensagem.autorNome}
                      src={mensagem.autorAvatarUrl ?? currentAvatarUrl}
                      className="h-7 w-7 text-[10px]"
                    />
                  )}
                </div>
              );
            })
          ) : (
            <p className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-3 py-4 text-center text-sm text-[#6B7280]">
              Nenhuma mensagem registrada nesta revisão.
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-[#E5E7EB] bg-white p-3">
          {revisao.status === "REVISAO_SOLICITADA" ? (
            <div className="flex items-end gap-2">
              <textarea
                className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                placeholder="Digite uma nova mensagem..."
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
              />
              <Button
                variant={gravando ? "danger" : "secondary"}
                className="h-11 shrink-0 px-3"
                onClick={toggleGravacao}
                title={gravando ? "Parar gravação" : "Enviar áudio"}
              >
                {gravando ? <StopCircle size={15} /> : <Mic size={15} />}
              </Button>
              <Button className="h-11 shrink-0 px-4" onClick={enviarResposta} disabled={enviando || !resposta.trim()}>
                <Send size={13} />
                {enviando ? "..." : "Enviar"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-center text-sm font-medium text-[#6B7280]">
              Conversa encerrada. O histórico permanece disponível para consulta.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

type DocLine = {
  _key: string;
  id?: string;
  se: string;
  contrato: string;
  numeroDocumento: string;
  formato: string;
  equivalenteA1Horas: string;
  percentualEmissao: string;
  tipo2: string;
  condicao: string;
  obs: string;
  _dirty: boolean;
};

function newDocLine(): DocLine {
  return {
    _key: Math.random().toString(36).slice(2),
    se: "", contrato: "", numeroDocumento: "", formato: "",
    equivalenteA1Horas: "0", percentualEmissao: "0", tipo2: "", condicao: "0",
    obs: "", _dirty: true,
  };
}

function docValorMedido(doc: DocLine): number {
  if (isDiscountDoc(doc)) return -Math.abs(parseCurrencyNumber(doc.condicao));
  const a1eq  = parseFloat(doc.equivalenteA1Horas) || 0;
  const pct   = (parseFloat(doc.percentualEmissao) || 0) / 100;
  const preco = parseFloat(doc.condicao) || 0;
  return a1eq * preco * pct;
}

function isDiscountDoc(doc: Pick<DocLine, "tipo2" | "se" | "numeroDocumento">) {
  return normalizeText(doc.tipo2) === "DESCONTO" || normalizeText(doc.se) === "DESCONTO" || normalizeText(doc.numeroDocumento) === "DESCONTO";
}

function newDiscountLine(): DocLine {
  return {
    _key: Math.random().toString(36).slice(2),
    se: "DESCONTO",
    contrato: "",
    numeroDocumento: "DESCONTO",
    formato: "",
    equivalenteA1Horas: "1",
    percentualEmissao: "100",
    tipo2: "DESCONTO",
    condicao: "0",
    obs: "",
    _dirty: true,
  };
}

type PaymentForm = {
  ato: string;
  projetistaCodigo: string;
  responsavel: string;
  cpfCnpj: string;
  razaoSocial: string;
  intrSossego: string;
  salobo: string;
  acg: string;
  escadasAlumar: string;
  horas: string;
  valor: string;
  rev: string;
  status: string;
  valorFixo: string;
  tipoContratacao: string;
  adicionaisFixos: string;
  observacoesContrato: string;
};

function paymentForm(item: MapaPagamentoItem | null): PaymentForm {
  const condicoesFixas = item?.condicoesFixas;
  const razaoSocial = item?.fornecedor?.razaoSocial ?? item?.razaoSocial ?? "";
  const cpfCnpj = item?.fornecedor?.cpfCnpj ?? item?.cpfCnpj ?? "";
  return {
    ato: item?.ato ?? "",
    projetistaCodigo: item?.projetistaCodigo ?? "",
    responsavel: item?.responsavel ?? "",
    cpfCnpj,
    razaoSocial,
    intrSossego: String(item?.intrSossego ?? 0),
    salobo: String(item?.salobo ?? 0),
    acg: String(item?.acg ?? 0),
    escadasAlumar: String(item?.escadasAlumar ?? 0),
    horas: String(item?.horas ?? 0),
    valor: currencyInputValue(item?.valor ?? 0),
    rev: String(item?.rev ?? 0),
    status: item?.status ?? "",
    valorFixo: condicoesFixas?.valorFixo ?? "",
    tipoContratacao: condicoesFixas?.tipoContratacao ?? "",
    adicionaisFixos: condicoesFixas?.adicionaisFixos ?? "",
    observacoesContrato: condicoesFixas?.observacoesContrato ?? "",
  };
}

function PaymentModal({
  item,
  ciclo,
  saving,
  profissionais,
  contratos,
  onCancel,
  onSave,
  onDivergenciaResolvida,
}: {
  item: MapaPagamentoItem | null;
  ciclo: string;
  saving: boolean;
  profissionais: Profissional[];
  contratos: ContratoResumo[];
  onCancel: () => void;
  onSave: (payload: PaymentForm) => Promise<void>;
  /** Chamado depois que Incluir/Descartar é confirmado com sucesso — deixa a linha de Pagamentos
   * por Fornecedor (fora deste modal) atualizar o badge de status sem esperar o próximo polling. */
  onDivergenciaResolvida?: () => void;
}) {
  const [form, setForm] = useState<PaymentForm>(() => paymentForm(item));
  const [codigoQuery, setCodigoQuery] = useState(item?.projetistaCodigo ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Correção da causa raiz de "fornecedor cadastrado não aparece no Nome": a lista de
  // `profissionais` do componente pai só é recarregada quando o ciclo muda ou um pagamento é
  // salvo — nunca ao simplesmente abrir este modal. Um fornecedor cadastrado no Administrativo
  // enquanto o Dashboard já estava aberto ficava invisível aqui até algum refresh não relacionado
  // acontecer. Busca uma cópia fresca assim que o modal monta, sem esperar F5; usa a prop como
  // fallback imediato para não piscar lista vazia enquanto a rede responde.
  const [profissionaisFrescos, setProfissionaisFrescos] = useState<Profissional[]>(profissionais);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/profissionais")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Profissional[] | null) => { if (!cancelado && data) setProfissionaisFrescos(data); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  // ── Document lines ──
  const [docs, setDocs] = useState<DocLine[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsSaving, setDocsSaving] = useState(false);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());

  const codigo = form.projetistaCodigo;

  useEffect(() => {
    if (!item || !codigo || !ciclo) return;
    setDocsLoading(true);
    fetch(`/api/mapa-pagamento/documentos?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
      .then((r) => r.json())
      .then((data: Array<{ id: string; se: string; contrato: string | null; numeroDocumento: string | null; formato: string | null; equivalenteA1Horas: number; percentualEmissao: number; tipo2: string | null; condicao: string | null; obs: string | null; }>) => {
        setDocs(data.map((d) => {
          const line = {
            _key: d.id,
            id: d.id,
            se: d.se ?? "",
            contrato: d.contrato ?? "",
            numeroDocumento: d.numeroDocumento ?? "",
            formato: d.formato ?? "",
            equivalenteA1Horas: String(d.equivalenteA1Horas),
            percentualEmissao: String(Math.round(d.percentualEmissao * 100)),
            tipo2: d.tipo2 ?? "",
            condicao: d.condicao ?? "0",
            obs: d.obs ?? "",
            _dirty: false,
          };
          return isDiscountDoc(line) ? { ...line, condicao: currencyInputValue(Math.abs(parseCurrencyNumber(line.condicao))) } : line;
        }));
      })
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, [item, codigo, ciclo]);

  // ── Divergências da conferência do fornecedor ──
  const [divergencias, setDivergencias] = useState<DivergenciaLinha[]>([]);
  const [divergenciasLoading, setDivergenciasLoading] = useState(false);
  const [observacoesDivergencia, setObservacoesDivergencia] = useState<Record<string, string>>({});
  const [resolvendoDivergenciaId, setResolvendoDivergenciaId] = useState<string | null>(null);
  const resolvendoDivergenciaRef = useRef(false);

  const loadDivergencias = useCallback(() => {
    if (!item || !codigo || !ciclo) return;
    setDivergenciasLoading(true);
    fetch(`/api/admin/conferencia?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
      .then((r) => r.json())
      .then((data: DivergenciaLinha[]) => setDivergencias(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setDivergenciasLoading(false));
  }, [item, codigo, ciclo]);

  useEffect(() => { loadDivergencias(); }, [loadDivergencias]);

  async function resolverDivergencia(id: string, acao: "incluir" | "descartar") {
    if (resolvendoDivergenciaRef.current) return;
    resolvendoDivergenciaRef.current = true;
    setResolvendoDivergenciaId(id);
    try {
      const res = await fetch(`/api/admin/conferencia/${id}/${acao}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observacao: observacoesDivergencia[id]?.trim() ?? "" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(payload.error ?? "Não foi possível concluir a ação. Tente novamente.");
        return;
      }
      loadDivergencias();
      onDivergenciaResolvida?.();
      // Documentos Medidos pode ter sido criado/atualizado — recarrega para refletir imediatamente.
      setDocsLoading(true);
      fetch(`/api/mapa-pagamento/documentos?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
        .then((r) => r.json())
        .then((data: Array<{ id: string; se: string; contrato: string | null; numeroDocumento: string | null; formato: string | null; equivalenteA1Horas: number; percentualEmissao: number; tipo2: string | null; condicao: string | null; obs: string | null; }>) => {
          setDocs(data.map((d) => {
            const line = {
              _key: d.id, id: d.id, se: d.se ?? "", contrato: d.contrato ?? "",
              numeroDocumento: d.numeroDocumento ?? "", formato: d.formato ?? "",
              equivalenteA1Horas: String(d.equivalenteA1Horas),
              percentualEmissao: String(Math.round(d.percentualEmissao * 100)),
              tipo2: d.tipo2 ?? "", condicao: d.condicao ?? "0", obs: d.obs ?? "", _dirty: false,
            };
            return isDiscountDoc(line) ? { ...line, condicao: currencyInputValue(Math.abs(parseCurrencyNumber(line.condicao))) } : line;
          }));
        })
        .catch(() => {})
        .finally(() => setDocsLoading(false));
    } finally {
      resolvendoDivergenciaRef.current = false;
      setResolvendoDivergenciaId(null);
    }
  }

  const documentosMedidos = docs.filter((doc) => !isDiscountDoc(doc));
  const descontos = docs.filter(isDiscountDoc);
  const totalDocsValorBruto = documentosMedidos.reduce((s, d) => s + docValorMedido(d), 0);
  const totalDescontos = descontos.reduce((s, d) => s + Math.abs(docValorMedido(d)), 0);
  const valorFixoBase = parseCurrencyNumber(form.valorFixo);
  const adicionaisFixos = parseCurrencyNumber(form.adicionaisFixos);
  const totalCondicoesFixas = valorFixoBase + adicionaisFixos;
  const valorPrevistoBase = totalCondicoesFixas + totalDocsValorBruto;
  const valorPrevistoLiquido = valorPrevistoBase - totalDescontos;

  // Fornecedor CONDICIONAL_PRODUCAO (ver lib/condicao-fixa.ts) — o valor fixo depende de "existem
  // documentos medidos" NESTE pagamento (linhas de Documentos Medidos já carregadas/adicionadas no
  // formulário, `totalDocsValorBruto`, a mesma definição usada pelo ETL em
  // generate_payment_map_from_measurements). Sempre recalculado ao vivo enquanto esse tipo de
  // condição está ativo — nunca um valor hardcoded por nome (era a exceção do Cristiano Jeferson,
  // hoje dado cadastral configurável por qualquer fornecedor via CadastroFornecedor).
  useEffect(() => {
    const target = normalizeText(form.projetistaCodigo || form.responsavel || codigoQuery);
    const matched = target
      ? profissionaisFrescos.find((p) => normalizeText(p.codigo) === target || normalizeText(p.nome) === target || normalizeText(p.nomeCompleto) === target)
      : undefined;
    if (!matched || matched.tipoCondicaoFixa !== "CONDICIONAL_PRODUCAO") return;
    const valorResolvido = resolveCondicaoFixa(toCondicaoFixaConfig(matched), totalDocsValorBruto > 0);
    if (valorResolvido == null) return;
    const nextValorFixo = currencyInputValue(valorResolvido);
    const nextTipoContratacao = matched.tipoContrato || "FIXO (PJ)";
    setForm((cur) => {
      if (cur.valorFixo === nextValorFixo && cur.tipoContratacao === nextTipoContratacao) return cur;
      return { ...cur, valorFixo: nextValorFixo, tipoContratacao: nextTipoContratacao };
    });
  }, [codigoQuery, form.projetistaCodigo, form.razaoSocial, form.responsavel, profissionaisFrescos, totalDocsValorBruto]);

  useEffect(() => {
    if (valorPrevistoBase <= 0 && totalDescontos <= 0) return;
    setForm((cur) => ({ ...cur, valor: currencyInputValue(valorPrevistoLiquido) }));
  }, [totalDescontos, valorPrevistoBase, valorPrevistoLiquido]);

  function updateDoc(key: string, field: keyof Omit<DocLine, "_key" | "id" | "_dirty">, value: string) {
    setDocs((cur) => cur.map((d) => d._key === key ? { ...d, [field]: value, _dirty: true } : d));
  }

  function updateDiscount(key: string, field: "obs" | "condicao", value: string) {
    setDocs((cur) => cur.map((d) => {
      if (d._key !== key) return d;
      return {
        ...d,
        se: "DESCONTO",
        numeroDocumento: "DESCONTO",
        tipo2: "DESCONTO",
        equivalenteA1Horas: "1",
        percentualEmissao: "100",
        [field]: field === "condicao" ? value.replace(/[^\d,.-]/g, "") : value,
        _dirty: true,
      };
    }));
  }

  async function saveDocLine(doc: DocLine) {
    setDocsSaving(true);
    try {
      const payload = {
        codigo,
        ciclo,
        se: doc.se,
        contrato: doc.contrato,
        numeroDocumento: doc.numeroDocumento,
        formato: doc.formato,
        equivalenteA1Horas: parseFloat(doc.equivalenteA1Horas) || 0,
        percentualEmissao: (parseFloat(doc.percentualEmissao) || 0) / 100,
        tipo2: doc.tipo2,
        condicao: isDiscountDoc(doc) ? String(-Math.abs(parseCurrencyNumber(doc.condicao))) : doc.condicao,
        obs: doc.obs || null,
      };

      if (doc.id) {
        const res = await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Não foi possível salvar a linha de documento.");
        }
        const updated = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: updated.id, _dirty: false } : d));
      } else {
        const res = await fetch("/api/mapa-pagamento/documentos", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Não foi possível salvar a linha de documento.");
        }
        const created = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: created.id, _dirty: false } : d));
      }
    } finally {
      setDocsSaving(false);
    }
  }

  async function deleteDocLine(doc: DocLine) {
    if (!doc.id) { setDocs((cur) => cur.filter((d) => d._key !== doc._key)); return; }
    setDeletingDocIds((s) => new Set(s).add(doc.id!));
    try {
      await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, { method: "DELETE" });
      setDocs((cur) => cur.filter((d) => d._key !== doc._key));
    } finally {
      setDeletingDocIds((s) => { const n = new Set(s); n.delete(doc.id!); return n; });
    }
  }

  const [savePaymentError, setSavePaymentError] = useState<string | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  async function handleSavePayment() {
    // Nunca deixar "Cadastrar"/"Salvar alterações" falhar em silêncio: antes, um erro ao salvar
    // uma linha de Documento/Desconto (ex.: "Fornecedor não encontrado" quando o código digitado
    // não bate com nenhum Profissional) virava uma promise rejeitada sem catch em nenhum lugar —
    // o clique parecia simplesmente não fazer nada (bug real encontrado nesta sessão).
    if (savingPayment) return; // duplo clique não dispara duas vezes
    setSavingPayment(true);
    setSavePaymentError(null);
    try {
      const shouldUseLiquidTotal = valorPrevistoBase > 0 || totalDescontos > 0;
      const finalForm = shouldUseLiquidTotal ? { ...form, valor: currencyInputValue(valorPrevistoLiquido) } : form;
      const dirtyDocs = docs.filter((doc) => doc._dirty);
      for (const doc of dirtyDocs) {
        await saveDocLine(doc);
      }
      await onSave(finalForm);
    } catch (err) {
      setSavePaymentError(err instanceof Error && err.message ? err.message : "Não foi possível cadastrar o pagamento. Tente novamente.");
    } finally {
      setSavingPayment(false);
    }
  }

  const suggestions = useMemo(() => {
    const q = codigoQuery.trim().toLowerCase();
    if (!q) return profissionaisFrescos.slice(0, 8);
    return profissionaisFrescos
      .filter((p) =>
        (p.codigo ?? "").toLowerCase().includes(q) ||
        (p.nome ?? "").toLowerCase().includes(q) ||
        (p.nomeCompleto ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [codigoQuery, profissionaisFrescos]);

  function selectProfissional(p: Profissional) {
    // CORREÇÃO CRÍTICA: fornecedores legados sem `Profissional.codigo` (import antigo nunca
    // preencheu essa coluna) caíam para "" aqui — o campo Nome ficava visualmente vazio após
    // selecionar, e salvar gravava `projetistaCodigo: null` silenciosamente (resolveProjetistaCodigo
    // trata "" como "nenhum código informado", não como erro). O próprio backend já usa `nome` como
    // identidade canônica de fallback nesses casos (ver lib/mapa-pagamento.ts:resolveProjetistaCodigo)
    // — espelha exatamente a mesma regra aqui, nunca grava uma identidade vazia.
    const identidade = p.codigo || p.nome || "";
    // Fonte PRIMÁRIA e ÚNICA: CadastroFornecedor real (join por colaboradorCodigo, vindo de
    // /api/profissionais) via `resolveCondicaoFixa` — nunca tabela hardcoded por nome. Para
    // CONDICIONAL_PRODUCAO o valor depende de `totalDocsValorBruto` (Documentos Medidos já
    // presentes no formulário nesse instante); o efeito dedicado acima mantém isso em sincronia
    // conforme documentos são carregados/adicionados/removidos.
    const valorResolvido = resolveCondicaoFixa(toCondicaoFixaConfig(p), totalDocsValorBruto > 0);
    setCodigoQuery(identidade);
    setForm((cur) => ({
      ...cur,
      projetistaCodigo: identidade,
      responsavel: p.nomeCompleto || p.nome || "",
      // Esta tela trabalha só com CNPJ (CPF nunca é a identidade de fornecedor aqui) — nunca usar
      // p.cpf, mesmo que preenchido.
      cpfCnpj: maskCpfCnpj(p.cnpj || cur.cpfCnpj),
      razaoSocial: p.razaoSocial || cur.razaoSocial,
      // Selecionar um fornecedor é uma troca EXPLÍCITA de identidade — nunca herda o valor do
      // fornecedor anterior (bug real: selecionar Mauricio, 8.640, depois trocar para alguém sem
      // condição fixa mantinha 8.640 na tela). Sempre reflete o fornecedor recém-selecionado:
      // valor real quando existe, "" quando não existe (nunca um resquício de state antigo).
      valorFixo: valorResolvido != null ? currencyInputValue(valorResolvido) : "",
      tipoContratacao: p.tipoContrato || "",
    }));
    setShowSuggestions(false);
  }

  function update(field: keyof PaymentForm, value: string) {
    setForm((cur) => ({ ...cur, [field]: value }));
  }

  useEffect(() => {
    // Mesma fonte primária de `selectProfissional` (CadastroFornecedor real, join por
    // colaboradorCodigo) — cobre o caso de o usuário digitar o código diretamente sem clicar numa
    // sugestão (fornecedores legados). CONDICIONAL_PRODUCAO já é tratado (sempre em sincronia) pelo
    // efeito dedicado acima — este aqui só preenche o caso FIXA, e só quando o campo está vazio
    // (nunca sobrescreve edição manual em andamento).
    const target = normalizeText(form.projetistaCodigo || form.responsavel || codigoQuery);
    const matched = target
      ? profissionaisFrescos.find((p) => normalizeText(p.codigo) === target || normalizeText(p.nome) === target || normalizeText(p.nomeCompleto) === target)
      : undefined;
    if (!matched || matched.tipoCondicaoFixa === "CONDICIONAL_PRODUCAO") return;
    const valorFixoReal = matched.valorCondicaoFixa;
    const tipoContratoReal = matched.tipoContrato;
    if (valorFixoReal == null && !tipoContratoReal) return;
    setForm((cur) => {
      if (parseCurrencyNumber(cur.valorFixo) > 0 && cur.tipoContratacao) return cur;
      return {
        ...cur,
        valorFixo: parseCurrencyNumber(cur.valorFixo) > 0
          ? cur.valorFixo
          : valorFixoReal != null
            ? currencyInputValue(valorFixoReal)
            : cur.valorFixo,
        tipoContratacao: cur.tipoContratacao || tipoContratoReal || "",
      };
    });
  }, [codigoQuery, form.projetistaCodigo, form.razaoSocial, form.responsavel, profissionaisFrescos]);

  function maskCpfCnpj(v: string) {
    const d = v.replace(/\D/g, "");
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  function maskPercent(v: string) {
    const d = v.replace(/[^\d,\.]/g, "").replace(",", ".");
    const n = parseFloat(d);
    if (isNaN(n)) return "";
    return String(Math.min(Math.max(n, 0), 100));
  }

  // close suggestions on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div className="ds-dialog min-h-screen w-full max-w-[1400px] overflow-hidden rounded-none border-0 sm:min-h-0 sm:rounded-[14px] sm:border">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A]">
              {item ? "Editar pagamento" : "Novo pagamento"}
            </h2>
            <p className="mt-0.5 text-sm text-[#555555]">
              {item ? "Atualize os dados do fornecedor no ciclo atual." : "Preencha os dados para cadastrar um novo fornecedor."}
            </p>
          </div>
          <IconButton onClick={onCancel} title="Fechar"><X size={16} /></IconButton>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 sm:p-5" style={{ maxHeight: "calc(100vh - 180px)" }}>

          {/* Seção: Identificação */}
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Identificação</p>
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Nome — autocomplete sobre Profissional (fonte espelhada de CadastroFornecedor pelo
                Administrativo; ver PaymentModal acima para o fetch fresco anti-cache). Ao
                selecionar, CNPJ/Razão social são preenchidos automaticamente (read-only abaixo). */}
            <MField label="Nome" className="sm:col-span-2">
              <div className="relative" ref={suggestionsRef}>
                <input
                  className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  placeholder="Buscar fornecedor..."
                  value={codigoQuery}
                  onChange={(e) => {
                    // codigoQuery (texto visível) e form.projetistaCodigo (valor realmente
                    // enviado) eram dois estados desacoplados — digitar sem clicar numa sugestão
                    // deixava projetistaCodigo vazio, e Documentos/Descontos adicionados depois
                    // falhavam (codigo ausente) sem nenhum aviso. Mantém os dois sincronizados
                    // para digitação livre também valer — resolveProjetistaCodigo() no backend
                    // ainda revalida contra Profissional antes de gravar, nunca aceita texto puro.
                    setCodigoQuery(e.target.value);
                    update("projetistaCodigo", e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 top-10 z-10 w-full overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white shadow-lg" style={{ maxHeight: "240px" }}>
                    {suggestions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#F5F5F5] border-b border-[#F3F4F6] last:border-0"
                        onMouseDown={() => selectProfissional(p)}
                      >
                        {/* Nome em destaque (nunca o código/ID) — razão social/CNPJ como pista extra
                            para distinguir homônimos, já que dois fornecedores podem ter o mesmo nome. */}
                        <span className="text-sm font-semibold text-[#1A1A1A]">{p.nomeCompleto || p.nome}</span>
                        {(p.razaoSocial || p.cnpj) && (
                          <span className="text-xs text-[#555555]">{p.razaoSocial}{p.razaoSocial && p.cnpj ? " · " : ""}{p.cnpj}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </MField>

            {/* CNPJ — somente leitura: fonte única é o cadastro administrativo (CadastroFornecedor/
                Profissional), preenchido ao selecionar o Nome. Editar CNPJ é responsabilidade do
                Painel Administrativo, nunca deste formulário (evita duas fontes de verdade). */}
            <MField label="CNPJ">
              <Input
                value={form.cpfCnpj}
                readOnly
                placeholder="Preenchido automaticamente"
                className="cursor-not-allowed bg-[#F9FAFB] text-[#555555]"
              />
            </MField>

            {/* Razão social — mesma regra: somente leitura, vem do cadastro administrativo. */}
            <MField label="Razão social">
              <Input
                value={form.razaoSocial}
                readOnly
                placeholder="Preenchida automaticamente"
                className="cursor-not-allowed bg-[#F9FAFB] text-[#555555]"
              />
            </MField>
          </div>

          {/* Seção: Participação por contrato — calculada automaticamente a partir dos Documentos Medidos (CTO + Valor Medido), não é mais editável manualmente. */}
          <p className="mb-3 mt-6 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Participação por contrato</p>
          {item && contratos.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {contratos.map((c) => {
                const percentual = item.participacaoContratos[c.id];
                return (
                  <div key={c.id} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                    <p className="text-xs font-semibold text-[#555555]">{c.nome}</p>
                    <p className="mt-0.5 text-sm font-bold text-[#1A1A1A]">{formatParticipacao(percentual)}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[#9CA3AF]">
              {item ? "Nenhum contrato identificado no ciclo." : "Calculado automaticamente após salvar e vincular documentos medidos."}
            </p>
          )}
          {item && item.documentosPendentesContrato > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[#B45309]">
              <AlertTriangle size={13} />
              {item.documentosPendentesContrato} documento(s) medido(s) sem contrato (CTO) válido — {money(item.valorNaoClassificadoContrato)} ({percent.format(item.percentualNaoClassificadoContrato / 100)} do total) ainda não classificado. Os percentuais acima já refletem essa pendência (não somam 100%).
            </p>
          )}

          {/* Seção: Condições fixas — simplificada: só "Valor fixo mensal/contratual" permanece
              editável aqui (mesmo campo de sempre, form.valorFixo / rawPayload.condicoesFixas.valorFixo
              — nenhuma propriedade nova). Tipo de contratação, Adicionais fixos e Observações de
              contrato deixaram de ter input nesta tela, mas continuam existindo no estado (carregados
              de condicoesFixas/import quando já preenchidos) e são enviados sem alteração no payload —
              nunca zerados só por não terem mais campo visível. O "Valor previsto líquido" que reunia
              esses três não faz mais sentido como card cheio para um valor só; a Seção Pagamento
              (Horas contabilizadas/Valor previsto/Revisão) foi removida por completo por ficar vazia
              — esses três continuam em form.horas/form.valor/form.rev e são enviados inalterados. */}
          <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Condições fixas</p>
              {totalCondicoesFixas > 0 && (
                <span className="rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-bold text-[#2563EB] ring-1 ring-[#BFDBFE]">
                  Base: {currency.format(totalCondicoesFixas)}
                </span>
              )}
            </div>
            <MField label="Valor fixo mensal/contratual" className="max-w-xs">
              <Input
                inputMode="decimal"
                value={form.valorFixo}
                onChange={(e) => update("valorFixo", e.target.value)}
                onBlur={(e) => update("valorFixo", currencyInputValue(parseCurrencyNumber(e.target.value)))}
                placeholder="R$ 0,00"
              />
            </MField>
          </div>

          {/* Seção: Descontos */}
          <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Descontos</p>
                <p className="mt-1 text-xs text-[#6B7280]">Inclua deduções que devem abater o valor previsto e o total medido.</p>
              </div>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#374151] transition hover:border-[#D1D5DB] hover:bg-[#F5F5F5]"
                onClick={() => setDocs((cur) => [...cur, newDiscountLine()])}
              >
                <Plus size={13} /> Adicionar desconto
              </button>
            </div>

            {descontos.length === 0 ? (
              <p className="mt-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#6B7280]">
                Nenhum desconto aplicado.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {descontos.map((desconto) => {
                  const isDeleting = desconto.id ? deletingDocIds.has(desconto.id) : false;
                  return (
                    <div key={desconto._key} className="grid gap-2 rounded-lg border border-[#FECACA] bg-white p-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                      <label className="grid gap-1 text-xs font-semibold text-[#7F1D1D]">
                        Descrição do desconto
                        <Input
                          value={desconto.obs}
                          onChange={(e) => updateDiscount(desconto._key, "obs", e.target.value)}
                          placeholder="Ex: retenção, ajuste, abatimento..."
                          className="border-[#FECACA] focus:border-[#DC2626] focus:ring-[#DC2626]/20"
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-[#7F1D1D]">
                        Valor do desconto
                        <Input
                          inputMode="decimal"
                          value={desconto.condicao}
                          onChange={(e) => updateDiscount(desconto._key, "condicao", e.target.value)}
                          onBlur={(e) => updateDiscount(desconto._key, "condicao", currencyInputValue(Math.abs(parseCurrencyNumber(e.target.value))))}
                          placeholder="R$ 0,00"
                          className="border-[#FECACA] font-semibold text-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20"
                        />
                      </label>
                      <div className="flex gap-1 sm:justify-end">
                        <button
                          type="button"
                          disabled={docsSaving}
                          className="rounded-lg border border-[#FECACA] px-3 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40"
                          onClick={() => saveDocLine(desconto)}
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          className="rounded-lg border border-[#FECACA] p-2 text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40"
                          onClick={() => deleteDocLine(desconto)}
                          title="Excluir desconto"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {totalDescontos > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-xs">
                <span className="font-semibold text-[#6B7280]">Total de descontos</span>
                <span className="font-bold text-[#DC2626]">- {currency.format(totalDescontos)}</span>
              </div>
            )}
          </div>

          {/* Seção: Divergências da medição (conferência do fornecedor) */}
          {!divergenciasLoading && divergencias.length > 0 && (
            <div className="mt-6 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Divergências da Medição</p>
                {(() => {
                  const pendentes = divergencias.filter((d) => d.status === "PENDENTE").length;
                  const resolvidas = divergencias.length - pendentes;
                  return (
                    <span className="text-xs text-[#7F1D1D]">
                      {divergencias.length} divergência{divergencias.length !== 1 ? "s" : ""} encontrada{divergencias.length !== 1 ? "s" : ""} — {pendentes} pendente{pendentes !== 1 ? "s" : ""}, {resolvidas} resolvida{resolvidas !== 1 ? "s" : ""}
                    </span>
                  );
                })()}
              </div>

              <div className="mt-3 grid gap-3">
                {divergencias.map((d) => {
                  const emResolucao = resolvendoDivergenciaId === d.id;
                  const observacaoAtual = observacoesDivergencia[d.id] ?? "";
                  const podeDescartar = observacaoAtual.trim().length > 0;
                  const campos: Array<{ label: string; equipe: string; fornecedor: string; divergente: boolean }> = [
                    { label: "Formato", equipe: d.equipe.formato ?? "–", fornecedor: d.fornecedor.formato, divergente: d.formatoDivergente },
                    { label: "A1eq/HH", equipe: d.equipe.a1eqHh === null ? "–" : String(d.equipe.a1eqHh), fornecedor: String(d.fornecedor.a1eqHh), divergente: d.a1eqDivergente },
                    { label: "% Emissão", equipe: d.equipe.percentualEmissao === null ? "–" : percent.format(d.equipe.percentualEmissao), fornecedor: percent.format(d.fornecedor.percentualEmissao), divergente: d.emissaoDivergente },
                    { label: "Tipo", equipe: d.equipe.tipo ?? "–", fornecedor: d.fornecedor.tipo, divergente: d.tipoDivergente },
                  ];

                  return (
                    <div key={d.id} className="rounded-lg border border-[#FECACA] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-technical text-sm font-bold text-[#1A1A1A]">{d.nrVale}</span>
                          {d.documentoNaoMapeado && <Badge variant="warning">Não mapeado pela Equipe</Badge>}
                          {d.comparacaoAmbigua && <Badge variant="danger">NR VALE duplicado — ambíguo</Badge>}
                          {d.status === "INCLUIDA" && <Badge variant="success">Incluída</Badge>}
                          {d.status === "DESCARTADA" && <Badge variant="neutral">Descartada</Badge>}
                        </div>
                      </div>

                      {d.status === "PENDENTE" && !d.comparacaoAmbigua && (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {campos.filter((c) => c.divergente || d.documentoNaoMapeado).map((c) => (
                            <div key={c.label} className="rounded-md bg-[#FEF2F2] px-2.5 py-1.5 text-xs">
                              <p className="font-semibold text-[#7F1D1D]">{c.label}</p>
                              <p className="text-[#555555]">Equipe: <span className="font-technical">{c.equipe}</span></p>
                              <p className="text-[#555555]">Fornecedor: <span className="font-technical">{c.fornecedor}</span></p>
                            </div>
                          ))}
                        </div>
                      )}

                      {d.status === "PENDENTE" ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Textarea
                            className="min-h-[38px] bg-white text-xs"
                            placeholder="Informe uma observação sobre esta divergência..."
                            value={observacaoAtual}
                            onChange={(e) => setObservacoesDivergencia((prev) => ({ ...prev, [d.id]: e.target.value }))}
                          />
                          <div className="flex items-center gap-2 self-end">
                            <Button
                              variant="secondary"
                              className="h-8 px-3 text-xs"
                              disabled={!podeDescartar || emResolucao}
                              onClick={() => resolverDivergencia(d.id, "descartar")}
                            >
                              {emResolucao ? "Descartando..." : "Descartar"}
                            </Button>
                            <Button
                              variant="success"
                              className="h-8 px-3 text-xs"
                              disabled={emResolucao}
                              onClick={() => resolverDivergencia(d.id, "incluir")}
                            >
                              {emResolucao ? "Incluindo..." : "Incluir"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-[#555555]">
                          <p><span className="font-semibold">{d.status === "INCLUIDA" ? "Incluído" : "Motivo"}:</span> {d.observacao || "—"}</p>
                          <p className="mt-0.5 text-[#9CA3AF]">Resolvido por {d.resolvidoPorNome ?? "—"}{d.resolvidoEm ? ` em ${new Date(d.resolvidoEm).toLocaleString("pt-BR")}` : ""}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seção: Documentos medidos */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Documentos medidos</p>
            <div className="flex items-center gap-3">
              {(valorPrevistoBase > 0 || totalDescontos > 0) && (
                <button
                  type="button"
                  className="rounded-md border border-[#2563EB]/30 bg-[#EFF6FF] px-3 py-1 text-xs font-semibold text-[#2563EB] hover:bg-[#DBEAFE]"
                  onClick={() => update("valor", formatCurrencyInput(String(valorPrevistoLiquido)))}
                >
                  Usar total ({currency.format(valorPrevistoLiquido)})
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F5F5]"
                onClick={() => setDocs((cur) => [...cur, newDocLine()])}
              >
                <Plus size={13} /> Adicionar linha
              </button>
            </div>
          </div>

          {docsLoading ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">Carregando documentos…</p>
          ) : docs.length === 0 && totalCondicoesFixas <= 0 ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">Nenhum documento. Clique em "Adicionar linha" para inserir.</p>
          ) : (
            <div className="mt-3 grid gap-4 pb-6">
              <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] pb-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                      {["SE", "CTO", "NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH", "Preço Unit.", "Valor Medido", "Observação", ""].map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-2 text-left font-semibold text-[#555555]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                  {totalCondicoesFixas > 0 && (
                    <tr className="border-b border-[#DBEAFE] bg-[#EFF6FF]/70 text-[#1D4ED8]">
                      <td className="px-2 py-2">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-[#2563EB] ring-1 ring-[#BFDBFE]">
                          Fixo
                        </span>
                      </td>
                      <td className="px-2 py-2 font-semibold text-[#2563EB]">
                        {form.tipoContratacao || "FIXO (PJ)"}
                      </td>
                      <td className="px-2 py-2 text-[#2563EB]" colSpan={6}>
                        Provento base contratual{adicionaisFixos > 0 ? " + adicionais fixos" : ""}
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-[#1D4ED8]">
                        {currency.format(totalCondicoesFixas)}
                      </td>
                      <td className="px-2 py-2 text-[#2563EB]">Base fixa</td>
                      <td className="px-2 py-2" />
                    </tr>
                  )}
                  {docs.map((doc) => {
                    const valorMedido = docValorMedido(doc);
                    const desconto = isDiscountDoc(doc);
                    const isDeleting = doc.id ? deletingDocIds.has(doc.id) : false;
                    if (desconto) {
                      return (
                        <tr key={doc._key} className="border-b border-[#FEE2E2] bg-white text-[#DC2626] last:border-0">
                          <td className="px-2 py-2">
                            <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-bold uppercase text-[#DC2626] ring-1 ring-[#FECACA]">
                              Desconto
                            </span>
                          </td>
                          <td className="px-2 py-2 text-[#DC2626]" colSpan={7}>
                            <span className="font-semibold">{doc.obs || "Desconto aplicado"}</span>
                          </td>
                          <td className="px-2 py-2 text-right font-bold text-[#DC2626]">
                            - {currency.format(Math.abs(valorMedido))}
                          </td>
                          <td className="px-2 py-2 text-[#DC2626]">Dedução</td>
                          <td className="px-2 py-2" />
                        </tr>
                      );
                    }
                    return (
                      <tr key={doc._key} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA]">
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-20 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.se} onChange={(e) => updateDoc(doc._key, "se", e.target.value)} placeholder="SE-001" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-24 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.contrato} onChange={(e) => updateDoc(doc._key, "contrato", e.target.value)} placeholder="CTO-X" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-24 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.numeroDocumento} onChange={(e) => updateDoc(doc._key, "numeroDocumento", e.target.value)} placeholder="NR-0001" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.formato} onChange={(e) => updateDoc(doc._key, "formato", e.target.value)} placeholder="A1" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.equivalenteA1Horas} onChange={(e) => updateDoc(doc._key, "equivalenteA1Horas", e.target.value)} placeholder="0" inputMode="decimal" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 pr-5 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.percentualEmissao} onChange={(e) => updateDoc(doc._key, "percentualEmissao", e.target.value)} placeholder="100" inputMode="decimal" />
                            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#9CA3AF]">%</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-28 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.tipo2} onChange={(e) => updateDoc(doc._key, "tipo2", e.target.value)} placeholder="Tipo" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#9CA3AF]">R$</span>
                            <input className="h-7 w-24 rounded border border-[#E5E7EB] pl-7 pr-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.condicao} onChange={(e) => updateDoc(doc._key, "condicao", e.target.value)} placeholder="0" inputMode="decimal" />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-[#1A1A1A]">
                          {currency.format(valorMedido)}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={`h-7 w-40 rounded border px-2 text-xs focus:outline-none focus:ring-1 ${doc._dirty ? "border-[#F59E0B]/60 bg-[#FFFBEB] placeholder:text-[#D97706]/60 focus:border-[#F59E0B] focus:ring-[#F59E0B]/30" : "border-[#E5E7EB] bg-white placeholder:text-[#D1D5DB] focus:border-[#2563EB] focus:ring-[#2563EB]/20"}`}
                            value={doc.obs}
                            onChange={(e) => updateDoc(doc._key, "obs", e.target.value)}
                            placeholder="Observação…"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={docsSaving}
                              className="rounded p-1 text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-40"
                              onClick={() => saveDocLine(doc)}
                              title="Salvar linha"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              className="rounded p-1 text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40"
                              onClick={() => deleteDocLine(doc)}
                              title="Excluir linha"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <div className="grid w-80 min-w-[280px] gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-xs shadow-sm">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-[#475569]">
                    <span>Condições fixas</span>
                    <span className="whitespace-nowrap text-right font-semibold text-[#1F2937]">{currency.format(totalCondicoesFixas)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-[#475569]">
                    <span>Documentos medidos</span>
                    <span className="whitespace-nowrap text-right font-semibold text-[#1F2937]">{currency.format(totalDocsValorBruto)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-[#475569]">
                    <span>Descontos</span>
                    <span className={`whitespace-nowrap text-right font-semibold ${totalDescontos > 0 ? "text-[#DC2626]" : "text-[#1F2937]"}`}>
                      - {currency.format(totalDescontos)}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-6 border-t border-[#E5E7EB] pt-2 text-sm">
                    <span className="font-bold text-[#111827]">Total medido líquido</span>
                    <span className="whitespace-nowrap text-right font-bold text-[#111827]">{currency.format(valorPrevistoLiquido)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E5E7EB] px-6 py-4">
          {savePaymentError && (
            <div className="mb-3 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#AF1B1B]">
              {savePaymentError}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel} disabled={saving || savingPayment}>Cancelar</Button>
            <Button onClick={handleSavePayment} disabled={saving || savingPayment || docsSaving}>
              {saving || savingPayment || docsSaving
                ? (item ? "Salvando…" : "Cadastrando…")
                : (item ? "Salvar alterações" : "Cadastrar")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 text-label text-[var(--muted-foreground)] ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
