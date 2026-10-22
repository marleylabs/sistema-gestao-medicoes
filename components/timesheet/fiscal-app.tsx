"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, RefreshCw, Search, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccountMenu } from "@/components/account-menu";
import { AdminSidePanel } from "@/components/administrativo/admin-side-panel";
import { ErroDialogo, PortalDialog } from "@/components/portal-fornecedor";
import { Badge, Button, Card, Carregando, Field, IconButton, Input, PageContainer, PageHeader, Select, Toast } from "@/components/ui";
import { ListaFolhas } from "@/components/timesheet/timesheet-workspace";
import { TabelaDiasTimesheet, TotaisTimesheet, erroDaApi } from "@/components/timesheet/folha-timesheet";
import { formatCicloLabel } from "@/lib/ciclo";
import { formatarData } from "@/lib/timesheet-calculo";
import type { FolhaTimesheet } from "@/lib/timesheet";
import type { AcompanhamentoFiscal } from "@/lib/timesheet-fiscal";
import type { AuthUser } from "@/lib/session";

type Item = AcompanhamentoFiscal["folhas"][number];

const rotuloCiclo = (c: string) => {
  try { return `${c} · ${formatCicloLabel(c)}`; } catch { return c; }
};

/**
 * Tela do FISCAL do contrato (spec docs/brain/specs/timesheet-aprovacao-fiscal.md): só o Timesheet dos
 * fornecedores dos contratos dele, para aprovar ou reprovar as horas de cada dia. Sem Feriados, publicação
 * de ciclo, liberação do preenchimento, configuração ou reabertura (isso é da medição).
 */
