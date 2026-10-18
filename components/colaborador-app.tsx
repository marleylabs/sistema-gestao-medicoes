"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import {
  AlertCircle,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  File as FileIcon,
  FileText,
  FileUp,
  LayoutDashboard,
  History,
  MessageCircle,
  Mic,
  RotateCcw,
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
import { MinhasMedicoes, type MedicaoAprovada } from "@/components/minhas-medicoes";
import {
  AprovarBoletimDialog,
  BoletimResumoPortal,
  ComposicaoPortal,
  DocumentosMedicaoPortal,
  EstadoConcluido,
  formatDataHora,
  PortalFeedback,
  ResponderMedicaoDialog,
  SolicitarRevisaoDialog,
} from "@/components/portal-fornecedor";
import { Badge, Button, Card, IconButton, PageContainer, PageHeader, Skeleton } from "@/components/ui";
import { AnimatedText, ENTRADA_JANELA, ENTRADA_MENSAGEM, Stagger, StaggerItem } from "@/components/motion";
import type { AuthUser } from "@/lib/session";
import { calcularBoletim } from "@/lib/boletim-calculo";
import { isFinancialFollowUpStatus, podeAprovarBm } from "@/lib/portal-fornecedor";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

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

/** Passo da validação que o fornecedor deve fazer agora (salvar, depois aprovar). */
const PASSO_ATUAL = "border-[var(--primary)] shadow-[inset_0_0_0_1px_var(--primary)]";

function readableFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function fileExtension(name: string) {
  return name.split(".").pop()?.toUpperCase() || "ARQ";
}

function hasUnreadMedicaoMessages(messages: SgcChatMessage[]) {
  return messages.some((message) => message.autor === "MEDICAO" && !message.lidoAt);
}

