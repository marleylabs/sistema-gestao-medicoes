"use client";

import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImageIcon, MessageCircle, Mic, Paperclip, Search, Send, StopCircle, X } from "lucide-react";
import { Button } from "@/components/ui";

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

type BubblePosition = { x: number; y: number };

const CHAT_BUBBLE_POSITION_KEY = "general_chat_bubble_position";
const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime";

function clampBubblePosition(position: BubblePosition, width: number, height: number): BubblePosition {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(8, position.x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, position.y), Math.max(8, window.innerHeight - height - 8)),
  };
}

function initials(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Avatar({ name, src, className = "h-9 w-9" }: { name: string; src?: string | null; className?: string }) {
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
  const [bubblePosition, setBubblePosition] = useState<BubblePosition | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const bubbleDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
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
      if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return;
      const width = bubbleRef.current?.offsetWidth ?? 150;
      const height = bubbleRef.current?.offsetHeight ?? 48;
      const nextPosition = clampBubblePosition({ x: parsed.x, y: parsed.y }, width, height);
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

  useEffect(() => {
    if (!open) return;
    loadConversas();
    const interval = setInterval(() => {
      loadConversas();
      if (selected?.id) loadMessages(selected.id);
    }, 5000);
    return () => clearInterval(interval);
  }, [loadConversas, loadMessages, open, selected?.id]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => loadUsuarios(search), 250);
    return () => clearTimeout(t);
  }, [loadUsuarios, open, search]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selected?.id]);

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

    const nextPosition = clampBubblePosition({ x: drag.startX + deltaX, y: drag.startY + deltaY }, button.offsetWidth, button.offsetHeight);
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
      startX: rect.left,
      startY: rect.top,
      moved: false,
      lastPosition: { x: rect.left, y: rect.top },
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
        className={`fixed z-[60] inline-flex h-12 touch-none select-none items-center gap-2 rounded-full px-4 text-sm font-semibold text-white shadow-xl transition-colors ${bubblePosition ? "" : `right-5 ${className || "bottom-5"}`} ${unreadCount ? "bg-[#16A34A] hover:bg-[#15803D]" : "bg-[#2563EB] hover:bg-[#1D4ED8]"}`}
        style={bubblePosition ? { left: bubblePosition.x, top: bubblePosition.y } : undefined}
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
    <div className={`fixed right-5 z-[70] grid h-[min(560px,calc(100vh-40px))] min-h-0 w-[min(860px,calc(100vw-24px))] grid-cols-1 overflow-hidden rounded-xl border border-[#D1D5DB] bg-white shadow-2xl md:grid-cols-[300px_1fr] ${className || "bottom-5"}`}>
      <aside className="hidden min-h-0 min-w-0 border-r border-[#E5E7EB] bg-white md:flex md:flex-col">
        <div className="border-b border-[#E5E7EB] px-4 py-3">
          <p className="text-base font-bold text-[#1A1A1A]">Conversas</p>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-xs text-[#9CA3AF]">
            <Search size={14} />
            <input className="min-w-0 flex-1 bg-transparent text-xs text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF]" placeholder="Pesquise usuário ou conversa" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {pinnedUsuarios.map((usuario) => (
            <button key={`fixed-${usuario.id}`} className="flex w-full gap-3 border-b border-[#F3F4F6] bg-[#F8FAFC] px-4 py-3 text-left hover:bg-[#EFF6FF]" onClick={() => startConversation(usuario)}>
              <Avatar name={usuario.nome} src={usuario.avatarUrl} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">{perfilLabel(usuario.perfil)}</p>
                <p className="mt-0.5 truncate text-xs text-[#2563EB]">Fixado • {usuario.online ? "online" : "offline"}</p>
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
            <button key={conversa.id} className={`flex w-full gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left ${selected?.id === conversa.id ? "bg-[#EFF6FF]" : "hover:bg-[#F9FAFB]"}`} onClick={() => selectConversa(conversa)}>
              <Avatar name={conversa.titulo} src={conversa.avatarUrl} className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#1A1A1A]">{conversa.titulo}</p>
                  <span className="shrink-0 text-[10px] text-[#9CA3AF]">{chatTime(conversa.ultimaMensagem?.criadoAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-[#6B7280]">{conversa.ultimaMensagem?.texto ?? conversa.subtitulo}</p>
              </div>
              {conversa.unreadCount > 0 && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#16A34A]" />}
            </button>
          ))}
          {!pinnedUsuarios.length && !filteredConversas.length && !usuariosToShow.length && <p className="px-4 py-6 text-sm text-[#9CA3AF]">Nenhuma conversa encontrada.</p>}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
          {selected ? (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={selected.titulo} src={selected.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#1A1A1A]">{selected.titulo}</p>
                <p className={`text-xs ${selected.online ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>{selected.online ? "online" : "offline"}</p>
              </div>
            </div>
          ) : <p className="text-sm font-bold text-[#1A1A1A]">Selecione uma conversa</p>}
          <button className="rounded-full p-1 text-[#6B7280] hover:bg-white hover:text-[#1A1A1A]" onClick={() => setOpen(false)} aria-label="Fechar chat"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F3F4F6] px-4 py-4">
          {selected ? messages.map((message) => (
            <div key={message.id} className={`flex items-end gap-2 ${message.meu ? "justify-end" : "justify-start"}`}>
              {!message.meu && <Avatar name={message.autorNome} src={message.autorAvatarUrl} className="h-7 w-7 text-[10px]" />}
              <div className={`max-w-[82%] rounded-xl px-3 py-2 text-sm shadow-sm ${message.meu ? "rounded-br-sm bg-[#DBEAFE] text-[#1E3A8A]" : "rounded-bl-sm bg-white text-[#1A1A1A]"}`}>
                <p className={`mb-1 text-[11px] font-bold ${message.meu ? "text-[#1D4ED8]" : "text-[#2563EB]"}`}>
                  {message.autorNome}
                </p>
                {message.arquivoUrl && message.tipoMensagem === "AUDIO" && (
                  <audio controls preload="metadata" src={message.arquivoUrl} className="h-9 w-64 max-w-full" />
                )}
                {message.arquivoUrl && message.tipoMensagem === "IMAGEM" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={message.arquivoUrl} alt={message.arquivoNome ?? "Imagem enviada"} className="max-h-56 max-w-full rounded-lg object-contain" />
                )}
                {message.arquivoUrl && message.tipoMensagem === "VIDEO" && (
                  <video controls preload="metadata" src={message.arquivoUrl} className="max-h-64 max-w-full rounded-lg" />
                )}
                {message.arquivoUrl && message.tipoMensagem === "ARQUIVO" && (
                  <a href={message.arquivoUrl} download className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${message.meu ? "border-[#93C5FD] bg-white/40 text-[#1E40AF]" : "border-[#E5E7EB] bg-[#F9FAFB] text-[#374151]"}`}>
                    <FileText size={16} />
                    <span className="min-w-0 flex-1 truncate">{message.arquivoNome ?? "Arquivo"}</span>
                    <span className="shrink-0 text-[10px] opacity-70">{readableFileSize(message.arquivoTamanho)}</span>
                  </a>
                )}
                {(!message.arquivoUrl || !isGenericAttachmentText(message)) && <p className="whitespace-pre-wrap leading-relaxed">{message.texto}</p>}
                <div className={`mt-1.5 text-[10px] font-semibold opacity-70 ${message.meu ? "text-right" : "text-left"}`}>{chatTime(message.criadoAt)}</div>
              </div>
            </div>
          )) : <p className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-3 py-4 text-center text-sm text-[#6B7280]">Busque um usuário ou selecione uma conversa existente.</p>}
          <div ref={endRef} />
        </div>

        <div className="border-t border-[#E5E7EB] bg-white p-3">
          <input ref={fileInputRef} type="file" className="hidden" accept={fileAccept} onChange={(event) => handleFileChange(event.target.files?.[0])} />
          <div className="flex items-end gap-2">
            <textarea className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20" placeholder="Digite uma nova mensagem..." value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!selected} />
            <div className="relative shrink-0">
              <button className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] shadow-sm transition hover:bg-[#F9FAFB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setAttachmentMenuOpen((current) => !current)} disabled={!selected || sending} aria-label="Adicionar anexo" title="Adicionar anexo">
                <Paperclip size={16} />
              </button>
              {attachmentMenuOpen && selected && (
                <div className="absolute bottom-12 right-0 z-10 w-44 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-1 text-sm shadow-xl">
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#374151] hover:bg-[#F9FAFB]" onClick={() => openAttachmentPicker(MEDIA_ACCEPT)}>
                    <ImageIcon size={15} className="text-[#2563EB]" />
                    Fotos e vídeos
                  </button>
                </div>
              )}
            </div>
            <button className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${recording ? "border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]" : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#2563EB]"}`} onClick={toggleRecording} disabled={!selected || sending} aria-label={recording ? "Parar gravação" : "Enviar áudio"} title={recording ? "Parar gravação" : "Enviar áudio"}>
              {recording ? <StopCircle size={16} /> : <Mic size={16} />}
            </button>
            <Button className="h-11 shrink-0 px-4" onClick={() => sendMessage()} disabled={sending || !selected || !draft.trim()}>
              <Send size={13} />
              {sending ? "..." : "Enviar"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
