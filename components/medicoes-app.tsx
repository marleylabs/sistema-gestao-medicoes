"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  BellRing,
  Building2,
  Eye,
  EyeOff,
  FileSearch,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Dashboard, MapaPagamentoResumo } from "@/components/dashboard";
import { MapaPagamentoTable } from "@/components/mapa-pagamento-table";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { UsuariosPanel } from "@/components/usuarios-panel";
import { FinanceiroPanel } from "@/components/financeiro-panel";
import { ContratosPanel } from "@/components/contratos-panel";
import { EquipePanel } from "@/components/equipe-panel";
import { Badge, Button, Card, IconButton, SectionHeader, Select } from "@/components/ui";
import { useBlur } from "@/components/providers";
import type { DashboardData, MapaPagamentoItem, Profissional } from "@/components/types";
import { cicloToDates, cicloToMesReferencia } from "@/lib/ciclo";
import type { AuthUser } from "@/lib/session";

type Section = "visao" | "historico" | "importar" | "evidencias" | "usuarios" | "financeiro" | "contratos" | "equipe";

const TITLES: Record<Section, string> = {
  visao: "Dashboard",
  historico: "Histórico de Medições",
  importar: "Importar Planilha",
  evidencias: "Evidências de Medição",
  usuarios: "Gestão de Usuários",
  financeiro: "Painel Financeiro",
  contratos: "Contratos",
  equipe: "Equipe de Medição",
};

const CICLO_GERAL = "GERAL";

type CicloEntry = { ciclo: string; mesReferencia: string | null; updatedAt: string };

