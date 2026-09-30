"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, FileCheck2, RefreshCw, Search, X } from "lucide-react";
import { Badge, BlurValue, Card, FilterButton, FilterChip, IconButton, Input, PageHeader, Select } from "@/components/ui";
import { useViewportAlign } from "@/components/use-viewport-align";
import { DashboardKpiCard } from "@/components/dashboard-pilot/dashboard-kpi-card";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { getMapaPagamentoDisplayStatus } from "@/lib/sgc-display-status";
import { type Evidencia, useEvidencias, useFornecedoresComEvidencia } from "@/components/evidencias/dados";
import { EvidenciaDrawer } from "@/components/evidencias/evidencia-drawer";

const CICLO_GERAL = "GERAL";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Ciclo = { ciclo: string };

/**
 * Evidências — CONFERÊNCIA documental do Boletim de Medição. Somente leitura: não há ação de
 * workflow aqui (envio/retorno do BM e resolução de divergências continuam em Fornecedores; aprovação
 * e pedido de revisão são do fornecedor, no portal). Trabalha com o ciclo de trabalho do app (o mesmo
 * de Fornecedores), nunca com o ciclo publicado no portal. Status pelo mapper central.
 */
export function EvidenciasWorkspace({
  ciclos,
  ciclo,
  onCicloChange,
}: {
  ciclos: Ciclo[];
  /** Ciclo de trabalho do app ("GERAL" = todos). */
  ciclo: string;
  onCicloChange: (ciclo: string) => void;
}) {
  const cicloFiltro = ciclo && ciclo !== CICLO_GERAL ? ciclo : null;
  const [fornecedor, setFornecedor] = useState<{ codigo: string; nome: string } | null>(null);
  const { itens, loading, erro, recarregar } = useEvidencias(cicloFiltro, fornecedor?.codigo ?? null);
  const todosFornecedores = useFornecedoresComEvidencia();
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [fornecedorQuery, setFornecedorQuery] = useState("");
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const filtrosRef = useRef<HTMLDivElement>(null);
  const filtrosPainelRef = useRef<HTMLDivElement>(null);
  const filtrosPosicao = useViewportAlign(filtrosRef, filtrosPainelRef, filtrosAbertos, "right");
  const [aberta, setAberta] = useState<Evidencia | null>(null);
  const [bm, setBm] = useState<{ data: BmData | null; erro: string | null; loading: boolean } | null>(null);

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (filtrosRef.current && !filtrosRef.current.contains(e.target as Node)) setFiltrosAbertos(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  useEffect(() => { setAberta(null); }, [cicloFiltro, fornecedor]);

  const sugestoes = useMemo(() => {
    const q = fornecedorQuery.trim().toLowerCase();
    const lista = q ? todosFornecedores.filter((f) => f.nome.toLowerCase().includes(q) || f.codigo.toLowerCase().includes(q)) : todosFornecedores;
    return lista.slice(0, 20);
  }, [todosFornecedores, fornecedorQuery]);

  const q = busca.trim().toLowerCase();
  const filtradas = useMemo(() => (itens ?? []).filter((e) =>
    (!status || e.statusMeta.label === status) &&
    (!q || [e.nome, e.empresa, e.colaboradorCodigo, e.ciclo].some((c) => (c ?? "").toLowerCase().includes(q))),
  ), [itens, status, q]);

  const statusDisponiveis = useMemo(() => Array.from(new Set((itens ?? []).map((e) => e.statusMeta.label))), [itens]);
  const kpis = useMemo(() => {
    const lista = itens ?? [];
    const display = lista.map((e) => getMapaPagamentoDisplayStatus(e.status, e.statusConferencia));
    return {
      total: lista.length,
      aguardando: display.filter((d) => d === "AGUARDANDO").length,
      divergencia: display.filter((d) => d === "DIVERGENCIA").length,
      revisao: display.filter((d) => d === "REVISAO_SOLICITADA").length,
      aprovados: display.filter((d) => d === "AGUARDANDO_NF" || d === "APROVADO" || d === "PAGO").length,
    };
  }, [itens]);

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (fornecedor) chips.push({ key: "fornecedor", label: `Fornecedor: ${fornecedor.nome}`, onRemove: () => setFornecedor(null) });
  if (status) chips.push({ key: "status", label: `Status: ${status}`, onRemove: () => setStatus("") });

  async function verBm(e: Evidencia) {
    setBm({ data: null, erro: null, loading: true });
    const res = await fetch(`/api/admin/bm?codigo=${encodeURIComponent(e.colaboradorCodigo)}&ciclo=${encodeURIComponent(e.ciclo)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setBm({ data: null, erro: data.error ?? "Erro ao buscar boletim.", loading: false });
    else if (!data.pagamento && !data.documentos?.length) setBm({ data: null, erro: "Nenhuma medição encontrada para este fornecedor e ciclo.", loading: false });
    else setBm({ data: data as BmData, erro: null, loading: false });
  }

  const total = filtradas.reduce((s, e) => s + (e.valor ?? 0), 0);

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
        <PageHeader eyebrow="Conferência" title="Evidências" description="Confira o BM, os documentos medidos e as divergências de cada fornecedor antes da etapa financeira." />
        <IconButton onClick={() => recarregar()} title="Atualizar" disabled={loading}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </IconButton>
      </div>

      {itens !== null && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="evidencias-kpis">
          <DashboardKpiCard compact title="BMs disponíveis" value={kpis.total} detail="Enviados ao fornecedor neste recorte" icon={<FileCheck2 size={17} />} />
          <DashboardKpiCard compact title="Aguardando fornecedor" value={kpis.aguardando} detail="BM enviado, sem retorno ainda" icon={<Clock3 size={17} />} tone={kpis.aguardando ? "warning" : "neutral"} />
          <DashboardKpiCard compact title="Divergência ou revisão" value={kpis.divergencia + kpis.revisao} detail={`${kpis.divergencia} divergência(s) · ${kpis.revisao} revisão(ões)`} icon={<AlertTriangle size={17} />} tone={kpis.divergencia + kpis.revisao ? "danger" : "neutral"} />
          <DashboardKpiCard compact title="Aprovados pelo fornecedor" value={kpis.aprovados} detail="Seguiram para NF e pagamento" icon={<CheckCircle2 size={17} />} tone={kpis.aprovados ? "success" : "neutral"} />
        </div>
      )}

      <Card className="w-full min-w-0 max-w-full overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          <span className="relative min-w-0 sm:w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#9CA3AF]" size={14} />
            <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, empresa, código ou ciclo…" aria-label="Buscar evidências" />
          </span>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 sm:w-[150px] sm:flex-none">
              <Select value={cicloFiltro ?? ""} onChange={(e) => onCicloChange(e.target.value || CICLO_GERAL)} aria-label="Ciclo">
                <option value="">Todos os ciclos</option>
                {ciclos.map((c) => <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>)}
              </Select>
            </div>
            <div className="relative shrink-0" ref={filtrosRef}>
              <FilterButton count={chips.length} onClick={() => setFiltrosAbertos((v) => !v)} />
              {filtrosAbertos && (
                <div ref={filtrosPainelRef} style={filtrosPosicao} className="absolute right-0 top-10 z-40 grid w-[300px] max-w-[88vw] gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <p className="text-label text-[var(--muted-foreground)]">Filtros</p>
                    <button type="button" onClick={() => setFiltrosAbertos(false)} title="Fechar" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#374151]"><X size={12} /></button>
                  </div>
                  <label className="grid gap-1 text-xs text-[var(--foreground)]">
                    Status
                    <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                      <option value="">Todos</option>
                      {statusDisponiveis.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </label>
                  {/* Fornecedor: filtra pela identidade canônica (colaboradorCodigo), em qualquer ciclo. */}
                  <label className="relative grid gap-1 text-xs text-[var(--foreground)]">
                    Fornecedor
                    <Input
                      value={fornecedor ? fornecedor.nome : fornecedorQuery}
                      placeholder="Todos os fornecedores / buscar…"
                      onFocus={() => setSugestoesAbertas(true)}
                      onChange={(e) => { setFornecedor(null); setFornecedorQuery(e.target.value); setSugestoesAbertas(true); }}
                    />
                    {sugestoesAbertas && !fornecedor && sugestoes.length > 0 && (
                      <div className="absolute top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-white shadow-lg">
                        {sugestoes.map((f) => (
                          <button
                            key={f.codigo}
                            type="button"
                            onClick={() => { setFornecedor(f); setFornecedorQuery(""); setSugestoesAbertas(false); }}
                            className="flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-[#F9FAFB]"
                          >
                            <span className="font-semibold text-[#1A1A1A]">{f.nome}</span>
                            <span className="font-technical text-[10px] text-[#9CA3AF]">{f.codigo}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                  <div className="flex justify-between border-t border-[var(--border)] pt-3">
                    <button type="button" onClick={() => { setStatus(""); setFornecedor(null); setFornecedorQuery(""); }} className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Limpar filtros</button>
                    <button type="button" onClick={() => setFiltrosAbertos(false)} className="text-xs font-bold text-[var(--primary)]">Concluído</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-5 py-2.5">
            {chips.map((c) => <FilterChip key={c.key} label={c.label} onRemove={c.onRemove} />)}
          </div>
        )}

        {itens === null ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Selecione um ciclo ou um fornecedor para visualizar as evidências.</div>
        ) : loading && !itens.length ? (
          <div className="grid gap-2 px-5 py-5" aria-label="Carregando evidências">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-[#F4F4F2]" />)}
          </div>
        ) : erro ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--error)]">{erro}</div>
        ) : filtradas.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]" data-testid="evidencias-vazio">Nenhuma evidência encontrada para este ciclo e filtro.</div>
        ) : (
          <EvidenciasLista itens={filtradas} onOpen={setAberta} />
        )}

        {itens !== null && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted-foreground)]">
            <span>{filtradas.length === itens.length ? `${itens.length} BM(s)` : `${filtradas.length} de ${itens.length} BM(s)`}</span>
            <span className="font-semibold tabular-nums text-[var(--foreground)]" data-testid="evidencias-total"><BlurValue>{brl.format(total)}</BlurValue></span>
          </div>
        )}
      </Card>

      {aberta && (
        <EvidenciaDrawer
          key={aberta.key}
          evidencia={aberta}
          escEnabled={!bm}
          onVerBm={() => verBm(aberta)}
          onClose={() => setAberta(null)}
        />
      )}

      {bm && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-[1px] sm:p-4 sm:pt-10">
          <div className="min-h-screen w-full max-w-5xl rounded-none bg-white shadow-2xl sm:min-h-0 sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Boletim de Medição{aberta ? ` — ${aberta.nome} (${aberta.ciclo})` : ""}</p>
              <IconButton onClick={() => setBm(null)} title="Fechar boletim"><X size={16} /></IconButton>
            </div>
            {/* Sem overflow-x-auto aqui: BoletimMedicao já rola horizontalmente por conta própria. */}
            <div className="min-w-0 max-w-full p-4 sm:p-5">
              {bm.loading ? <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">Carregando boletim…</p>
                : bm.erro ? <div className="rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-4 py-3 text-sm text-[var(--error)]">{bm.erro}</div>
                : bm.data ? <BoletimMedicao data={bm.data} /> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function onKey(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
    event.preventDefault();
    open();
  }
}

/** Uma linha por BM (fornecedor × ciclo); a linha abre o detalhe — sem coluna de ações. */
function EvidenciasLista({ itens, onOpen }: { itens: Evidencia[]; onOpen: (e: Evidencia) => void }) {
  const th = "text-table-header border-b border-[var(--border)] px-3 py-2.5 text-left text-[var(--muted-foreground)] xl:px-4";
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm" data-testid="evidencias-lista">
          <thead className="bg-[#FAFAF8]">
            <tr>
              <th className={th}>Fornecedor</th>
              <th className={`${th} w-20`}>Ciclo</th>
              <th className={`${th} hidden lg:table-cell`}>Revisão</th>
              <th className={`${th} text-right`}>Valor do BM</th>
              <th className={th}>Status</th>
              <th className={`${th} w-8`} />
            </tr>
          </thead>
          <tbody>
            {itens.map((e) => (
              <tr
                key={e.key}
                tabIndex={0}
                aria-label={`Abrir evidência de ${e.nome} no ciclo ${e.ciclo}`}
                onClick={() => onOpen(e)}
                onKeyDown={(ev) => onKey(ev, () => onOpen(e))}
                className="cursor-pointer border-b border-[#EFEFED] transition-colors last:border-0 hover:bg-[#FAFAF8] focus-visible:bg-[#FAFAF8] focus-visible:outline-none"
              >
                <td className="px-3 py-3 xl:px-4">
                  <p className="max-w-[340px] truncate font-semibold text-[var(--foreground)]">{e.nome}</p>
                  <p className="mt-0.5 max-w-[340px] truncate text-[12px] text-[var(--muted-foreground)]">{e.empresa ?? <span className="font-technical">{e.colaboradorCodigo}</span>}</p>
                </td>
                <td className="px-3 py-3 font-technical text-[12.5px] text-[var(--foreground)] xl:px-4">{e.ciclo}</td>
                <td className="hidden px-3 py-3 text-[12.5px] text-[var(--muted-foreground)] lg:table-cell xl:px-4">{e.revisaoNumero > 0 ? `Rev. ${e.revisaoNumero}` : "Original"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-[var(--foreground)] xl:px-4">{e.valor !== null ? <BlurValue>{brl.format(e.valor)}</BlurValue> : "–"}</td>
                <td className="whitespace-nowrap px-3 py-3 xl:px-4"><Badge variant={e.statusMeta.badge}>{e.statusMeta.label}</Badge></td>
                <td className="w-8 px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[#EFEFED] md:hidden" data-testid="evidencias-lista-mobile">
        {itens.map((e) => (
          <li key={e.key}>
            <button type="button" onClick={() => onOpen(e)} aria-label={`Abrir evidência de ${e.nome} no ciclo ${e.ciclo}`} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[#FAFAF8]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">{e.nome}</p>
                <p className="truncate text-[12px] text-[var(--muted-foreground)]"><span className="font-technical">{e.ciclo}</span> · {e.empresa ?? e.colaboradorCodigo}</p>
                <div className="mt-1.5"><Badge variant={e.statusMeta.badge}>{e.statusMeta.label}</Badge></div>
              </div>
              <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">{e.valor !== null ? <BlurValue>{brl.format(e.valor)}</BlurValue> : "–"}</p>
              <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
