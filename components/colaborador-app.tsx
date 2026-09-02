"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import {
  AlertTriangle,
  AlertCircle,
  Banknote,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  File as FileIcon,
  FileText,
  FileUp,
  LayoutDashboard,
  UserRound,
  History,
  MessageCircle,
  Mic,
  RotateCcw,
  Save,
  Search,
  Send,
  StopCircle,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { AppShell } from "@/components/app-shell";
import { AccountMenu } from "@/components/account-menu";
import { GeneralChatWidget } from "@/components/general-chat-widget";
import { Badge, Button, Card, IconButton, PageContainer, PageHeader, Textarea } from "@/components/ui";
import type { AuthUser } from "@/lib/session";
import { computarParticipacao } from "@/lib/contratos";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

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

type ColaboradorData = {
  cicloAtivo: string;
  usuario: {
    codigo: string; nome: string; cpf: string | null; cnpj: string | null;
    avatarUrl: string | null; razaoSocial: string | null; email: string | null; funcao: string | null; statusColaborador: string | null;
  };
  alocacao: { ato: string | null; intrSossego: number; salobo: number; acg: number; escadasAlumar: number; } | null;
  pagamento: {
    valor: number;
    rev: number;
    responsavel: string | null;
    razaoSocial: string | null;
    condicoesFixas?: {
      valorFixo: string | null;
      tipoContratacao: string | null;
      adicionaisFixos: string | null;
      observacoesContrato: string | null;
    };
  } | null;
  documentos: Array<{
    id: string; projetoReferente: string; tituloPrimario: string | null;
    dataCadastro: string | null; formato: string | null; quantidade: number;
    equivalenteA1Horas: number; valorMedicao: number; percentualEmissao: number;
    numeroDocumento: string | null; contrato: string | null; tipo2: string | null;
    condicao: string | null; precoUnitario: number; valorMedido: number; obs: string | null;
  }>;
  /** Divergências que a Equipe descartou na conferência deste ciclo — fonte única de verdade é
   * DivergenciaMedicao (mesma tabela usada em Pagamentos por Fornecedor), nunca uma cópia. */
  documentosDescartados: Array<{
    id: string; nrVale: string; formato: string; tipo: string; motivo: string;
  }>;
  sgc: {
    id: string | null;
    status: string; revisaoNumero: number; revisaoLabel: string | null;
    pontosDiscordancia: string | null; respostaAdmin: string | null; observacaoColaborador: string | null;
    medicaoOnline: boolean;
    mensagens: SgcChatMessage[];
    aprovadoAt: string | null; revisaoSolicitadaAt: string | null; reenviadoAt: string | null;
    statusConferencia: string;
  };
};