export function FiscalApp({ user }: { user: AuthUser }) {
  const [ciclos, setCiclos] = useState<string[]>([]);
  const [ciclo, setCiclo] = useState<string | null>(null);
  const [dados, setDados] = useState<AcompanhamentoFiscal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [aberto, setAberto] = useState<{ id: string; nome: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const res = await fetch(`/api/fiscal/timesheet${ciclo ? `?ciclo=${ciclo}` : ""}`, { cache: "no-store" });
    setCarregando(false);
    if (!res.ok) { setErro(await erroDaApi(res, "Erro ao carregar o timesheet.")); return; }
    setDados((await res.json()) as AcompanhamentoFiscal);
  }, [ciclo]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/ciclos").then((r) => (r.ok ? r.json() : [])).then((lista: Array<{ ciclo: string }>) => setCiclos(lista.map((c) => c.ciclo))).catch(() => setCiclos([]));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.assign("/login");
  }

  const q = busca.trim().toLowerCase();
  const filtradas = useMemo(() => (dados?.folhas ?? []).filter((f) =>
    (!q || f.nome.toLowerCase().includes(q) || (f.codigo ?? "").toLowerCase().includes(q)) &&
    (!filtro || (filtro === "pendentes" ? f.aprovacoes.pendentes > 0 : f.aprovacoes.reprovados > 0)),
  ), [dados, q, filtro]);
  const pendentes = (dados?.folhas ?? []).reduce((n, f) => n + f.aprovacoes.pendentes, 0);
  const cicloAtual = dados?.ciclo ?? ciclo ?? "";
  const opcoes = ciclos.includes(cicloAtual) || !cicloAtual ? ciclos : [cicloAtual, ...ciclos];

  return (
    <AppShell
      activeSection="timesheet"
      onNavigate={() => undefined}
      navItems={[{ id: "timesheet", label: "Timesheet", icon: <CalendarClock size={17} /> }]}
      pageTitle="Timesheet"
      sidebarFooter={<AccountMenu user={user} roleLabel="Fiscal" onLogout={logout} compact />}
    >
      <PageContainer className="grid gap-6 pb-24">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end" data-testid="fiscal-timesheet">
          <PageHeader eyebrow="Fiscal" title="Timesheet ATO" description="Aprove ou reprove as horas lançadas em cada dia pelos fornecedores dos seus contratos." />
          <div className="flex items-center gap-2">
            <div className="w-[190px]">
              <Select value={cicloAtual} onChange={(e) => setCiclo(e.target.value)} aria-label="Ciclo">
                {opcoes.map((c) => <option key={c} value={c}>{rotuloCiclo(c)}</option>)}
              </Select>
            </div>
            <IconButton onClick={() => void carregar()} title="Atualizar" disabled={carregando}>
              <RefreshCw size={15} className={carregando ? "animate-spin" : ""} />
            </IconButton>
          </div>
        </div>

        {erro ? (
          <Card className="px-6 py-10 text-center text-sm text-[var(--error)]">{erro}</Card>
        ) : !dados ? (
          <Carregando texto="Carregando o timesheet" linhas={5} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4"><p className="text-[11px] text-[var(--muted-foreground)]">Fornecedores</p><p className="text-xl font-bold tabular-nums">{dados.folhas.length}</p></Card>
              <Card className="p-4"><p className="text-[11px] text-[var(--muted-foreground)]">Dias aguardando sua decisão</p><p className="text-xl font-bold tabular-nums text-[var(--warning)]">{pendentes}</p></Card>
              <Card className="p-4"><p className="text-[11px] text-[var(--muted-foreground)]">Período</p><p className="text-[15px] font-bold tabular-nums">{formatarData(dados.periodo.inicio)} a {formatarData(dados.periodo.fim)}</p></Card>
            </div>
            <Card className="w-full min-w-0 max-w-full overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-3">
                <span className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" size={14} />
                  <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor ou código…" aria-label="Buscar fornecedor" />
                </span>
                <Select className="w-[200px]!" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtro de aprovação">
                  <option value="">Todos</option>
                  <option value="pendentes">Com dias pendentes</option>
                  <option value="reprovados">Com dias reprovados</option>
                </Select>
              </div>
              {filtradas.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-[var(--muted-foreground)]" data-testid="fiscal-vazio">
                  {dados.folhas.length ? "Nenhum fornecedor para este filtro." : "Nenhum fornecedor dos seus contratos neste ciclo."}
                </p>
              ) : (
                <ListaFolhas itens={filtradas} abertoId={aberto?.id ?? null} onAbrir={(f: Item) => setAberto({ id: f.profissionalId, nome: f.nome })} />
              )}
            </Card>
          </>
        )}
      </PageContainer>

      <AnimatePresence>
        {aberto && dados && (
          <FolhaFiscal
            key={aberto.id}
            profissionalId={aberto.id}
            nome={aberto.nome}
            ciclo={dados.ciclo}
            onClose={() => setAberto(null)}
            onDecidiu={async (texto) => { setToast(texto); await carregar(); }}
          />
        )}
      </AnimatePresence>
      <Toast mensagem={toast} />
    </AppShell>
  );
}

