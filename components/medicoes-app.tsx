"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  BellRing,
  Download,
  FileSearch,
  FileText,
  History,
  LayoutDashboard,
  MessageCircle,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccountMenu } from "@/components/account-menu";
import { GeneralChatWidget } from "@/components/general-chat-widget";
import { Dashboard, MapaPagamentoResumo } from "@/components/dashboard";
import { ComentarioDropdown, MapaPagamentoTable } from "@/components/mapa-pagamento-table";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { UsuariosPanel } from "@/components/usuarios-panel";
import { FinanceiroPanel } from "@/components/financeiro-panel";
import { AdministrativoPanel } from "@/components/administrativo-panel";
import { Badge, Button, Card, IconButton, PageContainer, PageHeader, Select } from "@/components/ui";
import type { ContratoResumo, DashboardData, MapaPagamentoItem, Profissional } from "@/components/types";
import { cicloToDates, cicloToMesReferencia } from "@/lib/ciclo";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";
import type { AuthUser } from "@/lib/session";

type Section = "visao" | "historico" | "importar" | "evidencias" | "usuarios" | "financeiro" | "administrativo";

const TITLES: Record<Section, string> = {
  visao: "Dashboard",
  historico: "Histórico de Medições",
  importar: "Importar Planilha",
  evidencias: "Evidências de Medição",
  usuarios: "Gestão de Usuários",
  financeiro: "Painel Financeiro",
  administrativo: "Painel Administrativo",
};

const CICLO_GERAL = "GERAL";

type CicloEntry = { ciclo: string; mesReferencia: string | null; ativoMedicao?: boolean; updatedAt: string };

