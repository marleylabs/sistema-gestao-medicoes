"use client";

import { AnimatePresence } from "framer-motion";
import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AlertTriangle, RefreshCw, Search, Trash2, UserPlus } from "lucide-react";
import clsx from "clsx";
import { Aba, Badge, Button, Card, Carregando, Field, IconButton, Input, PageHeader, Select, Toast, classeLinha } from "@/components/ui";
import { ErroDialogo, PortalDialog } from "@/components/portal-fornecedor";
import { CicloPublicadoControl, type CicloPortalEntry } from "@/components/fornecedores/ciclo-publicado";
import { TimesheetDrawer, type AbaDrawer, type Contrato } from "@/components/timesheet/timesheet-drawer";
import { erroDaApi } from "@/components/timesheet/folha-timesheet";
import { diasDoCiclo, formatarData, formatarDuracao } from "@/lib/timesheet-calculo";
import { isCicloValido } from "@/lib/ciclo";
import type { AcompanhamentoCiclo } from "@/lib/timesheet-medicao";

type Item = AcompanhamentoCiclo["folhas"][number];
type Feriado = AcompanhamentoCiclo["feriados"][number];
type ProfissionalBusca = { id: string; nome: string; codigo: string | null; nomeCompleto: string | null; statusColaborador: string | null };