export function MedicoesApp({ user }: { user: AuthUser }) {
  const [dashboard, setDashboard]           = useState<DashboardData | null>(null);
  const [profissionais, setProfissionais]   = useState<Profissional[]>([]);
  const [mapaItens, setMapaItens]           = useState<MapaPagamentoItem[]>([]);
  const [sgcAlertas, setSgcAlertas]         = useState<SgcAlerta[]>([]);
  const [sgcStatus, setSgcStatus]           = useState<Record<string, { status: string; revisaoNumero: number; id: string }>>({});
  const [reenviandoId, setReenviandoId]     = useState<string | null>(null);
  const [selectedAlerta, setSelectedAlerta] = useState<SgcAlerta | null>(null);
  const [notifOpen, setNotifOpen]           = useState(false);
  const [seenIds, setSeenIds]               = useState<string[]>([]);
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [selectedContrato, setSelectedContrato] = useState("");
  const [activeCiclo, setActiveCiclo]       = useState(CICLO_GERAL);
  const [ciclos, setCiclos]                 = useState<CicloEntry[]>([]);
  const [novoCiclo, setNovoCiclo]           = useState("");
  const [criandoCiclo, setCriandoCiclo]     = useState(false);
  const [novoCicloOpen, setNovoCicloOpen]   = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { blur, toggleBlur } = useBlur();
  const isAdmin      = user.perfil === "MEDICAO" || user.perfil === "ADMIN";
  const isFullAdmin  = user.perfil === "ADMIN";
  const isMedicao    = user.perfil === "MEDICAO";
  const isFinanceiro = user.perfil === "FINANCEIRO";
  const isDP         = user.perfil === "DEPARTAMENTO_PESSOAL";

  const VALID_SECTIONS: Section[] = isFinanceiro
    ? ["financeiro"]
    : isMedicao
    ? ["visao", "evidencias"]
    : isFullAdmin
    ? ["visao", "historico", "importar", "evidencias", "usuarios", "financeiro", "contratos", "equipe"]
    : ["visao", "historico", "importar", "evidencias", "usuarios", "financeiro", "contratos", "equipe"];
  const sectionParam = searchParams.get("section") as Section | null;
  const section: Section = sectionParam && VALID_SECTIONS.includes(sectionParam) ? sectionParam : (isFinanceiro ? "financeiro" : "visao");
  function setSection(s: Section) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", s);
    router.replace(`?${params.toString()}`);
  }
  const hasUnread = sgcAlertas.some((a) => !seenIds.includes(a.id));

  const colaboradores = useMemo(() => profissionais.filter((p) => p.codigo), [profissionais]);
  const contratos = useMemo(
    () => dashboard?.contextoMapa?.contratos.filter((c) => c.contrato !== "TOTAL").map((c) => c.contrato) ?? [],
    [dashboard],
  );

  const loadDashboard = useCallback(async () => {
    const p = new URLSearchParams();
    p.set("ciclo", activeCiclo);
    if (selectedCodigo) p.set("codigo", selectedCodigo);
    if (selectedContrato) p.set("contrato", selectedContrato);
    const res = await fetch(`/api/dashboard?${p}`);
    if (res.ok) setDashboard(await res.json());
  }, [activeCiclo, selectedCodigo, selectedContrato]);

  const loadLookups = useCallback(async () => {
    const [p, m] = await Promise.all([
      fetch("/api/profissionais"),
      fetch(`/api/mapa-pagamento?ciclo=${activeCiclo}`),
    ]);
    setProfissionais(await p.json());
    if (m.ok) setMapaItens(await m.json());
  }, [activeCiclo]);

  const refresh    = useCallback(async () => { await loadDashboard(); }, [loadDashboard]);
  const refreshAll = useCallback(async () => { await Promise.all([loadDashboard(), loadLookups()]); }, [loadDashboard, loadLookups]);

  const loadAlertas = useCallback(async () => {
    if (!isAdmin) return;
    const [alertasRes, statusRes] = await Promise.all([
      fetch(`/api/sgc/alertas?ciclo=${activeCiclo}`),
      fetch(`/api/sgc/status?ciclo=${activeCiclo}`),
    ]);
    if (alertasRes.ok) setSgcAlertas(await alertasRes.json());
    if (statusRes.ok) setSgcStatus(await statusRes.json());
  }, [isAdmin, activeCiclo]);

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
    fetch("/api/ciclos").then(async (res) => {
      if (!res.ok) return;
      setCiclos(await res.json());
    });
    const raw = localStorage.getItem("sgc_alertas_vistos");
    if (raw) { try { setSeenIds(JSON.parse(raw)); } catch { setSeenIds([]); } }
  }, []);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    loadAlertas();
    const interval = setInterval(loadAlertas, 30000);
    return () => clearInterval(interval);
  }, [loadAlertas]);

  // ─── Nav items ───────────────────────────────────────────────────────────────

  const navItems = isFinanceiro
    ? [{ id: "financeiro", label: "Financeiro", icon: <Wallet size={17} /> }]
    : isMedicao
    ? [
        { id: "visao",      label: "Visão Geral", icon: <LayoutDashboard size={17} /> },
        { id: "evidencias", label: "Evidências",  icon: <FileSearch size={17} /> },
      ]
    : [
        { id: "visao",      label: "Visão Geral",      icon: <LayoutDashboard size={17} /> },
        { id: "financeiro", label: "Financeiro",        icon: <Wallet size={17} /> },
        { id: "evidencias", label: "Evidências",        icon: <FileSearch size={17} /> },
        { id: "contratos",  label: "Contratos",         icon: <Building2 size={17} /> },
        { id: "equipe",     label: "Equipe de Medição", icon: <Users size={17} /> },
        { id: "usuarios",   label: "Usuários",          icon: <ShieldCheck size={17} /> },
        { id: "importar",   label: "Importar Planilha", icon: <Upload size={17} />, bottom: true },
      ];

  // ─── Top bar ─────────────────────────────────────────────────────────────────

  const topBar = (
    <div className="flex shrink-0 items-center gap-2">
      <IconButton
        onClick={toggleBlur}
        title={blur ? "Mostrar valores" : "Ocultar valores"}
        className={blur ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] hover:bg-[#DBEAFE] hover:text-[#1D4ED8]" : ""}
      >
        {blur ? <EyeOff size={16} /> : <Eye size={16} />}
      </IconButton>

      <Button variant="secondary" onClick={refresh} className="hidden sm:inline-flex">
        <RefreshCw size={14} />
        Atualizar
      </Button>

      {isAdmin && (
        <div className="relative">
          <IconButton
            className={hasUnread ? "border-[#AF1B1B] bg-[#AF1B1B] text-white hover:bg-[#8C1616] hover:text-white" : ""}
            onClick={() => { setNotifOpen((v) => !v); markSeen(); }}
            title="Notificações SGC"
          >
            {hasUnread ? <BellRing size={16} /> : <Bell size={16} />}
          </IconButton>
          {sgcAlertas.length > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F59E0B] px-1 text-[10px] font-bold text-white">
              {sgcAlertas.length}
            </span>
          )}

          {notifOpen && (
            <div className="absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-16px))] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-xl">
              <div className="border-b border-[#E5E7EB] px-4 py-3">
                <p className="text-sm font-bold text-[#1A1A1A]">Notificações SGC</p>
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
                        <span className="text-sm font-semibold text-[#1A1A1A]">{a.colaboradorCodigo}</span>
                        <Badge variant="warning">{a.proximaRevisaoLabel}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-[#555555]">{a.colaboradorNome ?? "–"}</p>
                      <p className="mt-1 text-xs text-[#9CA3AF] line-clamp-1">{a.pontosDiscordancia}</p>
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
      )}

      <div className="hidden items-center gap-2.5 border-l border-[#E5E7EB] pl-3 md:flex">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB]">
          <ShieldCheck size={16} />
        </span>
        <div className="max-w-36 leading-tight">
          <p className="truncate text-sm font-semibold text-[#1A1A1A]">{user.nome}</p>
          <p className="text-xs text-[#555555]">
            {isFinanceiro ? "Financeiro" : isFullAdmin ? "Administrador" : isMedicao ? "Medição" : isDP ? "Dep. Pessoal" : "Usuário"}
          </p>
        </div>
      </div>

      <IconButton onClick={logout} title="Sair">
        <LogOut size={15} />
      </IconButton>
    </div>
  );

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
        <p className="mb-2 text-sm font-semibold text-[#1A1A1A]">Filtros</p>
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-end gap-4">

            {/* Ciclo ativo */}
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#555555]">Ciclo ativo</span>
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
                {isAdmin && activeCiclo !== CICLO_GERAL && (
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
                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold text-[#555555]">Produção</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      className="h-9 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] outline-none hover:border-[#D1D5DB] focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20"
                      defaultValue={producaoInicio}
                      key={producaoInicio}
                      onBlur={(e) => { if (e.target.value && e.target.value !== producaoInicio) saveContextDates(e.target.value, producaoFim); }}
                    />
                    <span className="text-xs text-[#9CA3AF]">a</span>
                    <input
                      type="date"
                      className="h-9 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 text-sm text-[#1A1A1A] outline-none hover:border-[#D1D5DB] focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-[#2563EB]/20"
                      defaultValue={producaoFim}
                      key={producaoFim}
                      onBlur={(e) => { if (e.target.value && e.target.value !== producaoFim) saveContextDates(producaoInicio, e.target.value); }}
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold text-[#555555]">ATO</span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-sm text-[#1A1A1A] whitespace-nowrap">{fmtDate(atoInicio)}</div>
                    <span className="text-xs text-[#9CA3AF]">a</span>
                    <div className="flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-sm text-[#1A1A1A] whitespace-nowrap">{fmtDate(atoFim)}</div>
                  </div>
                </div>
              </>
            )}

            {/* Divisor vertical */}
            <div className="hidden self-stretch border-l border-[#E5E7EB] sm:block" />

            {/* Colaborador */}
            <label className="grid w-full min-w-0 flex-1 gap-1.5 text-xs font-semibold text-[#555555] sm:min-w-[180px]">
              Colaborador
              <Select value={selectedCodigo} onChange={(e) => setSelectedCodigo(e.target.value)}>
                <option value="">Todos os colaboradores</option>
                {colaboradores.map((p) => (
                  <option key={p.id} value={p.codigo ?? ""}>{p.codigo}</option>
                ))}
              </Select>
            </label>

            {/* Contrato */}
            <label className="grid w-full min-w-0 flex-1 gap-1.5 text-xs font-semibold text-[#555555] sm:min-w-[180px]">
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

  if (isDP) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5] p-6">
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-10 text-center shadow-sm max-w-sm w-full">
          <ShieldCheck size={40} className="mx-auto mb-4 text-[#9CA3AF]" />
          <p className="text-base font-bold text-[#1A1A1A]">Acesso não disponível</p>
          <p className="mt-2 text-sm text-[#555555]">O Departamento Pessoal ainda não tem acesso ao sistema.</p>
          <button onClick={logout} className="mt-6 rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-medium text-[#555555] hover:bg-[#F3F4F6]">
            <LogOut size={13} className="mr-1 inline" />Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      activeSection={section}
      onNavigate={(id) => setSection(id as Section)}
      navItems={navItems}
      pageTitle={TITLES[section]}
      topBarRight={topBar}
    >
      {section !== "importar" && section !== "evidencias" && section !== "usuarios" && section !== "financeiro" && section !== "contratos" && section !== "equipe" && filtersBar}

      {section === "visao" && (
        <div className="grid gap-6">
          <Dashboard data={dashboard} />
          <MapaPagamentoResumo data={dashboard} isAdmin={isAdmin} onChanged={refreshAll} ciclo={activeCiclo} />
          <MapaPagamentoTable
            itens={mapaItens}
            profissionais={profissionais}
            selectedCodigo={selectedCodigo}
            selectedContrato={selectedContrato}
            isAdmin={isAdmin}
            onChanged={refreshAll}
            revisoes={sgcAlertas}
            sgcStatus={sgcStatus}
            onEnviarBm={enviarBm}
            ciclo={activeCiclo}
          />
        </div>
      )}

      {section === "historico" && (
        <HistoricoSection
          ciclos={ciclos}
          activeCiclo={activeCiclo}
          isAdmin={isAdmin}
          novoCiclo={novoCiclo}
          setNovoCiclo={setNovoCiclo}
          criandoCiclo={criandoCiclo}
          onCriarCiclo={criarCiclo}
          onSelectCiclo={(c) => { setActiveCiclo(c); setSection("visao"); }}
        />
      )}

      {section === "importar" && isAdmin && (
        <div className="flex justify-center">
          <div className="w-full max-w-2xl">
            <ImportarPlanilhaSection ciclos={ciclos} onImported={refreshAll} />
          </div>
        </div>
      )}

      {section === "evidencias" && isAdmin && (
        <EvidenciasSection colaboradores={colaboradores} ciclos={ciclos} />
      )}

      {section === "financeiro" && (isAdmin || isFinanceiro) && (
        <FinanceiroPanel ciclos={ciclos} />
      )}

      {section === "usuarios" && isAdmin && (
        <UsuariosPanel />
      )}

      {section === "contratos" && isAdmin && (
        <ContratosPanel />
      )}

      {section === "equipe" && isAdmin && (
        <EquipePanel />
      )}

      {selectedAlerta && (
        <SgcReviewModal
          alerta={selectedAlerta}
          saving={reenviandoId === selectedAlerta.id}
          onClose={() => setSelectedAlerta(null)}
          onReenviar={() => reenviar(selectedAlerta)}
        />
      )}
    </AppShell>
  );
}

