"use client";

import { type ReactNode, useEffect, useRef, useMemo, useState } from "react";
import { ArrowRight, Check, CheckCheck, Edit3, MessageCircle, Mic, Plus, RotateCcw, Search, Send, StopCircle, Trash2, X } from "lucide-react";
import { Badge, BlurValue, Button, Card, Field, IconButton, Input, Select } from "@/components/ui";
import type { MapaPagamentoItem, Profissional } from "@/components/types";

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
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function normalizeText(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function statusLabel(item: MapaPagamentoItem) {
  return normalizeText(item.ato) === "PRODUCAO" ? "PRODUÇÃO" : "ATO";
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

function ratio(value: number) {
  return value ? percent.format(value) : "–";
}

function contractParticipation(item: MapaPagamentoItem, contrato: string) {
  const total = item.intrSossego + item.salobo + item.acg + item.escadasAlumar;
  const allocation = normalizeText(item.ato);
  const normalizedContrato = normalizeText(contrato);
  const isDirectAllocation = allocation === normalizedContrato;

  if (["INTR. SOSSEGO", "INTR SOSSEGO"].includes(normalizedContrato)) {
    return item.intrSossego > 0 ? item.intrSossego : isDirectAllocation ? 1 : 0;
  }
  if (normalizedContrato === "SALOBO") {
    return item.salobo > 0 ? item.salobo : isDirectAllocation ? 1 : 0;
  }
  if (normalizedContrato === "ACG") {
    return item.acg > 0 ? item.acg : isDirectAllocation ? 1 : 0;
  }
  if (["ESCADAS ALUMAR", "ESCADA ALUMAR"].includes(normalizedContrato)) {
    return item.escadasAlumar > 0 ? item.escadasAlumar : isDirectAllocation ? 1 : 0;
  }
  if (["NAO ALOCADO", "NÃO ALOCADO"].includes(normalizedContrato)) {
    const named = ["INTR. SOSSEGO", "SALOBO", "ACG", "ESCADAS ALUMAR"];
    return total === 0 && !named.includes(allocation) ? 1 : 0;
  }
  return 0;
}

export function MapaPagamentoTable({
  itens,
  profissionais = [],
  selectedCodigo,
  selectedContrato,
  isAdmin = false,
  onChanged,
  revisoes = [],
  sgcStatus = {},
  onEnviarBm,
  onRetornarBm,
  ciclo = "2605",
}: {
  itens: MapaPagamentoItem[];
  profissionais?: Profissional[];
  selectedCodigo: string;
  selectedContrato: string;
  isAdmin?: boolean;
  onChanged?: () => Promise<void> | void;
  revisoes?: Revisao[];
  sgcStatus?: Record<string, SgcStatusEntry>;
  onEnviarBm?: (colaboradorCodigo: string) => Promise<void>;
  onRetornarBm?: (sgcId: string) => Promise<void>;
  ciclo?: string;
}) {
  const [search, setSearch]           = useState("");
  const [status, setStatus]           = useState("");
  const [sortOrder, setSortOrder]     = useState("");
  const [editingItem, setEditingItem] = useState<MapaPagamentoItem | null>(null);
  const [isCreating, setIsCreating]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [enviandoCodigo, setEnviandoCodigo] = useState<string | null>(null);
  const [retornandoId, setRetornandoId] = useState<string | null>(null);

  const alocacoesUnicas = useMemo(
    () => [...new Set(itens.map((i) => i.ato).filter(Boolean) as string[])].sort(),
    [itens],
  );

  const revisaoMap = useMemo(
    () => new Map(revisoes.map((r) => [r.colaboradorCodigo, r])),
    [revisoes],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    const result = itens.filter((item) => {
      const s = statusLabel(item);
      const matchStatus      = status ? s === status : true;
      const matchColab       = selectedCodigo ? item.projetistaCodigo === selectedCodigo : true;
      const matchContract    = selectedContrato ? contractParticipation(item, selectedContrato) > 0 : true;
      const searchable       = [item.ato, item.projetistaCodigo, item.responsavel, item.cpfCnpj, item.razaoSocial]
        .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return matchStatus && matchColab && matchContract && (!q || searchable.includes(q));
    });

    if (!sortOrder) return result;
    return [...result].sort((a, b) => {
      const an = a.responsavel ?? a.projetistaCodigo ?? "";
      const bn = b.responsavel ?? b.projetistaCodigo ?? "";
      const cmp = an.localeCompare(bn, "pt-BR", { sensitivity: "base" });
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }, [itens, search, selectedCodigo, selectedContrato, sortOrder, status]);

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
            <label className="grid min-w-[200px] flex-1 gap-1.5 text-xs font-semibold text-[#555555]">
              Pesquisar
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
                <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, nome ou empresa" />
              </span>
            </label>
            <label className="grid min-w-[140px] gap-1.5 text-xs font-semibold text-[#555555]">
              Tipo de atuação
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="ATO">ATO</option>
                <option value="PRODUÇÃO">Produção</option>
              </Select>
            </label>
            <label className="grid min-w-[160px] gap-1.5 text-xs font-semibold text-[#555555]">
              Ordenar por nome
              <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="">Padrão da planilha</option>
                <option value="asc">A → Z</option>
                <option value="desc">Z → A</option>
              </Select>
            </label>
            {isAdmin && (
              <Button onClick={() => setIsCreating(true)} className="shrink-0">
                <Plus size={15} />
                Adicionar
              </Button>
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
          alocacoes={alocacoesUnicas}
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
              if (!res.ok) throw new Error("Falha ao salvar pagamento.");
              setIsCreating(false);
              setEditingItem(null);
              await onChanged?.();
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {/* ── Table ── */}
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1380px] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F9FAFB]">
              {[
                { label: "Alocação", align: "left" },
                { label: "Projetista", align: "left" },
                { label: "CPF / CNPJ", align: "left" },
                { label: "Razão social", align: "left" },
                { label: "Intr. Sossego", align: "right" },
                { label: "Salobo", align: "right" },
                { label: "ACG", align: "right" },
                { label: "Escadas Alumar", align: "right" },
                { label: "Pagamento", align: "right" },
                { label: "Revisão", align: "right" },
                { label: "Atuação", align: "left" },
                ...(isAdmin ? [{ label: "Ações", align: "right" }] : []),
              ].map(({ label, align }) => (
                <th
                  key={label}
                  className={`border-b border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#555555] text-${align}`}
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
              const podeEnviar = isAdmin && onEnviarBm && ["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"].includes(sgcStatusValue) && temAlteracao && !isConcluido;
              const podeRetornar = isAdmin && onRetornarBm && sgcEntry?.id && ["PENDENTE", "REVISAO_SOLICITADA"].includes(sgcStatusValue);

              return (
                <tr
                  key={item.id}
                  className={`border-b last:border-0 transition-colors ${
                    isConcluido
                      ? "border-[#BBF7D0] bg-[#F0FDF4] hover:bg-[#DCFCE7]"
                      : isPendente
                      ? "border-[#D1D5DB] bg-[#E5E7EB] hover:bg-[#D1D5DB]"
                      : hasRevisao
                      ? "border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7]"
                      : `border-[#F3F4F6] hover:bg-[#F9FAFB] ${i % 2 !== 0 ? "bg-[#FAFAFA]" : "bg-white"}`
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-[#1A1A1A]">{item.ato ?? "–"}</td>
                  <td className="px-4 py-3 font-semibold text-[#1A1A1A]">
                    <div className="flex items-center gap-2">
                      {item.responsavel ?? item.projetistaCodigo ?? "–"}
                      {isConcluido && (
                        <Badge variant="success" className="shrink-0">Concluído</Badge>
                      )}
                      {isPendente && (
                        <Badge variant="neutral" className="shrink-0">Aguardando</Badge>
                      )}
                      {!isConcluido && !isPendente && hasRevisao && (
                        <Badge variant="warning" className="shrink-0">Revisão</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#555555]"><BlurValue>{item.cpfCnpj ?? "–"}</BlurValue></td>
                  <td className="px-4 py-3 text-[#555555]">{item.razaoSocial ?? "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.intrSossego)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.salobo)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.acg)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.escadasAlumar)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#1A1A1A]"><BlurValue>{money(item.valor)}</BlurValue></td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">
                    {sgcEntry && sgcEntry.revisaoNumero > 0 ? `Rev. ${sgcEntry.revisaoNumero}` : "–"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusLabel(item) === "ATO" ? "primary" : "success"}>
                      {statusLabel(item)}
                    </Badge>
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
                <td colSpan={isAdmin ? 12 : 11} className="px-4 py-12 text-center text-sm text-[#9CA3AF]">
                  Nenhuma linha encontrada com os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  const a1eq  = parseFloat(doc.equivalenteA1Horas) || 0;
  const pct   = (parseFloat(doc.percentualEmissao) || 0) / 100;
  const preco = parseFloat(doc.condicao) || 0;
  return a1eq * preco * pct;
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
};

function paymentForm(item: MapaPagamentoItem | null): PaymentForm {
  return {
    ato: item?.ato ?? "",
    projetistaCodigo: item?.projetistaCodigo ?? "",
    responsavel: item?.responsavel ?? "",
    cpfCnpj: item?.cpfCnpj ?? "",
    razaoSocial: item?.razaoSocial ?? "",
    intrSossego: String(item?.intrSossego ?? 0),
    salobo: String(item?.salobo ?? 0),
    acg: String(item?.acg ?? 0),
    escadasAlumar: String(item?.escadasAlumar ?? 0),
    horas: String(item?.horas ?? 0),
    valor: currencyInputValue(item?.valor ?? 0),
    rev: String(item?.rev ?? 0),
    status: item?.status ?? "",
  };
}

function PaymentModal({
  item,
  ciclo,
  saving,
  profissionais,
  alocacoes: alocacoesCiclo,
  onCancel,
  onSave,
}: {
  item: MapaPagamentoItem | null;
  ciclo: string;
  saving: boolean;
  profissionais: Profissional[];
  alocacoes: string[];
  onCancel: () => void;
  onSave: (payload: PaymentForm) => Promise<void>;
}) {
  const [form, setForm] = useState<PaymentForm>(() => paymentForm(item));
  const [codigoQuery, setCodigoQuery] = useState(item?.projetistaCodigo ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [alocacoesGlobais, setAlocacoesGlobais] = useState<string[]>([]);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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
        setDocs(data.map((d) => ({
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
        })));
      })
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, [item, codigo, ciclo]);

  const totalDocsValor = docs.reduce((s, d) => s + docValorMedido(d), 0);

  function updateDoc(key: string, field: keyof Omit<DocLine, "_key" | "id" | "_dirty">, value: string) {
    setDocs((cur) => cur.map((d) => d._key === key ? { ...d, [field]: value, _dirty: true } : d));
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
        condicao: doc.condicao,
        obs: doc.obs || null,
      };

      if (doc.id) {
        const res = await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const updated = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: updated.id, _dirty: false } : d));
      } else {
        const res = await fetch("/api/mapa-pagamento/documentos", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
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

  useEffect(() => {
    fetch("/api/mapa-pagamento/alocacoes")
      .then((r) => r.json())
      .then((data: string[]) => setAlocacoesGlobais(data))
      .catch(() => {});
  }, []);

  const alocacoes = useMemo(
    () => [...new Set([...alocacoesGlobais, ...alocacoesCiclo])].sort(),
    [alocacoesGlobais, alocacoesCiclo],
  );

  const suggestions = useMemo(() => {
    const q = codigoQuery.trim().toLowerCase();
    if (!q) return profissionais.slice(0, 8);
    return profissionais
      .filter((p) =>
        (p.codigo ?? "").toLowerCase().includes(q) ||
        (p.nome ?? "").toLowerCase().includes(q) ||
        (p.nomeCompleto ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [codigoQuery, profissionais]);

  function selectProfissional(p: Profissional) {
    setCodigoQuery(p.codigo ?? "");
    setForm((cur) => ({
      ...cur,
      projetistaCodigo: p.codigo ?? "",
      responsavel: p.nomeCompleto || p.nome || "",
      cpfCnpj: maskCpfCnpj(p.cpf || p.cnpj || cur.cpfCnpj),
      razaoSocial: p.razaoSocial || cur.razaoSocial,
    }));
    setShowSuggestions(false);
  }

  function update(field: keyof PaymentForm, value: string) {
    setForm((cur) => ({ ...cur, [field]: value }));
  }

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-4 sm:items-center backdrop-blur-sm">
      <div className="w-full max-w-5xl overflow-hidden rounded-none sm:rounded-2xl border-0 sm:border border-[#E5E7EB] bg-white shadow-2xl min-h-screen sm:min-h-0">

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
        <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(100vh - 220px)" }}>

          {/* Seção: Identificação */}
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Identificação</p>
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Alocação — combobox com digitação livre */}
            <MField label="Alocação">
              <input
                className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                list="alocacoes-list"
                value={form.ato ?? ""}
                onChange={(e) => update("ato", e.target.value)}
                placeholder="Selecione ou digite…"
                autoComplete="off"
              />
              <datalist id="alocacoes-list">
                {alocacoes.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </MField>

            {/* Nome (código) — autocomplete */}
            <MField label="Nome (código)">
              <div className="relative" ref={suggestionsRef}>
                <input
                  className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  placeholder="Digite o código ou nome…"
                  value={codigoQuery}
                  onChange={(e) => { setCodigoQuery(e.target.value); setShowSuggestions(true); }}
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
                        <span className="text-sm font-semibold text-[#1A1A1A]">{p.codigo}</span>
                        <span className="text-xs text-[#555555]">{p.nomeCompleto || p.nome}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </MField>

            {/* Projetista — auto-preenchido, editável */}
            <MField label="Projetista (nome completo)">
              <Input
                value={form.responsavel}
                onChange={(e) => update("responsavel", e.target.value)}
                placeholder="Preenchido automaticamente"
              />
            </MField>

            {/* CPF / CNPJ */}
            <MField label="CPF / CNPJ">
              <Input
                value={form.cpfCnpj}
                onChange={(e) => update("cpfCnpj", maskCpfCnpj(e.target.value))}
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                maxLength={18}
                inputMode="numeric"
              />
            </MField>

            {/* Razão social */}
            <MField label="Razão social" className="sm:col-span-2">
              <Input value={form.razaoSocial} onChange={(e) => update("razaoSocial", e.target.value)} />
            </MField>
          </div>

          {/* Seção: Alocação por contrato */}
          <p className="mb-3 mt-6 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Participação por contrato</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(["intrSossego", "salobo", "acg", "escadasAlumar"] as const).map((field, i) => (
              <MField key={field} label={["Intr. Sossego", "Salobo", "ACG", "Escadas Alumar"][i]}>
                <div className="relative">
                  <Input
                    value={form[field]}
                    onChange={(e) => update(field, maskPercent(e.target.value))}
                    onBlur={(e) => {
                      const n = parseFloat(e.target.value);
                      update(field, isNaN(n) ? "0" : String(n));
                    }}
                    placeholder="0"
                    inputMode="decimal"
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#9CA3AF]">%</span>
                </div>
              </MField>
            ))}
          </div>

          {/* Seção: Pagamento */}
          <p className="mb-3 mt-6 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Pagamento</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <MField label="Horas contabilizadas">
              <div className="relative">
                <Input
                  inputMode="decimal"
                  value={form.horas}
                  onChange={(e) => update("horas", e.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="0"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#9CA3AF]">h</span>
              </div>
            </MField>
            <MField label="Valor previsto">
              <Input
                inputMode="decimal"
                value={form.valor}
                onBlur={(e) => update("valor", formatCurrencyInput(e.target.value))}
                onChange={(e) => update("valor", e.target.value)}
                placeholder="R$ 0,00"
              />
            </MField>
            <MField label="Revisão">
              <Input value={form.rev} onChange={(e) => update("rev", e.target.value)} placeholder="0" />
            </MField>
          </div>

          {/* Seção: Documentos medidos */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Documentos medidos</p>
            <div className="flex items-center gap-3">
              {totalDocsValor > 0 && (
                <button
                  type="button"
                  className="rounded-md border border-[#2563EB]/30 bg-[#EFF6FF] px-3 py-1 text-xs font-semibold text-[#2563EB] hover:bg-[#DBEAFE]"
                  onClick={() => update("valor", formatCurrencyInput(String(totalDocsValor)))}
                >
                  Usar total ({currency.format(totalDocsValor)})
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
          ) : docs.length === 0 ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">Nenhum documento. Clique em "Adicionar linha" para inserir.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#E5E7EB]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                    {["SE", "CTO", "NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH", "Preço Unit.", "Valor Medido", "Observação", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 text-left font-semibold text-[#555555]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => {
                    const valorMedido = docValorMedido(doc);
                    const isDeleting = doc.id ? deletingDocIds.has(doc.id) : false;
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
                {docs.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB]">
                      <td colSpan={8} className="px-2 py-2 text-right text-xs font-bold text-[#555555]">Total medido:</td>
                      <td className="px-2 py-2 text-right text-xs font-bold text-[#1A1A1A]">{currency.format(totalDocsValor)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-[#E5E7EB] px-6 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onSave(form)} disabled={saving}>
            {saving ? "Salvando…" : item ? "Salvar alterações" : "Cadastrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 text-xs font-semibold text-[#555555] ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
