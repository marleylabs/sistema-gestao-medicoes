"use client";

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, ImageIcon, MessageCircle, Mic, Paperclip, Search, Send, StopCircle, Users, X } from "lucide-react";
import { Button } from "@/components/ui";
import { shouldSendOnEnter } from "@/lib/chat-composer";
import { useLiveRefresh } from "@/hooks/use-live-refresh";

type ChatConversa = {
  id: string;
  titulo: string;
  subtitulo: string;
  avatarUrl: string | null;
  online: boolean;
  targetUserId?: string | null;
  targetPerfil?: string | null;
  ultimaMensagem: { id: string; texto: string; autorNome: string; criadoAt: string } | null;
  unreadCount: number;
};

type ChatUsuario = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  avatarUrl: string | null;
  online: boolean;
  fixado?: boolean;
};

type ChatMensagem = {
  id: string;
  autorNome: string;
  autorAvatarUrl: string | null;
  texto: string;
  tipoMensagem: "TEXTO" | "AUDIO" | "IMAGEM" | "VIDEO" | "ARQUIVO";
  arquivoNome: string | null;
  arquivoMime: string | null;
  arquivoTamanho: number | null;
  arquivoUrl: string | null;
  criadoAt: string;
  meu: boolean;
};

type BubblePosition = { right: number; bottom: number };

const CHAT_BUBBLE_POSITION_KEY = "general_chat_bubble_position";
const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime";
const BUBBLE_VIEWPORT_MARGIN = 8;

function clampBubbleViewportPosition(position: { x: number; y: number }, width: number, height: number) {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(BUBBLE_VIEWPORT_MARGIN, position.x), Math.max(BUBBLE_VIEWPORT_MARGIN, window.innerWidth - width - BUBBLE_VIEWPORT_MARGIN)),
    y: Math.min(Math.max(BUBBLE_VIEWPORT_MARGIN, position.y), Math.max(BUBBLE_VIEWPORT_MARGIN, window.innerHeight - height - BUBBLE_VIEWPORT_MARGIN)),
  };
}

function clampBubblePosition(position: BubblePosition, width: number, height: number): BubblePosition {
  if (typeof window === "undefined") return position;
  return {
    right: Math.min(Math.max(BUBBLE_VIEWPORT_MARGIN, position.right), Math.max(BUBBLE_VIEWPORT_MARGIN, window.innerWidth - width - BUBBLE_VIEWPORT_MARGIN)),
    bottom: Math.min(Math.max(BUBBLE_VIEWPORT_MARGIN, position.bottom), Math.max(BUBBLE_VIEWPORT_MARGIN, window.innerHeight - height - BUBBLE_VIEWPORT_MARGIN)),
  };
}

function edgePositionFromViewportPosition(position: { x: number; y: number }, width: number, height: number): BubblePosition {
  if (typeof window === "undefined") return { right: 20, bottom: 20 };
  return clampBubblePosition({
    right: window.innerWidth - position.x - width,
    bottom: window.innerHeight - position.y - height,
  }, width, height);
}