function FolhaFiscal({ profissionalId, nome, ciclo, onClose, onDecidiu }: {
  profissionalId: string; nome: string; ciclo: string; onClose: () => void; onDecidiu: (texto: string) => Promise<void>;
}) {
  const [folha, setFolha] = useState<FolhaTimesheet | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [reprovar, setReprovar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch(`/api/fiscal/timesheet/${profissionalId}?ciclo=${encodeURIComponent(ciclo)}`, { cache: "no-store" });
    if (!res.ok) { setErro(await erroDaApi(res, "Erro ao carregar a folha.")); return; }
    setFolha(((await res.json()) as { folha: FolhaTimesheet }).folha);
  }, [profissionalId, ciclo]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function decidir(decisao: "APROVADO" | "REPROVADO") {
    setOcupado(true); setErroAcao(null);
    const datas = [...selecionadas];
    const res = await fetch(`/api/fiscal/timesheet/${profissionalId}/decisao`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ciclo, datas, decisao, motivo }),
    });
    setOcupado(false);
    if (!res.ok) { setErroAcao(await erroDaApi(res, "Não foi possível registrar a decisão.")); return; }
    setSelecionadas(new Set()); setReprovar(false); setMotivo("");
    await carregar();
    await onDecidiu(`${datas.length} ${datas.length === 1 ? "dia" : "dias"} ${decisao === "APROVADO" ? "aprovado(s)" : "reprovado(s)"}.`);
  }

  const n = selecionadas.size;
  return (
    <AdminSidePanel
      size="full"
      eyebrow={`Timesheet ATO · Ciclo ${ciclo}`}
      title={nome}
      subtitle={folha ? <span className="font-technical text-[12.5px]">{folha.fornecedor.codigo}</span> : undefined}
      meta={folha && <Badge variant={folha.status === "ENVIADA" ? "success" : "warning"}>{folha.status === "ENVIADA" ? "Enviada" : "Aberta"}</Badge>}
      escEnabled={!reprovar}
      onClose={onClose}
      testId="fiscal-folha"
      footer={folha ? (
        <>
          <span className="mr-auto text-[13px] text-[var(--muted-foreground)]" aria-live="polite">
            {n ? `${n} ${n === 1 ? "dia selecionado" : "dias selecionados"}` : "Selecione os dias para aprovar ou reprovar."}
          </span>
          {erroAcao && !reprovar && <span role="alert" className="text-[12px] text-[var(--error)]">{erroAcao}</span>}
          <Button variant="secondary" className="h-10" disabled={!n || ocupado} onClick={() => { setErroAcao(null); setReprovar(true); }}>
            <X size={15} aria-hidden />
            Reprovar
          </Button>
          <Button className="h-10" disabled={!n || ocupado} aria-busy={ocupado} onClick={() => void decidir("APROVADO")}>
            <Check size={15} aria-hidden />
            Aprovar
          </Button>
        </>
      ) : undefined}
    >
      {erro ? (
        <p className="px-6 py-10 text-center text-sm text-[var(--error)]">{erro}</p>
      ) : !folha ? (
        <Carregando texto="Carregando a folha" linhas={6} className="px-5 py-5" />
      ) : (
        <div className="grid gap-4 px-5 py-4 sm:px-6">
          <p className="text-[12px] text-[var(--muted-foreground)]">
            {formatarData(folha.periodo.inicio)} a {formatarData(folha.periodo.fim)}. Só dias com horas lançadas podem ser aprovados ou reprovados; se o fornecedor alterar um dia, ele volta a pendente.
          </p>
          <TotaisTimesheet totais={folha.totais} />
          <TabelaDiasTimesheet
            dias={folha.dias}
            enviada={folha.status === "ENVIADA"}
            selecao={{
              selecionadas,
              alternar: (data) => setSelecionadas((atual) => {
                const novo = new Set(atual);
                if (novo.has(data)) novo.delete(data); else novo.add(data);
                return novo;
              }),
              alternarTodas: (datas) => setSelecionadas(new Set(datas)),
            }}
          />
        </div>
      )}

      <AnimatePresence>
        {reprovar && (
          <PortalDialog
            key="reprovar-dias"
            titulo={`Reprovar ${n} ${n === 1 ? "dia" : "dias"}`}
            descricao="O motivo fica visível para a medição e para o fornecedor. Para corrigir, a medição reabre a folha."
            busy={ocupado}
            onClose={() => setReprovar(false)}
            footer={
              <>
                <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={() => setReprovar(false)} disabled={ocupado}>Cancelar</Button>
                <Button variant="danger" className="h-10 w-full sm:w-auto" onClick={() => void decidir("REPROVADO")} disabled={ocupado || !motivo.trim()} aria-busy={ocupado}>
                  {ocupado ? "Reprovando..." : "Reprovar"}
                </Button>
              </>
            }
          >
            <ErroDialogo erro={erroAcao} />
            <Field label="Motivo da reprovação">
              <Input autoFocus maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: horário diferente do registro da portaria" />
            </Field>
          </PortalDialog>
        )}
      </AnimatePresence>
    </AdminSidePanel>
  );
}
