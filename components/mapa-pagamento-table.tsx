"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Edit3, MessageCircle, Mic, RotateCcw, Search, Send, StopCircle, Trash2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import type { ContratoResumo, MapaPagamentoItem } from "@/components/types";
import type { SgcStatusEntry } from "@/lib/sgc-display-status";
import { normalizeText } from "@/components/pagamento-format";
import { avaliarElegibilidadeEnvioBm, ultimaAlteracaoDoBm } from "@/lib/bm-envio-elegibilidade";
import { isCicloValido } from "@/lib/ciclo";

// Compatibilidade: consumidores existentes importam estes daqui.
export { formatParticipacao, money } from "@/components/pagamento-format";
export { MapaPagamentoEditor, type PagamentoEditorContexto } from "@/components/pagamento-editor";

export type Revisao = {
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


/**
 * Elegibilidade de um item para o filtro "Contrato" (toolbar) — usa a MESMA participação dinâmica
 * já calculada no backend (`item.participacaoContratos`, vindo de
 * lib/participacao-contratos.ts::getParticipacaoPorFornecedorCiclo) e já usada para exibir o
 * percentual por contrato nesta mesma tabela. Nunca mais os 4 contratos fixos hardcoded
 * (Intr. Sossego/Salobo/ACG/Escadas Alumar) — funciona com qualquer contrato descoberto no ciclo.
 */
export function contractParticipation(item: MapaPagamentoItem, contrato: string, contratos: ContratoResumo[]) {
  const contratoId = contratos.find((c) => c.nome === contrato)?.id;
  if (!contratoId) return 0;
  return item.participacaoContratos?.[contratoId] ?? 0;
}

/**
 * Ações de um fornecedor no Mapa de Pagamento (Retornar/Enviar/Reenviar BM, chat de revisão, Editar,
 * Excluir) — mesmas condições de sempre, exibidas no detalhe (drawer) da tela Fornecedores. Estado canônico vem de `sgcStatus` (lib/sgc-display-status.ts), nunca otimista.
 */
export function MapaItemActions({
  item,
  itens,
  sgcEntry,
  revisao,
  revisoes = [],
  isAdmin = false,
  onEnviarBm,
  onRetornarBm,
  onEdit,
  onChanged,
  dropdownOpen = false,
  onToggleDropdown,
  onOpenDropdownFor,
  ciclo,
}: {
  item: MapaPagamentoItem;
  itens: MapaPagamentoItem[];
  sgcEntry?: SgcStatusEntry;
  revisao?: Revisao;
  revisoes?: Revisao[];
  isAdmin?: boolean;
  onEnviarBm?: (colaboradorCodigo: string) => Promise<void>;
  onRetornarBm?: (sgcId: string) => Promise<void>;
  onEdit: (item: MapaPagamentoItem) => void;
  onChanged?: () => Promise<void> | void;
  dropdownOpen?: boolean;
  onToggleDropdown?: () => void;
  onOpenDropdownFor?: (itemId: string | null) => void;
  ciclo: string;
}) {
  const [enviando, setEnviando] = useState(false);
  const [retornando, setRetornando] = useState(false);
  if (!isAdmin) return null;

  const codigo = item.projetistaCodigo ?? "";
  const sgcStatusValue = sgcEntry?.status ?? "AGUARDANDO_ENVIO";
  const isRevisaoEnvio = sgcStatusValue === "REVISAO_SOLICITADA";
  // Mesma regra do servidor e do envio em lote (lib/bm-envio-elegibilidade.ts) — nada de lista
  // de status paralela aqui.
  const elegibilidadeEnvio = avaliarElegibilidadeEnvioBm({
    status: sgcEntry?.status,
    statusConferencia: sgcEntry?.statusConferencia,
    revisaoSolicitadaAt: revisao?.revisaoSolicitadaAt,
    // Nível do BM (todas as linhas do fornecedor no ciclo carregado), como o servidor — não só esta linha.
    itemAtualizadoEm: ultimaAlteracaoDoBm(itens, codigo) ?? item.updatedAt,
    cadastroPendente: item.cadastroPendente,
  });
  const temAlteracao = !(!elegibilidadeEnvio.elegivel && elegibilidadeEnvio.motivo === "REVISAO_SEM_ALTERACAO");
  // "Geral" (ou qualquer valor que não seja um ciclo real) nunca envia: o BM sempre pertence a uma
  // competência específica — o servidor também recusa.
  const cicloReal = isCicloValido(ciclo);
  const podeEnviar = !!onEnviarBm && cicloReal && elegibilidadeEnvio.elegivel;
  const envioAplicavel = !!onEnviarBm && (elegibilidadeEnvio.elegivel || (isRevisaoEnvio && !temAlteracao));
  const sgcId = sgcEntry?.id;
  const podeRetornar = onRetornarBm && sgcId && ["PENDENTE", "REVISAO_SOLICITADA"].includes(sgcStatusValue);
  async function excluir() {
    if (!window.confirm("Excluir este pagamento?")) return;
    const res = await fetch(`/api/mapa-pagamento/${item.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Falha ao excluir pagamento.");
    await onChanged?.();
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5">
      {podeRetornar && (
        <Button
          disabled={retornando}
          title="Retornar BM para aguardando envio"
          onClick={async () => {
            setRetornando(true);
            try { await onRetornarBm(sgcId); } finally { setRetornando(false); }
          }}
          className="h-8 shrink-0 gap-1 whitespace-nowrap border border-[#FCA5A5] bg-[#FEF2F2] px-2 text-xs font-semibold !text-[#DC2626] hover:border-[#F87171] hover:bg-[#FEE2E2]"
          variant="ghost"
        >
          <RotateCcw size={12} />
          {retornando ? "Retornando..." : "Retornar BM"}
        </Button>
      )}
      {envioAplicavel && !cicloReal && (
        <p className="text-[12px] text-[var(--muted-foreground)]" data-testid="envio-bm-requer-ciclo">
          Selecione um ciclo específico para enviar o boletim.
        </p>
      )}
      {cicloReal && onEnviarBm && (podeEnviar || (isRevisaoEnvio && !temAlteracao)) && (
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
            setEnviando(true);
            try { await onEnviarBm(codigo); } finally { setEnviando(false); }
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
      {revisao && (
        <div className="relative">
          <IconButton
            className={hasUnreadFornecedorMessages(revisao.mensagens)
              ? "border-[#86EFAC] bg-[#F0FDF4] text-[#16A34A] hover:border-[#22C55E] hover:bg-[#DCFCE7]"
              : "border-[#FCD34D] bg-[#FFFBEB] text-[#D97706] hover:border-[#F59E0B] hover:bg-[#FEF3C7]"}
            title="Ver comentário do fornecedor"
            onClick={onToggleDropdown}
          >
            <MessageCircle size={14} />
          </IconButton>
          {dropdownOpen && (
            <ComentarioDropdown
              revisao={revisao}
              conversas={revisoes}
              onClose={() => onOpenDropdownFor?.(null)}
              onRespondido={onChanged}
              onSelectRevisao={(next) => {
                const target = itens.find((it) => it.projetistaCodigo === next.colaboradorCodigo);
                if (target) onOpenDropdownFor?.(target.id);
              }}
              ciclo={ciclo}
            />
          )}
        </div>
      )}
      <Button variant="secondary" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => onEdit(item)}>
        <Edit3 size={13} />
        Editar pagamento
      </Button>
      <Button variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs !text-[#DC2626] hover:bg-[#FEF2F2]" onClick={excluir}>
        <Trash2 size={13} />
        Excluir pagamento
      </Button>
    </div>
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
