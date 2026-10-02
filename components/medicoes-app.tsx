"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccountMenu } from "@/components/account-menu";
import { GeneralChatWidget } from "@/components/general-chat-widget";
import { DashboardPilot } from "@/components/dashboard-pilot";
import { ComentarioDropdown } from "@/components/mapa-pagamento-table";
import { FornecedoresPage } from "@/components/fornecedores";
import { FinanceiroPanel } from "@/components/financeiro-panel";
import { AdministrativoPanel } from "@/components/administrativo-panel";
import { HistoricoWorkspace } from "@/components/historico/historico-workspace";
import { EvidenciasWorkspace } from "@/components/evidencias/evidencias-workspace";
import { useViewportAlign } from "@/components/use-viewport-align";
import { Badge, Button, Card, FilterButton, FilterChip, IconButton, PageContainer, PageHeader, Select } from "@/components/ui";
import type { ContratoResumo, DashboardData, MapaPagamentoItem, Profissional } from "@/components/types";
import { cicloToDates, cicloToMesReferencia } from "@/lib/ciclo";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";
import type { AuthUser } from "@/lib/session";
import { indexSgcStatusByColaborador, type SgcStatusApiEntry, type SgcStatusEntry } from "@/lib/sgc-display-status";

type Section = "visao" | "fornecedores" | "historico" | "importar" | "evidencias" | "financeiro" | "administrativo";

/** Única seção com rota própria; as demais continuam em /?section=. */
const FORNECEDORES_PATH = "/fornecedores";

const TITLES: Record<Section, string> = {
  visao: "Dashboard",
  fornecedores: "Fornecedores",
  historico: "Histórico",
  importar: "Importar Planilha",
  evidencias: "Evidências",
  financeiro: "Financeiro",
  administrativo: "Administrativo",
};

const CICLO_GERAL = "GERAL";

type CicloEntry = { ciclo: string; mesReferencia: string | null; ativoMedicao?: boolean; updatedAt: string };