export function MedicoesApp({ user }: { user: AuthUser }) {
  const [dashboard, setDashboard]           = useState<DashboardData | null>(null);
  const [profissionais, setProfissionais]   = useState<Profissional[]>([]);
  const [mapaItens, setMapaItens]           = useState<MapaPagamentoItem[]>([]);
  const [contratosCiclo, setContratosCiclo] = useState<ContratoResumo[]>([]);
  const [sgcAlertas, setSgcAlertas]         = useState<SgcAlerta[]>([]);
  const [sgcConversas, setSgcConversas]     = useState<SgcAlerta[]>([]);
  const [sgcStatus, setSgcStatus]           = useState<Record<string, { status: string; revisaoNumero: number; id: string }>>({});
  const [reenviandoId, setReenviandoId]     = useState<string | null>(null);
  const [selectedAlerta, setSelectedAlerta] = useState<SgcAlerta | null>(null);
  const [selectedChatAlerta, setSelectedChatAlerta] = useState<SgcAlerta | null>(null);
  const [notifOpen, setNotifOpen]           = useState(false);
  const [seenIds, setSeenIds]               = useState<string[]>([]);
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [selectedContrato, setSelectedContrato] = useState("");
  const [activeCiclo, setActiveCiclo]       = useState(CICLO_GERAL);
  const [ciclos, setCiclos]                 = useState<CicloEntry[]>([]);
  const [novoCiclo, setNovoCiclo]           = useState("");
  const [criandoCiclo, setCriandoCiclo]     = useState(false);
  const [novoCicloOpen, setNovoCicloOpen]   = useState(false);
  const [ativandoMedicaoCiclo, setAtivandoMedicaoCiclo] = useState<string | null>(null);
  const [resetandoCiclos, setResetandoCiclos] = useState(false);
  const cicloInicializadoRef                = useRef(false);
  const alertasBaselineRef                  = useRef(false);
  const previousAlertIdsRef                 = useRef<Set<string>>(new Set());
  const previousAlertMessageIdsRef          = useRef<Map<string, string>>(new Map());

  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearchParams = searchParams ?? new URLSearchParams();
  const isAdmin      = user.perfil === "MEDICAO" || user.perfil === "ADMIN";
  const isFullAdmin  = user.perfil === "ADMIN";
  const isMedicao    = user.perfil === "MEDICAO";
  const isFinanceiro = user.perfil === "FINANCEIRO";
  const isAdministrativo = user.perfil === "ADMINISTRATIVO";

  const VALID_SECTIONS: Section[] = isFinanceiro
    ? ["financeiro"]
    : isAdministrativo
    ? ["administrativo", "financeiro"]
    : isMedicao
    ? ["visao", "importar", "evidencias"]
    : isFullAdmin
    ? ["administrativo", "evidencias", "financeiro", "historico", "importar", "usuarios", "visao"]
    : ["evidencias", "financeiro", "historico", "importar", "usuarios", "visao"];
  const sectionParam = currentSearchParams.get("section") as Section | null;
  const section: Section = sectionParam && VALID_SECTIONS.includes(sectionParam) ? sectionParam : (isFinanceiro ? "financeiro" : isAdministrativo ? "administrativo" : "visao");
  function setSection(s: Section) {
    const params = new URLSearchParams(currentSearchParams.toString());
    params.set("section", s);
    router.replace(`?${params.toString()}`);
  }
  const hasUnread = sgcAlertas.some((a) => !seenIds.includes(a.id));
  const unreadChatMessagesCount = useMemo(
    () =>
      sgcConversas.reduce(
        (total, conversa) => total + conversa.mensagens.filter((message) => message.autor === "FORNECEDOR" && !message.lidoAt).length,
        0,
      ),
    [sgcConversas],
  );

  const colaboradores = useMemo(() => profissionais.filter((p) => p.codigo), [profissionais]);
  const contratos = useMemo(
    () => dashboard?.contextoMapa?.contratos.filter((c) => c.contrato !== "TOTAL").map((c) => c.contrato) ?? [],
    [dashboard],
  );

  const loadDashboard = useCallback(async () => {
    if (!isAdmin) return;
    const p = new URLSearchParams();
    p.set("ciclo", activeCiclo);
    if (selectedCodigo) p.set("codigo", selectedCodigo);
    if (selectedContrato) p.set("contrato", selectedContrato);
    const res = await fetch(`/api/dashboard?${p}`);
    if (res.ok) setDashboard(await res.json());
  }, [activeCiclo, isAdmin, selectedCodigo, selectedContrato]);

  const loadLookups = useCallback(async () => {
    if (!isAdmin) return;
    const [p, m] = await Promise.all([
      fetch("/api/profissionais"),
      fetch(`/api/mapa-pagamento?ciclo=${activeCiclo}`),
    ]);
    if (p.ok) setProfissionais(await p.json());
    if (m.ok) {
      const payload = await m.json();
      setMapaItens(payload.itens ?? []);
      setContratosCiclo(payload.contratos ?? []);
    }
  }, [activeCiclo, isAdmin]);

  const refresh    = useCallback(async () => { await loadDashboard(); }, [loadDashboard]);
  const refreshAll = useCallback(async () => { await Promise.all([loadDashboard(), loadLookups()]); }, [loadDashboard, loadLookups]);

  const loadCiclos = useCallback(async () => {
    const res = await fetch("/api/ciclos");
    if (!res.ok) return;
    const data: CicloEntry[] = await res.json();
    setCiclos(data);
    if (!cicloInicializadoRef.current) {
      cicloInicializadoRef.current = true;
      setActiveCiclo((current) => current === CICLO_GERAL && data[0]?.ciclo ? data[0].ciclo : current);
    }
  }, []);

  const loadAlertas = useCallback(async () => {
    if (!isAdmin) return;
    const [alertasRes, statusRes, conversasRes] = await Promise.all([
      fetch(`/api/sgc/alertas?ciclo=${activeCiclo}`),
      fetch(`/api/sgc/status?ciclo=${activeCiclo}`),
      fetch(`/api/sgc/conversas?ciclo=${activeCiclo}`),
    ]);
    if (alertasRes.ok) setSgcAlertas(await alertasRes.json());
    if (statusRes.ok) setSgcStatus(await statusRes.json());
    if (conversasRes.ok) setSgcConversas(await conversasRes.json());
  }, [isAdmin, activeCiclo]);

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

  async function enviarBm(colaboradorCodigo: string) {
    const res = await fetch("/api/sgc/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colaboradorCodigo, ciclo: activeCiclo }),
    });
    if (!res.ok) {
      const p = await res.json().catch(() => ({}));
      alert(p.error ?? "Não foi possível enviar o BM.");
      return;
    }
    await loadAlertas();
  }

  async function retornarBm(sgcId: string) {
    if (!window.confirm("Retornar este BM para aguardando envio?")) return;
    const res = await fetch("/api/admin/financeiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "VOLTAR_BM", id: sgcId }),
    });
    if (!res.ok) {
      const p = await res.json().catch(() => ({}));
      alert(p.error ?? "Não foi possível retornar a medição.");
      return;
    }
    await Promise.all([refreshAll(), loadAlertas()]);
  }

  async function ativarCicloMedicao(ciclo: string) {
    setAtivandoMedicaoCiclo(ciclo);
    try {
      const res = await fetch("/api/ciclos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_ativo_medicao", ciclo }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        alert(p.error ?? "Não foi possível ativar o ciclo para medição.");
        return;
      }
      await loadCiclos();
    } finally {
      setAtivandoMedicaoCiclo(null);
    }
  }

  async function resetarCiclos(cicloAlvo?: string) {
    const cicloParaResetar = (cicloAlvo?.trim() || (activeCiclo !== CICLO_GERAL ? activeCiclo : "")).trim();
    if (!/^\d{4}$/.test(cicloParaResetar)) {
      alert("Selecione ou digite um ciclo válido para excluir.");
      return;
    }
    const confirmed = window.confirm(
      `Excluir o ciclo ${cicloParaResetar}? Esta ação remove os dados vinculados ao ciclo, incluindo medições, pagamentos, aprovações, arquivos e histórico de revisão. Usuários cadastrados serão preservados.`,
    );
    if (!confirmed) return;

    setResetandoCiclos(true);
    try {
      const res = await fetch("/api/ciclos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: "RESETAR_CICLOS", ciclo: cicloParaResetar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Não foi possível excluir o ciclo.");
        return;
      }
      setActiveCiclo(CICLO_GERAL);
      setCiclos([]);
      await Promise.all([loadCiclos(), refreshAll(), loadAlertas()]);
      alert(`${data.removed?.ciclos ?? 0} ciclo(s) excluído(s).`);
    } finally {
      setResetandoCiclos(false);
    }
  }

  function markSeen(alerta?: SgcAlerta) {
    const ids = alerta ? [alerta.id] : sgcAlertas.map((a) => a.id);
    setSeenIds((cur) => {
      const merged = Array.from(new Set([...cur, ...ids]));
      localStorage.setItem("sgc_alertas_vistos", JSON.stringify(merged));
      return merged;
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.assign("/login");
  }

  async function reenviar(alerta: SgcAlerta) {
    setReenviandoId(alerta.id);
    try {
      const res = await fetch(`/api/sgc/alertas/${alerta.id}/reenviar`, { method: "POST" });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        alert(p.error ?? "Não foi possível reenviar.");
        return;
      }
      await loadAlertas();
      setSelectedAlerta(null);
    } finally {
      setReenviandoId(null);
    }
  }

  useEffect(() => {
    loadCiclos();
    const raw = localStorage.getItem("sgc_alertas_vistos");
    if (raw) { try { setSeenIds(JSON.parse(raw)); } catch { setSeenIds([]); } }
  }, [loadCiclos]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    fetch("/api/usuario/presenca", { method: "POST" }).catch(() => undefined);
    const interval = setInterval(() => {
      fetch("/api/usuario/presenca", { method: "POST" }).catch(() => undefined);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    alertasBaselineRef.current = false;
    previousAlertIdsRef.current = new Set();
    previousAlertMessageIdsRef.current = new Map();
  }, [activeCiclo]);

  useEffect(() => {
    if (!isAdmin) return;

    loadAlertas();
    const source = new EventSource(`/api/sgc/alertas/stream?ciclo=${encodeURIComponent(activeCiclo)}`);
    source.addEventListener("alertas", () => {
      loadAlertas();
    });

    // Rede de segurança caso o SSE caia (proxy que bufferiza, aba que perde a conexão) — o SSE em
    // si já sonda o banco a cada 2s no servidor e empurra na hora que algo muda, então isto é só
    // o pior caso; ~8s mantém o alvo de "até 10s" pedido para atualização de workflow.
    const fallbackInterval = setInterval(() => {
      if (!document.hidden) loadAlertas();
    }, 8000);

    // Voltar de outra aba, recuperar o foco da janela ou a conexão cair e voltar não deve esperar
    // o próximo tick — refetch imediato nesses três casos.
    const onVisibility = () => { if (!document.hidden) loadAlertas(); };
    const onFocus = () => loadAlertas();
    const onOnline = () => loadAlertas();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      source.close();
      clearInterval(fallbackInterval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [isAdmin, activeCiclo, loadAlertas]);

  useEffect(() => {
    if (!isAdmin) return;

    const currentIds = new Set(sgcAlertas.map((alerta) => alerta.id));
    const currentMessageIds = new Map(sgcAlertas.map((alerta) => [alerta.id, latestChatMessage(alerta)?.id ?? ""]));
    if (!alertasBaselineRef.current) {
      alertasBaselineRef.current = true;
      previousAlertIdsRef.current = currentIds;
      previousAlertMessageIdsRef.current = currentMessageIds;
      return;
    }

    const novos = sgcAlertas.filter((alerta) => !previousAlertIdsRef.current.has(alerta.id));
    const novasMensagens = sgcAlertas.filter((alerta) => {
      const ultima = latestChatMessage(alerta);
      return ultima?.autor === "FORNECEDOR" && previousAlertMessageIdsRef.current.get(alerta.id) !== ultima.id;
    });
    previousAlertIdsRef.current = currentIds;
    previousAlertMessageIdsRef.current = currentMessageIds;

    const alertaNotificacao = novasMensagens[0] ?? novos[0];
    if (!alertaNotificacao) return;

    playNotificationSound();
    if (selectedChatAlerta?.id === alertaNotificacao.id) return;
  }, [isAdmin, selectedChatAlerta?.id, sgcAlertas]);

  useEffect(() => {
    if (!selectedChatAlerta) return;
    const atualizado = sgcConversas.find((alerta) => alerta.id === selectedChatAlerta.id);
    if (atualizado && atualizado !== selectedChatAlerta) setSelectedChatAlerta(atualizado);
  }, [selectedChatAlerta, sgcConversas]);

  useEffect(() => {
    if (!selectedChatAlerta) return;
    const interval = setInterval(loadAlertas, 3000);
    return () => clearInterval(interval);
  }, [loadAlertas, selectedChatAlerta]);

  // ─── Nav items ───────────────────────────────────────────────────────────────

  const navItems = isFinanceiro
    ? [{ id: "financeiro", label: "Financeiro", icon: <Wallet size={17} /> }]
    : isAdministrativo
    ? [
        { id: "administrativo", label: "Administrativo", icon: <FileText size={17} /> },
        { id: "financeiro", label: "Financeiro", icon: <Wallet size={17} /> },
      ]
    : isMedicao
    ? [
        { id: "visao",      label: "Visão Geral", icon: <LayoutDashboard size={17} /> },
        { id: "evidencias", label: "Evidências",  icon: <FileSearch size={17} /> },
        { id: "importar",   label: "Importar Planilha", icon: <Upload size={17} />, bottom: true },
      ]
    : [
        { id: "visao",      label: "Visão Geral",      icon: <LayoutDashboard size={17} /> },
        { id: "administrativo", label: "Administrativo", icon: <FileText size={17} /> },
        { id: "evidencias", label: "Evidências",        icon: <FileSearch size={17} /> },
        { id: "financeiro", label: "Financeiro",        icon: <Wallet size={17} /> },
        { id: "historico",  label: "Histórico",         icon: <History size={17} /> },
        { id: "usuarios",   label: "Usuários",          icon: <ShieldCheck size={17} /> },
        { id: "importar",   label: "Importar Planilha", icon: <Upload size={17} />, bottom: true },
      ];

  const floatingNotifications = isAdmin ? (
        <div className="fixed right-5 top-4 z-30 sm:right-6 sm:top-5">
          <button
            type="button"
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-white text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[#f2f2ef] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30"
            onClick={() => { setNotifOpen((v) => !v); markSeen(); }}
            title="Notificações"
            aria-label="Notificações"
          >
            {hasUnread ? <BellRing size={17} /> : <Bell size={17} />}
          </button>
          {sgcAlertas.length > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[9px] font-bold text-white">
              {sgcAlertas.length}
            </span>
          )}

          {notifOpen && (
            <div className="absolute right-0 top-12 z-40 w-[min(360px,calc(100vw-40px))] overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-xl">
              <div className="border-b border-[#E5E7EB] px-4 py-3">
                <p className="text-sm font-bold text-[#1A1A1A]">Notificações</p>
                <p className="text-xs text-[#555555]">{sgcAlertas.length} solicitação(ões) pendente(s)</p>
              </div>
              <div className="max-h-72 overflow-auto">
                {sgcAlertas.length ? (
                  sgcAlertas.map((a) => (
                    <button
                      key={a.id}
                      className="block w-full border-b border-[#F3F4F6] px-4 py-3 text-left last:border-0 hover:bg-[#F9FAFB] transition-colors"
                      onClick={() => { setSelectedAlerta(a); setNotifOpen(false); markSeen(a); }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#1A1A1A]">{a.colaboradorNome ?? "Fornecedor"}</span>
                        <Badge variant="warning">{a.proximaRevisaoLabel}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-[#9CA3AF] line-clamp-1">Solicitação de revisão</p>
                    </button>
                  ))
                ) : (
                  <p className="px-4 py-6 text-sm text-[#9CA3AF]">Nenhuma solicitação pendente.</p>
                )}
              </div>
              <button
                className="block w-full border-t border-[#E5E7EB] px-4 py-3 text-left text-sm font-semibold text-[#2563EB] hover:bg-[#F9FAFB] transition-colors"
                onClick={() => { setNotifOpen(false); }}
              >
                Fechar
              </button>
            </div>
          )}
        </div>
  ) : null;

  // ─── Filters ─────────────────────────────────────────────────────────────────

  async function criarCiclo() {
    if (!novoCiclo.trim() || !/^\d{4}$/.test(novoCiclo.trim())) {
      alert("Digite um ciclo válido no formato YYMM (ex: 2606).");
      return;
    }
    setCriandoCiclo(true);
    try {
      const res = await fetch("/api/ciclos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciclo: novoCiclo.trim() }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        alert(p.error ?? "Erro ao criar ciclo.");
        return;
      }
      const cicloValue = novoCiclo.trim();
      setNovoCiclo("");
      setNovoCicloOpen(false);
      const updated = await fetch("/api/ciclos");
      if (updated.ok) setCiclos(await updated.json());
      setActiveCiclo(cicloValue);
    } finally {
      setCriandoCiclo(false);
    }
  }

  const filtersBar = (() => {
    const ctx = dashboard?.contextoMapa;
    const datas = activeCiclo && activeCiclo !== CICLO_GERAL ? cicloToDates(activeCiclo) : { atoInicio: "", atoFim: "", producaoInicio: "", producaoFim: "" };
    const fmtDate = (v: string | null | undefined) =>
      v ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(v + "T12:00:00")) : "–";
    const producaoInicio = ctx?.producaoInicio || datas.producaoInicio;
    const producaoFim    = ctx?.producaoFim    || datas.producaoFim;
    const atoInicio      = datas.atoInicio;
    const atoFim         = datas.atoFim;

    async function saveContextDates(inicio: string, fim: string) {
      const ctx2 = dashboard?.contextoMapa;
      await fetch("/api/mapa-pagamento/contexto", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciclo: activeCiclo,
          mesReferencia: ctx2?.mesReferencia ?? cicloToMesReferencia(activeCiclo),
          producaoLabel: ctx2?.producaoLabel ?? "MEDIÇÃO:",
          producaoInicio: inicio,
          producaoFim: fim,
          atoLabel: ctx2?.atoLabel ?? "CICLO:",
          atoCiclo: ctx2?.atoCiclo ?? activeCiclo,
        }),
      });
      await refreshAll();
    }

    return (
      <>
        <p className="text-card-title mb-2 text-[#1A1A1A]">Filtros</p>
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-end gap-4">

            {/* Ciclo ativo */}
            <div className="grid gap-1.5">
              <span className="text-label text-[var(--muted-foreground)]">Ciclo ativo</span>
              <div className="flex items-center gap-1.5">
                <Select
                  className="min-w-[150px]"
                  value={activeCiclo}
                  onChange={(e) => { setActiveCiclo(e.target.value); setSelectedCodigo(""); setSelectedContrato(""); }}
                >
                  <option value={CICLO_GERAL}>Geral</option>
                  {ciclos.map((c) => (
                    <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>
                  ))}
                  {!ciclos.find((c) => c.ciclo === activeCiclo) && activeCiclo !== CICLO_GERAL && (
                    <option value={activeCiclo}>{activeCiclo}</option>
                  )}
                </Select>
                {isAdmin && (
                  <div className="relative">
                    <IconButton
                      title="Novo ciclo"
                      onClick={() => { setNovoCicloOpen((v) => !v); setNovoCiclo(""); }}
                      className={novoCicloOpen ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]" : ""}
                    >
                      <Plus size={15} />
                    </IconButton>
                    {novoCicloOpen && (
                      <div className="absolute left-0 top-10 z-40 w-64 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-xl">
                        <p className="mb-2 text-sm font-bold text-[#1A1A1A]">Novo ciclo</p>
                        <p className="mb-3 text-xs text-[#555555]">Formato YYMM — ex: <strong>2606</strong></p>
                        <input
                          className="mb-3 h-9 w-full rounded-lg border border-[#E5E7EB] px-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                          placeholder="Ex: 2606"
                          maxLength={4}
                          value={novoCiclo}
                          onChange={(e) => setNovoCiclo(e.target.value.replace(/\D/g, ""))}
                          onKeyDown={(e) => e.key === "Enter" && criarCiclo()}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button variant="secondary" className="flex-1" onClick={() => { setNovoCicloOpen(false); setNovoCiclo(""); }}>Cancelar</Button>
                          <Button className="flex-1" onClick={criarCiclo} disabled={criandoCiclo || novoCiclo.length !== 4}>{criandoCiclo ? "Criando…" : "Criar"}</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Divisor vertical — oculto no Geral */}
            {activeCiclo !== CICLO_GERAL && <div className="hidden self-stretch border-l border-[#E5E7EB] sm:block" />}

            {/* Produção + ATO — oculto no Geral */}
            {activeCiclo !== CICLO_GERAL && (
              <>
                <div className="grid w-full gap-1.5 sm:w-auto">
                  <span className="text-label text-[var(--muted-foreground)]">Produção</span>
                  <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                    <input
                      type="date"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] outline-none hover:border-[#D1D5DB] focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 sm:flex-none"
                      defaultValue={producaoInicio}
                      key={producaoInicio}
                      onBlur={(e) => { if (e.target.value && e.target.value !== producaoInicio) saveContextDates(e.target.value, producaoFim); }}
                    />
                    <span className="text-xs text-[#9CA3AF]">a</span>
                    <input
                      type="date"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] outline-none hover:border-[#D1D5DB] focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20 sm:flex-none"
                      defaultValue={producaoFim}
                      key={producaoFim}
                      onBlur={(e) => { if (e.target.value && e.target.value !== producaoFim) saveContextDates(producaoInicio, e.target.value); }}
                    />
                  </div>
                </div>

                <div className="grid w-full gap-1.5 sm:w-auto">
                  <span className="text-label text-[var(--muted-foreground)]">ATO</span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] sm:flex-none sm:px-3">{fmtDate(atoInicio)}</div>
                    <span className="text-xs text-[#9CA3AF]">a</span>
                    <div className="flex h-9 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] sm:flex-none sm:px-3">{fmtDate(atoFim)}</div>
                  </div>
                </div>
              </>
            )}

            {/* Divisor vertical */}
            <div className="hidden self-stretch border-l border-[#E5E7EB] sm:block" />

            {/* Fornecedor */}
            <label className="text-label grid w-full min-w-0 basis-full gap-1.5 text-[var(--muted-foreground)] sm:min-w-[180px] sm:flex-1 sm:basis-auto">
              Fornecedor
              <Select value={selectedCodigo} onChange={(e) => setSelectedCodigo(e.target.value)}>
                <option value="">Todos os fornecedores</option>
                {colaboradores.map((p) => (
                  <option key={p.id} value={p.codigo ?? ""}>{p.codigo}</option>
                ))}
              </Select>
            </label>

            {/* Contrato */}
            <label className="text-label grid w-full min-w-0 basis-full gap-1.5 text-[var(--muted-foreground)] sm:min-w-[180px] sm:flex-1 sm:basis-auto">
              Contrato
              <Select value={selectedContrato} onChange={(e) => setSelectedContrato(e.target.value)}>
                <option value="">Todos os contratos</option>
                {contratos.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </label>

            {/* Limpar */}
            <Button
              variant="ghost"
              onClick={() => { setSelectedCodigo(""); setSelectedContrato(""); }}
              className="shrink-0 self-end"
            >
              <X size={14} />
              Limpar
            </Button>
          </div>
        </Card>
      </>
    );
  })();

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppShell
      activeSection={section}
      onNavigate={(id) => setSection(id as Section)}
      navItems={navItems}
      pageTitle={TITLES[section]}
      sidebarFooter={<AccountMenu user={user} roleLabel={user.perfil} onLogout={logout} compact />}
    >
      {floatingNotifications}
      {section === "visao" && (
        <PageContainer className="grid gap-6">
          <PageHeader
            eyebrow="Visão geral"
            title="Dashboard"
            description="Acompanhe os indicadores consolidados de medição e participação."
          />
          {filtersBar}
          <div className="grid gap-6">
            <Dashboard data={dashboard} />
            <MapaPagamentoResumo data={dashboard} isAdmin={isAdmin} onChanged={refreshAll} ciclo={activeCiclo} />
            <MapaPagamentoTable
              itens={mapaItens}
              contratos={contratosCiclo}
              profissionais={profissionais}
              selectedCodigo={selectedCodigo}
              selectedContrato={selectedContrato}
              isAdmin={isAdmin}
              onChanged={refreshAll}
              revisoes={sgcAlertas}
              sgcStatus={sgcStatus}
              onEnviarBm={enviarBm}
              onRetornarBm={retornarBm}
              onDivergenciaResolvida={loadAlertas}
              ciclo={activeCiclo}
            />
          </div>
        </PageContainer>
      )}

      {section === "historico" && (
        <PageContainer className="grid gap-6">
          <PageHeader
            eyebrow="Medições"
            title="Histórico de Medições"
            description="Consulte ciclos concluídos e seus registros operacionais."
          />
          {filtersBar}
          <HistoricoSection
            ciclos={ciclos}
            activeCiclo={activeCiclo}
            isAdmin={isAdmin}
            novoCiclo={novoCiclo}
            setNovoCiclo={setNovoCiclo}
            criandoCiclo={criandoCiclo}
            onCriarCiclo={criarCiclo}
            onSelectCiclo={(c) => { setActiveCiclo(c); setSection("visao"); }}
            ativandoMedicaoCiclo={ativandoMedicaoCiclo}
            onAtivarMedicao={ativarCicloMedicao}
            canResetCiclos={isFullAdmin}
            resetandoCiclos={resetandoCiclos}
            onResetCiclos={resetarCiclos}
          />
        </PageContainer>
      )}

      {section === "importar" && isAdmin && (
        <PageContainer className="grid gap-6">
          <PageHeader
            eyebrow="Importação"
            title="Importar Planilha"
            description="Atualize a base de medições a partir da planilha operacional."
          />
          <div className="flex justify-center">
            <div className="w-full max-w-2xl">
              <ImportarPlanilhaSection
                ciclos={ciclos}
                onImported={() => {
                  loadCiclos();
                  refreshAll();
                }}
              />
            </div>
          </div>
        </PageContainer>
      )}

      {section === "evidencias" && isAdmin && (
        <PageContainer className="grid gap-6">
          <PageHeader
            eyebrow="Administrativo"
            title="Evidências de Medição"
            description="Visualize e imprima o Boletim de Medição de qualquer fornecedor por ciclo."
          />
          <EvidenciasSection ciclos={ciclos} />
        </PageContainer>
      )}

      {section === "financeiro" && (isAdmin || isFinanceiro || isAdministrativo) && (
        <FinanceiroPanel ciclos={ciclos} exportOnly={isAdministrativo} />
      )}

      {section === "usuarios" && isAdmin && (
        <UsuariosPanel canCreateUsers={isFullAdmin} />
      )}

      {section === "administrativo" && (isFullAdmin || isAdministrativo) && (
        <AdministrativoPanel />
      )}

      {selectedAlerta && (
        <SgcReviewModal
          alerta={selectedAlerta}
          saving={reenviandoId === selectedAlerta.id}
          onClose={() => setSelectedAlerta(null)}
          onReenviar={() => reenviar(selectedAlerta)}
        />
      )}

      {isAdmin && !selectedChatAlerta && <GeneralChatWidget />}

      {selectedChatAlerta && (
        <ComentarioDropdown
          revisao={selectedChatAlerta}
          conversas={sgcConversas}
          onClose={() => setSelectedChatAlerta(null)}
          onRespondido={loadAlertas}
          onSelectRevisao={(revisao) => {
            const alerta = sgcConversas.find((item) => item.id === revisao.id);
            if (alerta) setSelectedChatAlerta(alerta);
          }}
          ciclo={activeCiclo}
        />
      )}
    </AppShell>
  );
}

// ─── HistoricoSection ─────────────────────────────────────────────────────────

function HistoricoSection({
  ciclos,
  activeCiclo,
  isAdmin,
  novoCiclo,
  setNovoCiclo,
  criandoCiclo,
  onCriarCiclo,
  onSelectCiclo,
  ativandoMedicaoCiclo,
  onAtivarMedicao,
  canResetCiclos,
  resetandoCiclos,
  onResetCiclos,
}: {
  ciclos: CicloEntry[];
  activeCiclo: string;
  isAdmin: boolean;
  novoCiclo: string;
  setNovoCiclo: (v: string) => void;
  criandoCiclo: boolean;
  onCriarCiclo: () => void;
  onSelectCiclo: (ciclo: string) => void;
  ativandoMedicaoCiclo: string | null;
  onAtivarMedicao: (ciclo: string) => void;
  canResetCiclos: boolean;
  resetandoCiclos: boolean;
  onResetCiclos: (ciclo?: string) => void;
}) {
  const dateLabel = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(v));

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-end gap-4">
        {isAdmin && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              className="h-9 w-32 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
              placeholder="Ex: 2606"
              maxLength={4}
              value={novoCiclo}
              onChange={(e) => setNovoCiclo(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && onCriarCiclo()}
            />
            <Button onClick={onCriarCiclo} disabled={criandoCiclo || !novoCiclo}>
              <Plus size={14} />
              Novo ciclo
            </Button>
            {canResetCiclos && (
              <Button variant="danger" onClick={() => onResetCiclos(novoCiclo)} disabled={resetandoCiclos || !/^\d{4}$/.test(novoCiclo)}>
                <Trash2 size={14} />
                {resetandoCiclos ? "Excluindo..." : "Excluir ciclo"}
              </Button>
            )}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#F9FAFB]">
              {["Ciclo", "Mês de referência", "Última atualização", ""].map((h, i) => (
                <th
                  key={i}
                  className={`text-table-header border-b border-[#E5E7EB] px-4 py-3 text-[var(--muted-foreground)] ${i === 3 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ciclos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-[#9CA3AF]">
                  Nenhum ciclo cadastrado.
                </td>
              </tr>
            )}
            {ciclos.map((c) => {
              const isActive = c.ciclo === activeCiclo;
              const isMedicaoAtiva = !!c.ativoMedicao;
              return (
                <tr key={c.ciclo} className={`border-b border-[#F3F4F6] last:border-0 ${isActive ? "bg-[#EFF6FF]" : "hover:bg-[#FAFAFA]"}`}>
                  <td className="px-4 py-3 font-semibold text-[#1A1A1A]">
                    {c.ciclo}
                    {isActive && (
                      <span className="ml-2 inline-flex items-center rounded-md bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-bold text-[#2563EB] ring-1 ring-[#BFDBFE]">
                        VISUALIZANDO
                      </span>
                    )}
                    {isMedicaoAtiva && (
                      <span className="ml-2 inline-flex items-center rounded-md bg-[#F0FDF4] px-1.5 py-0.5 text-[10px] font-bold text-[#15803D] ring-1 ring-[#BBF7D0]">
                        MEDIÇÃO ATIVA
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{c.mesReferencia ?? "–"}</td>
                  <td className="px-4 py-3 text-[#555555]">{dateLabel(c.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {isAdmin && (
                        <Button
                          variant={isMedicaoAtiva ? "success" : "secondary"}
                          disabled={isMedicaoAtiva || ativandoMedicaoCiclo === c.ciclo}
                          onClick={() => onAtivarMedicao(c.ciclo)}
                        >
                          {isMedicaoAtiva ? "Ativo para medição" : ativandoMedicaoCiclo === c.ciclo ? "Ativando..." : "Ativar medição"}
                        </Button>
                      )}
                      <Button
                        variant={isActive ? "secondary" : "primary"}
                        onClick={() => onSelectCiclo(c.ciclo)}
                      >
                        {isActive ? "Visualizando" : "Abrir ciclo"}
                      </Button>
                      {canResetCiclos && (
                        <IconButton
                          title={`Excluir ciclo ${c.ciclo}`}
                          onClick={() => onResetCiclos(c.ciclo)}
                          disabled={resetandoCiclos}
                          className="border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] hover:text-[#991B1B]"
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type SgcAlerta = {
  id: string;
  colaboradorCodigo: string;
  colaboradorNome: string | null;
  status: string;
  revisaoNumero: number;
  proximaRevisaoLabel: string;
  pontosDiscordancia: string | null;
  respostaAdmin: string | null;
  observacaoColaborador: string | null;
  colaboradorAvatarUrl?: string | null;
  colaboradorOnline?: boolean;
  mensagens: Array<{
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
  }>;
  revisaoSolicitadaAt: string | null;
  colaborador: {
    codigo: string; nome: string | null; cpf: string | null; cnpj: string | null;
    razaoSocial: string | null; email: string | null; funcao: string | null; statusColaborador: string | null;
  };
  pagamento: { ato: string | null; valor: number; rev: number; razaoSocial: string | null; } | null;
  medicao: {
    totalDocumentos: number; totalMedido: number; totalHoras: number;
    documentos: Array<{
      id: string; projetoReferente: string; tituloPrimario: string | null;
      dataCadastro: string | null; formato: string | null; valorMedicao: number; equivalenteA1Horas: number;
    }>;
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number   = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function dateTimeLabel(v: string | null) {
  if (!v) return "–";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
}
function dateLabel(v: string | null) {
  if (!v) return "–";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${v}T00:00:00`));
}

function latestChatMessage(alerta: SgcAlerta) {
  return alerta.mensagens.at(-1) ?? null;
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-[#1A1A1A]">{value || "–"}</p>
    </div>
  );
}

// ─── SGC Modal ────────────────────────────────────────────────────────────────

function SgcReviewModal({
  alerta, saving, onClose, onReenviar,
}: { alerta: SgcAlerta; saving: boolean; onClose: () => void; onReenviar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-4 sm:items-center backdrop-blur-sm">
      <section className="w-full max-w-4xl overflow-hidden rounded-none sm:rounded-2xl border-0 sm:border border-[#E5E7EB] bg-white shadow-2xl min-h-screen sm:min-h-0 sm:max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A]">Análise da solicitação SGC</h2>
            <p className="mt-0.5 text-sm text-[#555555]">Revise o comentário, ajuste a medição e reenvie para validação.</p>
          </div>
          <IconButton onClick={onClose} title="Fechar"><X size={16} /></IconButton>
        </div>

        {/* Body */}
        <div className="overflow-auto p-4 sm:p-6 sm:max-h-[calc(90vh-136px)]">
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              {
                title: "Fornecedor",
                fields: [
                  ["ID", alerta.colaborador.codigo],
                  ["Nome", alerta.colaborador.nome],
                  ["CPF / CNPJ", alerta.colaborador.cpf || alerta.colaborador.cnpj],
                  ["Razão social", alerta.colaborador.razaoSocial],
                  ["E-mail", alerta.colaborador.email],
                ],
              },
              {
                title: "Status da revisão",
                fields: [
                  ["Status", alerta.status],
                  ["Próximo reenvio", alerta.proximaRevisaoLabel],
                  ["Solicitação em", dateTimeLabel(alerta.revisaoSolicitadaAt)],
                  ["Alocação", alerta.pagamento?.ato],
                  ["Pagamento", alerta.pagamento ? currency.format(alerta.pagamento.valor) : null],
                ],
              },
              {
                title: "Medição relacionada",
                fields: [
                  ["Documentos", alerta.medicao.totalDocumentos],
                  ["Valor medido", currency.format(alerta.medicao.totalMedido)],
                  ["Horas", `${number.format(alerta.medicao.totalHoras)} HH`],
                ],
              },
            ].map(({ title, fields }) => (
              <div key={title} className="rounded-xl border border-[#E5E7EB] p-4">
                <p className="mb-3 text-sm font-bold text-[#1A1A1A]">{title}</p>
                <div className="grid gap-3">
                  {fields.map(([l, v]) => (
                    <Detail key={String(l)} label={String(l)} value={v as React.ReactNode} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Discordance */}
          <div className="mt-4 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4">
            <p className="text-sm font-bold text-[#DC2626]">Comentário enviado</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-[#1A1A1A]">{alerta.pontosDiscordancia}</p>
          </div>

          {/* Documents */}
          <div className="mt-4 overflow-hidden rounded-xl border border-[#E5E7EB]">
            <div className="border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
              <p className="text-sm font-bold text-[#1A1A1A]">Documentos da medição</p>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F9FAFB]">
                    {["Projeto", "Título", "Data", "Formato", "Valor"].map((h, i) => (
                      <th key={h} className={`text-table-header border-b border-[#E5E7EB] px-4 py-2.5 text-[var(--muted-foreground)] ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {alerta.medicao.documentos.map((d) => (
                    <tr key={d.id} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA]">
                      <td className="px-4 py-3 font-medium text-[#1A1A1A]">{d.projetoReferente}</td>
                      <td className="px-4 py-3 text-[#555555]">{d.tituloPrimario ?? "–"}</td>
                      <td className="px-4 py-3 text-[#555555]">{dateLabel(d.dataCadastro)}</td>
                      <td className="px-4 py-3 text-[#555555]">{d.formato ?? "–"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1A1A1A]">{currency.format(d.valorMedicao)}</td>
                    </tr>
                  ))}
                  {!alerta.medicao.documentos.length && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-[#9CA3AF]">Nenhum documento vinculado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Fechar</Button>
          <Button variant="success" onClick={onReenviar} disabled={saving}>
            {saving ? "Reenviando…" : `Reenviar ${alerta.proximaRevisaoLabel}`}
          </Button>
        </div>
      </section>
    </div>
  );
}

// ─── ImportarPlanilhaSection ──────────────────────────────────────────────────

type EtlStatus = { running: boolean; lastResult: Record<string, number> | null; lastError: string | null };

function ImportarPlanilhaSection({ ciclos, onImported }: { ciclos: CicloEntry[]; onImported: () => void }) {
  const [file, setFile]         = useState<File | null>(null);
  const [ciclo, setCiclo]       = useState("");
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg]           = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [status, setStatus]     = useState<EtlStatus | null>(null);
  const pollingRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/etl");
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // poll while ETL is running
  useEffect(() => {
    if (status?.running) {
      pollingRef.current = setInterval(async () => {
        const res = await fetch("/api/admin/etl");
        if (!res.ok) return;
        const data: EtlStatus = await res.json();
        setStatus(data);
        if (!data.running) {
          clearInterval(pollingRef.current!);
          if (data.lastError) {
            setMsg({ type: "error", text: "ETL encerrou com erro. Veja os detalhes abaixo." });
          } else {
            setMsg({ type: "success", text: "Importação concluída com sucesso!" });
            onImported();
          }
        }
      }, 2000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [status?.running, onImported]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setMsg({ type: "error", text: "Selecione um arquivo .xlsm ou .xlsx." }); return; }
    if (!/^\d{4}$/.test(ciclo.trim())) {
      setMsg({ type: "error", text: "Informe o ciclo de destino no formato YYMM antes de importar. Exemplo: 2606." });
      return;
    }
    setUploading(true);
    setMsg({ type: "info", text: "Enviando arquivo…" });
    const form = new FormData();
    form.append("file", file);
    form.append("ciclo", ciclo.trim());
    try {
      const res = await fetch("/api/admin/etl", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: "error", text: data.error ?? "Erro ao iniciar ETL." }); return; }
      setMsg({ type: "info", text: "ETL iniciado. Aguardando conclusão…" });
      setStatus((s) => s ? { ...s, running: true } : { running: true, lastResult: null, lastError: null });
    } catch {
      setMsg({ type: "error", text: "Erro de conexão." });
    } finally {
      setUploading(false);
    }
  }

  async function handleResetDatabase() {
    const confirmed = window.confirm(
      "Limpar dados de teste? Esta ação apaga medições, profissionais, projetos, mapa de pagamento, SGC e contratos importados. Os usuários internos de acesso serão preservados.",
    );
    if (!confirmed) return;

    setResetting(true);
    setMsg({ type: "info", text: "Limpando dados de teste…" });
    try {
      const res = await fetch("/api/admin/reset-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: "LIMPAR" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", text: data.error ?? "Não foi possível limpar os dados." });
        return;
      }
      setFile(null);
      setCiclo("");
      setStatus(null);
      setMsg({
        type: "success",
        text: `Dados limpos. ${data.removed?.medicoes ?? 0} medição(ões), ${data.removed?.profissionais ?? 0} profissional(is) e ${data.removed?.mapaPagamentoItens ?? 0} item(ns) de pagamento removidos.`,
      });
      onImported();
    } catch {
      setMsg({ type: "error", text: "Erro de conexão ao limpar os dados." });
    } finally {
      setResetting(false);
    }
  }

  const msgColors = { success: "bg-[#DCFCE7] text-[#15803D]", error: "bg-[#FEE2E2] text-[#B91C1C]", info: "bg-[#EFF6FF] text-[#1D4ED8]" };

  return (
    <div className="grid gap-6">
      {/* Ações */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <a
          href="/api/admin/templates/medicoes"
          download
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#555555] shadow-sm transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <Download size={14} />
          Baixar máscara
        </a>
        {status?.running && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#2563EB]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#2563EB]" />
            Importando…
          </span>
        )}
      </div>

      {/* Upload card */}
      <Card className="overflow-hidden">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF0F0] text-[#AF1B1B]">
              <Upload size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">Arquivo Excel</p>
              <p className="text-[11px] text-[#9CA3AF]">Formato aceito: .xlsm ou .xlsx; dados cadastrais vêm do Painel Administrativo</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5 p-5">
          {/* File picker */}
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#E5E7EB] bg-[#FAFAFA] py-8 text-center transition hover:border-[#AF1B1B] hover:bg-[#FFF5F5]"
            onClick={() => document.getElementById("etl-file-input")?.click()}
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3F4F6] text-[#9CA3AF]">
              <Upload size={20} />
            </span>
            {file ? (
              <>
                <span className="text-sm font-semibold text-[#AF1B1B]">{file.name}</span>
                <span className="text-[11px] text-[#9CA3AF]">Clique para trocar o arquivo</span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-[#555555]">Clique para selecionar o arquivo</span>
                <span className="text-[11px] text-[#9CA3AF]">.xlsm ou .xlsx</span>
              </>
            )}
          </div>
          <input
            id="etl-file-input"
            type="file"
            accept=".xlsm,.xlsx"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(null); }}
          />

          {/* Ciclo selector */}
          <div className="grid gap-1.5">
            <p className="text-label text-[var(--muted-foreground)]">Ciclo de destino</p>
            <div className="flex gap-2">
              <Select value={ciclo} onChange={(e) => setCiclo(e.target.value)} className="flex-1">
                <option value="">Selecione ou digite o ciclo</option>
                {ciclos.map((c) => (
                  <option key={c.ciclo} value={c.ciclo}>{c.ciclo}{c.mesReferencia ? ` – ${c.mesReferencia}` : ""}</option>
                ))}
              </Select>
              <input
                type="text"
                placeholder="Ou digite (ex: 2607)"
                value={ciclo}
                onChange={(e) => setCiclo(e.target.value)}
                className="h-9 w-40 rounded-lg border border-[#E5E7EB] px-3 text-xs outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
              />
            </div>
            <p className="text-[11px] text-[#9CA3AF]">O ciclo informado separa as cargas. Se o ciclo já existir, a importação atualiza somente os fornecedores presentes no arquivo.</p>
          </div>

          {msg && (
            <div className={`rounded-lg px-4 py-3 text-xs font-medium ${msgColors[msg.type]}`}>{msg.text}</div>
          )}

          <button
            type="submit"
            disabled={uploading || status?.running}
            className="w-full rounded-xl bg-[#AF1B1B] py-2.5 text-sm font-semibold text-white transition hover:bg-[#8C1616] disabled:opacity-50"
          >
            {uploading ? "Enviando…" : status?.running ? "Importando…" : "Iniciar importação"}
          </button>
        </form>
      </Card>

      {/* Resultado */}
      {status && (status.lastResult || status.lastError) && (
        <Card className="overflow-hidden">
          <div className="border-b border-[#E5E7EB] px-5 py-4">
            <p className="text-sm font-semibold text-[#1A1A1A]">Último resultado</p>
          </div>
          <div className="p-5">
            {status.lastError ? (
              <pre className="overflow-auto rounded-lg bg-[#FEF2F2] p-3 text-xs text-[#B91C1C] whitespace-pre-wrap">{status.lastError}</pre>
            ) : status.lastResult ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Object.entries(status.lastResult).map(([key, val]) => (
                  <div key={key} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{key.replace(/_/g, " ")}</p>
                    <p className="mt-1 text-lg font-bold text-[#1A1A1A]">{val}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border-[#FCA5A5]">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-[#1A1A1A]">Ambiente de testes</p>
            <p className="mt-0.5 text-xs text-[#555555]">Limpa os dados importados e mantém os usuários internos para novo teste.</p>
          </div>
          <Button
            variant="danger"
            onClick={handleResetDatabase}
            disabled={resetting || uploading || status?.running}
            className="sm:w-auto"
          >
            <Trash2 size={14} />
            {resetting ? "Limpando…" : "Limpar dados"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── EvidenciasSection ────────────────────────────────────────────────────────

function EvidenciasSection({ ciclos }: { ciclos: CicloEntry[] }) {
  const TODOS = "__todos__";
  const [selectedCiclo,  setSelectedCiclo]  = useState(TODOS);
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [bm, setBm]       = useState<BmData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // colaboradorCodigo (chave canônica do SGC) → { ciclo mais recente com BM, nome para exibição }.
  // Evidências representa a EXISTÊNCIA do Boletim de Medição (qualquer status a partir do envio),
  // não um recorte transitório de "aguardando aprovação" — por isso a fonte é o próprio SGC
  // (mesma tabela/regra usada em app/api/colaborador/sgc/route.ts: status !== AGUARDANDO_ENVIO/CANCELADO),
  // e não a lista de Profissional (cujo campo `codigo` fica vazio na maioria dos cadastros importados
  // pelo ETL e não deve ser usado como chave de correspondência aqui).
  const [aprovadosMap, setAprovadosMap] = useState<Map<string, { ciclo: string; nome: string }>>(new Map());

  useEffect(() => {
    setSelectedCodigo("");
    setBm(null);
    const ciclosParaBuscar = selectedCiclo === TODOS ? ciclos.map((c) => c.ciclo) : [selectedCiclo];
    if (ciclosParaBuscar.length === 0) return;

    Promise.all(
      ciclosParaBuscar.map((ciclo) =>
        fetch(`/api/sgc/status?ciclo=${encodeURIComponent(ciclo)}`)
          .then((r) => r.json() as Promise<Record<string, { status: string; colaboradorNome: string | null }>>)
          .then((data) => ({ ciclo, data }))
          .catch(() => ({ ciclo, data: {} as Record<string, { status: string; colaboradorNome: string | null }> }))
      )
    ).then((results) => {
      // ciclos já vêm ordenados desc; iterar do mais antigo ao mais recente
      // para que o mais recente sobreescreva no map
      const map = new Map<string, { ciclo: string; nome: string }>();
      for (const { ciclo, data } of [...results].reverse()) {
        for (const [codigo, entry] of Object.entries(data)) {
          if (entry.status !== "AGUARDANDO_ENVIO" && entry.status !== "CANCELADO") {
            map.set(codigo, { ciclo, nome: entry.colaboradorNome || codigo });
          }
        }
      }
      setAprovadosMap(map);
    });
  }, [selectedCiclo, ciclos]);

  const colaboradoresAprovados = Array.from(aprovadosMap.entries())
    .map(([codigo, info]) => ({ codigo, nome: info.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  async function buscar() {
    if (!selectedCodigo) return;
    const ciclo = selectedCiclo === TODOS ? (aprovadosMap.get(selectedCodigo)?.ciclo ?? "") : selectedCiclo;
    if (!ciclo) return;
    setLoading(true);
    setError(null);
    setBm(null);
    const res = await fetch(`/api/admin/bm?codigo=${encodeURIComponent(selectedCodigo)}&ciclo=${encodeURIComponent(ciclo)}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Erro ao buscar boletim."); }
    else if (!data.pagamento && !data.documentos?.length) { setError("Nenhuma medição encontrada para este fornecedor e ciclo."); }
    else setBm(data);
    setLoading(false);
  }

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF0F0] text-[#AF1B1B]">
              <FileSearch size={16} />
            </span>
            <div>
              <p className="text-card-title text-[#1A1A1A]">Filtros</p>
              <p className="text-helper text-[#9CA3AF]">Selecione o ciclo e o fornecedor para visualizar o boletim</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 p-5">
          <label className="text-label grid w-full gap-1.5 text-[var(--muted-foreground)] sm:w-auto">
            Ciclo
            <Select value={selectedCiclo} onChange={(e) => setSelectedCiclo(e.target.value)} className="sm:min-w-[200px]">
              <option value={TODOS}>Todos os ciclos</option>
              {ciclos.map((c) => (
                <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>
              ))}
            </Select>
          </label>
          <label className="text-label grid w-full gap-1.5 text-[var(--muted-foreground)] sm:w-auto">
            Fornecedor
            <Select value={selectedCodigo} onChange={(e) => setSelectedCodigo(e.target.value)} className="sm:min-w-[220px]" disabled={colaboradoresAprovados.length === 0}>
              <option value="">
                {colaboradoresAprovados.length === 0 ? "Nenhum Boletim de Medição encontrado neste ciclo" : "Selecione…"}
              </option>
              {colaboradoresAprovados.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.nome}</option>
              ))}
            </Select>
          </label>
          <Button onClick={buscar} disabled={!selectedCodigo || loading}>
            {loading ? "Carregando…" : "Ver Boletim"}
          </Button>
        </div>

        {error && (
          <div className="mx-5 mb-5 rounded-lg bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">{error}</div>
        )}
      </Card>

      {bm && (
        <Card>
          <div className="border-b border-[#E5E7EB] px-5 py-4">
            <p className="text-sm font-semibold text-[#1A1A1A]">Boletim de Medição</p>
          </div>
          <div className="p-5 overflow-x-auto">
            <BoletimMedicao data={bm} />
          </div>
        </Card>
      )}
    </div>
  );
}