function initials(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Avatar({ name, src, isTeam, className = "h-9 w-9" }: { name: string; src?: string | null; isTeam?: boolean; className?: string }) {
  if (isTeam) {
    return (
      <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)] ${className}`}>
        <Users size={14} />
      </span>
    );
  }
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#EFF6FF] text-xs font-bold text-[#2563EB] ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : initials(name)}
    </span>
  );
}

function chatTime(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateSeparatorLabel(value: string) {
  const date = new Date(value);
  if (isSameDay(date, new Date())) return "Hoje";
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function readableFileSize(size: number | null | undefined) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function perfilLabel(perfil: string) {
  if (perfil === "COLABORADOR") return "Fornecedor";
  if (perfil === "FINANCEIRO") return "Financeiro";
  if (perfil === "ADMINISTRATIVO") return "Administrativo";
  if (perfil === "ADMIN") return "Administrador";
  if (perfil === "MEDICAO") return "Equipe de Medição";
  return "Usuário";
}

function perfilFromLabel(label: string | null | undefined) {
  if (label === "Equipe de Medição") return "MEDICAO";
  if (label === "Financeiro") return "FINANCEIRO";
  if (label === "Administrador") return "ADMIN";
  return null;
}

function isGenericAttachmentText(message: ChatMensagem) {
  return (
    (message.tipoMensagem === "AUDIO" && message.texto === "Áudio") ||
    (message.tipoMensagem === "IMAGEM" && message.texto === "Imagem") ||
    (message.tipoMensagem === "VIDEO" && message.texto === "Vídeo") ||
    (message.tipoMensagem === "ARQUIVO" && message.texto === "Arquivo")
  );
}

/**
 * Um balão por mensagem — nunca duplicar esse markup em outro lugar. `isOwn` decide o lado
 * (conceito chat-start/chat-end do DaisyUI, reimplementado com Tailwind, sem instalar a lib).
 * `showHeader` permite ocultar avatar/nome/horário em mensagens consecutivas do mesmo autor.
 */
function ChatMessage({
  message,
  isOwn,
  showHeader,
  onOpenImage,
}: {
  message: ChatMensagem;
  isOwn: boolean;
  showHeader: boolean;
  onOpenImage: (message: ChatMensagem) => void;
}) {
  return (
    <div className={`flex items-end gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
      <div className="w-7 shrink-0">{showHeader && <Avatar name={message.autorNome} src={message.autorAvatarUrl} className="h-7 w-7 text-[10px]" />}</div>
      <div className={`flex min-w-0 max-w-[70%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
        {showHeader && (
          <div className={`mb-1 flex items-baseline gap-2 px-0.5 ${isOwn ? "flex-row-reverse" : ""}`}>
            <span className="truncate text-[11px] font-semibold text-[var(--foreground)]">{message.autorNome}</span>
            <span className="font-technical shrink-0 text-[10px] text-[var(--muted-foreground)]">{chatTime(message.criadoAt)}</span>
          </div>
        )}
        <div
          className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
            isOwn
              ? "rounded-tr-sm border border-[rgba(175,27,27,0.14)] bg-[rgba(175,27,27,0.08)] text-[var(--foreground)]"
              : "rounded-tl-sm border border-[var(--border)] bg-white text-[var(--foreground)]"
          }`}
        >
          {message.arquivoUrl && message.tipoMensagem === "AUDIO" && (
            <audio controls preload="metadata" src={message.arquivoUrl} className="h-9 w-64 max-w-full" />
          )}
          {message.arquivoUrl && message.tipoMensagem === "IMAGEM" && (
            <ChatImagePreview message={message} onOpen={() => onOpenImage(message)} />
          )}
          {message.arquivoUrl && message.tipoMensagem === "VIDEO" && (
            <video controls preload="metadata" src={message.arquivoUrl} className="max-h-64 max-w-full rounded-lg" />
          )}
          {message.arquivoUrl && message.tipoMensagem === "ARQUIVO" && (
            <a
              href={message.arquivoUrl}
              download
              aria-label={`Baixar anexo ${message.arquivoNome ?? "arquivo"}`}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_3%,white)] px-2.5 py-2 text-xs font-semibold text-[var(--foreground)] outline-none transition hover:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30"
            >
              <FileText size={15} className="shrink-0 text-[var(--muted-foreground)]" />
              <span className="min-w-0 flex-1 truncate">{message.arquivoNome ?? "Arquivo"}</span>
              <span className="shrink-0 text-[10px] font-normal text-[var(--muted-foreground)]">{readableFileSize(message.arquivoTamanho)}</span>
            </a>
          )}
          {(!message.arquivoUrl || !isGenericAttachmentText(message)) && <p className="whitespace-pre-wrap break-words">{message.texto}</p>}
        </div>
      </div>
    </div>
  );
}