const STATUS: Record<Item["status"], { rotulo: string; variante: "neutral" | "warning" | "success" }> = {
  NAO_INICIADA: { rotulo: "Não iniciada", variante: "neutral" },
  EM_PREENCHIMENTO: { rotulo: "Em preenchimento", variante: "warning" },
  ENVIADA: { rotulo: "Enviada", variante: "success" },
};
const dataHora = (v: string | null) => (v ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—");

/**
 * Painel "Timesheet" da medição (spec docs/brain/specs/timesheet-ato.md): acompanhamento das folhas
 * do ciclo, liberação do preenchimento, feriados estaduais/municipais e o detalhe de cada fornecedor.
 */
export function TimesheetWorkspace({ ciclos, ciclo, onCicloChange, onPublicarCiclo }: {
  ciclos: CicloPortalEntry[]; ciclo: string; onCicloChange: (ciclo: string) => void; onPublicarCiclo: (ciclo: string) => Promise<string | null>;
}) {
  const [aba, setAba] = useState<"acompanhamento" | "feriados">("acompanhamento");
  const [dados, setDados] = useState<AcompanhamentoCiclo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<{ id: string; nome: string; aba: AbaDrawer } | null>(null);
  const [habilitar, setHabilitar] = useState(false);
  const [toast, setToast] = useState<{ texto: string; tom: "success" | "error" } | null>(null);

  const cicloPedido = isCicloValido(ciclo) ? ciclo : null;
  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const res = await fetch(`/api/admin/timesheet${cicloPedido ? `?ciclo=${cicloPedido}` : ""}`, { cache: "no-store" });
    setCarregando(false);
    if (!res.ok) { setErro(await erroDaApi(res, "Erro ao carregar o timesheet.")); return; }
    setDados((await res.json()) as AcompanhamentoCiclo);
  }, [cicloPedido]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function mudarLiberacao(liberacao: string) {
    if (!dados) return;
    const res = await fetch("/api/admin/timesheet/liberacao", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ciclo: dados.ciclo, liberacao }),
    });
    if (!res.ok) { setToast({ texto: await erroDaApi(res, "Não foi possível mudar a liberação."), tom: "error" }); return; }
    setToast({ texto: liberacao === "CICLO" ? "Ciclo todo liberado para preenchimento." : "Preenchimento liberado só até hoje.", tom: "success" });
    await carregar();
  }

  const q = busca.trim().toLowerCase();
  const filtradas = useMemo(() => (dados?.folhas ?? []).filter((f) =>
    (!filtroStatus || f.status === filtroStatus) && (!q || f.nome.toLowerCase().includes(q) || (f.codigo ?? "").toLowerCase().includes(q)),
  ), [dados, filtroStatus, q]);
  const contagem = useMemo(() => {
    const lista = dados?.folhas.filter((f) => f.habilitado) ?? [];
    return { total: lista.length, enviadas: lista.filter((f) => f.status === "ENVIADA").length, pendentes: lista.filter((f) => f.status !== "ENVIADA").length };
  }, [dados]);

  const cicloAtual = dados?.ciclo ?? cicloPedido ?? "";
  const opcoesCiclo = ciclos.some((c) => c.ciclo === cicloAtual) || !cicloAtual ? ciclos : [{ ciclo: cicloAtual }, ...ciclos];

  return (
    <div className="grid min-w-0 gap-6" data-testid="timesheet-workspace">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
        <div className="grid min-w-0 gap-3">
          <PageHeader eyebrow="Medição" title="Timesheet ATO" description="Acompanhe quem está preenchendo a folha de horas do ciclo, libere o preenchimento e cadastre os feriados locais." />
          {ciclos.length > 0 && (
            <CicloPublicadoControl variante="timesheet" ciclos={ciclos} cicloSelecionado={cicloPedido ?? ""} podePublicar onPublicar={onPublicarCiclo} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[150px]">
            <Select value={cicloAtual} onChange={(e) => onCicloChange(e.target.value)} aria-label="Ciclo">
              {opcoesCiclo.map((c) => <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>)}
            </Select>
          </div>
          <IconButton onClick={() => void carregar()} title="Atualizar" disabled={carregando}>
            <RefreshCw size={15} className={carregando ? "animate-spin" : ""} />
          </IconButton>
        </div>
      </div>

      <div role="tablist" aria-label="Seções do timesheet" className="flex gap-5 border-b border-[var(--border)]">
        <Aba grupo="aba-timesheet-medicao" ativa={aba === "acompanhamento"} onClick={() => setAba("acompanhamento")}>Acompanhamento</Aba>
        <Aba grupo="aba-timesheet-medicao" ativa={aba === "feriados"} onClick={() => setAba("feriados")}>Feriados</Aba>
      </div>

      {erro ? (
        <Card className="px-6 py-10 text-center text-sm text-[var(--error)]">{erro}</Card>
      ) : !dados ? (
        <Carregando texto="Carregando o timesheet" linhas={5} />
      ) : aba === "acompanhamento" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-[11px] text-[var(--muted-foreground)]">Fornecedores habilitados</p><p className="text-xl font-bold tabular-nums">{contagem.total}</p></Card>
            <Card className="p-4"><p className="text-[11px] text-[var(--muted-foreground)]">Folhas enviadas</p><p className="text-xl font-bold tabular-nums text-[var(--success)]">{contagem.enviadas}</p></Card>
            <Card className="p-4"><p className="text-[11px] text-[var(--muted-foreground)]">Ainda não enviadas</p><p className={clsx("text-xl font-bold tabular-nums", contagem.pendentes && "text-[var(--warning)]")}>{contagem.pendentes}</p></Card>
          </div>

          <Card className="w-full min-w-0 max-w-full overflow-hidden">
            <div className="grid gap-2 border-b border-[var(--border)] px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 whitespace-nowrap text-[12px] text-[var(--muted-foreground)]">
                  Preenchimento
                  <Select className="w-[190px]!" value={dados.liberacao} onChange={(e) => void mudarLiberacao(e.target.value)} aria-label="Liberação do preenchimento">
                    <option value="DIA_A_DIA">Dia a dia (até hoje)</option>
                    <option value="CICLO">Ciclo todo</option>
                  </Select>
                </label>
                <Button variant="secondary" onClick={() => setHabilitar(true)}>
                  <UserPlus size={15} aria-hidden />
                  Habilitar fornecedor
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" size={14} />
                  <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor ou código…" aria-label="Buscar fornecedor" />
                </span>
                <Select className="w-[170px]!" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Status">
                  <option value="">Todos os status</option>
                  {Object.entries(STATUS).map(([valor, st]) => <option key={valor} value={valor}>{st.rotulo}</option>)}
                </Select>
              </div>
            </div>
            {filtradas.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-[var(--muted-foreground)]" data-testid="timesheet-vazio">
                {dados.folhas.length ? "Nenhum fornecedor para este filtro." : "Nenhum fornecedor ATO habilitado. Use \"Habilitar fornecedor\" para incluir alguém."}
              </p>
            ) : (
              <ListaFolhas itens={filtradas} abertoId={aberto?.id ?? null} onAbrir={(f) => setAberto({ id: f.profissionalId, nome: f.nome, aba: "folha" })} />
            )}
          </Card>
        </>
      ) : (
        <CalendarioFeriados
          ciclo={dados.ciclo}
          periodo={dados.periodo}
          feriados={dados.feriados}
          onMudou={async (texto) => { setToast({ texto, tom: "success" }); await carregar(); }}
        />
      )}

      <AnimatePresence>
        {aberto && dados && (
          <Fragment key="timesheet-painel">
            <TimesheetDrawer
              key={aberto.id}
              profissionalId={aberto.id}
              nome={aberto.nome}
              ciclo={dados.ciclo}
              abaInicial={aberto.aba}
              feriadoAposEnvio={dados.folhas.find((f) => f.profissionalId === aberto.id)?.feriadoAposEnvio ?? false}
              onClose={() => setAberto(null)}
              onMudou={() => void carregar()}
            />
          </Fragment>
        )}
        {habilitar && dados && (
          <HabilitarDialog
            key="habilitar"
            jaListados={new Set(dados.folhas.filter((f) => f.habilitado).map((f) => f.profissionalId))}
            onClose={() => setHabilitar(false)}
            onEscolher={(p) => { setHabilitar(false); setAberto({ id: p.id, nome: p.nomeCompleto ?? p.nome, aba: "config" }); }}
          />
        )}
      </AnimatePresence>
      <Toast mensagem={toast?.texto ?? null} tom={toast?.tom} />
    </div>
  );
}