function dateLabel(v: string | null) {
  if (!v) return "–";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${v}T00:00:00`));
}

function chatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function readableFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function fileExtension(name: string) {
  return name.split(".").pop()?.toUpperCase() || "ARQ";
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function parseCurrencyNumber(value: string | null | undefined) {
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDiscountDocument(documento: Pick<ColaboradorData["documentos"][number], "tipo2" | "projetoReferente" | "numeroDocumento">) {
  return normalizeText(documento.tipo2) === "DESCONTO" || normalizeText(documento.projetoReferente) === "DESCONTO" || normalizeText(documento.numeroDocumento) === "DESCONTO";
}

function hasUnreadMedicaoMessages(messages: SgcChatMessage[]) {
  return messages.some((message) => message.autor === "MEDICAO" && !message.lidoAt);
}

function ChatReceipt({ read, sending }: { read: boolean; sending?: boolean }) {
  if (sending) return <Check size={13} className="text-[#9CA3AF]" />;
  return <CheckCheck size={13} className={read ? "text-[#2563EB]" : "text-[#9CA3AF]"} />;
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

function ratio(v: number) { return v ? percent.format(v) : "–"; }

function statusConfig(status: string) {
  if (status === "PAGO")               return { label: "Medição concluída",       badge: "success" as const };
  if (status === "APROVADO")           return { label: "Aguardando pagamento",    badge: "brand" as const };
  if (status === "AGUARDANDO_NF")      return { label: "Aguardando envio da NF",  badge: "warning" as const };
  if (status === "REVISAO_SOLICITADA") return { label: "Revisão solicitada",      badge: "warning" as const };
  if (status === "AGUARDANDO_ENVIO")   return { label: "Aguardando envio do BM",  badge: "neutral" as const };
  if (status === "CANCELADO")          return { label: "BM cancelado",            badge: "neutral" as const };
  return                                      { label: "Pendente de validação",   badge: "neutral" as const };
}

function isFinancialFollowUpStatus(status: string) {
  return status === "APROVADO" || status === "PAGO";
}

function SummaryField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#F3F4F6] bg-[#FAFAFA] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[#1A1A1A]" title={typeof value === "string" ? value : undefined}>
        {value || "–"}
      </p>
    </div>
  );
}

function displayEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

// ─── ColaboradorApp ───────────────────────────────────────────────────────────

type MedicaoAprovada = BmData & { id: string; status?: string; nfArquivoNome?: string | null; nfCarregadoAt?: string | null; comprovanteArquivoNome?: string | null; comprovanteCarregadoAt?: string | null; };

type Section = "portal" | "medicoes";

export function ColaboradorApp({ user }: { user: AuthUser }) {
  const [section, setSection]               = useState<Section>("portal");
  const [data, setData]                     = useState<ColaboradorData | null>(null);
  const [loading, setLoading]               = useState(true);
  const [medicoes, setMedicoes]             = useState<MedicaoAprovada[]>([]);
  const [medLoading, setMedLoading]         = useState(false);
  const [documentsOpen, setDocumentsOpen]   = useState(false);
  const [actionModal, setActionModal]       = useState<"revisao" | "resposta" | null>(null);
  const [pontos, setPontos]                 = useState("");
  const [respostaFornecedor, setRespostaFornecedor] = useState("");
  const [message, setMessage]               = useState<{ text: string; type: "success" | "info" } | null>(null);
  const [modalError, setModalError]         = useState<string | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [nfFile, setNfFile]                 = useState<File | null>(null);
  const [nfUploading, setNfUploading]       = useState(false);
  const [nfProgress, setNfProgress]         = useState(0);
  const [nfError, setNfError]               = useState<string | null>(null);
  const [draggingNf, setDraggingNf]         = useState(false);
  const [conferenciaFile, setConferenciaFile]         = useState<File | null>(null);
  const [conferenciaUploading, setConferenciaUploading] = useState(false);
  const [conferenciaProgress, setConferenciaProgress]   = useState(0);
  const [conferenciaError, setConferenciaError]         = useState<string | null>(null);
  const [draggingConferencia, setDraggingConferencia]   = useState(false);
  const [savingAction, setSavingAction]     = useState<"SALVAR" | "ENVIAR" | null>(null);
  const [salvoAt, setSalvoAt]               = useState<string | null>(null);
  const [chatOpen, setChatOpen]             = useState(false);
  const [chatDraft, setChatDraft]           = useState("");
  const [chatSending, setChatSending]       = useState(false);
  const [pendingChatMessage, setPendingChatMessage] = useState<(SgcChatMessage & { enviando?: boolean }) | null>(null);
  const chatBaselineRef                     = useRef(false);
  const sgcRequestInFlightRef               = useRef(false);
  const previousMedicaoMessageIdsRef        = useRef<Set<string>>(new Set());
  const nfInputRef                          = useRef<HTMLInputElement | null>(null);

  const canValidate = data?.sgc.status === "PENDENTE" && data?.sgc.statusConferencia === "CONCLUIDA";
  const { label: statusLabel, badge: statusBadge } = data ? statusConfig(data.sgc.status) : { label: "", badge: "neutral" as const };

  const resultadoParticipacao = useMemo(() => {
    if (!data) return null;
    const elegiveis = data.documentos.filter((d) => !isDiscountDocument(d));
    return computarParticipacao(elegiveis.map((d) => ({ contrato: d.contrato, valorMedido: d.valorMedido })));
  }, [data]);
  const contratos = useMemo((): [string, number][] => {
    return resultadoParticipacao?.participacoes.map((p): [string, number] => [p.nome, p.percentual / 100]) ?? [];
  }, [resultadoParticipacao]);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/colaborador/me");
      // Sem checar res.ok: uma resposta de erro (ex.: 401 numa janela curta de troca de sessão)
      // tem o formato {error: "..."}, sem "sgc" — e todo o resto do componente lê data.sgc.status
      // sem optional chaining, o que crashava com "Cannot read properties of undefined". Numa
      // falha, mantém o último estado válido em tela (item já estabelecido nesta sessão: nunca
      // apagar dados atuais por causa de uma consulta automática que falhou).
      if (res.ok) setData(await res.json());
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const loadMedicoes = useCallback(async () => {
    setMedLoading(true);
    const res = await fetch("/api/colaborador/medicoes");
    const json = await res.json();
    setMedicoes(json.medicoes ?? []);
    setMedLoading(false);
  }, []);

  function playNotificationSound() {
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.36);
      setTimeout(() => ctx.close().catch(() => {}), 500);
    } catch {}
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.assign("/login");
  }

  function openActionModal(kind: "revisao" | "resposta") {
    setModalError(null);
    if (kind === "resposta") setRespostaFornecedor(data?.sgc.observacaoColaborador ?? "");
    setActionModal(kind);
  }

  function closeActionModal() {
    setModalError(null);
    setActionModal(null);
  }

  const ERROR_FALLBACK: Record<"SALVAR" | "ENVIAR" | "SOLICITAR_REVISAO" | "RESPONDER_MEDICAO", string> = {
    SALVAR: "Não foi possível salvar sua validação. Tente novamente.",
    ENVIAR: "Não foi possível enviar o BM. Tente novamente.",
    SOLICITAR_REVISAO: "Não foi possível enviar a solicitação de revisão. Tente novamente.",
    RESPONDER_MEDICAO: "Não foi possível enviar sua resposta. Tente novamente.",
  };

  async function sendSgc(action: "SALVAR" | "ENVIAR" | "SOLICITAR_REVISAO" | "RESPONDER_MEDICAO") {
    if (sgcRequestInFlightRef.current) return; // evita disparo duplicado por duplo clique (ref: imune a stale state)
    sgcRequestInFlightRef.current = true;
    setSaving(true);
    setSavingAction(action === "SALVAR" || action === "ENVIAR" ? action : null);
    setMessage(null);
    setModalError(null);
    const res = await fetch("/api/colaborador/sgc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pontosDiscordancia: pontos, respostaFornecedor }),
    });
    const payload = await res.json().catch(() => ({}));
    sgcRequestInFlightRef.current = false;
    setSaving(false);
    setSavingAction(null);
    if (!res.ok) {
      const errorText = payload.error ?? ERROR_FALLBACK[action];
      if (actionModal) setModalError(errorText);
      else setMessage({ text: errorText, type: "info" });
      return;
    }
    if (action === "SALVAR") {
      setSalvoAt(payload.salvoAt ?? new Date().toISOString());
      setMessage({ text: "Validação salva com sucesso.", type: "success" });
      return;
    }
    closeActionModal();
    setPontos("");
    if (action === "RESPONDER_MEDICAO") setRespostaFornecedor("");
    const msgs: Record<string, string> = {
      ENVIAR: "BM enviado com sucesso. Aguardando envio da Nota Fiscal.",
      SOLICITAR_REVISAO: "Solicitação de revisão enviada para a equipe de Medição.",
      RESPONDER_MEDICAO: "Resposta enviada para a equipe de Medição.",
    };
    setMessage({ text: msgs[action] ?? "Operação realizada.", type: "success" });
    await loadData();
  }

  function handleEnviar() {
    if (sgcRequestInFlightRef.current) return;
    const confirmado = window.confirm(
      "Aprovar este BM?\n\nAo continuar, você confirma os dados apresentados e o processo seguirá para envio da Nota Fiscal.",
    );
    if (!confirmado) return;
    void sendSgc("ENVIAR");
  }

  async function sendChatMessage() {
    const texto = chatDraft.trim();
    if (!texto) return;
    setPendingChatMessage({
      id: "pending-fornecedor-message",
      autor: "FORNECEDOR",
      autorNome: user.nome,
      autorAvatarUrl: data?.usuario.avatarUrl ?? null,
      texto,
      tipo: "TEXTO",
      audioUrl: null,
      audioMime: null,
      audioNome: null,
      lidoAt: null,
      criadoAt: new Date().toISOString(),
      enviando: true,
    });
    setChatSending(true);
    setMessage(null);
    const res = await fetch("/api/colaborador/sgc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RESPONDER_MEDICAO", respostaFornecedor: texto }),
    });
    const payload = await res.json().catch(() => ({}));
    setChatSending(false);
    if (!res.ok) {
      setPendingChatMessage(null);
      setMessage({ text: payload.error ?? "Não foi possível enviar a mensagem.", type: "info" });
      return;
    }
    setChatDraft("");
    setMessage({ text: "Mensagem enviada para a equipe de Medição.", type: "success" });
    await loadData({ silent: true });
    setPendingChatMessage(null);
  }

  const markChatRead = useCallback(async () => {
    const sgcId = data?.sgc.id;
    if (!sgcId) return;

    const readAt = new Date().toISOString();
    setData((current) => {
      if (!current || current.sgc.id !== sgcId) return current;
      return {
        ...current,
        sgc: {
          ...current.sgc,
          mensagens: current.sgc.mensagens.map((message) =>
            message.autor === "MEDICAO" && !message.lidoAt ? { ...message, lidoAt: readAt } : message,
          ),
        },
      };
    });

    await fetch("/api/sgc/chat/lido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sgcId }),
    }).catch(() => undefined);
  }, [data?.sgc.id]);

  function selectNfFile(file: File | null) {
    setNfError(null);
    setNfProgress(0);
    if (!file) {
      setNfFile(null);
      return;
    }

    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
    const allowedExtensions = /\.(pdf|jpg|jpeg|png)$/i;
    if (!allowedTypes.has(file.type) && !allowedExtensions.test(file.name)) {
      setNfFile(null);
      setNfError("Formato inválido. Envie PDF, JPG ou PNG.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNfFile(null);
      setNfError("A Nota Fiscal deve ter no máximo 10 MB.");
      return;
    }
    setNfFile(file);
  }

  async function uploadNf() {
    if (!nfFile) return;
    setNfUploading(true);
    setMessage(null);
    setNfError(null);
    setNfProgress(4);
    const form = new FormData();
    form.append("nf", nfFile);
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/colaborador/nf");
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setNfProgress(Math.min(95, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onload = () => {
          const payload = (() => {
            try { return JSON.parse(xhr.responseText || "{}"); } catch { return {}; }
          })();
          if (xhr.status >= 200 && xhr.status < 300) {
            setNfProgress(100);
            resolve();
          } else {
            reject(new Error(payload.error ?? "Erro ao enviar a NF."));
          }
        };
        xhr.onerror = () => reject(new Error("Erro de conexão ao enviar a NF."));
        xhr.send(form);
      });
      setNfFile(null);
      setMessage({ text: "Nota fiscal enviada com sucesso. Medição marcada como aprovada.", type: "success" });
      await loadData();
    } catch (error) {
      setNfError(error instanceof Error ? error.message : "Erro ao enviar a NF.");
    } finally {
      setNfUploading(false);
    }
  }

  function handleConferenciaFileSelect(file: File | null) {
    setConferenciaError(null);
    if (!file) {
      setConferenciaFile(null);
      return;
    }
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      setConferenciaFile(null);
      setConferenciaError("Formato inválido. Envie um arquivo .xlsx.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setConferenciaFile(null);
      setConferenciaError("O arquivo deve ter no máximo 5 MB.");
      return;
    }
    setConferenciaFile(file);
  }

  async function uploadConferencia() {
    if (!conferenciaFile) return;
    setConferenciaUploading(true);
    setMessage(null);
    setConferenciaError(null);
    setConferenciaProgress(4);
    const form = new FormData();
    form.append("planilha", conferenciaFile);
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/colaborador/conferencia/upload");
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setConferenciaProgress(Math.min(95, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onload = () => {
          const payload = (() => {
            try { return JSON.parse(xhr.responseText || "{}"); } catch { return {}; }
          })();
          if (xhr.status >= 200 && xhr.status < 300) {
            setConferenciaProgress(100);
            resolve();
          } else {
            reject(new Error(payload.error ?? "Não foi possível processar a planilha."));
          }
        };
        xhr.onerror = () => reject(new Error("Erro de conexão ao enviar a planilha."));
        xhr.send(form);
      });
      setConferenciaFile(null);
      setMessage({ text: "Planilha enviada com sucesso.", type: "success" });
      await loadData();
    } catch (error) {
      setConferenciaError(error instanceof Error ? error.message : "Não foi possível processar a planilha.");
    } finally {
      setConferenciaUploading(false);
    }
  }

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (section === "medicoes") loadMedicoes(); }, [section, loadMedicoes]);
  useEffect(() => {
    fetch("/api/usuario/presenca", { method: "POST" }).catch(() => undefined);
    const interval = setInterval(() => {
      fetch("/api/usuario/presenca", { method: "POST" }).catch(() => undefined);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
  // Antes só reatualizava sozinho durante REVISAO_SOLICITADA — por isso o Portal ficava preso em
  // "EM ANÁLISE" (statusConferencia=DIVERGENCIA) até a Equipe resolver e o fornecedor dar F5.
  // Cobre qualquer estado não-terminal: PAGO/CANCELADO não têm mais nada para mudar sozinho.
  const liveRefreshEnabled = !!data && !["PAGO", "CANCELADO"].includes(data.sgc.status);
  const loadDataSilent = useCallback(() => { loadData({ silent: true }); }, [loadData]);
  useLiveRefresh(loadDataSilent, { intervalMs: 5000, enabled: liveRefreshEnabled });

  useEffect(() => {
    if (data?.sgc.status !== "REVISAO_SOLICITADA") {
      chatBaselineRef.current = false;
      previousMedicaoMessageIdsRef.current = new Set();
      return;
    }

    const medicaoMessages = data.sgc.mensagens.filter((message) => message.autor === "MEDICAO");
    const currentIds = new Set(medicaoMessages.map((message) => message.id));
    if (!chatBaselineRef.current) {
      chatBaselineRef.current = true;
      previousMedicaoMessageIdsRef.current = currentIds;
      return;
    }

    const novas = medicaoMessages.filter((message) => !previousMedicaoMessageIdsRef.current.has(message.id));
    previousMedicaoMessageIdsRef.current = currentIds;
    if (!novas.length) return;

    playNotificationSound();
  }, [chatOpen, data?.sgc.mensagens, data?.sgc.status]);

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5]">
        <div className="flex items-center gap-3 text-sm text-[#555555]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
          Carregando ambiente do fornecedor…
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "portal",   label: "Portal",           icon: <LayoutDashboard size={17} /> },
    { id: "medicoes", label: "Minhas Medições",  icon: <History size={17} /> },
  ];

  const aguardando = data.sgc.status === "AGUARDANDO_ENVIO";
  const precisaConferencia = data.sgc.status === "PENDENTE" && data.sgc.statusConferencia !== "CONCLUIDA";

  const TITLES: Record<Section, string> = { portal: "Portal do Fornecedor", medicoes: "Minhas Medições" };

  return (
    <AppShell activeSection={section} onNavigate={(id) => setSection(id as Section)} navItems={navItems} pageTitle={TITLES[section]} sidebarFooter={<AccountMenu user={user} roleLabel="Fornecedor" onLogout={logout} compact />}>
      <PageContainer className="grid gap-5">
        <PageHeader
          eyebrow="Fornecedor"
          title={TITLES[section]}
          description={section === "portal" ? "Acompanhe seu BM, nota fiscal, pagamento e comprovante." : "Consulte o histórico dos ciclos concluídos."}
        />

        {/* ── Portal ── */}
        {/* ── Aguardando envio ── */}
        {section === "portal" && aguardando && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
              <Clock size={30} />
            </div>
            <h2 className="text-section-title text-[#1A1A1A]">Aguardando o envio do BM</h2>
            <p className="mt-2 text-sm text-[#555555]">
              Sua medição ainda não foi disponibilizada pela equipe de Medição.
              <br />
              Assim que for enviada, você poderá visualizar e validar os dados aqui.
            </p>
            <p className="mt-4 text-xs text-[#9CA3AF]">
              Caso tenha dúvidas, entre em contato com a equipe responsável.
            </p>
          </Card>
        )}

        {/* ── Conferência da medição (antes da liberação do BM) ── */}
        {section === "portal" && precisaConferencia && data.sgc.statusConferencia === "AGUARDANDO_UPLOAD" && (
          <Card className="p-6">
            <p className="text-eyebrow mb-1 text-[var(--primary)]">Fornecedor</p>
            <h2 className="text-section-title text-[#1A1A1A]">Conferência da Medição</h2>
            <p className="mt-2 text-sm text-[#555555]">
              Antes de visualizar e aprovar seu BM, informe os documentos correspondentes a este ciclo. Baixe a máscara, preencha os dados e envie o arquivo para conferência.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#F9FAFB] px-3 py-1.5">
              <span className="text-label text-[var(--muted-foreground)]">Ciclo da medição</span>
              <span className="font-technical text-sm font-bold text-[#1A1A1A]">{data.cicloAtivo}</span>
            </div>

            {message && (
              <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${message.type === "success" ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-[#EFF6FF] text-[#2563EB]"}`}>
                {message.text}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href="/api/colaborador/conferencia/mascara"
                download
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#555555] shadow-sm transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <FileUp size={14} />
                Baixar máscara
              </a>
            </div>

            <p className="mt-5 mb-2 text-label text-[var(--muted-foreground)]">Enviar documentos da medição</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDraggingConferencia(true); }}
              onDragLeave={() => setDraggingConferencia(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDraggingConferencia(false);
                handleConferenciaFileSelect(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`rounded-xl border border-dashed px-4 py-5 text-center transition ${draggingConferencia ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[#D1D5DB] bg-white/65 hover:bg-white"}`}
            >
              {!conferenciaFile ? (
                <>
                  <UploadCloud className="mx-auto mb-2 text-[#9CA3AF]" size={26} />
                  <p className="text-sm text-[#555555]">Arraste o arquivo .xlsx aqui ou</p>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#555555] hover:border-[var(--primary)] hover:text-[var(--primary)]">
                    Selecionar arquivo
                    <input
                      type="file"
                      accept=".xlsx,.xlsm"
                      className="hidden"
                      onChange={(e) => handleConferenciaFileSelect(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3 text-left">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileIcon size={18} className="shrink-0 text-[#6B7280]" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#1A1A1A]">{conferenciaFile.name}</p>
                      <p className="mt-0.5 text-xs text-[#6B7280]">{readableFileSize(conferenciaFile.size)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <IconButton onClick={() => handleConferenciaFileSelect(null)} disabled={conferenciaUploading}>
                      <X size={14} />
                    </IconButton>
                    <Button variant="success" className="h-8 px-4" onClick={uploadConferencia} disabled={conferenciaUploading}>
                      {conferenciaUploading ? "Enviando..." : "Enviar"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {conferenciaUploading && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
                <div className="h-full rounded-full bg-[#15803D] transition-all duration-200" style={{ width: `${conferenciaProgress}%` }} />
              </div>
            )}
            {conferenciaError && <p className="mt-2 flex items-center gap-1 text-xs text-[#B91C1C]"><AlertCircle size={13} />{conferenciaError}</p>}
          </Card>
        )}

        {/*
          Status técnico interno (statusConferencia === "DIVERGENCIA") é preservado sem alteração —
          a Equipe de Medição continua vendo "Divergência" normalmente em Pagamentos por
          Fornecedor/Editar Pagamento. Esta tela é só a apresentação para o fornecedor: ele nunca
          precisa da terminologia técnica da conferência, só de saber que a análise está em curso.
        */}
        {section === "portal" && precisaConferencia && data.sgc.statusConferencia === "DIVERGENCIA" && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
              <Clock size={30} />
            </div>
            <h2 className="text-section-title text-[#1A1A1A]">Análise em andamento</h2>
            <p className="mt-2 text-sm text-[#555555]">
              As informações enviadas estão sendo analisadas pela Equipe de Medição.
              <br />
              Aguarde a conclusão da análise.
            </p>
            <div className="mx-auto mt-4 inline-flex items-center gap-4 rounded-lg bg-[#F9FAFB] px-4 py-2">
              <span className="text-label text-[var(--muted-foreground)]">Ciclo <span className="font-technical text-[#1A1A1A]">{data.cicloAtivo}</span></span>
              <span className="text-label text-[var(--muted-foreground)]">Status <Badge variant="warning" className="ml-1">Em análise</Badge></span>
            </div>
          </Card>
        )}

        {/* ── Conteúdo visível após envio do BM e conclusão da conferência ── */}
        {section === "portal" && !aguardando && !precisaConferencia && <>
        <Card className="p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-eyebrow mb-1 text-[var(--primary)]">SISTEMA APROVAÇÃO</p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#1A1A1A]">{statusLabel}</h2>
                {data.sgc.revisaoLabel && <Badge variant="brand">{data.sgc.revisaoLabel}</Badge>}
              </div>
            </div>
            <Badge variant={statusBadge} className="shrink-0 px-3 py-1 text-xs">
              {data.sgc.status}
            </Badge>
          </div>

          {/* Feedback message */}
          {message && (
            <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${message.type === "success" ? "bg-[#F0FDF4] text-[#16A34A]" : "bg-[#EFF6FF] text-[#2563EB]"}`}>
              {message.text}
            </div>
          )}

          {/* Link para Minhas Medições quando segue para acompanhamento financeiro */}
          {isFinancialFollowUpStatus(data.sgc.status) && (
            <div className="mt-5 flex flex-col items-start gap-3 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#15803D]">Acesse <strong>Minhas Medições</strong> para acompanhar o pagamento e os detalhes desta medição.</p>
              <Button variant="success" className="w-full shrink-0 sm:w-auto" onClick={() => setSection("medicoes")}>
                <History size={14} />
                Ver medições
              </Button>
            </div>
          )}

          {/* NF Upload (AGUARDANDO_NF) */}
          {data.sgc.status === "AGUARDANDO_NF" && (
            <div className="mt-5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-5">
              <div className="mb-3 flex items-start gap-2">
                <FileUp size={16} className="mt-0.5 shrink-0 text-[#D97706]" />
                <div>
                  <h3 className="text-sm font-bold text-[#1A1A1A]">Envio da Nota Fiscal</h3>
                  <p className="mt-1 text-xs text-[#92400E]/80">
                    Sua medição foi aprovada. Arraste o arquivo ou selecione no computador. Formato aceito: PDF pesquisável, até 10 MB.
                  </p>
                </div>
              </div>
              <input
                ref={nfInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => selectNfFile(e.target.files?.[0] ?? null)}
              />
              <div
                role="button"
                tabIndex={0}
                className={`rounded-xl border border-dashed px-4 py-5 text-center transition ${draggingNf ? "border-[#D97706] bg-[#FEF3C7]" : "border-[#FBBF24] bg-white/65 hover:bg-white"}`}
                onClick={() => nfInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  nfInputRef.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDraggingNf(true);
                }}
                onDragLeave={() => setDraggingNf(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggingNf(false);
                  selectNfFile(event.dataTransfer.files?.[0] ?? null);
                }}
              >
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF7ED] text-[#D97706]">
                  <UploadCloud size={20} />
                </span>
                <p className="mt-3 text-sm font-semibold text-[#1A1A1A]">Clique para escolher ou arraste a Nota Fiscal</p>
                <p className="mt-1 text-xs text-[#6B7280]">PDF pesquisável</p>
              </div>
              {nfFile && (
                <div className="mt-3 rounded-xl border border-[#FDE68A] bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FFF7ED] text-[#D97706]">
                      <FileIcon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#1A1A1A]">{nfFile.name}</p>
                        <span className="shrink-0 rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-bold text-[#6B7280]">{fileExtension(nfFile.name)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#6B7280]">{readableFileSize(nfFile.size)}</p>
                    </div>
                    {nfError ? (
                      <button
                        type="button"
                        className="rounded-lg p-2 text-[#D97706] hover:bg-[#FFF7ED]"
                        onClick={uploadNf}
                        title="Tentar novamente"
                      >
                        <RotateCcw size={16} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#DC2626]"
                      onClick={() => selectNfFile(null)}
                      disabled={nfUploading}
                      title="Remover arquivo"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#DCFCE7]">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${nfError ? "bg-[#DC2626]" : "bg-[#15803D]"}`}
                      style={{ width: `${nfError ? 100 : nfProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className={`flex items-center gap-1 text-xs ${nfError ? "text-[#B91C1C]" : "text-[#6B7280]"}`}>
                      {nfError ? <AlertCircle size={13} /> : null}
                      {nfError ?? (nfUploading ? `Enviando... ${nfProgress}%` : nfProgress === 100 ? "Arquivo enviado." : "Pronto para envio.")}
                    </p>
                    <Button variant="success" className="h-8 px-4" onClick={uploadNf} disabled={nfUploading}>
                      {nfUploading ? "Enviando..." : nfError ? "Tentar novamente" : "Enviar NF"}
                    </Button>
                  </div>
                </div>
              )}
              {nfError && !nfFile && <p className="mt-2 text-xs text-[#B91C1C]">{nfError}</p>}
            </div>
          )}

          {/* Actions */}
          {canValidate ? (
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" className="h-10 px-5" onClick={() => sendSgc("SALVAR")} disabled={saving}>
                  <Save size={15} />
                  {savingAction === "SALVAR" ? "Salvando..." : "Salvar"}
                </Button>
                <Button
                  variant="success"
                  className="h-10 px-6"
                  onClick={handleEnviar}
                  disabled={saving || !salvoAt}
                  title={!salvoAt ? "Salve primeiro para habilitar o Envio" : undefined}
                >
                  <Send size={15} />
                  Enviar
                </Button>
                <Button
                  variant="ghost"
                  className="h-10 border border-[#F59E0B] bg-[#FFFBEB] px-5 text-[#D97706] hover:bg-[#FEF3C7]"
                  onClick={() => openActionModal("revisao")}
                  disabled={saving}
                >
                  <AlertTriangle size={15} />
                  Solicitar revisão
                </Button>
              </div>
              {!salvoAt && (
                <p className="text-xs text-[#9CA3AF]">
                  Clique em <strong>Salvar</strong> para registrar e depois em <strong>Enviar</strong> para confirmar.
                </p>
              )}
            </div>
          ) : data.sgc.status === "AGUARDANDO_NF" ? null : data.sgc.status === "REVISAO_SOLICITADA" ? (
            <div className="mt-5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#555555]">
              Solicitação enviada. A conversa desta revisão fica disponível no chat flutuante.
            </div>
          ) : data.sgc.status === "CANCELADO" ? (
            <div className="mt-5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#555555]">
              Este BM foi cancelado.
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#555555]">
              A medição está disponível em Minhas Medições para acompanhamento financeiro.
            </div>
          )}

        </Card>

        {actionModal && (canValidate || actionModal === "resposta") && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4">
            <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-2xl">
              <div className="border-b border-[#FDE68A] bg-[#FFFBEB] px-5 py-4">
                <p className="text-base font-bold text-[#1A1A1A]">
                  {actionModal === "revisao" ? "Solicitar revisão" : "Responder equipe de Medição"}
                </p>
                <p className="mt-1 text-sm text-[#555555]">
                  {actionModal === "revisao"
                    ? "Descreva os pontos de discordância para análise da equipe de Medição."
                    : "Leia o retorno recebido e envie uma resposta complementar para a equipe."}
                </p>
              </div>
              <div className="grid gap-4 p-5">
                {modalError && (
                  <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#AF1B1B]">
                    {modalError}
                  </div>
                )}
                {(actionModal === "resposta" || (actionModal === "revisao" && data.sgc.respostaAdmin)) && (
                  <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#2563EB]">Resposta da equipe de Medição</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#1A1A1A]">
                      {data.sgc.respostaAdmin}
                    </p>
                  </div>
                )}
                {actionModal === "resposta" && data.sgc.pontosDiscordancia && (
                  <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#D97706]">Sua solicitação original</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#1A1A1A]">
                      {data.sgc.pontosDiscordancia}
                    </p>
                  </div>
                )}
                {actionModal === "resposta" && data.sgc.observacaoColaborador && (
                  <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">Última resposta enviada</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#1A1A1A]">
                      {data.sgc.observacaoColaborador}
                    </p>
                  </div>
                )}
                <Textarea
                  className="min-h-32 bg-white"
                  value={actionModal === "revisao" ? pontos : respostaFornecedor}
                  onChange={(e) => {
                    if (actionModal === "revisao") setPontos(e.target.value);
                    else setRespostaFornecedor(e.target.value);
                  }}
                  placeholder={
                    actionModal === "revisao"
                      ? "Descreva onde e por que os dados estão incorretos."
                      : "Digite sua resposta para a equipe de Medição."
                  }
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={closeActionModal} disabled={saving}>
                    Cancelar
                  </Button>
                  <Button
                    variant="success"
                    onClick={() => sendSgc(actionModal === "revisao" ? "SOLICITAR_REVISAO" : "RESPONDER_MEDICAO")}
                    disabled={saving}
                  >
                    {saving ? "Enviando..." : actionModal === "revisao" ? "Enviar revisão" : "Enviar resposta"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Resumo do fornecedor (oculto no acompanhamento financeiro) ── */}
        <Card className={`overflow-hidden ${isFinancialFollowUpStatus(data.sgc.status) ? "hidden" : ""}`}>
          <div className="grid gap-5 p-5 xl:grid-cols-[1.15fr_0.9fr_0.95fr]">
            <section className="min-w-0">
              <div className="mb-4 flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB]">
                  <UserRound size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#9CA3AF]">Fornecedor</p>
                  <h2 className="truncate text-base font-bold text-[#1A1A1A]">{data.usuario.nome}</h2>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <SummaryField label="ID" value={data.usuario.codigo} />
                <SummaryField label="Função" value={data.usuario.funcao || "Cadastro em atualização"} />
                <SummaryField label="CPF / CNPJ" value={data.usuario.cnpj || data.usuario.cpf || "Cadastro em atualização"} />
                <SummaryField label="E-mail" value={displayEmail(data.usuario.email) || "Cadastro em atualização"} />
                <div className="sm:col-span-2">
                  <SummaryField label="Razão social" value={data.usuario.razaoSocial || "Cadastro em atualização"} />
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
              <div className="mb-4 flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#D97706] ring-1 ring-[#FDE68A]">
                  <FileText size={17} />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#D97706]">Alocação</p>
                  <p className="text-sm font-bold text-[#1A1A1A]">{data.alocacao?.ato ?? "–"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {contratos.length ? contratos.map(([label, value]) => (
                  <span key={label} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#1A1A1A] ring-1 ring-[#FDE68A]">
                    {label}
                    <strong className="text-[#D97706]">{ratio(value)}</strong>
                  </span>
                )) : (
                  <span className="text-sm text-[#92400E]">Nenhum contrato informado.</span>
                )}
                {resultadoParticipacao && resultadoParticipacao.documentosPendentes > 0 && (
                  <span
                    className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#B45309] ring-1 ring-[#FCD34D]"
                    title={`${resultadoParticipacao.documentosPendentes} documento(s) sem contrato (CTO) válido`}
                  >
                    Não classificado
                    <strong>{ratio(resultadoParticipacao.percentualNaoClassificado / 100)}</strong>
                  </span>
                )}
              </div>
              <div className="mt-4 rounded-lg bg-white px-3 py-2 ring-1 ring-[#FDE68A]">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#D97706]">Atuação</p>
                <p className="mt-1 text-sm font-semibold text-[#1A1A1A]">{data.usuario.statusColaborador ?? "–"}</p>
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
              <div className="mb-4 flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#16A34A] ring-1 ring-[#BBF7D0]">
                  <Banknote size={17} />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#16A34A]">Pagamento previsto</p>
                  <p className="text-xl font-bold text-[#1A1A1A]">{currency.format(data.pagamento?.valor ?? 0)}</p>
                </div>
              </div>
              <div className="grid gap-2">
                <SummaryField label="Revisão" value={data.pagamento?.rev ? currency.format(data.pagamento.rev) : "–"} />
                <SummaryField label="Responsável" value={data.pagamento?.responsavel} />
                <SummaryField label="Empresa" value={data.pagamento?.razaoSocial} />
              </div>
            </section>
          </div>
        </Card>

        {/* ── Documentos não considerados (divergências descartadas pela Equipe) ──
             Nunca usar a palavra "Divergência" aqui — regra de UX já estabelecida para o Portal.
             Não renderiza nada se não houver nenhum documento descartado (sem card vazio). */}
        {data.documentosDescartados.length > 0 && (
          <Card className={`overflow-hidden ${isFinancialFollowUpStatus(data.sgc.status) ? "hidden" : ""}`}>
            <div className="px-5 py-4">
              <h2 className="text-sm font-bold text-[#1A1A1A]">Documentos não considerados</h2>
              <p className="mt-0.5 text-sm text-[#555555]">
                {data.documentosDescartados.length === 1
                  ? "1 documento não foi considerado nesta medição."
                  : `${data.documentosDescartados.length} documentos não foram considerados nesta medição.`}
              </p>
            </div>
            <div className="grid gap-2 px-5 pb-5">
              {data.documentosDescartados.map((d) => (
                <div key={d.id} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">Documento</p>
                  <p className="font-technical text-sm font-semibold text-[#1A1A1A]">{d.nrVale}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-[#6B7280]">Motivo</p>
                  <p className="text-sm text-[#555555]">{d.motivo}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── Documents (oculto no acompanhamento financeiro) ── */}
        <Card className={`overflow-hidden ${isFinancialFollowUpStatus(data.sgc.status) ? "hidden" : ""}`}>
          <button
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#FAFAFA]"
            onClick={() => setDocumentsOpen((v) => !v)}
          >
            <div>
              <h2 className="text-sm font-bold text-[#1A1A1A]">Documentos da Medição do Ciclo</h2>
              <p className="mt-0.5 text-sm text-[#555555]">
                {data.documentos.filter((documento) => !isDiscountDocument(documento)).length} documentos vinculados ao ID {data.usuario.codigo} no ciclo {data.cicloAtivo}.
              </p>
            </div>
            <ChevronDown className={`shrink-0 text-[#9CA3AF] transition-transform duration-200 ${documentsOpen ? "rotate-180" : ""}`} size={18} />
          </button>

          {documentsOpen && (() => {
            const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
            const fmtN = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
            const fmtP = (v: number) => new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(v);
            const valorDocumento = (documento: ColaboradorData["documentos"][number]) =>
              documento.valorMedido ?? (documento.equivalenteA1Horas * (parseFloat(documento.condicao ?? "0") || 0) * documento.percentualEmissao);
            const documentosMedidos = data.documentos.filter((documento) => !isDiscountDocument(documento));
            const descontos = data.documentos.filter((documento) => isDiscountDocument(documento));
            const condicoesFixas = data.pagamento?.condicoesFixas;
            const valorFixo = parseCurrencyNumber(condicoesFixas?.valorFixo);
            const adicionaisFixos = parseCurrencyNumber(condicoesFixas?.adicionaisFixos);
            const totalCondicoesFixas = valorFixo + adicionaisFixos;
            const totalDocumentos = documentosMedidos.reduce((sum, documento) => sum + valorDocumento(documento), 0);
            const totalDescontos = descontos.reduce((sum, documento) => sum + Math.abs(valorDocumento(documento)), 0);
            const totalLiquido = totalCondicoesFixas + totalDocumentos - totalDescontos;
            const hasFinancialAdjustments = totalCondicoesFixas > 0 || totalDescontos > 0;
            const tipoCondicaoFixa = normalizeText(condicoesFixas?.tipoContratacao) || "FIXO PJ";
            const hasObs = documentosMedidos.some((d) => d.obs) || descontos.some((d) => d.obs);
            const headers = ["SE", "NR VALE / Projeto", "CTO", "Formato", "A1eq / HH", "% Emissão", "Tipo DG/DOC/HH", "Preço Unit.", "Valor Medido", "Total", ...(hasObs ? ["Observação"] : [])];
            return (
              <div className="border-t border-[#E5E7EB]">
                <div className="overflow-x-auto pb-2">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F9FAFB]">
                        {headers.map((h) => (
                          <th key={h} className="text-table-header whitespace-nowrap border-b border-[#E5E7EB] px-4 py-2.5 text-left text-[var(--muted-foreground)]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {totalCondicoesFixas > 0 && (
                        <tr className="border-b border-[#DBEAFE] bg-[#EFF6FF]/70 text-[#1D4ED8]">
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-md border border-[#BFDBFE] bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2563EB]">
                              Condição fixa
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#2563EB]" colSpan={7}>
                            Provento base contratual - {tipoCondicaoFixa}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-[#1D4ED8]">{currency.format(totalCondicoesFixas)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-[#1D4ED8]">{currency.format(totalCondicoesFixas)}</td>
                          {hasObs && <td className="px-4 py-3 text-[#2563EB]">{condicoesFixas?.observacoesContrato ?? "Base fixa"}</td>}
                        </tr>
                      )}

                      {documentosMedidos.map((d, i) => {
                        const valorMedido = valorDocumento(d);
                        return (
                          <tr key={d.id} className={`border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA] ${i % 2 !== 0 ? "bg-[#FAFAFA]" : ""}`}>
                            <td className="px-4 py-3 font-medium text-[#1A1A1A]">{d.projetoReferente}</td>
                            <td className="px-4 py-3 text-[#555555]">{d.numeroDocumento ?? "–"}</td>
                            <td className="px-4 py-3 text-[#555555]">{d.contrato ?? "–"}</td>
                            <td className="px-4 py-3 text-[#555555]">{d.formato ?? "–"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{fmtN(d.equivalenteA1Horas)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{d.percentualEmissao ? fmtP(d.percentualEmissao) : "100%"}</td>
                            <td className="px-4 py-3 text-[#555555]">{d.tipo2 ?? "–"}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{d.precoUnitario ? currency.format(d.precoUnitario) : (d.condicao ?? "–")}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{currency.format(valorMedido)}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#1A1A1A]">{currency.format(valorMedido)}</td>
                            {hasObs && <td className="px-4 py-3 text-[#555555]">{d.obs ?? ""}</td>}
                          </tr>
                        );
                      })}

                      {descontos.map((d) => {
                        const valorDesconto = Math.abs(valorDocumento(d));
                        return (
                          <tr key={d.id} className="border-b border-[#FEE2E2] text-[#DC2626] last:border-0">
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-md border border-[#FECACA] bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#DC2626]">
                                Desconto
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-[#DC2626]" colSpan={7}>
                              {d.obs || d.numeroDocumento || "Desconto aplicado"}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-bold text-[#DC2626]">- {currency.format(valorDesconto)}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-bold text-[#DC2626]">- {currency.format(valorDesconto)}</td>
                            {hasObs && <td className="px-4 py-3 text-[#DC2626]">{d.obs ?? "Dedução"}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                    {!hasFinancialAdjustments && documentosMedidos.length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB]">
                          <td colSpan={8} className="px-4 py-2.5 text-right text-xs font-bold text-[#555555]">Total medido:</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold text-[#1A1A1A]">{currency.format(totalDocumentos)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs font-bold text-[#1A1A1A]">{currency.format(totalDocumentos)}</td>
                          {hasObs && <td />}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {hasFinancialAdjustments && (
                  <div className="flex justify-end px-5 pb-5 pt-4">
                    <div className="grid w-80 min-w-[280px] gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-xs shadow-sm">
                      {totalCondicoesFixas > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#6B7280]">Condições fixas:</span>
                          <span className="tabular-nums font-semibold text-[#1F2937]">{currency.format(totalCondicoesFixas)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-[#6B7280]">Documentos medidos:</span>
                        <span className="tabular-nums font-semibold text-[#1F2937]">{currency.format(totalDocumentos)}</span>
                      </div>
                      {totalDescontos > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#6B7280]">Descontos:</span>
                          <span className="tabular-nums font-semibold text-[#DC2626]">- {currency.format(totalDescontos)}</span>
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-4 border-t border-[#E5E7EB] pt-2">
                        <span className="font-bold text-[#111827]">Total medido líquido:</span>
                        <span className="tabular-nums text-sm font-bold text-[#111827]">{currency.format(totalLiquido)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </Card>
        </>}

        {/* ── Minhas Medições ── */}
        {section === "medicoes" && (
          medLoading ? (
            <div className="flex items-center justify-center py-20 text-sm text-[#555555]">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
                Carregando medições…
              </div>
            </div>
          ) : medicoes.length === 0 ? (
            <Card className="p-10 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
                <History size={30} />
              </div>
              <h2 className="text-section-title text-[#1A1A1A]">Nenhuma medição disponível</h2>
              <p className="mt-2 text-sm text-[#555555]">
                As medições aprovadas ou aguardando NF aparecerão aqui.
              </p>
            </Card>
          ) : (
            <div className="grid gap-5">
              {medicoes.map((med) => (
                <MedicaoAprovadaCard key={med.id} med={med} onReload={loadMedicoes} />
              ))}
            </div>
          )
      )}
    </PageContainer>
      {section === "portal" && data.sgc.status === "REVISAO_SOLICITADA" && (
        <RevisionChatWidget
          mensagens={data.sgc.mensagens}
          medicaoOnline={data.sgc.medicaoOnline}
          fornecedorNome={data.usuario.nome}
          fornecedorAvatarUrl={data.usuario.avatarUrl}
          sgcId={data.sgc.id}
          open={chatOpen}
          draft={chatDraft}
          sending={chatSending}
  pendingMessage={pendingChatMessage}
          onOpenChange={setChatOpen}
          onDraftChange={setChatDraft}
          onSend={sendChatMessage}
          onRead={markChatRead}
          onAudioSent={async (message) => {
            setPendingChatMessage(message);
            if (!message) await loadData({ silent: true });
          }}
        />
      )}
      <GeneralChatWidget className={section === "portal" && data.sgc.status === "REVISAO_SOLICITADA" ? "bottom-20" : "bottom-5"} />
    </AppShell>
  );
}

function RevisionChatWidget({
  mensagens,
  medicaoOnline,
  fornecedorNome,
  fornecedorAvatarUrl,
  sgcId,
  open,
  draft,
  sending,
  pendingMessage,
  onOpenChange,
  onDraftChange,
  onSend,
  onRead,
  onAudioSent,
}: {
  mensagens: SgcChatMessage[];
  medicaoOnline: boolean;
  fornecedorNome: string;
  fornecedorAvatarUrl: string | null;
  sgcId: string | null;
  open: boolean;
  draft: string;
  sending: boolean;
  pendingMessage: (SgcChatMessage & { enviando?: boolean }) | null;
  onOpenChange: (value: boolean) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onRead: () => void;
  onAudioSent: (message: (SgcChatMessage & { enviando?: boolean }) | null) => Promise<void>;
}) {
  const hasUnread = hasUnreadMedicaoMessages(mensagens);
  const visibleMessages = pendingMessage ? [...mensagens, pendingMessage] : mensagens;
  const unreadKey = mensagens.filter((message) => message.autor === "MEDICAO" && !message.lidoAt).map((message) => message.id).join(",");
  const markedReadRef = useRef<string | null>(null);
  const latestMedicaoMessage = visibleMessages.at(-1);
  const [gravando, setGravando] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageKey = visibleMessages.at(-1)?.id ?? sgcId ?? "chat";

  useEffect(() => {
    if (!open || !sgcId || !unreadKey) return;
    const markKey = `${sgcId}:${unreadKey}`;
    if (markedReadRef.current === markKey) return;
    markedReadRef.current = markKey;
    onRead();
  }, [open, onRead, sgcId, unreadKey]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, lastMessageKey]);

  if (!open) {
    return (
      <button
        className={`fixed bottom-5 right-5 z-50 inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white shadow-xl ${hasUnread ? "bg-[#16A34A] hover:bg-[#15803D]" : "bg-[#2563EB] hover:bg-[#1D4ED8]"}`}
        onClick={() => onOpenChange(true)}
      >
        <MessageCircle size={18} />
        Chat da revisão
      </button>
    );
  }

  async function enviarAudio(blob: Blob) {
    if (!sgcId) return;
    const localUrl = URL.createObjectURL(blob);
    const pending: SgcChatMessage & { enviando?: boolean } = {
      id: "pending-fornecedor-audio",
      autor: "FORNECEDOR",
      autorNome: fornecedorNome,
      autorAvatarUrl: fornecedorAvatarUrl,
      texto: "Áudio",
      tipo: "AUDIO",
      audioUrl: localUrl,
      audioMime: blob.type || "audio/webm",
      audioNome: "audio.webm",
      lidoAt: null,
      criadoAt: new Date().toISOString(),
      enviando: true,
    };
    await onAudioSent(pending);
    const form = new FormData();
    form.append("sgcId", sgcId);
    form.append("audio", blob, "audio.webm");
    await fetch("/api/sgc/chat/audio", { method: "POST", body: form });
    URL.revokeObjectURL(localUrl);
    await onAudioSent(null);
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

  return (
    <div className="fixed bottom-5 right-5 z-50 grid h-[min(560px,calc(100vh-40px))] min-h-0 w-[min(860px,calc(100vw-24px))] grid-cols-1 overflow-hidden rounded-xl border border-[#D1D5DB] bg-white shadow-2xl md:grid-cols-[300px_1fr]">
      <aside className="hidden min-h-0 min-w-0 border-r border-[#E5E7EB] bg-white md:flex md:flex-col">
        <div className="border-b border-[#E5E7EB] px-4 py-3">
          <p className="text-base font-bold text-[#1A1A1A]">Conversas</p>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-xs text-[#9CA3AF]">
            <Search size={14} />
            Pesquise conversas
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <button className="flex w-full gap-3 border-b border-[#F3F4F6] bg-[#EFF6FF] px-4 py-3 text-left">
            <ChatAvatar name="Equipe de Medição" unread={hasUnread} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">Equipe de Medição</p>
                <span className="shrink-0 text-[10px] text-[#9CA3AF]">{latestMedicaoMessage ? chatTime(latestMedicaoMessage.criadoAt).split(", ").at(-1) : ""}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[#6B7280]">{latestMedicaoMessage?.texto ?? "Sem mensagens."}</p>
            </div>
          </button>
          <button className="flex w-full gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left opacity-70">
            <ChatAvatar name="Financeiro" className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-[#1A1A1A]">Financeiro</p>
                <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-semibold text-[#6B7280]">em breve</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[#6B7280]">Canal reservado para notas fiscais e pagamentos.</p>
            </div>
          </button>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChatAvatar name="Equipe de Medição" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#1A1A1A]">Equipe de Medição</p>
              <p className={`text-xs ${medicaoOnline ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>
                {medicaoOnline ? "online" : "offline"}
              </p>
            </div>
          </div>
          <button className="rounded-full p-1 text-[#6B7280] hover:bg-white hover:text-[#1A1A1A]" onClick={() => onOpenChange(false)} aria-label="Fechar chat">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F3F4F6] px-4 py-4">
          {visibleMessages.length ? (
            visibleMessages.map((mensagem) => {
              const isFornecedor = mensagem.autor === "FORNECEDOR";
              return (
                <div key={mensagem.id} className={`flex items-end gap-2 ${isFornecedor ? "justify-end" : "justify-start"}`}>
                  {!isFornecedor && (
                    <ChatAvatar
                      name={mensagem.autorNome}
                      src={mensagem.autorAvatarUrl}
                      className="h-7 w-7 text-[10px]"
                    />
                  )}
                  <div className={`max-w-[82%] rounded-xl px-3 py-2 text-sm shadow-sm ${isFornecedor ? "rounded-br-sm bg-[#DBEAFE] text-[#1E3A8A]" : "rounded-bl-sm bg-white text-[#1A1A1A]"}`}>
                    <p className={`mb-1 text-[11px] font-bold ${isFornecedor ? "text-[#1D4ED8]" : "text-[#2563EB]"}`}>
                      {mensagem.autorNome}
                    </p>
                    {mensagem.tipo === "AUDIO" && mensagem.audioUrl ? (
                      <div className="min-w-52">
                        <audio controls preload="metadata" src={mensagem.audioUrl} className="h-9 w-full" />
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{mensagem.texto}</p>
                    )}
                    <div className={`mt-1.5 flex items-center gap-1 text-[10px] font-semibold opacity-70 ${isFornecedor ? "justify-end" : "justify-start"}`}>
                      <span>{chatTime(mensagem.criadoAt)}</span>
                      {isFornecedor && <ChatReceipt read={!!mensagem.lidoAt} sending={mensagem.enviando} />}
                    </div>
                  </div>
                  {isFornecedor && (
                    <ChatAvatar
                      name={mensagem.autorNome}
                      src={mensagem.autorAvatarUrl ?? fornecedorAvatarUrl}
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
          <div className="flex items-end gap-2">
            <textarea
              className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
              placeholder="Digite uma nova mensagem..."
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
            />
            <Button
              variant={gravando ? "danger" : "secondary"}
              className="h-11 shrink-0 px-3"
              onClick={toggleGravacao}
              title={gravando ? "Parar gravação" : "Enviar áudio"}
            >
              {gravando ? <StopCircle size={15} /> : <Mic size={15} />}
            </Button>
            <Button className="h-11 shrink-0 px-4" onClick={onSend} disabled={sending || !draft.trim()}>
              <Send size={13} />
              {sending ? "..." : "Enviar"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── MedicaoAprovadaCard ──────────────────────────────────────────────────────

function MedicaoAprovadaCard({ med, onReload }: { med: MedicaoAprovada; onReload: () => void }) {
  const cur = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const [bmOpen, setBmOpen] = useState(false);
  const [nfFile, setNfFile] = useState<File | null>(null);
  const [nfUploading, setNfUploading] = useState(false);
  const [nfProgress, setNfProgress] = useState(0);
  const [nfError, setNfError] = useState<string | null>(null);
  const [draggingNf, setDraggingNf] = useState(false);
  const nfInputRef = useRef<HTMLInputElement | null>(null);

  const isAguardandoNf = med.status === "AGUARDANDO_NF";
  const isAguardandoPagamento = med.status === "APROVADO";
  const isConcluida = med.status === "PAGO";

  const aprovadoLabel = med.aprovadoAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.aprovadoAt))
    : "–";

  const nfEnviadaLabel = med.nfCarregadoAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.nfCarregadoAt))
    : null;

  const totalValor = (med.pagamento?.valor ?? 0) + (med.pagamento?.rev ?? 0);

  function selectNfFile(file: File | null) {
    setNfError(null);
    setNfProgress(0);
    if (!file) {
      setNfFile(null);
      return;
    }

    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
    const allowedExtensions = /\.(pdf|jpg|jpeg|png)$/i;
    if (!allowedTypes.has(file.type) && !allowedExtensions.test(file.name)) {
      setNfFile(null);
      setNfError("Formato inválido. Envie PDF, JPG ou PNG.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNfFile(null);
      setNfError("A Nota Fiscal deve ter no máximo 10 MB.");
      return;
    }
    setNfFile(file);
  }

  async function uploadNf() {
    if (!nfFile) return;
    setNfUploading(true);
    setNfError(null);
    setNfProgress(4);
    const form = new FormData();
    form.append("nf", nfFile);
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/colaborador/nf");
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setNfProgress(Math.min(95, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onload = () => {
          const payload = (() => {
            try { return JSON.parse(xhr.responseText || "{}"); } catch { return {}; }
          })();
          if (xhr.status >= 200 && xhr.status < 300) {
            setNfProgress(100);
            resolve();
          } else {
            reject(new Error(payload.error ?? "Erro ao enviar a NF."));
          }
        };
        xhr.onerror = () => reject(new Error("Erro de conexão ao enviar a NF."));
        xhr.send(form);
      });
      setNfFile(null);
      onReload();
    } catch (error) {
      setNfError(error instanceof Error ? error.message : "Erro ao enviar a NF.");
    } finally {
      setNfUploading(false);
    }
  }

  const headerBg = isAguardandoNf
    ? "border-[#FDE68A] bg-[#FFFBEB]"
    : isAguardandoPagamento
      ? "border-[#BFDBFE] bg-[#EFF6FF]"
      : "border-[#BBF7D0] bg-[#F0FDF4]";
  const iconBg = isAguardandoNf
    ? "bg-[#D97706]/10 text-[#D97706]"
    : isAguardandoPagamento
      ? "bg-[#2563EB]/10 text-[#2563EB]"
      : "bg-[#16A34A]/10 text-[#16A34A]";
  const titleColor = isAguardandoNf
    ? "text-[#92400E]"
    : isAguardandoPagamento
      ? "text-[#1D4ED8]"
      : "text-[#15803D]";
  const subColor = isAguardandoNf
    ? "text-[#D97706]"
    : isAguardandoPagamento
      ? "text-[#2563EB]"
      : "text-[#16A34A]";
  const StatusIcon = isAguardandoNf ? FileUp : isAguardandoPagamento ? Clock : CheckCircle2;
  const statusTitle = isAguardandoNf
    ? "Aguardando NF"
    : isAguardandoPagamento
      ? "Aguardando pagamento"
      : isConcluida
        ? "Medição Concluída"
        : "Medição";
  const statusSubtitle = isAguardandoNf
    ? "Envie a Nota Fiscal para seguir com o pagamento"
    : isAguardandoPagamento
      ? nfEnviadaLabel
        ? `NF enviada em ${nfEnviadaLabel}. Pagamento pendente.`
        : "Nota Fiscal recebida. Pagamento pendente."
      : med.comprovanteCarregadoAt
        ? `Pagamento concluído em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.comprovanteCarregadoAt))}`
        : `Aprovado em ${aprovadoLabel}`;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className={`border-b px-5 py-4 ${headerBg}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
              <StatusIcon size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-bold ${titleColor}`}>
                  {statusTitle} — Ciclo {med.ciclo}
                </p>
                {med.revisaoLabel && (
                  <Badge variant={isAguardandoNf ? "warning" : isAguardandoPagamento ? "brand" : "success"} className="shrink-0">
                    {med.revisaoLabel}
                  </Badge>
                )}
              </div>
              <p className={`text-xs ${subColor}`}>
                {statusSubtitle}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-stat-label uppercase tracking-wide text-[#9CA3AF]">Valor total</p>
            <p className="text-base font-bold text-[#1A1A1A]">{cur.format(totalValor)}</p>
          </div>
        </div>
      </div>

      {/* NF status / upload */}
      {isAguardandoNf && (
        <div className="border-b border-[#FDE68A] bg-[#FFFBEB] px-5 py-4">
          <div className="mb-3 flex items-start gap-2">
            <FileUp size={16} className="mt-0.5 shrink-0 text-[#D97706]" />
            <div>
              <p className="text-sm font-semibold text-[#92400E]">Envio da Nota Fiscal</p>
              <p className="mt-1 text-xs text-[#92400E]/80">Arraste o arquivo ou selecione no computador. Formato aceito: PDF pesquisável, até 10 MB.</p>
            </div>
          </div>
          <input
            ref={nfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => selectNfFile(e.target.files?.[0] ?? null)}
          />
          <div
            role="button"
            tabIndex={0}
            className={`rounded-xl border border-dashed px-4 py-5 text-center transition ${draggingNf ? "border-[#D97706] bg-[#FEF3C7]" : "border-[#FBBF24] bg-white/65 hover:bg-white"}`}
            onClick={() => nfInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              nfInputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDraggingNf(true);
            }}
            onDragLeave={() => setDraggingNf(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDraggingNf(false);
              selectNfFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF7ED] text-[#D97706]">
              <UploadCloud size={20} />
            </span>
            <p className="mt-3 text-sm font-semibold text-[#1A1A1A]">Clique para escolher ou arraste a Nota Fiscal</p>
            <p className="mt-1 text-xs text-[#6B7280]">PDF pesquisável</p>
          </div>
          {nfFile && (
            <div className="mt-3 rounded-xl border border-[#FDE68A] bg-white p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FFF7ED] text-[#D97706]">
                  <FileIcon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[#1A1A1A]">{nfFile.name}</p>
                    <span className="shrink-0 rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-bold text-[#6B7280]">{fileExtension(nfFile.name)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#6B7280]">{readableFileSize(nfFile.size)}</p>
                </div>
                {nfError ? (
                  <button
                    type="button"
                    className="rounded-lg p-2 text-[#D97706] hover:bg-[#FFF7ED]"
                    onClick={uploadNf}
                    title="Tentar novamente"
                  >
                    <RotateCcw size={16} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#DC2626]"
                  onClick={() => selectNfFile(null)}
                  disabled={nfUploading}
                  title="Remover arquivo"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#DCFCE7]">
                <div
                  className={`h-full rounded-full transition-all duration-200 ${nfError ? "bg-[#DC2626]" : "bg-[#15803D]"}`}
                  style={{ width: `${nfError ? 100 : nfProgress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className={`flex items-center gap-1 text-xs ${nfError ? "text-[#B91C1C]" : "text-[#6B7280]"}`}>
                  {nfError ? <AlertCircle size={13} /> : null}
                  {nfError ?? (nfUploading ? `Enviando... ${nfProgress}%` : nfProgress === 100 ? "Arquivo enviado." : "Pronto para envio.")}
                </p>
                <Button variant="success" className="h-8 px-4" onClick={uploadNf} disabled={nfUploading}>
                  {nfUploading ? "Enviando..." : nfError ? "Tentar novamente" : "Enviar NF"}
                </Button>
              </div>
            </div>
          )}
          {nfError && !nfFile && <p className="mt-2 text-xs text-[#B91C1C]">{nfError}</p>}
        </div>
      )}

      {!isAguardandoNf && med.nfArquivoNome && (
        <div className={`flex items-center gap-3 border-b px-5 py-3 ${isAguardandoPagamento ? "border-[#BFDBFE] bg-[#EFF6FF]" : "border-[#BBF7D0] bg-[#F0FDF4]"}`}>
          <FileText size={14} className={`shrink-0 ${isAguardandoPagamento ? "text-[#2563EB]" : "text-[#16A34A]"}`} />
          <span className={`flex-1 text-xs ${isAguardandoPagamento ? "text-[#1D4ED8]" : "text-[#15803D]"}`}>
            NF enviada: <strong>{med.nfArquivoNome}</strong>
            {nfEnviadaLabel && <span className={`ml-1 ${isAguardandoPagamento ? "text-[#2563EB]/70" : "text-[#16A34A]/70"}`}>· {nfEnviadaLabel}</span>}
          </span>
          <a
            href={`/api/colaborador/nf/${med.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${isAguardandoPagamento ? "bg-[#2563EB] hover:bg-[#1D4ED8]" : "bg-[#16A34A] hover:bg-[#15803D]"}`}
          >
            Visualizar NF
          </a>
        </div>
      )}

      {med.status === "PAGO" && med.comprovanteArquivoNome && (
        <div className="flex items-center gap-3 border-b border-[#BFDBFE] bg-[#EFF6FF] px-5 py-3">
          <FileText size={14} className="shrink-0 text-[#2563EB]" />
          <span className="flex-1 text-xs text-[#1D4ED8]">
            Comprovante de pagamento: <strong>{med.comprovanteArquivoNome}</strong>
            {med.comprovanteCarregadoAt && (
              <span className="ml-1 text-[#2563EB]/70">
                · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(med.comprovanteCarregadoAt))}
              </span>
            )}
          </span>
          <a
            href={`/api/colaborador/comprovante/${med.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
          >
            Ver comprovante
          </a>
        </div>
      )}

      {/* Dropdown do Boletim */}
      <button
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#FAFAFA]"
        onClick={() => setBmOpen((v) => !v)}
      >
        <span className="text-sm font-medium text-[#555555]">
          {bmOpen ? "Ocultar" : "Ver"} Boletim de Medição
        </span>
        <ChevronDown className={`shrink-0 text-[#9CA3AF] transition-transform duration-200 ${bmOpen ? "rotate-180" : ""}`} size={16} />
      </button>

      {bmOpen && (
        <div className="border-t border-[#E5E7EB] p-5">
          <BoletimMedicao data={med} />
        </div>
      )}
    </Card>
  );
}