function ChatReceipt({ read, sending }: { read: boolean; sending?: boolean }) {
  if (sending) return <Check size={13} className="text-[var(--muted-foreground)]" />;
  return <CheckCheck size={13} className={read ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"} />;
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
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${className} ${unread ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--primary-soft)] text-[var(--primary)]"}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

function displayEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

// ─── ColaboradorApp ───────────────────────────────────────────────────────────


type Section = "portal" | "medicoes";

export function ColaboradorApp({ user }: { user: AuthUser }) {
  const [section, setSection]               = useState<Section>("portal");
  const [data, setData]                     = useState<ColaboradorData | null>(null);
  const [loading, setLoading]               = useState(true);
  const [loadError, setLoadError]           = useState<"sessao" | "erro" | null>(null);
  const [medicoes, setMedicoes]             = useState<MedicaoAprovada[]>([]);
  const [medLoading, setMedLoading]         = useState(false);
  const [medErro, setMedErro]               = useState<string | null>(null);
  const [actionModal, setActionModal]       = useState<"revisao" | "resposta" | null>(null);
  const [aprovarOpen, setAprovarOpen]       = useState(false);
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

  const canValidate = !!data && podeAprovarBm(data.sgc.status, data.sgc.statusConferencia);
  // Ação pendente do fornecedor (aprovar o BM ou enviar a NF): o card de ação fica em destaque.
  const acaoPendente = canValidate || data?.sgc.status === "AGUARDANDO_NF";

  // Cálculo canônico do BM (lib/boletim-calculo.ts): o MESMO total que o PDF, o Histórico, as
  // Evidências e o Financeiro mostram, e que o editor grava em mapaPagamentoItem.valor.
  const calculo = useMemo(() => {
    if (!data) return null;
    return calcularBoletim({
      documentos: data.documentos,
      condicoesFixas: data.pagamento?.condicoesFixas,
      valorInformado: data.pagamento?.valor ?? null,
      rev: data.pagamento?.rev ?? 0,
    });
  }, [data]);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/colaborador/me");
      // Sem checar res.ok: uma resposta de erro (ex.: 401 numa janela curta de troca de sessão)
      // tem o formato {error: "..."}, sem "sgc" — e todo o resto do componente lê data.sgc.status
      // sem optional chaining, o que crashava com "Cannot read properties of undefined". Numa
      // falha, mantém o último estado válido em tela (item já estabelecido nesta sessão: nunca
      // apagar dados atuais por causa de uma consulta automática que falhou).
      if (res.ok) {
        setData(await res.json());
        setLoadError(null);
      } else {
        // Só aparece quando ainda não há nenhum dado em tela (ver render): sessão expirada ou erro.
        setLoadError(res.status === 401 ? "sessao" : "erro");
      }
    } catch {
      setLoadError("erro");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const loadMedicoes = useCallback(async () => {
    setMedLoading(true);
    try {
      const res = await fetch("/api/colaborador/medicoes");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setMedicoes(json.medicoes ?? []);
      setMedErro(null);
    } catch {
      // Sem loading infinito: falha vira estado de erro com "Tentar novamente".
      setMedErro("Não foi possível carregar suas medições.");
    } finally {
      setMedLoading(false);
    }
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
      if (actionModal || aprovarOpen) setModalError(errorText);
      else setMessage({ text: errorText, type: "info" });
      return;
    }
    if (action === "SALVAR") {
      setSalvoAt(payload.salvoAt ?? new Date().toISOString());
      setMessage({ text: "Validação salva com sucesso.", type: "success" });
      return;
    }
    closeActionModal();
    setAprovarOpen(false);
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

  // Aprovar = a mesma ação ENVIAR de sempre (exige SALVAR antes, regra do servidor). Só a confirmação
  // mudou: diálogo da própria aplicação no lugar da confirmação nativa do navegador.
  function handleEnviar() {
    if (sgcRequestInFlightRef.current) return;
    setModalError(null);
    setAprovarOpen(true);
  }

  function fecharAprovar() {
    setModalError(null);
    setAprovarOpen(false);
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

  // Recargas depois de uma ação mantêm o conteúdo em tela; o carregamento cheio só aparece sem dados.
  if (!data) {
    if (loading || !loadError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
          {/* Esqueleto do portal (resumo e ação) enquanto os dados chegam; o texto fica para o leitor de tela. */}
          <div role="status" className="grid w-full max-w-[1040px] gap-5 px-4">
            <span className="sr-only">Carregando ambiente do fornecedor…</span>
            <Skeleton className="h-40 rounded-[10px]" />
            <Skeleton className="h-56 rounded-[10px]" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
        <Card className="w-full max-w-md p-6 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--error-soft)] text-[var(--error)]">
            <AlertCircle size={20} aria-hidden />
          </span>
          <h1 className="text-section-title text-[var(--foreground)]">
            {loadError === "sessao" ? "Sua sessão expirou" : "Não foi possível carregar o portal"}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
            {loadError === "sessao" ? "Entre novamente para consultar seu boletim." : "Verifique sua conexão e tente novamente."}
          </p>
          <div className="mt-5 flex justify-center">
            {loadError === "sessao" ? (
              <a href="/login" className="inline-flex h-10 items-center rounded-lg bg-[var(--primary)] px-4 text-[13px] font-semibold text-[var(--on-solid)] hover:bg-[var(--primary-hover)]">Entrar novamente</a>
            ) : (
              <Button className="h-10 px-4" onClick={() => void loadData()}>Tentar novamente</Button>
            )}
          </div>
        </Card>
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
      {/* Portal externo: coluna central de leitura (não espalha o boletim pela tela toda); o respiro
          inferior evita que os botões flutuantes de chat cubram o fim da página. */}
      <PageContainer className="grid max-w-[1040px]! gap-5 pb-24!">
        <PageHeader
          eyebrow="Fornecedor"
          title={TITLES[section]}
          description={section === "portal" ? "Acompanhe seu BM, nota fiscal, pagamento e comprovante." : "Acompanhe seus boletins, valores e pagamentos."}
        />

        {/* ── Portal ── */}
        {/* ── Aguardando envio ── */}
        {section === "portal" && aguardando && (
          <Card className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--muted-foreground)]">
              <Clock size={30} />
            </div>
            <AnimatedText as="h2" texto="Aguardando o envio do BM" className="text-section-title text-[var(--foreground)]" />
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Sua medição ainda não foi disponibilizada pela equipe de Medição.
              <br />
              Assim que for enviada, você poderá visualizar e validar os dados aqui.
            </p>
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              Caso tenha dúvidas, entre em contato com a equipe responsável.
            </p>
          </Card>
        )}

        {/* ── Conferência da medição (antes da liberação do BM) ── */}
        {section === "portal" && precisaConferencia && data.sgc.statusConferencia === "AGUARDANDO_UPLOAD" && (
          <Card className="p-6">
            <p className="text-eyebrow mb-1 text-[var(--primary)]">Fornecedor</p>
            <AnimatedText as="h2" texto="Conferência da Medição" className="text-section-title text-[var(--foreground)]" />
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Antes de visualizar e aprovar seu BM, informe os documentos correspondentes a este ciclo. Baixe a máscara, preencha os dados e envie o arquivo para conferência.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-1.5">
              <span className="text-label text-[var(--muted-foreground)]">Ciclo da medição</span>
              <span className="font-technical text-sm font-bold text-[var(--foreground)]">{data.cicloAtivo}</span>
            </div>

            {message && (
              <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${message.type === "success" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--primary-soft)] text-[var(--primary)]"}`}>
                {message.text}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href="/api/colaborador/conferencia/mascara"
                download
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted-foreground)] shadow-sm transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
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
              className={`rounded-xl border border-dashed px-4 py-5 text-center transition ${draggingConferencia ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border-strong)] bg-[var(--surface)]/65 hover:bg-[var(--surface)]"}`}
            >
              {!conferenciaFile ? (
                <>
                  <UploadCloud className="mx-auto mb-2 text-[var(--muted-foreground)]" size={26} />
                  <p className="text-sm text-[var(--muted-foreground)]">Arraste o arquivo .xlsx aqui ou</p>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]">
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
                    <FileIcon size={18} className="shrink-0 text-[var(--muted-foreground)]" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">{conferenciaFile.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{readableFileSize(conferenciaFile.size)}</p>
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
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
                <div className="h-full rounded-full bg-[var(--success)] transition-all duration-200" style={{ width: `${conferenciaProgress}%` }} />
              </div>
            )}
            {conferenciaError && <p className="mt-2 flex items-center gap-1 text-xs text-[var(--error)]"><AlertCircle size={13} />{conferenciaError}</p>}
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
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--muted-foreground)]">
              <Clock size={30} />
            </div>
            <AnimatedText as="h2" texto="Análise em andamento" className="text-section-title text-[var(--foreground)]" />
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              As informações enviadas estão sendo analisadas pela Equipe de Medição.
              <br />
              Aguarde a conclusão da análise.
            </p>
            <div className="mx-auto mt-4 inline-flex items-center gap-4 rounded-lg bg-[var(--surface-muted)] px-4 py-2">
              <span className="text-label text-[var(--muted-foreground)]">Ciclo <span className="font-technical text-[var(--foreground)]">{data.cicloAtivo}</span></span>
              <span className="text-label text-[var(--muted-foreground)]">Status <Badge variant="warning" className="ml-1">Em análise</Badge></span>
            </div>
          </Card>
        )}

        {/* ── Conteúdo visível após envio do BM e conclusão da conferência ──
             Hierarquia: resumo (quem, ciclo, valor, status) → ação do fornecedor → composição →
             documentos. Ações e regras são as mesmas de antes (SALVAR → ENVIAR, SOLICITAR_REVISAO,
             upload de NF); só a apresentação mudou. */}
        {section === "portal" && !aguardando && !precisaConferencia && <Stagger className="grid gap-5">
        <StaggerItem>
        <BoletimResumoPortal
          nome={data.usuario.nome}
          codigo={data.usuario.codigo}
          ciclo={data.cicloAtivo}
          revisaoLabel={data.sgc.revisaoLabel}
          status={data.sgc.status}
          totalMedicao={calculo?.totalMedicao ?? 0}
          rev={calculo?.rev ?? 0}
          totalAPagar={calculo?.totalAPagar ?? 0}
          documento={data.usuario.cnpj || data.usuario.cpf}
          razaoSocial={data.usuario.razaoSocial || data.pagamento?.razaoSocial || null}
          email={displayEmail(data.usuario.email)}
        />
        </StaggerItem>

        {/* A ação pendente do fornecedor (aprovar o BM ou enviar a NF) fica em destaque logo abaixo do resumo. */}
        <StaggerItem>
        <Card className={`p-5 sm:p-6 ${acaoPendente ? "border-[var(--primary)]! bg-[var(--primary-soft)]!" : ""}`}>
          <section aria-label="Ação do fornecedor" data-testid="portal-acao" data-acao-pendente={acaoPendente || undefined}>
          {canValidate ? (
            <>
              <AnimatedText as="h2" texto="O que você precisa fazer" className="text-card-title text-[var(--foreground)]" />
              <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">
                Confira o valor, a composição e os documentos. Se estiver tudo certo, salve sua validação e aprove o boletim.
              </p>
              <PortalFeedback message={message} />
              <ol className="mt-4 grid gap-3 md:grid-cols-2">
                <li className={`flex flex-col gap-3 rounded-lg border bg-[var(--surface)] p-4 transition-[border-color,box-shadow] ${salvoAt ? "border-[var(--border)]" : PASSO_ATUAL}`} aria-current={salvoAt ? undefined : "step"}>
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${salvoAt ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--primary)] text-[var(--on-solid)]"}`} aria-hidden>
                      {salvoAt ? <Check size={13} /> : "1"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--foreground)]">Salvar validação</p>
                      <p className="text-[12px] text-[var(--muted-foreground)]">
                        {salvoAt ? `Validação salva em ${formatDataHora(salvoAt)}.` : "Registra que você conferiu os dados deste boletim."}
                      </p>
                    </div>
                  </div>
                  <Button variant="secondary" className="border-[var(--border-strong)]! mt-auto h-10 w-full sm:w-auto sm:self-start" onClick={() => sendSgc("SALVAR")} disabled={saving}>
                    {savingAction === "SALVAR" ? "Salvando..." : "Salvar validação"}
                  </Button>
                </li>
                <li className={`flex flex-col gap-3 rounded-lg border bg-[var(--surface)] p-4 transition-[border-color,box-shadow] ${salvoAt ? PASSO_ATUAL : "border-[var(--border)]"}`} aria-current={salvoAt ? "step" : undefined}>
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${salvoAt ? "bg-[var(--primary)] text-[var(--on-solid)]" : "bg-[var(--surface-hover)] text-[var(--muted-foreground)]"}`} aria-hidden>2</span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[var(--foreground)]">Aprovar boletim</p>
                      <p className="text-[12px] text-[var(--muted-foreground)]">
                        {salvoAt ? "Confirma os dados e segue para o envio da Nota Fiscal." : "Disponível depois de salvar a validação."}
                      </p>
                    </div>
                  </div>
                  <Button
                    className="mt-auto h-10 w-full sm:w-auto sm:self-start"
                    onClick={handleEnviar}
                    disabled={saving || !salvoAt}
                    title={!salvoAt ? "Salve a validação para habilitar a aprovação" : undefined}
                    aura={!!salvoAt}
                  >
                    <CheckCircle2 size={15} aria-hidden />
                    Aprovar boletim
                  </Button>
                </li>
              </ol>
              <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] text-[var(--muted-foreground)]">Encontrou algum dado incorreto?</p>
                <Button variant="outline" className="border-[var(--primary)]! h-10 w-full sm:w-auto" onClick={() => openActionModal("revisao")} disabled={saving}>
                  <MessageCircle size={15} aria-hidden />
                  Solicitar revisão
                </Button>
              </div>
            </>
          ) : data.sgc.status === "AGUARDANDO_NF" ? (
            <>
              <EstadoConcluido
                tone="success"
                titulo="Boletim aprovado"
                detalhe={data.sgc.aprovadoAt ? `Aprovado em ${formatDataHora(data.sgc.aprovadoAt)}. Envie a Nota Fiscal para seguir com o pagamento.` : "Envie a Nota Fiscal para seguir com o pagamento."}
              />
              <PortalFeedback message={message} />
              <div className="mt-5 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-soft)] p-4 sm:p-5">
                <div className="mb-3 flex items-start gap-2">
                  <FileUp size={16} className="mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden />
                  <div>
                    <h3 className="text-[13px] font-semibold text-[var(--foreground)]">Envio da Nota Fiscal</h3>
                    <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">
                      Arraste o arquivo ou selecione no computador. Formato aceito: PDF pesquisável, até 10 MB.
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
                  aria-label="Escolher arquivo da Nota Fiscal"
                  className={`rounded-lg border border-dashed px-4 py-5 text-center transition ${draggingNf ? "border-[var(--warning)] bg-[var(--surface)]" : "border-[var(--warning)]/35 bg-[var(--surface)]/70 hover:bg-[var(--surface)]"}`}
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
                  <UploadCloud size={22} className="mx-auto text-[var(--warning)]" aria-hidden />
                  <p className="mt-2 text-[13px] font-semibold text-[var(--foreground)]">Clique para escolher ou arraste a Nota Fiscal</p>
                  <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">PDF pesquisável</p>
                </div>
                {nfFile && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--warning-soft)] text-[var(--warning)]">
                        <FileIcon size={18} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-semibold text-[var(--foreground)]">{nfFile.name}</p>
                          <span className="shrink-0 rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">{fileExtension(nfFile.name)}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{readableFileSize(nfFile.size)}</p>
                      </div>
                      {nfError ? (
                        <IconButton onClick={uploadNf} title="Tentar novamente" aria-label="Tentar novamente">
                          <RotateCcw size={15} />
                        </IconButton>
                      ) : null}
                      <IconButton onClick={() => selectNfFile(null)} disabled={nfUploading} title="Remover arquivo" aria-label="Remover arquivo">
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${nfError ? "bg-[var(--error)]" : "bg-[var(--success)]"}`}
                        style={{ width: `${nfError ? 100 : nfProgress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className={`flex items-center gap-1 text-[12px] ${nfError ? "text-[var(--error)]" : "text-[var(--muted-foreground)]"}`}>
                        {nfError ? <AlertCircle size={13} aria-hidden /> : null}
                        {nfError ?? (nfUploading ? `Enviando... ${nfProgress}%` : nfProgress === 100 ? "Arquivo enviado." : "Pronto para envio.")}
                      </p>
                      <Button className="h-10 w-full sm:h-9 sm:w-auto" onClick={uploadNf} disabled={nfUploading}>
                        {nfUploading ? "Enviando..." : nfError ? "Tentar novamente" : "Enviar NF"}
                      </Button>
                    </div>
                  </div>
                )}
                {nfError && !nfFile && <p className="mt-2 text-[12px] text-[var(--error)]">{nfError}</p>}
              </div>
            </>
          ) : data.sgc.status === "REVISAO_SOLICITADA" ? (
            <>
              <EstadoConcluido
                tone="warning"
                titulo="Revisão solicitada"
                detalhe={data.sgc.revisaoSolicitadaAt ? `Solicitada em ${formatDataHora(data.sgc.revisaoSolicitadaAt)}.` : null}
              >
                <p className="mt-2 text-[13px] text-[var(--foreground)]">
                  Solicitação enviada. A conversa desta revisão fica disponível no chat flutuante.
                </p>
              </EstadoConcluido>
              <PortalFeedback message={message} />
              {data.sgc.pontosDiscordancia && (
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Motivo informado</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--foreground)]">{data.sgc.pontosDiscordancia}</p>
                </div>
              )}
            </>
          ) : data.sgc.status === "CANCELADO" ? (
            <>
              <EstadoConcluido tone="neutral" titulo="BM cancelado" detalhe="Este BM foi cancelado." />
              <PortalFeedback message={message} />
            </>
          ) : isFinancialFollowUpStatus(data.sgc.status) ? (
            <>
              <EstadoConcluido
                tone="success"
                titulo={data.sgc.status === "PAGO" ? "Medição concluída" : "Boletim aprovado"}
                detalhe={data.sgc.aprovadoAt ? `Aprovado em ${formatDataHora(data.sgc.aprovadoAt)}.` : null}
              >
                <p className="mt-2 text-[13px] text-[var(--foreground)]">
                  Acesse <strong>Minhas Medições</strong> para acompanhar o pagamento e os detalhes desta medição.
                </p>
              </EstadoConcluido>
              <PortalFeedback message={message} />
              <div className="mt-4 flex sm:justify-end">
                <Button variant="secondary" className="border-[var(--border-strong)]! h-10 w-full sm:w-auto" onClick={() => setSection("medicoes")}>
                  <History size={15} aria-hidden />
                  Ver medições
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-[var(--muted-foreground)]">A medição está disponível em Minhas Medições para acompanhamento financeiro.</p>
              <PortalFeedback message={message} />
            </>
          )}
          </section>
        </Card>
        </StaggerItem>

        {/* Diálogos do portal: entram e saem com animação (inertes durante a saída, pelo Modal). */}
        <AnimatePresence>
        {aprovarOpen && canValidate && (
          <AprovarBoletimDialog
            key="dialogo-aprovar"
            fornecedor={data.usuario.nome}
            ciclo={data.cicloAtivo}
            totalMedicao={calculo?.totalMedicao ?? 0}
            rev={calculo?.rev ?? 0}
            totalAPagar={calculo?.totalAPagar ?? 0}
            saving={saving}
            erro={modalError}
            onCancel={fecharAprovar}
            onConfirm={() => void sendSgc("ENVIAR")}
          />
        )}

        {actionModal === "revisao" && canValidate && (
          <SolicitarRevisaoDialog
            key="dialogo-revisao"
            value={pontos}
            onChange={setPontos}
            respostaAdmin={data.sgc.respostaAdmin}
            saving={saving}
            erro={modalError}
            onCancel={closeActionModal}
            onConfirm={() => void sendSgc("SOLICITAR_REVISAO")}
          />
        )}

        {actionModal === "resposta" && (
          <ResponderMedicaoDialog
            key="dialogo-resposta"
            value={respostaFornecedor}
            onChange={setRespostaFornecedor}
            respostaAdmin={data.sgc.respostaAdmin}
            pontosDiscordancia={data.sgc.pontosDiscordancia}
            observacaoColaborador={data.sgc.observacaoColaborador}
            saving={saving}
            erro={modalError}
            onCancel={closeActionModal}
            onConfirm={() => void sendSgc("RESPONDER_MEDICAO")}
          />
        )}
        </AnimatePresence>

        {/* Composição e documentos: ocultos no acompanhamento financeiro (APROVADO/PAGO), como antes. */}
        {!isFinancialFollowUpStatus(data.sgc.status) && calculo && <StaggerItem><ComposicaoPortal calculo={calculo} /></StaggerItem>}

        {/* ── Documentos não considerados (divergências descartadas pela Equipe) ──
             Nunca usar a palavra "Divergência" aqui — regra de UX já estabelecida para o Portal.
             Não renderiza nada se não houver nenhum documento descartado (sem card vazio). */}
        {data.documentosDescartados.length > 0 && !isFinancialFollowUpStatus(data.sgc.status) && (
          <StaggerItem>
          <Card className="p-5 sm:p-6">
            <h2 className="text-card-title text-[var(--foreground)]">Documentos não considerados</h2>
            <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">
              {data.documentosDescartados.length === 1
                ? "1 documento não foi considerado nesta medição."
                : `${data.documentosDescartados.length} documentos não foram considerados nesta medição.`}
            </p>
            <ul className="mt-3 grid gap-2">
              {data.documentosDescartados.map((d) => (
                <li key={d.id} className="grid gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Documento</p>
                    <p className="break-all font-technical text-[13px] font-semibold text-[var(--foreground)]">{d.nrVale}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Motivo</p>
                    <p className="break-words text-[13px] text-[var(--foreground)]">{d.motivo}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          </StaggerItem>
        )}

        {!isFinancialFollowUpStatus(data.sgc.status) && (
          <StaggerItem>
          <DocumentosMedicaoPortal
            calculo={calculo!}
            observacoesContrato={data.pagamento?.condicoesFixas?.observacoesContrato}
            codigo={data.usuario.codigo}
            ciclo={data.cicloAtivo}
          />
          </StaggerItem>
        )}
        </Stagger>}

        {/* ── Minhas Medições ── */}
        {section === "medicoes" && (
          <MinhasMedicoes
            medicoes={medicoes}
            loading={medLoading}
            erro={medErro}
            fornecedorNome={data.usuario.nome}
            onRecarregar={loadMedicoes}
          />
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
        className={`fixed bottom-5 right-5 z-50 inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[var(--on-solid)] shadow-xl ${ENTRADA_JANELA} ${hasUnread ? "bg-[var(--success)] hover:bg-[var(--success)]/90" : "bg-[var(--primary)] hover:bg-[var(--primary)]/90"}`}
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
    <div className={`fixed bottom-5 right-5 z-50 grid h-[min(560px,calc(100vh-40px))] min-h-0 w-[min(860px,calc(100vw-24px))] grid-cols-1 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl md:grid-cols-[300px_1fr] ${ENTRADA_JANELA}`}>
      <aside className="hidden min-h-0 min-w-0 border-r border-[var(--border)] bg-[var(--surface)] md:flex md:flex-col">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="text-base font-bold text-[var(--foreground)]">Conversas</p>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--muted-foreground)]">
            <Search size={14} />
            Pesquise conversas
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <button className="flex w-full gap-3 border-b border-[var(--surface-hover)] bg-[var(--primary-soft)] px-4 py-3 text-left">
            <ChatAvatar name="Equipe de Medição" unread={hasUnread} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">Equipe de Medição</p>
                <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{latestMedicaoMessage ? chatTime(latestMedicaoMessage.criadoAt).split(", ").at(-1) : ""}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{latestMedicaoMessage?.texto ?? "Sem mensagens."}</p>
            </div>
          </button>
          <button className="flex w-full gap-3 border-b border-[var(--surface-hover)] px-4 py-3 text-left opacity-70">
            <ChatAvatar name="Financeiro" className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">Financeiro</p>
                <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">em breve</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">Canal reservado para notas fiscais e pagamentos.</p>
            </div>
          </button>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChatAvatar name="Equipe de Medição" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--foreground)]">Equipe de Medição</p>
              <p className={`text-xs ${medicaoOnline ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"}`}>
                {medicaoOnline ? "online" : "offline"}
              </p>
            </div>
          </div>
          <button className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]" onClick={() => onOpenChange(false)} aria-label="Fechar chat">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--surface-hover)] px-4 py-4">
          {visibleMessages.length ? (
            visibleMessages.map((mensagem) => {
              const isFornecedor = mensagem.autor === "FORNECEDOR";
              return (
                <div key={mensagem.id} className={`flex items-end gap-2 ${isFornecedor ? "justify-end" : `justify-start ${ENTRADA_MENSAGEM}`}`}>
                  {!isFornecedor && (
                    <ChatAvatar
                      name={mensagem.autorNome}
                      src={mensagem.autorAvatarUrl}
                      className="h-7 w-7 text-[10px]"
                    />
                  )}
                  <div className={`max-w-[82%] rounded-xl px-3 py-2 text-sm shadow-sm ${isFornecedor ? "rounded-br-sm bg-[var(--primary-soft)] text-[var(--primary)]" : "rounded-bl-sm bg-[var(--surface)] text-[var(--foreground)]"}`}>
                    <p className={`mb-1 text-[11px] font-bold ${isFornecedor ? "text-[var(--primary)]" : "text-[var(--primary)]"}`}>
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
            <p className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">
              Nenhuma mensagem registrada nesta revisão.
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/70 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
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