// ─── HistoricoSection ─────────────────────────────────────────────────────────

function HistoricoSection({
  ciclos, activeCiclo, isAdmin, novoCiclo, setNovoCiclo, criandoCiclo, onCriarCiclo, onSelectCiclo,
}: {
  ciclos: CicloEntry[];
  activeCiclo: string;
  isAdmin: boolean;
  novoCiclo: string;
  setNovoCiclo: (v: string) => void;
  criandoCiclo: boolean;
  onCriarCiclo: () => void;
  onSelectCiclo: (ciclo: string) => void;
}) {
  const dateLabel = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(v));

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">Histórico de Medições</h2>
          <p className="mt-0.5 text-sm text-[#555555]">Todos os ciclos cadastrados no sistema.</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
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
                  className={`border-b border-[#E5E7EB] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#555555] ${i === 3 ? "text-right" : "text-left"}`}
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
              return (
                <tr key={c.ciclo} className={`border-b border-[#F3F4F6] last:border-0 ${isActive ? "bg-[#EFF6FF]" : "hover:bg-[#FAFAFA]"}`}>
                  <td className="px-4 py-3 font-semibold text-[#1A1A1A]">
                    {c.ciclo}
                    {isActive && (
                      <span className="ml-2 inline-flex items-center rounded-md bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-bold text-[#2563EB] ring-1 ring-[#BFDBFE]">
                        ATIVO
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#555555]">{c.mesReferencia ?? "–"}</td>
                  <td className="px-4 py-3 text-[#555555]">{dateLabel(c.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant={isActive ? "secondary" : "primary"}
                      onClick={() => onSelectCiclo(c.ciclo)}
                    >
                      {isActive ? "Visualizando" : "Abrir ciclo"}
                    </Button>
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
                title: "Fornecedor / colaborador",
                fields: [
                  ["Código", alerta.colaborador.codigo],
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
                      <th key={h} className={`border-b border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#555555] ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
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
    setUploading(true);
    setMsg({ type: "info", text: "Enviando arquivo…" });
    const form = new FormData();
    form.append("file", file);
    if (ciclo) form.append("ciclo", ciclo);
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

  const msgColors = { success: "bg-[#DCFCE7] text-[#15803D]", error: "bg-[#FEE2E2] text-[#B91C1C]", info: "bg-[#EFF6FF] text-[#1D4ED8]" };

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-[#1A1A1A]">Importar Planilha</h1>
          <p className="mt-0.5 text-xs text-[#555555]">Envie o arquivo .xlsm ou .xlsx para atualizar os dados da plataforma.</p>
        </div>
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
              <p className="text-[11px] text-[#9CA3AF]">Formato aceito: .xlsm ou .xlsx</p>
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
            <p className="text-xs font-semibold text-[#555555]">Ciclo de destino</p>
            <div className="flex gap-2">
              <Select value={ciclo} onChange={(e) => setCiclo(e.target.value)} className="flex-1">
                <option value="">Detectar automaticamente pela planilha</option>
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
            <p className="text-[11px] text-[#9CA3AF]">Se deixar em branco, o ciclo será derivado do campo "Mês Referência" da planilha.</p>
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
    </div>
  );
}

// ─── EvidenciasSection ────────────────────────────────────────────────────────

function EvidenciasSection({ colaboradores, ciclos }: { colaboradores: Profissional[]; ciclos: CicloEntry[] }) {
  const TODOS = "__todos__";
  const [selectedCiclo,  setSelectedCiclo]  = useState(TODOS);
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [bm, setBm]       = useState<BmData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // codigo → ciclo mais recente aprovado
  const [aprovadosMap, setAprovadosMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setSelectedCodigo("");
    setBm(null);
    const ciclosParaBuscar = selectedCiclo === TODOS ? ciclos.map((c) => c.ciclo) : [selectedCiclo];
    if (ciclosParaBuscar.length === 0) return;

    Promise.all(
      ciclosParaBuscar.map((ciclo) =>
        fetch(`/api/sgc/status?ciclo=${encodeURIComponent(ciclo)}`)
          .then((r) => r.json() as Promise<Record<string, { status: string }>>)
          .then((data) => ({ ciclo, data }))
          .catch(() => ({ ciclo, data: {} as Record<string, { status: string }> }))
      )
    ).then((results) => {
      // ciclos já vêm ordenados desc; iterar do mais antigo ao mais recente
      // para que o mais recente sobreescreva no map
      const map = new Map<string, string>();
      for (const { ciclo, data } of [...results].reverse()) {
        for (const [codigo, entry] of Object.entries(data)) {
          if (entry.status === "APROVADO" || entry.status === "AGUARDANDO_NF") map.set(codigo, ciclo);
        }
      }
      setAprovadosMap(map);
    });
  }, [selectedCiclo, ciclos]);

  const colaboradoresAprovados = colaboradores.filter((c) => aprovadosMap.has(c.codigo ?? ""));

  async function buscar() {
    if (!selectedCodigo) return;
    const ciclo = selectedCiclo === TODOS ? (aprovadosMap.get(selectedCodigo) ?? "") : selectedCiclo;
    if (!ciclo) return;
    setLoading(true);
    setError(null);
    setBm(null);
    const res = await fetch(`/api/admin/bm?codigo=${encodeURIComponent(selectedCodigo)}&ciclo=${encodeURIComponent(ciclo)}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Erro ao buscar boletim."); }
    else if (!data.pagamento && !data.documentos?.length) { setError("Nenhuma medição encontrada para este colaborador e ciclo."); }
    else setBm(data);
    setLoading(false);
  }

  return (
    <div className="grid gap-6 mx-auto w-full" style={{ maxWidth: "80rem" }}>
      <SectionHeader
        title="Evidências de Medição"
        description="Visualize e imprima o Boletim de Medição de qualquer colaborador por ciclo."
      />

      <Card className="overflow-hidden">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF0F0] text-[#AF1B1B]">
              <FileSearch size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">Filtros</p>
              <p className="text-[11px] text-[#9CA3AF]">Selecione o ciclo e o colaborador para visualizar o boletim</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 p-5">
          <label className="grid w-full gap-1.5 text-xs font-semibold text-[#555555] sm:w-auto">
            Ciclo
            <Select value={selectedCiclo} onChange={(e) => setSelectedCiclo(e.target.value)} className="sm:min-w-[200px]">
              <option value={TODOS}>Todos os ciclos</option>
              {ciclos.map((c) => (
                <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>
              ))}
            </Select>
          </label>
          <label className="grid w-full gap-1.5 text-xs font-semibold text-[#555555] sm:w-auto">
            Colaborador
            <Select value={selectedCodigo} onChange={(e) => setSelectedCodigo(e.target.value)} className="sm:min-w-[220px]" disabled={colaboradoresAprovados.length === 0}>
              <option value="">
                {colaboradoresAprovados.length === 0 ? "Nenhuma aprovação encontrada" : "Selecione…"}
              </option>
              {colaboradoresAprovados.map((c) => (
                <option key={c.id} value={c.codigo ?? ""}>{c.codigo}</option>
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