/** Thumbnail clicável dentro do balão — abre o ChatImageViewer. Nunca baixa nem amplia sozinha. */
function ChatImagePreview({ message, onOpen }: { message: ChatMensagem; onOpen: () => void }) {
  const [error, setError] = useState(false);
  if (!message.arquivoUrl) return null;

  if (error) {
    return (
      <div className="flex max-w-[380px] flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[#F9FAFB] px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
        <span>Não foi possível carregar esta imagem.</span>
        <a href={`${message.arquivoUrl}?download=1`} download={message.arquivoNome ?? undefined} className="font-semibold text-[var(--primary)] underline-offset-2 hover:underline">
          Baixar arquivo
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Ampliar imagem${message.arquivoNome ? ` ${message.arquivoNome}` : ""}`}
      className="block max-h-[300px] max-w-[380px] cursor-zoom-in overflow-hidden rounded-[10px] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={message.arquivoUrl}
        alt={message.arquivoNome ?? "Imagem enviada"}
        onError={() => setError(true)}
        className="max-h-[300px] max-w-[380px] rounded-[10px] object-cover"
      />
    </button>
  );
}

/** Lightbox de imagem — overlay escuro, imagem ampliada mantendo proporção, download do arquivo original via o mesmo endpoint autorizado do anexo. Único modal montado por vez (estado vive no widget pai). */
function ChatImageViewer({ message, onClose }: { message: ChatMensagem; onClose: () => void }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!message.arquivoUrl) return null;
  const downloadUrl = `${message.arquivoUrl}?download=1`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/72 p-4" onClick={onClose}>
      <div className="flex max-h-full max-w-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex w-full items-center justify-end gap-2">
          <a
            href={downloadUrl}
            download={message.arquivoNome ?? undefined}
            aria-label={`Baixar ${message.arquivoNome ?? "imagem"}`}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Download size={14} />
            Baixar
          </a>
          <button
            onClick={onClose}
            aria-label="Fechar visualizador"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X size={16} />
          </button>
        </div>
        {error ? (
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-white/5 px-6 py-10 text-center text-sm text-white/80">
            <p>Não foi possível carregar esta imagem.</p>
            <a href={downloadUrl} download={message.arquivoNome ?? undefined} className="rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/25">
              Baixar arquivo
            </a>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.arquivoUrl}
            alt={message.arquivoNome ?? "Imagem enviada"}
            onError={() => setError(true)}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
          />
        )}
        {(message.arquivoNome || message.arquivoTamanho) && (
          <div className="mt-3 flex max-w-full items-center gap-2 text-xs text-white/70">
            {message.arquivoNome && <span className="truncate">{message.arquivoNome}</span>}
            {message.arquivoTamanho ? <span className="shrink-0">{readableFileSize(message.arquivoTamanho)}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** Presença de uma conversa individual — nunca usada para conversas de equipe (targetPerfil truthy), que mostram sua descrição fixa em vez de online/offline. */
function UserPresence({ online }: { online: boolean }) {
  return <span className={`text-xs ${online ? "text-[#16A34A]" : "text-[var(--muted-foreground)]"}`}>{online ? "online" : "offline"}</span>;
}

function ConversationListItem({
  conversa,
  selected,
  onClick,
}: {
  conversa: ChatConversa;
  selected: boolean;
  onClick: () => void;
}) {
  const isTeam = !!conversa.targetPerfil;
  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left transition-colors ${
        selected ? "border-l-2 border-l-[var(--primary)] bg-[rgba(175,27,27,0.06)]" : "border-l-2 border-l-transparent hover:bg-[#F9FAFB]"
      }`}
      onClick={onClick}
    >
      <Avatar name={conversa.titulo} src={conversa.avatarUrl} isTeam={isTeam} className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-[#1A1A1A]">{conversa.titulo}</p>
          <span className="font-technical shrink-0 text-[10px] text-[#9CA3AF]">{chatTime(conversa.ultimaMensagem?.criadoAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[#6B7280]">{conversa.ultimaMensagem?.texto ?? conversa.subtitulo}</p>
      </div>
      {conversa.unreadCount > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold text-white">
          {conversa.unreadCount}
        </span>
      )}
    </button>
  );
}

export function GeneralChatWidget({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [conversas, setConversas] = useState<ChatConversa[]>([]);
  const [usuarios, setUsuarios] = useState<ChatUsuario[]>([]);
  const [selected, setSelected] = useState<ChatConversa | null>(null);
  const [messages, setMessages] = useState<ChatMensagem[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [fileAccept, setFileAccept] = useState(MEDIA_ACCEPT);
  const [viewerMessage, setViewerMessage] = useState<ChatMensagem | null>(null);
  const [bubblePosition, setBubblePosition] = useState<BubblePosition | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const bubbleDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
    lastPosition: BubblePosition | null;
  } | null>(null);

  const unreadCount = useMemo(() => conversas.reduce((total, conversa) => total + conversa.unreadCount, 0), [conversas]);

  const loadConversas = useCallback(async () => {
    const res = await fetch("/api/chat/conversas", { cache: "no-store" });
    if (res.ok) setConversas(await res.json());
  }, []);

  const loadUsuarios = useCallback(async (q: string) => {
    const res = await fetch(`/api/chat/usuarios?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    if (res.ok) setUsuarios(await res.json());
  }, []);

  const loadMessages = useCallback(async (conversaId: string) => {
    const res = await fetch(`/api/chat/conversas/${conversaId}/mensagens`, { cache: "no-store" });
    if (res.ok) {
      setMessages(await res.json());
      await fetch(`/api/chat/conversas/${conversaId}/lido`, { method: "POST" }).catch(() => undefined);
      await loadConversas();
    }
  }, [loadConversas]);

  useEffect(() => { loadConversas(); }, [loadConversas]);

  useEffect(() => {
    const raw = localStorage.getItem(CHAT_BUBBLE_POSITION_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<BubblePosition>;
      const width = bubbleRef.current?.offsetWidth ?? 150;
      const height = bubbleRef.current?.offsetHeight ?? 48;
      const nextPosition =
        typeof parsed.right === "number" && typeof parsed.bottom === "number"
          ? clampBubblePosition({ right: parsed.right, bottom: parsed.bottom }, width, height)
          : typeof (parsed as any).x === "number" && typeof (parsed as any).y === "number"
          ? edgePositionFromViewportPosition({ x: (parsed as any).x, y: (parsed as any).y }, width, height)
          : null;
      if (!nextPosition) return;
      setBubblePosition(nextPosition);
      localStorage.setItem(CHAT_BUBBLE_POSITION_KEY, JSON.stringify(nextPosition));
    } catch {
      localStorage.removeItem(CHAT_BUBBLE_POSITION_KEY);
    }
  }, []);

  useEffect(() => {
    function handleResize() {
      setBubblePosition((current) => {
        if (!current) return current;
        const width = bubbleRef.current?.offsetWidth ?? 150;
        const height = bubbleRef.current?.offsetHeight ?? 48;
        const nextPosition = clampBubblePosition(current, width, height);
        localStorage.setItem(CHAT_BUBBLE_POSITION_KEY, JSON.stringify(nextPosition));
        return nextPosition;
      });
    }

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  // Antes só pollava com o widget ABERTO — contador/bolha ficavam parados enquanto o chat estava
  // só fechado (bolha flutuante), exigindo F5 para saber que chegou mensagem nova. `loadConversas`
  // (lista + unreadCount) agora atualiza sempre; `loadMessages` da conversa aberta continua restrito
  // a quando o widget está aberto (não há histórico visível para atualizar quando fechado).
  const tick = useCallback(() => {
    loadConversas();
    if (open && selected?.id) loadMessages(selected.id);
  }, [loadConversas, loadMessages, open, selected?.id]);
  useLiveRefresh(tick, { intervalMs: 5000, enabled: true });

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => loadUsuarios(search), 250);
    return () => clearTimeout(t);
  }, [loadUsuarios, open, search]);

  // Só acompanha o fim automaticamente se o usuário já estava perto dele — evita puxar a tela
  // para baixo enquanto alguém lê mensagens antigas.
  const nearBottomRef = useRef(true);
  function handleMessagesScroll() {
    const el = scrollAreaRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }
  useEffect(() => {
    if (nearBottomRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  useEffect(() => {
    nearBottomRef.current = true;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [selected?.id]);

  async function selectConversa(conversa: ChatConversa) {
    setSelected(conversa);
    await loadMessages(conversa.id);
  }

  async function startConversation(usuario: ChatUsuario) {
    const res = await fetch("/api/chat/conversas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(usuario.id.startsWith("perfil:") ? { targetPerfil: usuario.perfil } : { targetUserId: usuario.id }),
    });
    if (!res.ok) return;
    const payload = await res.json();
    await loadConversas();
    const conversa: ChatConversa = {
      id: payload.id,
      titulo: usuario.nome,
      subtitulo: perfilLabel(usuario.perfil),
      avatarUrl: usuario.avatarUrl,
      online: usuario.online,
      targetUserId: usuario.id.startsWith("perfil:") ? null : usuario.id,
      targetPerfil: usuario.id.startsWith("perfil:") ? usuario.perfil : null,
      ultimaMensagem: null,
      unreadCount: 0,
    };
    await selectConversa(conversa);
  }

  async function sendMessage(arquivo?: File, textoAlternativo?: string) {
    if (!selected) return;
    const texto = (textoAlternativo ?? draft).trim();
    if (!texto && !arquivo) return;
    setSending(true);
    setDraft("");
    const res = arquivo
      ? await fetch(`/api/chat/conversas/${selected.id}/mensagens`, {
          method: "POST",
          body: (() => {
            const form = new FormData();
            form.append("texto", texto);
            form.append("arquivo", arquivo);
            return form;
          })(),
        })
      : await fetch(`/api/chat/conversas/${selected.id}/mensagens`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto }),
        });
    setSending(false);
    if (res.ok) {
      await loadMessages(selected.id);
      await loadConversas();
    }
    // Mantém o foco no composer para permitir continuar digitando rapidamente.
    textareaRef.current?.focus();
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) event.preventDefault();
    if (!shouldSendOnEnter({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, draft, sending, hasSelected: !!selected })) return;
    sendMessage();
  }

  async function handleFileChange(file: File | null | undefined) {
    if (!file || !selected) return;
    await sendMessage(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openAttachmentPicker(accept: string) {
    setFileAccept(accept);
    setAttachmentMenuOpen(false);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function stopRecorder() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function toggleRecording() {
    if (!selected || sending) return;
    if (recording) {
      stopRecorder();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Gravação de áudio indisponível neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (!blob.size) return;
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
        await sendMessage(file);
      };
      recorder.start();
      setRecording(true);
    } catch {
      setRecording(false);
      alert("Não foi possível acessar o microfone.");
    }
  }

  function moveBubble(clientX: number, clientY: number) {
    const drag = bubbleDragRef.current;
    const button = bubbleRef.current;
    if (!drag || !button) return;

    const deltaX = clientX - drag.startClientX;
    const deltaY = clientY - drag.startClientY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) drag.moved = true;

    const nextViewportPosition = clampBubbleViewportPosition(
      { x: drag.startLeft + deltaX, y: drag.startTop + deltaY },
      button.offsetWidth,
      button.offsetHeight,
    );
    const nextPosition = edgePositionFromViewportPosition(nextViewportPosition, button.offsetWidth, button.offsetHeight);
    drag.lastPosition = nextPosition;
    setBubblePosition(nextPosition);
  }

  function handleBubblePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    bubbleDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
      lastPosition: edgePositionFromViewportPosition({ x: rect.left, y: rect.top }, rect.width, rect.height),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleBubblePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!bubbleDragRef.current || bubbleDragRef.current.pointerId !== event.pointerId) return;
    moveBubble(event.clientX, event.clientY);
  }

  function handleBubblePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = bubbleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    moveBubble(event.clientX, event.clientY);
    const position = drag.lastPosition ?? bubblePosition;
    if (position) localStorage.setItem(CHAT_BUBBLE_POSITION_KEY, JSON.stringify(position));
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleBubbleClick() {
    const wasDragged = bubbleDragRef.current?.moved;
    bubbleDragRef.current = null;
    if (wasDragged) return;
    setOpen(true);
  }

  const messageItems = useMemo(() => {
    const items: Array<
      | { kind: "date"; label: string; key: string }
      | { kind: "message"; message: ChatMensagem; showHeader: boolean }
    > = [];
    let lastDateLabel: string | null = null;
    let lastAuthor: string | null = null;
    let lastTime = 0;
    for (const message of messages) {
      const label = dateSeparatorLabel(message.criadoAt);
      if (label !== lastDateLabel) {
        items.push({ kind: "date", label, key: `date-${message.id}` });
        lastDateLabel = label;
        lastAuthor = null;
      }
      const time = new Date(message.criadoAt).getTime();
      // Mensagens consecutivas do mesmo autor em menos de 5 min repetem menos avatar/nome/horário.
      const showHeader = message.autorNome !== lastAuthor || time - lastTime > 5 * 60 * 1000;
      items.push({ kind: "message", message, showHeader });
      lastAuthor = message.autorNome;
      lastTime = time;
    }
    return items;
  }, [messages]);

  // A presença precisa refletir o polling de `conversas` (a cada 5s), não o snapshot congelado no
  // momento da seleção — senão o header de uma conversa aberta há minutos mostra online/offline
  // desatualizado mesmo com o resto da lista já atualizado.
  const selectedLive = selected ? conversas.find((conversa) => conversa.id === selected.id) ?? selected : null;

  const filteredConversas = conversas.filter((conversa) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [conversa.titulo, conversa.subtitulo, conversa.ultimaMensagem?.texto].some((value) => (value ?? "").toLowerCase().includes(term));
  });
  const targetUserIds = new Set(conversas.map((conversa) => conversa.targetUserId).filter(Boolean));
  const targetPerfis = new Set(conversas.flatMap((conversa) => [conversa.targetPerfil, perfilFromLabel(conversa.subtitulo)]).filter(Boolean));
  const conversaIds = new Set(conversas.map((conversa) => conversa.titulo.toLowerCase()));
  const pinnedUsuarios = search.trim() ? [] : usuarios.filter((usuario) => usuario.fixado && !targetUserIds.has(usuario.id) && !targetPerfis.has(usuario.perfil));
  const usuariosToShow = search.trim() ? usuarios.filter((usuario) => !conversaIds.has(usuario.nome.toLowerCase())).slice(0, 10) : [];

  if (!open) {
    return (
      <button
        ref={bubbleRef}
        className={`fixed z-30 inline-flex h-10 touch-none select-none items-center gap-2 rounded-full px-3.5 text-[12px] font-semibold text-white shadow-lg transition-colors ${bubblePosition ? "" : `right-4 ${className || "bottom-4"}`} ${unreadCount ? "bg-[#16A34A] hover:bg-[#15803D]" : "bg-[var(--primary)] hover:bg-[var(--primary-hover)]"}`}
        style={bubblePosition ? { right: bubblePosition.right, bottom: bubblePosition.bottom } : undefined}
        onPointerDown={handleBubblePointerDown}
        onPointerMove={handleBubblePointerMove}
        onPointerUp={handleBubblePointerUp}
        onPointerCancel={() => { bubbleDragRef.current = null; }}
        onClick={handleBubbleClick}
        title="Clique para abrir ou arraste para mover"
      >
        <MessageCircle size={18} />
        Conversas
        {unreadCount > 0 && (
          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-bold">
            {unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={`fixed right-4 z-30 grid h-[min(720px,80vh)] min-h-0 w-[min(1000px,calc(100vw-32px))] grid-cols-1 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-2xl md:grid-cols-[300px_1fr] ${className || "bottom-4"}`}
    >
      <aside className={`min-h-0 min-w-0 flex-col border-r border-[#E5E7EB] bg-white ${selected ? "hidden" : "flex"} md:flex`}>
        <div className="border-b border-[#E5E7EB] px-4 py-3">
          <p className="text-sm font-bold text-[#1A1A1A]">Conversas</p>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-[12px] text-[#9CA3AF]">
            <Search size={13} />
            <input className="min-w-0 flex-1 bg-transparent text-[12px] text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF]" placeholder="Pesquisar..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {pinnedUsuarios.map((usuario) => (
            <button key={`fixed-${usuario.id}`} className="flex w-full items-center gap-3 border-b border-[#F3F4F6] bg-[#FAFAFA] px-4 py-3 text-left transition-colors hover:bg-[rgba(175,27,27,0.05)]" onClick={() => startConversation(usuario)}>
              <Avatar name={perfilLabel(usuario.perfil)} isTeam className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">{perfilLabel(usuario.perfil)}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--primary)]">Equipe fixa</p>
              </div>
            </button>
          ))}
          {usuariosToShow.map((usuario) => (
            <button key={usuario.id} className="flex w-full gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left hover:bg-[#F9FAFB]" onClick={() => startConversation(usuario)}>
              <Avatar name={usuario.nome} src={usuario.avatarUrl} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">{usuario.nome}</p>
                <p className="mt-0.5 truncate text-xs text-[#6B7280]">Iniciar conversa • {perfilLabel(usuario.perfil)}</p>
              </div>
            </button>
          ))}
          {filteredConversas.map((conversa) => (
            <ConversationListItem key={conversa.id} conversa={conversa} selected={selected?.id === conversa.id} onClick={() => selectConversa(conversa)} />
          ))}
          {!pinnedUsuarios.length && !filteredConversas.length && !usuariosToShow.length && <p className="px-4 py-6 text-sm text-[#9CA3AF]">Nenhuma conversa encontrada.</p>}
        </div>
      </aside>

      <section className={`min-h-0 min-w-0 flex-col ${selected ? "flex" : "hidden"} md:flex`}>
        <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
          {selectedLive ? (
            <div className="flex min-w-0 items-center gap-2">
              <button className="-ml-1 rounded-full p-1.5 text-[#6B7280] hover:bg-white hover:text-[#1A1A1A] md:hidden" onClick={() => setSelected(null)} aria-label="Voltar para a lista de conversas">
                <ArrowLeft size={16} />
              </button>
              <Avatar name={selectedLive.titulo} src={selectedLive.avatarUrl} isTeam={!!selectedLive.targetPerfil} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#1A1A1A]">{selectedLive.titulo}</p>
                {selectedLive.targetPerfil ? (
                  <p className="text-xs text-[var(--muted-foreground)]">{selectedLive.subtitulo}</p>
                ) : (
                  <UserPresence online={selectedLive.online} />
                )}
              </div>
            </div>
          ) : <p className="text-sm font-bold text-[#1A1A1A]">Selecione uma conversa</p>}
          <button className="rounded-full p-1 text-[#6B7280] hover:bg-white hover:text-[#1A1A1A]" onClick={() => setOpen(false)} aria-label="Fechar chat"><X size={16} /></button>
        </div>

        <div ref={scrollAreaRef} onScroll={handleMessagesScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[var(--background)] px-4 py-4">
          {selected ? (
            messages.length ? (
              messageItems.map((item) =>
                item.kind === "date" ? (
                  <div key={item.key} className="flex items-center justify-center py-1">
                    <span className="rounded-full bg-[#F3F4F6] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{item.label}</span>
                  </div>
                ) : (
                  <ChatMessage key={item.message.id} message={item.message} isOwn={item.message.meu} showHeader={item.showHeader} onOpenImage={setViewerMessage} />
                ),
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-semibold text-[#1A1A1A]">Nenhuma mensagem ainda.</p>
                <p className="text-xs text-[#6B7280]">Inicie a conversa enviando uma mensagem.</p>
              </div>
            )
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="max-w-xs text-center text-sm text-[#6B7280]">Busque um usuário ou selecione uma conversa existente.</p>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-[#E5E7EB] bg-white p-3">
          <input ref={fileInputRef} type="file" className="hidden" accept={fileAccept} onChange={(event) => handleFileChange(event.target.files?.[0])} />
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
              placeholder="Digite uma mensagem..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={!selected}
              rows={1}
            />
            <div className="relative shrink-0">
              <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[#6B7280] shadow-sm transition hover:bg-[#F9FAFB] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setAttachmentMenuOpen((current) => !current)} disabled={!selected || sending} aria-label="Adicionar anexo" title="Adicionar anexo">
                <Paperclip size={16} />
              </button>
              {attachmentMenuOpen && selected && (
                <div className="absolute bottom-12 right-0 z-10 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-white py-1 text-sm shadow-xl">
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#374151] hover:bg-[#F9FAFB]" onClick={() => openAttachmentPicker(MEDIA_ACCEPT)}>
                    <ImageIcon size={15} className="text-[var(--primary)]" />
                    Fotos e vídeos
                  </button>
                </div>
              )}
            </div>
            <button className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${recording ? "border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]" : "border-[var(--border)] bg-white text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[var(--primary)]"}`} onClick={toggleRecording} disabled={!selected || sending} aria-label={recording ? "Parar gravação" : "Enviar áudio"} title={recording ? "Parar gravação" : "Enviar áudio"}>
              {recording ? <StopCircle size={16} /> : <Mic size={16} />}
            </button>
            <Button className="h-10 shrink-0 px-4" onClick={() => sendMessage()} disabled={sending || !selected || !draft.trim()}>
              <Send size={13} />
              {sending ? "..." : "Enviar"}
            </Button>
          </div>
        </div>
      </section>

      {viewerMessage && <ChatImageViewer message={viewerMessage} onClose={() => setViewerMessage(null)} />}
    </div>
  );
}
