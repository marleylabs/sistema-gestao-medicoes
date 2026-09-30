"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { BlurValue, Card, FilterButton, FilterChip, IconButton, Input, PageHeader, Select } from "@/components/ui";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { type CicloHistorico, type ContratoHistorico, type FornecedorHistorico, type MedicaoHistorico, useHistoricoDados, useIndices } from "@/components/historico/dados";
import { ContratosLista, FornecedoresLista, MedicoesLista, brl } from "@/components/historico/listas";
import { ContratoHistoricoDrawer, FornecedorHistoricoDrawer, MedicaoDrawer } from "@/components/historico/drawers";

type Visao = "medicoes" | "fornecedores" | "contratos";
type Painel =
  | { tipo: "medicao"; medicao: MedicaoHistorico; voltar?: Painel }
  | { tipo: "fornecedor"; fornecedor: FornecedorHistorico }
  | { tipo: "contrato"; contrato: ContratoHistorico };

const VISOES: { valor: Visao; label: string }[] = [
  { valor: "medicoes", label: "Medições" },
  { valor: "fornecedores", label: "Fornecedores" },
  { valor: "contratos", label: "Contratos" },
];

/**
 * Histórico — área de CONSULTA e rastreabilidade (não publica ciclo; isso fica em /fornecedores).
 * Nenhuma manutenção de ciclo aqui (criar/selecionar/excluir ficam em /fornecedores → Gerenciar
 * ciclos). Uma única área, três perspectivas sobre os mesmos dados: Medições (BM por fornecedor ×
 * ciclo), Fornecedores (trajetória por identidade canônica) e Contratos (contrato como eixo). Dados
 * de GET /api/historico (somente leitura); valores = mapaPagamentoItem.valor; valor por contrato
 * pela mesma regra do Dashboard.
 */