export function MedicoesApp({ user, permissoesExtras = [] }: { user: AuthUser; permissoesExtras?: string[] }) {
  const [dashboard, setDashboard]           = useState<DashboardData | null>(null);
  const [profissionais, setProfissionais]   = useState<Profissional[]>([]);
  const [mapaItens, setMapaItens]           = useState<MapaPagamentoItem[]>([]);
  const [contratosCiclo, setContratosCiclo] = useState<ContratoResumo[]>([]);
  const [sgcAlertas, setSgcAlertas]         = useState<SgcAlerta[]>([]);
  const [sgcConversas, setSgcConversas]     = useState<SgcAlerta[]>([]);
  const [sgcStatus, setSgcStatus]           = useState<Record<string, SgcStatusEntry>>({});
  const [reenviandoId, setReenviandoId]     = useState<string | null>(null);
  const [selectedAlerta, setSelectedAlerta] = useState<SgcAlerta | null>(null);
  const [selectedChatAlerta, setSelectedChatAlerta] = useState<SgcAlerta | null>(null);
  const [notifOpen, setNotifOpen]           = useState(false);
  const [seenIds, setSeenIds]               = useState<string[]>([]);
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [selectedContrato, setSelectedContrato] = useState("");
  const initialSearchParams                  = useSearchParams();
  const [activeCiclo, setActiveCiclo]       = useState(() => {
    const cicloUrl = initialSearchParams?.get("ciclo");
    return cicloUrl && /^\d{4}$/.test(cicloUrl) ? cicloUrl : CICLO_GERAL;
  });
  const [ciclos, setCiclos]                 = useState<CicloEntry[]>([]);
  const [novoCiclo, setNovoCiclo]           = useState("");
  const [criandoCiclo, setCriandoCiclo]     = useState(false);
  const [novoCicloOpen, setNovoCicloOpen]   = useState(false);
  const [filtrosDashboardOpen, setFiltrosDashboardOpen] = useState(false);
  const filtrosDashboardRef                 = useRef<HTMLDivElement>(null);
  const filtrosDashboardPainelRef           = useRef<HTMLDivElement>(null);
  const filtrosDashboardPosicao             = useViewportAlign(filtrosDashboardRef, filtrosDashboardPainelRef, filtrosDashboardOpen);
  const cicloInicializadoRef                = useRef(false);
  const alertasBaselineRef                  = useRef(false);
  const previousAlertIdsRef                 = useRef<Set<string>>(new Set());
  const previousAlertMessageIdsRef          = useRef<Map<string, string>>(new Map());

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearchParams = searchParams ?? new URLSearchParams();
  const isAdmin      = user.perfil === "MEDICAO" || user.perfil === "ADMIN";
  const isFullAdmin  = user.perfil === "ADMIN";
  const isMedicao    = user.perfil === "MEDICAO";
  const isFinanceiro = user.perfil === "FINANCEIRO";
  const isAdministrativo = user.perfil === "ADMINISTRATIVO";
  // Permissões ADITIVAS concedidas individualmente (lib/permissoes.ts) — nunca liberadas para o
  // perfil inteiro. ADMIN já tem tudo de base independentemente desta lista. Nenhum perfil além
  // de ADMIN tem "historico" de base hoje (auditado antes desta mudança — nem MEDICAO) — por isso
  // HISTORICO_MEDICOES precisa da mesma concessão nominal para qualquer perfil, sem exceção.
  const temAcessoAdministrativoExtra = permissoesExtras.includes("ADMINISTRATIVO");
  const temAcessoHistoricoExtra = permissoesExtras.includes("HISTORICO_MEDICOES");

  const VALID_SECTIONS: Section[] = isFinanceiro
    ? (["financeiro", ...(temAcessoAdministrativoExtra ? ["administrativo" as const] : []), ...(temAcessoHistoricoExtra ? ["historico" as const] : [])])
    : isAdministrativo
    ? (["administrativo", "financeiro", ...(temAcessoHistoricoExtra ? ["historico" as const] : [])])
    : isMedicao
    ? (["visao", "fornecedores", "importar", "evidencias", ...(temAcessoAdministrativoExtra ? ["administrativo" as const] : []), ...(temAcessoHistoricoExtra ? ["historico" as const] : [])])
    : isFullAdmin
    ? ["administrativo", "evidencias", "financeiro", "fornecedores", "historico", "importar", "visao"]
    : ["evidencias", "financeiro", "fornecedores", "historico", "importar", "visao"];
  const sectionParam = currentSearchParams.get("section") as Section | null;
  const defaultSection: Section = isFinanceiro ? "financeiro" : isAdministrativo ? "administrativo" : "visao";
  const naRotaFornecedores = pathname === FORNECEDORES_PATH;
  const section: Section = naRotaFornecedores
    ? (VALID_SECTIONS.includes("fornecedores") ? "fornecedores" : defaultSection)
    : sectionParam && VALID_SECTIONS.includes(sectionParam) ? sectionParam : defaultSection;
  function setSection(s: Section) {
    // Entre / e /fornecedores o ciclo ativo segue pela URL (?ciclo=), para não voltar a "Geral".
    const cicloParam = activeCiclo !== CICLO_GERAL ? `ciclo=${activeCiclo}` : "";
    if (s === "fornecedores") {
      router.push(`${FORNECEDORES_PATH}${cicloParam ? `?${cicloParam}` : ""}`);
      return;
    }
    if (naRotaFornecedores) {
      router.push(`/?section=${s}${cicloParam ? `&${cicloParam}` : ""}`);
      return;
    }
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
    if (statusRes.ok) {
      const entries = await statusRes.json() as SgcStatusApiEntry[];
      setSgcStatus(indexSgcStatusByColaborador(entries));
    }
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

  /**
   * Publica o ciclo no portal dos fornecedores — a MESMA ação de sempre (PATCH /api/ciclos,
   * action "set_ativo_medicao", que marca `ativoMedicao` só neste ciclo; permissão Medição/ADMIN).
   * Antes ficava no Histórico ("Ativar medição"); agora é acionada pelo controle "Ciclo publicado"
   * em /fornecedores. Devolve a mensagem de erro (exibida na confirmação) ou null.
   */
  async function publicarCicloPortal(ciclo: string): Promise<string | null> {
    const res = await fetch("/api/ciclos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_ativo_medicao", ciclo }),
    });
    if (!res.ok) {
      const p = await res.json().catch(() => ({}));
      return p.error ?? "Não foi possível publicar o ciclo no portal.";
    }
    await loadCiclos();
    return null;
  }

  // Excluir ciclo (DELETE /api/ciclos — somente ADMIN, mesmo payload de sempre). A confirmação é o
  // modal do design system em Fornecedores → Gerenciar ciclos; devolve a mensagem de erro ou null.
  async function excluirCiclo(cicloParaExcluir: string): Promise<string | null> {
    if (!/^\d{4}$/.test(cicloParaExcluir)) return "Selecione um ciclo válido para excluir.";
    try {
      const res = await fetch("/api/ciclos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacao: "RESETAR_CICLOS", ciclo: cicloParaExcluir }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? "Não foi possível excluir o ciclo.";
      if (activeCiclo === cicloParaExcluir) handleCicloChange(CICLO_GERAL);
      await Promise.all([loadCiclos(), refreshAll(), loadAlertas()]);
      return null;
    } catch {
      return "Não foi possível excluir o ciclo.";
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

  const navItemAdministrativoExtra = { id: "administrativo" as const, label: "Administrativo", icon: <FileText size={17} /> };
  const navItemHistoricoExtra = { id: "historico" as const, label: "Histórico", icon: <History size={17} /> };

  const navItems = isFinanceiro
    ? [
        { id: "financeiro", label: "Financeiro", icon: <Wallet size={17} /> },
        ...(temAcessoAdministrativoExtra ? [navItemAdministrativoExtra] : []),
        ...(temAcessoHistoricoExtra ? [navItemHistoricoExtra] : []),
      ]
    : isAdministrativo
    ? [
        { id: "administrativo", label: "Administrativo", icon: <FileText size={17} /> },
        { id: "financeiro", label: "Financeiro", icon: <Wallet size={17} /> },
        ...(temAcessoHistoricoExtra ? [navItemHistoricoExtra] : []),
      ]
    : isMedicao
    ? [
        { id: "visao",      label: "Visão Geral", icon: <LayoutDashboard size={17} /> },
        { id: "fornecedores", label: "Fornecedores", icon: <Users size={17} /> },
        { id: "evidencias", label: "Evidências",  icon: <FileSearch size={17} /> },
        ...(temAcessoAdministrativoExtra ? [navItemAdministrativoExtra] : []),
        ...(temAcessoHistoricoExtra ? [navItemHistoricoExtra] : []),
        { id: "importar",   label: "Importar Planilha", icon: <Upload size={17} />, bottom: true },
      ]
    : [
        { id: "visao",      label: "Visão Geral",      icon: <LayoutDashboard size={17} /> },
        { id: "fornecedores", label: "Fornecedores",    icon: <Users size={17} /> },
        { id: "administrativo", label: "Administrativo", icon: <FileText size={17} /> },
        { id: "evidencias", label: "Evidências",        icon: <FileSearch size={17} /> },
        { id: "financeiro", label: "Financeiro",        icon: <Wallet size={17} /> },
        { id: "historico",  label: "Histórico",         icon: <History size={17} /> },
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

  // Mesmo padrão de fechar ao clicar fora já usado no dropdown "Filtros" do Painel Administrativo.
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (filtrosDashboardRef.current && !filtrosDashboardRef.current.contains(e.target as Node)) {
        setFiltrosDashboardOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function handleCicloChange(value: string) {
    setActiveCiclo(value);
    setSelectedCodigo("");
    setSelectedContrato("");
    if (naRotaFornecedores) router.replace(value === CICLO_GERAL ? FORNECEDORES_PATH : `${FORNECEDORES_PATH}?ciclo=${value}`);
  }

  // Novo ciclo (POST /api/ciclos — Medição/ADMIN, formato YYMM). Mesmo fluxo de sempre: depois de
  // criar, recarrega a lista e passa a trabalhar no ciclo novo (sem publicá-lo no portal).
  async function criarCicloApi(cicloValue: string): Promise<string | null> {
    if (!/^\d{4}$/.test(cicloValue)) return "Digite um ciclo válido no formato YYMM (ex: 2606).";
    setCriandoCiclo(true);
    try {
      const res = await fetch("/api/ciclos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciclo: cicloValue }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        return p.error ?? "Erro ao criar ciclo.";
      }
      const updated = await fetch("/api/ciclos");
      if (updated.ok) setCiclos(await updated.json());
      handleCicloChange(cicloValue);
      return null;
    } catch {
      return "Erro ao criar ciclo.";
    } finally {
      setCriandoCiclo(false);
    }
  }

  async function criarCiclo() {
    const falha = await criarCicloApi(novoCiclo.trim());
    if (falha) {
      alert(falha);
      return;
    }
    setNovoCiclo("");
    setNovoCicloOpen(false);
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

    // "Filtro ativo" (chip/contador) = Ciclo fora do padrão "Geral", Fornecedor/Contrato
    // diferentes de "Todos". Produção/ATO não são filtros de seleção (são dados do contexto do
    // ciclo), então não entram nos chips/contador — só continuam dentro do dropdown.
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (activeCiclo !== CICLO_GERAL) chips.push({ key: "ciclo", label: `Ciclo: ${activeCiclo}`, onRemove: () => handleCicloChange(CICLO_GERAL) });
    if (selectedCodigo) chips.push({ key: "fornecedor", label: `Fornecedor: ${selectedCodigo}`, onRemove: () => setSelectedCodigo("") });
    if (selectedContrato) chips.push({ key: "contrato", label: `Contrato: ${selectedContrato}`, onRemove: () => setSelectedContrato("") });

    return (
      <div className={section === "visao" ? "flex flex-wrap items-center gap-2" : "mb-6 flex flex-wrap items-center gap-2"}>
        <div className="relative" ref={filtrosDashboardRef}>
          <FilterButton count={chips.length} onClick={() => setFiltrosDashboardOpen((v) => !v)} />
          {filtrosDashboardOpen && (
            // Largura limitada à viewport e posição com detecção de colisão (useViewportAlign): no
            // desktop o botão fica na borda direita do cabeçalho e o painel é deslocado para dentro.
            <div
              ref={filtrosDashboardPainelRef}
              data-testid="dashboard-filtros"
              style={filtrosDashboardPosicao}
              className="absolute left-0 top-10 z-40 w-[min(340px,calc(100vw-2rem))] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-xl"
            >
              <p className="mb-3 text-sm font-bold text-[#1A1A1A]">Filtros</p>

              <div className="grid gap-3">
                {/* Ciclo de trabalho (contexto interno; o ciclo publicado no portal fica em /fornecedores) */}
                <div className="grid gap-1.5">
                  <span className="text-label text-[var(--muted-foreground)]">Ciclo</span>
                  <div className="flex items-center gap-1.5">
                    <Select
                      className="flex-1"
                      value={activeCiclo}
                      onChange={(e) => handleCicloChange(e.target.value)}
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
                      <div className="relative shrink-0">
                        <IconButton
                          title="Novo ciclo"
                          onClick={() => { setNovoCicloOpen((v) => !v); setNovoCiclo(""); }}
                          className={novoCicloOpen ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]" : ""}
                        >
                          <Plus size={15} />
                        </IconButton>
                        {novoCicloOpen && (
                          <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-xl">
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

                {/* Produção + ATO — oculto no Geral, mesma condição/valores de sempre */}
                {activeCiclo !== CICLO_GERAL && (
                  <>
                    <div className="grid gap-1.5">
                      <span className="text-label text-[var(--muted-foreground)]">Produção</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="date"
                          className="h-9 min-w-[8.5rem] flex-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] outline-none hover:border-[#D1D5DB] focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20"
                          defaultValue={producaoInicio}
                          key={producaoInicio}
                          onBlur={(e) => { if (e.target.value && e.target.value !== producaoInicio) saveContextDates(e.target.value, producaoFim); }}
                        />
                        <span className="text-xs text-[#9CA3AF]">a</span>
                        <input
                          type="date"
                          className="h-9 min-w-[8.5rem] flex-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] outline-none hover:border-[#D1D5DB] focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20"
                          defaultValue={producaoFim}
                          key={producaoFim}
                          onBlur={(e) => { if (e.target.value && e.target.value !== producaoFim) saveContextDates(producaoInicio, e.target.value); }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-1.5">
                      <span className="text-label text-[var(--muted-foreground)]">ATO</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="flex h-9 min-w-[8.5rem] flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A]">{fmtDate(atoInicio)}</div>
                        <span className="text-xs text-[#9CA3AF]">a</span>
                        <div className="flex h-9 min-w-[8.5rem] flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A]">{fmtDate(atoFim)}</div>
                      </div>
                    </div>
                  </>
                )}

                {/* Fornecedor */}
                <label className="text-label grid gap-1.5 text-[var(--muted-foreground)]">
                  Fornecedor
                  <Select value={selectedCodigo} onChange={(e) => setSelectedCodigo(e.target.value)}>
                    <option value="">Todos os fornecedores</option>
                    {colaboradores.map((p) => (
                      <option key={p.id} value={p.codigo ?? ""}>{p.codigo}</option>
                    ))}
                  </Select>
                </label>

                {/* Contrato */}
                <label className="text-label grid gap-1.5 text-[var(--muted-foreground)]">
                  Contrato
                  <Select value={selectedContrato} onChange={(e) => setSelectedContrato(e.target.value)}>
                    <option value="">Todos os contratos</option>
                    {contratos.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-3">
                <button
                  type="button"
                  onClick={() => handleCicloChange(CICLO_GERAL)}
                  className="text-xs font-semibold text-[#6B7280] transition hover:text-[#374151]"
                >
                  Limpar filtros
                </button>
                <button
                  type="button"
                  onClick={() => setFiltrosDashboardOpen(false)}
                  className="text-xs font-bold text-[#AF1B1B]"
                >
                  Concluído
                </button>
              </div>
            </div>
          )}
        </div>

        {chips.map((chip) => (
          <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
        ))}
      </div>
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
          <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
            <PageHeader
              eyebrow="Visão geral"
              title="Dashboard"
              description="Visão consolidada das medições e do fluxo operacional dos BMs."
            />
            <div className="shrink-0">{filtersBar}</div>
          </div>
          <div className="grid gap-8">
            <DashboardPilot
              data={dashboard}
              mapaItens={mapaItens}
              contratos={contratosCiclo}
              statuses={sgcStatus}
              ciclo={activeCiclo}
              onVerTodosFornecedores={() => setSection("fornecedores")}
            />
          </div>
        </PageContainer>
      )}

      {section === "fornecedores" && isAdmin && (
        <PageContainer>
          <FornecedoresPage
            itens={mapaItens}
            contratos={contratosCiclo}
            profissionais={profissionais}
            revisoes={sgcAlertas}
            sgcStatus={sgcStatus}
            isAdmin={isAdmin}
            ciclo={activeCiclo}
            ciclos={ciclos.map((c) => c.ciclo)}
            contratoSelecionado={selectedContrato}
            tiposPrecos={dashboard?.tiposPrecos ?? []}
            onCicloChange={handleCicloChange}
            onContratoChange={setSelectedContrato}
            onChanged={refreshAll}
            onEnviarBm={enviarBm}
            onRetornarBm={retornarBm}
            onDivergenciaResolvida={loadAlertas}
            ciclosPortal={ciclos}
            onPublicarCiclo={publicarCicloPortal}
            podeExcluirCiclos={isFullAdmin}
            onCriarCiclo={criarCicloApi}
            onExcluirCiclo={excluirCiclo}
            onBmsEnviados={async () => { await Promise.all([refreshAll(), loadAlertas()]); }}
          />
        </PageContainer>
      )}

      {section === "historico" && (
        <PageContainer className="grid gap-6 pb-24">
          <HistoricoSection ciclos={ciclos} />
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
        <PageContainer className="grid gap-6 pb-24">
          <EvidenciasWorkspace ciclos={ciclos} ciclo={activeCiclo} onCicloChange={handleCicloChange} />
        </PageContainer>
      )}

      {section === "financeiro" && (isAdmin || isFinanceiro || isAdministrativo) && (
        <FinanceiroPanel ciclos={ciclos} exportOnly={isAdministrativo} />
      )}

      {/* isAdmin aqui (prop do AdministrativoPanel) continua isFullAdmin — quem entra só pela
          permissão extra ADMINISTRATIVO recebe exatamente a mesma experiência reduzida que o
          perfil ADMINISTRATIVO nativo já tinha (ver/editar/criar fornecedor, importar planilha,
          sem ações sensíveis) — decisão explícita do pedido, nada novo a implementar no painel. */}
      {section === "administrativo" && (isFullAdmin || isAdministrativo || temAcessoAdministrativoExtra) && (
        <AdministrativoPanel isAdmin={isFullAdmin} />
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

// Histórico = somente consulta/rastreabilidade. Nenhuma manutenção de ciclo aqui: Novo ciclo,
// Selecionar, Excluir e Publicar ficam em /fornecedores (Gerenciar ciclos / Ciclo publicado). Os
// dados vêm de GET /api/historico (Medição/ADMIN ou permissão extra HISTORICO_MEDICOES).
function HistoricoSection({ ciclos }: { ciclos: CicloEntry[] }) {
  return (
    // min-w-0: permite encolher dentro do ancestral flex/grid do AppShell (nunca empurra a página).
    <div className="grid min-w-0 max-w-full gap-6">
      <HistoricoWorkspace ciclos={ciclos} />
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

type EtlInvalidRow = {
  origin: string;
  excelRow: number | null;
  numeroDocumento: string | null;
  numeroMedicao: string | null;
  ciclo: string;
  negativeFields: Record<string, string>;
};

/** Identidade operacional da planilha que não resolveu para um Profissional (etl UnresolvedIdentityError). */
type EtlUnresolvedIdentity = {
  valor: string;
  origem: string;
  ciclo?: string;
  status: "NAO_RESOLVIDO" | "AMBIGUO" | "CONFLITO_ALIAS";
  candidatos?: string[];
  ocorrencias: number;
  linhas: number[];
  sugestoesCadastro?: string[];
};

type EtlStatus = {
  running: boolean;
  lastResult: Record<string, unknown> | null;
  lastError: string | null;
  lastErrorType?: "validation" | "internal" | null;
  lastErrorDetails?: Array<EtlInvalidRow | EtlUnresolvedIdentity>;
};

function isUnresolvedIdentity(row: EtlInvalidRow | EtlUnresolvedIdentity): row is EtlUnresolvedIdentity {
  return "valor" in row && "ocorrencias" in row;
}

const identityStatusLabels: Record<EtlUnresolvedIdentity["status"], string> = {
  NAO_RESOLVIDO: "não encontrado",
  AMBIGUO: "ambíguo",
  CONFLITO_ALIAS: "código já é alias de outro fornecedor",
};

const negativeMeasurementFieldLabels: Record<string, string> = {
  quantidade: "Quantidade",
  valor_total: "Valor total",
  valor_medicao: "Valor da medição",
  equivalente_a1_horas: "Equivalente A1/horas",
  medido_horas: "Medido em horas",
  valor_bruto: "Valor bruto",
  valor_reajuste: "Valor do reajuste",
};

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
      if (res.ok || res.status === 422 || res.status === 500) setStatus(await res.json());
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
        if (!res.ok && res.status !== 422 && res.status !== 500) return;
        const data: EtlStatus = await res.json();
        setStatus(data);
        if (!data.running) {
          clearInterval(pollingRef.current!);
          if (data.lastError) {
            setMsg({
              type: "error",
              text: data.lastErrorType === "validation"
                ? "Importação bloqueada. Revise as linhas indicadas abaixo; nenhum dado foi alterado."
                : "A importação encerrou com uma falha interna. Nenhum dado foi alterado.",
            });
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
              <div className="grid gap-3 rounded-lg bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
                <p className="whitespace-pre-line font-medium">
                  {status.lastErrorDetails?.length && status.lastErrorDetails.every(isUnresolvedIdentity)
                    ? `Importação bloqueada. ${status.lastErrorDetails.length} identidade(s) da planilha não correspondem a um fornecedor cadastrado. Vincule cada nome a um fornecedor existente (alias) ou confirme-o como novo antes de reimportar. Nenhum dado foi alterado.`
                    : status.lastErrorDetails?.length
                    ? `Importação bloqueada. ${status.lastErrorDetails.length} medição(ões) com valores negativos foram encontradas. Revise as linhas abaixo. Nenhum dado foi alterado.`
                    : status.lastError}
                </p>
                {!!status.lastErrorDetails?.length && status.lastErrorDetails.every(isUnresolvedIdentity) && (
                  <ol className="grid list-decimal gap-2 pl-5" data-testid="etl-identidades-nao-resolvidas">
                    {status.lastErrorDetails.map((row) => (
                      <li key={`${row.origem}-${row.valor}`}>
                        <span className="font-semibold">&quot;{row.valor}&quot; — {identityStatusLabels[row.status] ?? row.status}</span>
                        <span className="block">
                          {row.origem}, {row.ocorrencias} ocorrência(s){row.linhas.length ? ` — linha(s) ${row.linhas.join(", ")}${row.ocorrencias > row.linhas.length ? "…" : ""}` : ""}
                        </span>
                        {!!row.candidatos?.length && <span className="block">Candidatos: {row.candidatos.join("; ")}</span>}
                        {!!row.sugestoesCadastro?.length && (
                          <span className="block text-[#92400E]">Sugestão (não aplicada): {row.sugestoesCadastro.join("; ")}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {!!status.lastErrorDetails?.length && !status.lastErrorDetails.every(isUnresolvedIdentity) && (
                  <ol className="grid list-decimal gap-2 pl-5">
                    {status.lastErrorDetails.filter((row): row is EtlInvalidRow => !isUnresolvedIdentity(row)).map((row, index) => (
                      <li key={`${row.origin}-${row.excelRow ?? index}-${row.numeroDocumento ?? index}`}>
                        <span className="font-semibold">
                          {row.origin}{row.excelRow ? `, linha ${row.excelRow}` : ""} — {row.numeroDocumento ?? "Documento não informado"}
                        </span>
                        <span className="block">
                          {Object.entries(row.negativeFields)
                            .map(([field, value]) => `${negativeMeasurementFieldLabels[field] ?? field}: ${value}`)
                            .join("; ")}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : status.lastResult ? (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Object.entries(status.lastResult).filter(([, val]) => typeof val === "number").map(([key, val]) => (
                    <div key={key} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{key.replace(/_/g, " ")}</p>
                      <p className="mt-1 text-lg font-bold text-[#1A1A1A]">{val as number}</p>
                    </div>
                  ))}
                </div>
                {Array.isArray(status.lastResult.aliases_utilizados) && status.lastResult.aliases_utilizados.length > 0 && (
                  <div className="text-xs text-[#555555]" data-testid="etl-aliases-utilizados">
                    <p className="font-semibold text-[#1A1A1A]">Nomes resolvidos por alias</p>
                    <ul className="mt-1 grid gap-0.5">
                      {(status.lastResult.aliases_utilizados as string[]).map((a) => <li key={a}>{a.replace(" -> ", " → ")}</li>)}
                    </ul>
                  </div>
                )}
                {Array.isArray(status.lastResult.sugestoes_cadastro_nao_aplicadas) && status.lastResult.sugestoes_cadastro_nao_aplicadas.length > 0 && (
                  <div className="rounded-lg bg-[var(--warning-soft)] p-3 text-xs text-[#92400E]" data-testid="etl-sugestoes-cadastro">
                    <p className="font-semibold">Cadastros sugeridos por nome aproximado — não aplicados</p>
                    <p>Se for a mesma pessoa, cadastre o nome como alias do fornecedor e reimporte.</p>
                    <ul className="mt-1 grid gap-0.5">
                      {(status.lastResult.sugestoes_cadastro_nao_aplicadas as Array<{ codigo: string; cadastroSugerido: string }>).map((s) => (
                        <li key={s.codigo}>{s.codigo} → {s.cadastroSugerido}</li>
                      ))}
                    </ul>
                  </div>
                )}
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
