"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellRing, CalendarClock, Database, FileCheck2, LayoutDashboard, LogOut, RefreshCw, ShieldCheck, SlidersHorizontal, UsersRound, X } from "lucide-react";
import { Dashboard, MapaPagamentoResumo } from "@/components/dashboard";
import { MapaPagamentoTable } from "@/components/mapa-pagamento-table";
import { Button, IconButton, Select } from "@/components/ui";
import type { DashboardData, MapaPagamentoItem, Profissional } from "@/components/types";
import type { AuthUser } from "@/lib/session";

export function MedicoesApp({ user }: { user: AuthUser }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [profissionais, setProfissionais] = useState<Profissional[]>([]);
  const [mapaPagamentoItens, setMapaPagamentoItens] = useState<MapaPagamentoItem[]>([]);
  const [sgcAlertas, setSgcAlertas] = useState<SgcAlerta[]>([]);
  const [reenviandoSgcId, setReenviandoSgcId] = useState<string | null>(null);
  const [selectedSgcAlerta, setSelectedSgcAlerta] = useState<SgcAlerta | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [seenSgcIds, setSeenSgcIds] = useState<string[]>([]);
  const [selectedCodigo, setSelectedCodigo] = useState("");
  const [selectedContrato, setSelectedContrato] = useState("");

  const colaboradores = useMemo(
    () => profissionais.filter((profissional) => profissional.codigo),
    [profissionais],
  );
  const contratos = useMemo(
    () => dashboard?.contextoMapa?.contratos.filter((item) => item.contrato !== "TOTAL").map((item) => item.contrato) ?? [],
    [dashboard],
  );
  const isAdmin = user.perfil === "MEDICAO" || user.perfil === "ADMIN";
  const hasUnreadSgc = sgcAlertas.some((alerta) => !seenSgcIds.includes(alerta.id));

  const loadDashboard = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedCodigo) params.set("codigo", selectedCodigo);
    if (selectedContrato) params.set("contrato", selectedContrato);
    const response = await fetch(`/api/dashboard${params.toString() ? `?${params.toString()}` : ""}`);
    setDashboard(await response.json());
  }, [selectedCodigo, selectedContrato]);

  const loadLookups = useCallback(async () => {
    const [profissionaisResponse, mapaPagamentoResponse] = await Promise.all([
      fetch("/api/profissionais"),
      fetch("/api/mapa-pagamento"),
    ]);
    setProfissionais(await profissionaisResponse.json());
    setMapaPagamentoItens(await mapaPagamentoResponse.json());
  }, []);

  const refresh = useCallback(async () => {
    await loadDashboard();
  }, [loadDashboard]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDashboard(), loadLookups()]);
  }, [loadDashboard, loadLookups]);

  const loadSgcAlertas = useCallback(async () => {
    if (!isAdmin) return;
    const response = await fetch("/api/sgc/alertas");
    if (response.ok) setSgcAlertas(await response.json());
  }, [isAdmin]);

  function markSgcSeen(alerta?: SgcAlerta) {
    const ids = alerta ? [alerta.id] : sgcAlertas.map((item) => item.id);
    setSeenSgcIds((current) => {
      const merged = Array.from(new Set([...current, ...ids]));
      window.localStorage.setItem("sgc_alertas_vistos", JSON.stringify(merged));
      return merged;
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function reenviarMedicaoRevisada(alerta: SgcAlerta) {
    setReenviandoSgcId(alerta.id);
    try {
      const response = await fetch(`/api/sgc/alertas/${alerta.id}/reenviar`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        window.alert(payload.error ?? "Não foi possível reenviar a medição revisada.");
        return;
      }
      await loadSgcAlertas();
      setSelectedSgcAlerta(null);
    } finally {
      setReenviandoSgcId(null);
    }
  }

  useEffect(() => {
    loadLookups();
    const rawSeen = window.localStorage.getItem("sgc_alertas_vistos");
    if (rawSeen) {
      try {
        setSeenSgcIds(JSON.parse(rawSeen));
      } catch {
        setSeenSgcIds([]);
      }
    }
  }, [loadLookups]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    loadSgcAlertas();
    const interval = window.setInterval(loadSgcAlertas, 30000);
    return () => window.clearInterval(interval);
  }, [loadSgcAlertas]);

  return (
    <main className="min-h-screen w-full overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-[#d8dee8] bg-white/95 shadow-sm backdrop-blur">
        <div className="flex min-h-16 w-full items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-7">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#AF1B1B] text-white">
                <Database size={21} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold text-[#1A1A1A]">Medições e Pagamentos</h1>
                <p className="hidden text-xs text-[#1A1A1A] sm:block">Controle financeiro por ciclo</p>
              </div>
            </div>
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Navegação principal">
              <a href="#resumo" className="inline-flex h-9 items-center gap-2 rounded-md bg-[#F5F5F5] px-3 text-sm font-semibold text-[#AF1B1B]">
                <LayoutDashboard size={16} />
                Visão geral
              </a>
              <a href="#pagamentos" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#1A1A1A] hover:bg-[#f2f4f7]">
                <UsersRound size={16} />
                Pagamentos
              </a>
              {isAdmin ? (
                <a href="#revisoes-sgc" className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#1A1A1A] hover:bg-[#f2f4f7]">
                  <FileCheck2 size={16} />
                  Revisões SGC
                </a>
              ) : null}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={() => refresh()} className="hidden sm:inline-flex">
              <RefreshCw size={16} />
              Atualizar
            </Button>
            {isAdmin ? (
              <div className="relative">
                <IconButton
                  className={hasUnreadSgc ? "border-[#AF1B1B] bg-[#AF1B1B] text-white hover:bg-[#8C1616]" : ""}
                  onClick={() => {
                    setNotificationsOpen((value) => !value);
                    markSgcSeen();
                  }}
                  title="Notificações SGC"
                >
                  {hasUnreadSgc ? <BellRing size={17} /> : <Bell size={17} />}
                </IconButton>
                {sgcAlertas.length ? (
                  <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F2C94C] px-1 text-xs font-bold text-[#1A1A1A]">
                    {sgcAlertas.length}
                  </span>
                ) : null}
                {notificationsOpen ? (
                  <div className="absolute right-0 top-11 z-50 w-[360px] overflow-hidden rounded-lg border border-[#d8dee8] bg-white shadow-xl">
                    <div className="border-b border-[#d8dee8] px-4 py-3">
                      <div className="text-sm font-bold text-[#1A1A1A]">Notificações SGC</div>
                      <div className="text-xs text-[#1A1A1A]">{sgcAlertas.length} solicitação pendente</div>
                    </div>
                    <div className="max-h-80 overflow-auto">
                      {sgcAlertas.length ? (
                        sgcAlertas.map((alerta) => (
                          <button
                            key={alerta.id}
                            className="block w-full border-b border-[#edf1f6] px-4 py-3 text-left last:border-0 hover:bg-[#F5F5F5]"
                            onClick={() => {
                              setSelectedSgcAlerta(alerta);
                              setNotificationsOpen(false);
                              markSgcSeen(alerta);
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-[#1A1A1A]">{alerta.colaboradorCodigo}</span>
                              <span className="rounded-md bg-[#F5F5F5] px-2 py-1 text-xs font-bold text-[#AF1B1B]">{alerta.proximaRevisaoLabel}</span>
                            </div>
                            <div className="mt-1 text-sm text-[#1A1A1A]">{alerta.colaboradorNome ?? "-"}</div>
                            <div className="mt-1 text-xs text-[#1A1A1A]">{alerta.pontosDiscordancia}</div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-6 text-sm text-[#1A1A1A]">Nenhuma solicitação pendente.</div>
                      )}
                    </div>
                    <a href="#revisoes-sgc" className="block border-t border-[#d8dee8] px-4 py-3 text-sm font-bold text-[#AF1B1B]" onClick={() => setNotificationsOpen(false)}>
                      Ver central de revisões
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="hidden items-center gap-2 border-l border-[#e4e7ec] pl-3 md:flex">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F5F5] text-[#AF1B1B]">
                <ShieldCheck size={18} />
              </span>
              <div className="max-w-40 leading-tight">
                <div className="truncate text-sm font-semibold text-[#1A1A1A]">{user.nome}</div>
                <div className="text-xs text-[#1A1A1A]">{isAdmin ? "Medição" : "Usuário"}</div>
              </div>
            </div>
            <IconButton onClick={logout} title="Sair da plataforma">
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
        <nav className="border-t border-[#edf1f6] bg-[#F5F5F5] px-4 py-3 sm:px-6 lg:px-8" aria-label="Segmentação do dashboard">
          <div className="grid items-end gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,360px)_minmax(220px,300px)_auto]">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#d8dee8] bg-white text-[#AF1B1B]">
                <SlidersHorizontal size={18} />
              </span>
              <div>
                <div className="text-sm font-semibold text-[#1A1A1A]">Filtros de análise</div>
                <div className="text-xs text-[#1A1A1A]">Refine os indicadores por colaborador e contrato</div>
              </div>
            </div>
            <label className="grid gap-1 text-xs font-semibold text-[#1A1A1A]">
              <span>Colaborador</span>
              <Select value={selectedCodigo} onChange={(event) => setSelectedCodigo(event.target.value)}>
                <option value="">Todos os colaboradores</option>
                {colaboradores.map((profissional) => (
                  <option key={profissional.id} value={profissional.codigo ?? ""}>
                    {profissional.codigo}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[#1A1A1A]">
              <span>Contrato</span>
              <Select value={selectedContrato} onChange={(event) => setSelectedContrato(event.target.value)}>
                <option value="">Todos os contratos</option>
                {contratos.map((contrato) => (
                  <option key={contrato} value={contrato}>
                    {contrato}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              className="border-[#cfd7e3] bg-white text-[#1A1A1A] hover:bg-[#eef1f5]"
              onClick={() => {
                setSelectedCodigo("");
                setSelectedContrato("");
              }}
              title="Limpar filtros"
            >
              <X size={16} />
              Limpar
            </Button>
          </div>
        </nav>
      </header>

      <div className="grid min-w-0 w-full gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <div id="resumo" className="min-w-0 scroll-mt-36">
          <Dashboard data={dashboard} />
        </div>

        <MapaPagamentoResumo data={dashboard} isAdmin={isAdmin} onChanged={refreshAll} />

        <div id="pagamentos" className="min-w-0 scroll-mt-36">
          <MapaPagamentoTable
            itens={mapaPagamentoItens}
            selectedCodigo={selectedCodigo}
            selectedContrato={selectedContrato}
            isAdmin={isAdmin}
            onChanged={refreshAll}
          />
        </div>

        {isAdmin ? (
          <section id="revisoes-sgc" className="min-w-0 scroll-mt-36 rounded-lg border border-[#d8dee8] bg-white">
            <div className="flex flex-col justify-between gap-3 border-b border-[#d8dee8] px-4 py-4 md:flex-row md:items-center">
              <div>
                <h2 className="text-lg font-bold text-[#1A1A1A]">Central de Revisões SGC</h2>
                <p className="text-sm text-[#1A1A1A]">Solicitações de revisão enviadas por fornecedores e colaboradores.</p>
              </div>
              <span className="w-fit rounded-md bg-[#F5F5F5] px-3 py-1 text-sm font-bold text-[#AF1B1B]">{sgcAlertas.length} pendente(s)</span>
            </div>
            <div className="grid gap-3 p-4">
              {sgcAlertas.length ? (
                sgcAlertas.map((alerta) => (
                  <button
                    key={alerta.id}
                    className="rounded-lg border border-[#d8dee8] bg-white p-4 text-left transition hover:border-[#AF1B1B] hover:bg-[#F5F5F5]"
                    onClick={() => {
                      setSelectedSgcAlerta(alerta);
                      markSgcSeen(alerta);
                    }}
                  >
                    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                      <div>
                        <div className="text-base font-bold text-[#1A1A1A]">{alerta.colaboradorCodigo}</div>
                        <div className="mt-1 text-sm font-semibold text-[#1A1A1A]">{alerta.colaboradorNome ?? "-"}</div>
                        <p className="mt-2 text-sm text-[#1A1A1A]">{alerta.pontosDiscordancia}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-md bg-[#F5F5F5] px-2 py-1 text-xs font-bold text-[#AF1B1B]">Revisão solicitada</span>
                        <span className="rounded-md bg-[#F5F5F5] px-2 py-1 text-xs font-bold text-[#1A1A1A]">{alerta.proximaRevisaoLabel}</span>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-[#d8dee8] p-8 text-center text-sm font-semibold text-[#1A1A1A]">
                  Nenhuma solicitação de revisão pendente.
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {selectedSgcAlerta ? (
        <SgcReviewModal
          alerta={selectedSgcAlerta}
          saving={reenviandoSgcId === selectedSgcAlerta.id}
          onClose={() => setSelectedSgcAlerta(null)}
          onReenviar={() => reenviarMedicaoRevisada(selectedSgcAlerta)}
        />
      ) : null}
    </main>
  );
}

type SgcAlerta = {
  id: string;
  colaboradorCodigo: string;
  colaboradorNome: string | null;
  status: string;
  revisaoNumero: number;
  proximaRevisaoLabel: string;
  pontosDiscordancia: string | null;
  revisaoSolicitadaAt: string | null;
  colaborador: {
    codigo: string;
    nome: string | null;
    cpf: string | null;
    cnpj: string | null;
    razaoSocial: string | null;
    email: string | null;
    funcao: string | null;
    statusColaborador: string | null;
  };
  pagamento: {
    ato: string | null;
    valor: number;
    rev: number;
    razaoSocial: string | null;
  } | null;
  medicao: {
    totalDocumentos: number;
    totalMedido: number;
    totalHoras: number;
    documentos: Array<{
      id: string;
      projetoReferente: string;
      tituloPrimario: string | null;
      dataCadastro: string | null;
      formato: string | null;
      valorMedicao: number;
      equivalenteA1Horas: number;
    }>;
  };
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function dateTimeLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T00:00:00`));
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase text-[#1A1A1A]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#1A1A1A]">{value || "-"}</div>
    </div>
  );
}

function SgcReviewModal({
  alerta,
  saving,
  onClose,
  onReenviar,
}: {
  alerta: SgcAlerta;
  saving: boolean;
  onClose: () => void;
  onReenviar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1A1A1A]/35 p-4">
      <section className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg border border-[#d8dee8] bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#d8dee8] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">Análise da solicitação SGC</h2>
            <p className="text-sm text-[#1A1A1A]">Revise o comentário, ajuste a medição e reenvie para validação.</p>
          </div>
          <IconButton onClick={onClose} title="Fechar">
            <X size={17} />
          </IconButton>
        </div>

        <div className="max-h-[calc(90vh-132px)] overflow-auto p-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-[#d8dee8] p-4">
              <h3 className="mb-3 text-base font-bold text-[#1A1A1A]">Fornecedor / colaborador</h3>
              <div className="grid gap-3">
                <Detail label="Código" value={alerta.colaborador.codigo} />
                <Detail label="Nome" value={alerta.colaborador.nome} />
                <Detail label="CPF / CNPJ" value={alerta.colaborador.cpf || alerta.colaborador.cnpj} />
                <Detail label="Razão social" value={alerta.colaborador.razaoSocial} />
                <Detail label="E-mail" value={alerta.colaborador.email} />
              </div>
            </div>

            <div className="rounded-lg border border-[#d8dee8] p-4">
              <h3 className="mb-3 text-base font-bold text-[#1A1A1A]">Status da revisão</h3>
              <div className="grid gap-3">
                <Detail label="Status" value={alerta.status} />
                <Detail label="Próximo reenvio" value={alerta.proximaRevisaoLabel} />
                <Detail label="Data da solicitação" value={dateTimeLabel(alerta.revisaoSolicitadaAt)} />
                <Detail label="Alocação" value={alerta.pagamento?.ato} />
                <Detail label="Pagamento" value={alerta.pagamento ? currency.format(alerta.pagamento.valor) : "-"} />
              </div>
            </div>

            <div className="rounded-lg border border-[#d8dee8] p-4">
              <h3 className="mb-3 text-base font-bold text-[#1A1A1A]">Medição relacionada</h3>
              <div className="grid gap-3">
                <Detail label="Documentos" value={alerta.medicao.totalDocumentos} />
                <Detail label="Valor medido" value={currency.format(alerta.medicao.totalMedido)} />
                <Detail label="Horas" value={`${number.format(alerta.medicao.totalHoras)} HH`} />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-[#AF1B1B] bg-[#F5F5F5] p-4">
            <div className="text-sm font-bold text-[#AF1B1B]">Comentário enviado</div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-[#1A1A1A]">{alerta.pontosDiscordancia}</p>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-[#d8dee8]">
            <div className="border-b border-[#d8dee8] px-4 py-3 text-sm font-bold text-[#1A1A1A]">Documentos da medição</div>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="bg-[#F5F5F5]">
                  <tr>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Projeto</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Título</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Data</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Formato</th>
                    <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {alerta.medicao.documentos.map((documento) => (
                    <tr key={documento.id} className="border-b border-[#edf1f6] last:border-0">
                      <td className="px-3 py-3 font-semibold text-[#1A1A1A]">{documento.projetoReferente}</td>
                      <td className="px-3 py-3 text-[#1A1A1A]">{documento.tituloPrimario ?? "-"}</td>
                      <td className="px-3 py-3 text-[#1A1A1A]">{dateLabel(documento.dataCadastro)}</td>
                      <td className="px-3 py-3 text-[#1A1A1A]">{documento.formato ?? "-"}</td>
                      <td className="px-3 py-3 text-right text-[#1A1A1A]">{currency.format(documento.valorMedicao)}</td>
                    </tr>
                  ))}
                  {!alerta.medicao.documentos.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-sm text-[#1A1A1A]" colSpan={5}>
                        Nenhum documento vinculado encontrado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#d8dee8] px-5 py-4">
          <Button className="border-[#cfd7e3] bg-white text-[#1A1A1A] hover:bg-[#eef1f5]" onClick={onClose} disabled={saving}>
            Fechar
          </Button>
          <Button className="bg-[#16A34A] hover:bg-[#15803D] focus:ring-[#16A34A]/40" onClick={onReenviar} disabled={saving}>
            {saving ? "Reenviando..." : `Reenviar ${alerta.proximaRevisaoLabel}`}
          </Button>
        </div>
      </section>
    </div>
  );
}