export function HistoricoWorkspace({ ciclos }: { ciclos: CicloHistorico[] }) {
  const { medicoes, contratos, loading, erro, carregado, recarregar } = useHistoricoDados(true);
  const cicloPublicado = ciclos.find((c) => c.ativoMedicao)?.ciclo ?? null;
  const { fornecedores, contratos: contratosHist, nomeContrato } = useIndices(medicoes, contratos);
  const [visao, setVisao] = useState<Visao>("medicoes");
  const [busca, setBusca] = useState("");
  const [ciclo, setCiclo] = useState("");
  const [status, setStatus] = useState("");
  const [contrato, setContrato] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const filtrosRef = useRef<HTMLDivElement>(null);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [bm, setBm] = useState<{ data: BmData | null; erro: string | null; loading: boolean } | null>(null);

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (filtrosRef.current && !filtrosRef.current.contains(e.target as Node)) setFiltrosAbertos(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const q = busca.trim().toLowerCase();
  const casaTexto = (...campos: (string | null | undefined)[]) => !q || campos.some((c) => (c ?? "").toLowerCase().includes(q));

  const medicoesFiltradas = useMemo(() => medicoes.filter((m) =>
    (!ciclo || m.ciclo === ciclo) &&
    (!status || m.status.label === status) &&
    (!contrato || (m.participacoes[contrato] ?? 0) > 0) &&
    casaTexto(m.nome, m.empresa, m.codigo, m.ciclo),
  ), [medicoes, ciclo, status, contrato, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const fornecedoresFiltrados = useMemo(() => fornecedores.filter((f) =>
    (!ciclo || f.ciclos.includes(ciclo)) &&
    (!contrato || f.contratoIds.includes(contrato)) &&
    casaTexto(f.nome, f.empresa, f.codigo),
  ), [fornecedores, ciclo, contrato, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const contratosFiltrados = useMemo(() => contratosHist.filter((c) =>
    (!ciclo || c.ciclos.includes(ciclo)) && casaTexto(c.nome),
  ), [contratosHist, ciclo, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusDisponiveis = useMemo(() => Array.from(new Set(medicoes.map((m) => m.status.label))), [medicoes]);
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (visao === "medicoes" && status) chips.push({ key: "status", label: `Status: ${status}`, onRemove: () => setStatus("") });
  if (visao !== "contratos" && contrato) chips.push({ key: "contrato", label: `Contrato: ${nomeContrato.get(contrato) ?? contrato}`, onRemove: () => setContrato("") });

  async function verBm(m: MedicaoHistorico) {
    setBm({ data: null, erro: null, loading: true });
    const res = await fetch(`/api/admin/bm?codigo=${encodeURIComponent(m.codigo)}&ciclo=${encodeURIComponent(m.ciclo)}`);
    const payload = await res.json().catch(() => ({}));
    setBm(res.ok ? { data: payload as BmData, erro: null, loading: false } : { data: null, erro: payload.error ?? "Não foi possível carregar o boletim de medição.", loading: false });
  }

  const total = visao === "medicoes" ? medicoesFiltradas.reduce((s, m) => s + m.valor, 0) : null;
  const contagem = visao === "medicoes" ? `${medicoesFiltradas.length} medição(ões)` : visao === "fornecedores" ? `${fornecedoresFiltrados.length} fornecedor(es)` : `${contratosFiltrados.length} contrato(s)`;
  const vazio = visao === "medicoes" ? !medicoesFiltradas.length : visao === "fornecedores" ? !fornecedoresFiltrados.length : !contratosFiltrados.length;
  const modalAberto = !!bm;

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
        <PageHeader eyebrow="Consulta" title="Histórico" description="Explore o histórico de medições por ciclo, fornecedor ou contrato." />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <IconButton onClick={() => recarregar()} title="Atualizar" disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </IconButton>
        </div>
      </div>

      <Card className="w-full min-w-0 max-w-full overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div role="tablist" aria-label="Perspectiva" className="-mx-5 flex gap-x-5 overflow-x-auto whitespace-nowrap px-5 xl:mx-0 xl:overflow-visible xl:px-0">
            {VISOES.map((v) => (
              <button
                key={v.valor}
                type="button"
                role="tab"
                aria-selected={visao === v.valor}
                onClick={() => { setVisao(v.valor); setPainel(null); }}
                className={`border-b-2 pb-2.5 pt-1 text-sm transition xl:-mb-3 ${visao === v.valor ? "border-[var(--primary)] font-semibold text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <span className="relative min-w-0 sm:w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#9CA3AF]" size={14} />
              <Input
                className="pl-8"
                aria-label="Buscar no histórico"
                placeholder={visao === "contratos" ? "Buscar contrato..." : visao === "fornecedores" ? "Nome, empresa ou código..." : "Fornecedor, empresa ou ciclo..."}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </span>
            <div className="flex items-center gap-2">
              <div className="w-[150px] shrink-0">
                <Select value={ciclo} onChange={(e) => setCiclo(e.target.value)} aria-label="Ciclo">
                  <option value="">Todos os ciclos</option>
                  {ciclos.map((c) => <option key={c.ciclo} value={c.ciclo}>{c.ciclo === cicloPublicado ? `${c.ciclo} · publicado no portal` : c.ciclo}</option>)}
                </Select>
              </div>
              {visao !== "contratos" && (
                <div className="relative shrink-0" ref={filtrosRef}>
                  <FilterButton count={chips.length} onClick={() => setFiltrosAbertos((v) => !v)} />
                  {filtrosAbertos && (
                    <div className="absolute right-0 top-10 z-40 grid w-[280px] max-w-[88vw] gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <p className="text-label text-[var(--muted-foreground)]">Filtros</p>
                        <button type="button" onClick={() => setFiltrosAbertos(false)} title="Fechar" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#374151]"><X size={12} /></button>
                      </div>
                      {visao === "medicoes" && (
                        <label className="grid gap-1 text-xs text-[var(--foreground)]">
                          Status
                          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                            <option value="">Todos</option>
                            {statusDisponiveis.map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        </label>
                      )}
                      <label className="grid gap-1 text-xs text-[var(--foreground)]">
                        Contrato
                        <Select value={contrato} onChange={(e) => setContrato(e.target.value)} aria-label="Contrato">
                          <option value="">Todos</option>
                          {contratos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </Select>
                      </label>
                      <div className="flex justify-between border-t border-[var(--border)] pt-3">
                        <button type="button" onClick={() => { setStatus(""); setContrato(""); }} className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Limpar filtros</button>
                        <button type="button" onClick={() => setFiltrosAbertos(false)} className="text-xs font-bold text-[var(--primary)]">Concluído</button>
                      </div>
                    </div>
                  )}
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

        {erro ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--error)]">{erro}</div>
        ) : !carregado ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Carregando histórico…</div>
        ) : vazio ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Nenhum registro encontrado para os filtros selecionados.</div>
        ) : visao === "medicoes" ? (
          <MedicoesLista itens={medicoesFiltradas} nomesContrato={nomeContrato} onOpen={(m) => setPainel({ tipo: "medicao", medicao: m })} />
        ) : visao === "fornecedores" ? (
          <FornecedoresLista itens={fornecedoresFiltrados} onOpen={(f) => setPainel({ tipo: "fornecedor", fornecedor: f })} />
        ) : (
          <ContratosLista itens={contratosFiltrados} onOpen={(c) => setPainel({ tipo: "contrato", contrato: c })} />
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted-foreground)]">
          <span>{contagem}</span>
          {total !== null && <span className="font-semibold tabular-nums text-[var(--foreground)]" data-testid="historico-total"><BlurValue>{brl.format(total)}</BlurValue></span>}
        </div>
      </Card>

      {painel?.tipo === "medicao" && (
        <MedicaoDrawer
          key={painel.medicao.key}
          medicao={painel.medicao}
          nomesContrato={nomeContrato}
          publicadoNoPortal={painel.medicao.ciclo === cicloPublicado}
          escEnabled={!modalAberto}
          onVerBm={() => verBm(painel.medicao)}
          onBack={painel.voltar ? () => setPainel(painel.voltar!) : undefined}
          onClose={() => setPainel(null)}
        />
      )}
      {painel?.tipo === "fornecedor" && (
        <FornecedorHistoricoDrawer
          fornecedor={painel.fornecedor}
          nomesContrato={nomeContrato}
          escEnabled={!modalAberto}
          onAbrirMedicao={(m) => setPainel({ tipo: "medicao", medicao: m, voltar: painel })}
          onClose={() => setPainel(null)}
        />
      )}
      {painel?.tipo === "contrato" && (
        <ContratoHistoricoDrawer
          contrato={painel.contrato}
          escEnabled={!modalAberto}
          onAbrirMedicao={(m) => setPainel({ tipo: "medicao", medicao: m, voltar: painel })}
          onClose={() => setPainel(null)}
        />
      )}

      {bm && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-[1px] sm:p-4 sm:pt-10">
          <div className="min-h-screen w-full max-w-5xl rounded-none bg-white shadow-2xl sm:min-h-0 sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Boletim de Medição</p>
              <IconButton onClick={() => setBm(null)} title="Fechar boletim"><X size={16} /></IconButton>
            </div>
            <div className="p-4 sm:p-5">
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