function onKey(event: KeyboardEvent<HTMLElement>, abrir: () => void) {
  if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
    event.preventDefault();
    abrir();
  }
}

function ListaFolhas({ itens, abertoId, onAbrir }: { itens: Item[]; abertoId: string | null; onAbrir: (f: Item) => void }) {
  const th = "text-table-header border-b border-[var(--border)] px-3 py-2.5 text-left text-[var(--muted-foreground)] xl:px-4";
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm" data-testid="timesheet-lista">
        <thead className="bg-[var(--surface-muted)]">
          <tr>
            <th className={th}>Fornecedor</th>
            <th className={th}>Status</th>
            <th className={`${th} text-right`}>Dias</th>
            <th className={th}>Último preenchimento</th>
            <th className={`${th} text-right`}>Normal</th>
            <th className={`${th} text-right`}>HE 50%</th>
            <th className={`${th} text-right`}>HE 100%</th>
            <th className={`${th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((f) => (
            <tr
              key={f.profissionalId}
              tabIndex={0}
              aria-label={`Abrir a folha de ${f.nome}`}
              data-testid={`timesheet-linha-${f.codigo}`}
              onClick={() => onAbrir(f)}
              onKeyDown={(e) => onKey(e, () => onAbrir(f))}
              className={classeLinha(f.profissionalId === abertoId)}
            >
              <td className="px-3 py-3 xl:px-4">
                <p className="max-w-[300px] truncate font-semibold text-[var(--foreground)]">{f.nome}</p>
                <p className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
                  <span className="font-technical">{f.codigo}</span>
                  {!f.habilitado && <Badge variant="neutral">Desabilitado</Badge>}
                </p>
              </td>
              <td className="px-3 py-3 xl:px-4">
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant={STATUS[f.status].variante}>{STATUS[f.status].rotulo}</Badge>
                  {f.feriadoAposEnvio && <AlertTriangle size={14} className="text-[var(--warning)]" aria-label="Feriado cadastrado depois do envio" />}
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums xl:px-4">{f.diasPreenchidos}</td>
              <td className="px-3 py-3 text-[12.5px] text-[var(--muted-foreground)] xl:px-4">{dataHora(f.ultimoPreenchimento)}</td>
              {(["hn", "he50", "he100", "total"] as const).map((k) => (
                <td key={k} className={clsx("px-3 py-3 text-right tabular-nums xl:px-4", k === "total" && "font-semibold", !f.totais[k] && "text-[var(--muted-foreground)]/60")}>
                  {formatarDuracao(f.totais[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const paraQuem = (f: Feriado) => (f.contratoNome ? `contrato ${f.contratoNome}` : "todos os contratos");

/**
 * Grade dos dias do ciclo (21→20): clique numa data livre cria um feriado; num manual, exclui.
 * O filtro de contrato mostra o que vale para ele (gerais + os dele) e é o contrato do feriado novo.
 */
function CalendarioFeriados({ ciclo, periodo, feriados: todos, onMudou }: { ciclo: string; periodo: { inicio: string; fim: string }; feriados: Feriado[]; onMudou: (texto: string) => Promise<void> }) {
  const [novo, setNovo] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<Feriado | null>(null);
  const [nome, setNome] = useState("");
  const [abrangencia, setAbrangencia] = useState("MUNICIPAL");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [contratoId, setContratoId] = useState("");

  useEffect(() => {
    fetch("/api/admin/contratos").then((r) => (r.ok ? r.json() : [])).then((lista: Contrato[]) => setContratos(lista)).catch(() => setContratos([]));
  }, []);

  const contrato = contratos.find((c) => c.id === contratoId) ?? null;
  const opcoesContrato = contratos.filter((c) => c.ativo || c.id === contratoId || todos.some((f) => f.contratoId === c.id));
  const feriados = todos.filter((f) => f.contratoId === null || f.contratoId === contratoId);
  const porData = new Map(feriados.map((f) => [f.data, f]));
  const dias = diasDoCiclo(ciclo);
  const vazios = new Date(`${periodo.inicio}T00:00:00Z`).getUTCDay();

  async function criar() {
    if (!novo) return;
    setOcupado(true); setErro(null);
    const res = await fetch("/api/admin/timesheet/feriados", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: novo, nome, abrangencia, contratoId: contratoId || null }),
    });
    setOcupado(false);
    if (!res.ok) { setErro(await erroDaApi(res, "Não foi possível cadastrar o feriado.")); return; }
    setNovo(null);
    await onMudou(`Feriado de ${formatarData(novo)} cadastrado.`);
  }

  async function remover() {
    if (!excluir?.id) return;
    setOcupado(true); setErro(null);
    const res = await fetch(`/api/admin/timesheet/feriados/${excluir.id}`, { method: "DELETE" });
    setOcupado(false);
    if (!res.ok) { setErro(await erroDaApi(res, "Não foi possível excluir o feriado.")); return; }
    setExcluir(null);
    await onMudou(`Feriado de ${formatarData(excluir.data)} excluído.`);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="p-4 sm:p-5">
        <label className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
          Contrato
          <Select className="w-[260px]!" value={contratoId} onChange={(e) => setContratoId(e.target.value)} aria-label="Contrato dos feriados">
            <option value="">Todos os contratos</option>
            {opcoesContrato.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ${c.nome}` : c.nome}</option>)}
          </Select>
        </label>
        <p className="mb-3 text-[12px] text-[var(--muted-foreground)]">
          {formatarData(periodo.inicio)} a {formatarData(periodo.fim)}. Clique numa data para cadastrar um feriado estadual ou municipal {contrato ? `só do contrato ${contrato.nome}` : "para todos os contratos"}. Os nacionais já vêm marcados.
        </p>
        <div className="grid grid-cols-7 gap-1.5" data-testid="timesheet-calendario">
          {SEMANA.map((s) => <p key={s} className="pb-1 text-center text-[11px] font-semibold uppercase text-[var(--muted-foreground)]">{s}</p>)}
          {Array.from({ length: vazios }, (_, i) => <span key={`v${i}`} aria-hidden />)}
          {dias.map((data) => {
            const f = porData.get(data);
            const semana = new Date(`${data}T00:00:00Z`).getUTCDay();
            const nacional = f?.origem === "NACIONAL";
            const rotulo = `${formatarData(data)}${f ? `, ${f.nome} (${nacional ? "nacional" : f.origem.toLowerCase()})` : ""}`;
            return (
              <button
                key={data}
                type="button"
                disabled={nacional}
                aria-label={nacional ? rotulo : f ? `Excluir feriado: ${rotulo}` : `Cadastrar feriado em ${formatarData(data)}`}
                title={f?.nome}
                onClick={() => { setErro(null); if (f) setExcluir(f); else { setNome(""); setAbrangencia("MUNICIPAL"); setNovo(data); } }}
                className={clsx(
                  "flex min-h-[64px] min-w-0 flex-col items-start gap-0.5 overflow-hidden rounded-lg border p-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 sm:p-2",
                  nacional && "cursor-default border-[var(--error)]/30 bg-[var(--error-soft)] text-[var(--error)]",
                  f && !nacional && "border-[var(--warning)]/40 bg-[var(--warning-soft)] text-[var(--warning)] hover:border-[var(--warning)]",
                  !f && "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
                  !f && (semana === 0 || semana === 6) && "bg-[var(--surface-muted)] text-[var(--muted-foreground)]",
                  !f && semana !== 0 && semana !== 6 && "text-[var(--foreground)]",
                )}
              >
                <span className="font-semibold tabular-nums">
                  {data.slice(8, 10)}
                  {(data.slice(8, 10) === "01" || data === periodo.inicio) && <span className="ml-0.5 text-[10px] font-normal opacity-70">/{data.slice(5, 7)}</span>}
                </span>
                {f && <span className="line-clamp-2 text-[10.5px] leading-tight">{f.nome}</span>}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="h-fit">
        <h3 className="text-label border-b border-[var(--border)] px-4 py-3 text-[var(--muted-foreground)]">Feriados do ciclo</h3>
        {feriados.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">Nenhum feriado neste ciclo.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]" data-testid="timesheet-feriados-lista">
            {feriados.map((f) => (
              <li key={f.id ?? f.data} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--foreground)]">{f.nome}</p>
                  <p className="text-[12px] text-[var(--muted-foreground)]">
                    {formatarData(f.data)} · {f.origem === "NACIONAL" ? "Nacional" : f.origem === "ESTADUAL" ? "Estadual" : "Municipal"}
                    {f.id && ` · ${f.contratoNome ?? "Todos os contratos"}`}
                  </p>
                </div>
                {f.id && (
                  <IconButton title={`Excluir ${f.nome}`} onClick={() => { setErro(null); setExcluir(f); }}>
                    <Trash2 size={14} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AnimatePresence>
        {novo && (
          <PortalDialog
            key="novo-feriado"
            titulo={`Feriado em ${formatarData(novo)}`}
            descricao={`${contrato ? `Vale só para os fornecedores do contrato ${contrato.nome}.` : "Vale para todos os contratos."} Os dias trabalhados nesta data passam a contar como HE 100%.`}
            busy={ocupado}
            onClose={() => setNovo(null)}
            footer={
              <>
                <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={() => setNovo(null)} disabled={ocupado}>Cancelar</Button>
                <Button className="h-10 w-full sm:w-auto" onClick={() => void criar()} disabled={ocupado || !nome.trim()} aria-busy={ocupado}>{ocupado ? "Salvando..." : "Cadastrar feriado"}</Button>
              </>
            }
          >
            <ErroDialogo erro={erro} />
            <Field label="Nome"><Input autoFocus maxLength={100} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aniversário de Parauapebas" /></Field>
            <Field label="Abrangência">
              <Select value={abrangencia} onChange={(e) => setAbrangencia(e.target.value)}>
                <option value="MUNICIPAL">Municipal</option>
                <option value="ESTADUAL">Estadual</option>
              </Select>
            </Field>
          </PortalDialog>
        )}
        {excluir && (
          <PortalDialog
            key="excluir-feriado"
            role="alertdialog"
            titulo="Excluir feriado"
            descricao={`${excluir.nome} (${formatarData(excluir.data)}, ${paraQuem(excluir)}) deixa de valer, e os dias trabalhados nesta data voltam ao cálculo normal.`}
            busy={ocupado}
            onClose={() => setExcluir(null)}
            footer={
              <>
                <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={() => setExcluir(null)} disabled={ocupado} autoFocus>Cancelar</Button>
                <Button variant="danger" className="h-10 w-full sm:w-auto" onClick={() => void remover()} disabled={ocupado} aria-busy={ocupado}>{ocupado ? "Excluindo..." : "Excluir feriado"}</Button>
              </>
            }
          >
            <ErroDialogo erro={erro} />
          </PortalDialog>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Busca um fornecedor ativo para habilitar o timesheet; a escolha abre a configuração dele. */
function HabilitarDialog({ jaListados, onClose, onEscolher }: { jaListados: Set<string>; onClose: () => void; onEscolher: (p: ProfissionalBusca) => void }) {
  const [lista, setLista] = useState<ProfissionalBusca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/profissionais").then(async (res) => {
      if (!res.ok) { setErro(await erroDaApi(res, "Erro ao buscar fornecedores.")); return; }
      setLista((await res.json()) as ProfissionalBusca[]);
    }).catch(() => setErro("Erro ao buscar fornecedores."));
  }, []);

  const termo = q.trim().toLowerCase();
  const resultados = (lista ?? [])
    .filter((p) => !jaListados.has(p.id) && (!termo || [p.nomeCompleto, p.nome, p.codigo].some((v) => (v ?? "").toLowerCase().includes(termo))))
    .slice(0, 30);

  return (
    <PortalDialog
      titulo="Habilitar fornecedor"
      descricao="Escolha o fornecedor. Na configuração, marque Habilitado e preencha o cabeçalho da folha."
      busy={false}
      onClose={onClose}
      footer={<Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={onClose}>Fechar</Button>}
    >
      <ErroDialogo erro={erro} />
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou código…" aria-label="Buscar fornecedor para habilitar" />
      {!lista && !erro ? (
        <Carregando texto="Carregando fornecedores" linhas={3} altura="h-9" />
      ) : (
        <ul className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {resultados.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onEscolher(p)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-[var(--foreground)]">{p.nomeCompleto ?? p.nome}</span>
                  <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{p.codigo ?? "sem código"}</span>
                </span>
                {p.statusColaborador && <Badge variant="neutral">{p.statusColaborador}</Badge>}
              </button>
            </li>
          ))}
          {resultados.length === 0 && <li className="px-3 py-4 text-sm text-[var(--muted-foreground)]">Nenhum fornecedor encontrado.</li>}
        </ul>
      )}
    </PortalDialog>
  );
}
