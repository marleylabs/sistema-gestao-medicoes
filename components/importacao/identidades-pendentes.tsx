"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Link2, Search, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { pareceNomeDeFornecedor } from "@/lib/identidade-plausivel";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Detalhe de um bloqueio ESTRUTURAL do etl UnresolvedIdentityError (ver etl/ingest_medicoes.py). */
export type EtlUnresolvedIdentity = {
  valor: string;
  origem: string;
  coluna?: string;
  ciclo?: string;
  status: "SEM_PROJETISTA" | "PROJETISTA_INVALIDO" | "AMBIGUO" | "CONFLITO_ALIAS" | "NAO_RESOLVIDO";
  candidatos?: string[];
  ocorrencias: number;
  linhas: number[];
  sugestoesCadastro?: string[];
  exemplos?: Array<{ linha: number; numeroDocumento: string | null; evidencia: string | null }>;
  chaves?: Array<{ chave: string; linha: number; numeroDocumento: string | null; evidencia: string | null }>;
};

/** Identidade da importação gravada no ciclo (GET /api/admin/importacao/identidades). */
export type IdentidadeDoCiclo = {
  id: string;
  ciclo: string;
  valorBruto: string;
  origem: string;
  status: "PENDENTE" | "VINCULADO" | "AUTO_VINCULADO" | "DESCARTADO";
  ocorrencias: number;
  linhas: number[];
  sugestoesCadastro: string[];
  codigoCanonico: string | null;
  valor: number;
  resolvidoPorNome: string | null;
  descartadoPorNome: string | null;
};

type Alvo = { profissionalId: string; codigo: string; responsavel: string; razaoSocial: string | null };
export type NovoFornecedorDaImportacao = (nome: string, identidadeId: string) => void;

const STATUS: Record<IdentidadeDoCiclo["status"], { label: string; variant: "warning" | "success" | "neutral" | "danger" }> = {
  PENDENTE: { label: "Cadastro pendente", variant: "warning" },
  VINCULADO: { label: "Vinculado", variant: "success" },
  AUTO_VINCULADO: { label: "Resolvido automaticamente", variant: "success" },
  DESCARTADO: { label: "Descartado", variant: "neutral" },
};

const BLOQUEIO_LABEL: Record<EtlUnresolvedIdentity["status"], string> = {
  SEM_PROJETISTA: "sem PROJETISTA",
  PROJETISTA_INVALIDO: "PROJETISTA não é nome de fornecedor",
  AMBIGUO: "ambíguo",
  CONFLITO_ALIAS: "código já é alias de outro fornecedor",
  NAO_RESOLVIDO: "não encontrado",
};

const LINHAS_VISIVEIS = 5;

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const payload = await res.json().catch(() => null);
  return { ok: res.ok, payload };
}

// ─── Diálogo base (design system) ─────────────────────────────────────────────────────────────

function DialogShell({ titulo, children, footer, onClose, busy = false, testId }: {
  titulo: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void; busy?: boolean; testId: string;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-busy={busy} data-testid={testId}
        className="ds-dialog flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden sm:w-[480px] sm:max-w-[92vw]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 id={`${id}-t`} className="text-section-title break-words text-[var(--foreground)]">{titulo}</h2>
        </div>
        <div className="grid min-h-0 gap-2 overflow-y-auto px-5 py-4 text-[13px] text-[var(--foreground)]">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/** Trava síncrona contra duplo clique (o servidor também serializa e é idempotente). */
function useAcao() {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const trava = useRef(false);
  const executar = useCallback(async (fn: () => Promise<string | null>) => {
    if (trava.current) return;
    trava.current = true;
    setSalvando(true);
    setErro("");
    try {
      const falha = await fn();
      if (falha) setErro(falha);
    } catch {
      setErro("Não foi possível concluir a ação.");
    } finally {
      trava.current = false;
      setSalvando(false);
    }
  }, []);
  return { salvando, erro, executar };
}

function ResumoIdentidade({ identidade }: { identidade: IdentidadeDoCiclo }) {
  return (
    <div className="grid gap-1 rounded-lg border border-[var(--border)] bg-[#fafaf9] p-3 text-xs">
      <p><span className="text-[var(--muted-foreground)]">Nome na planilha:</span> <strong className="break-words">{identidade.valorBruto}</strong></p>
      <p><span className="text-[var(--muted-foreground)]">Origem:</span> {identidade.origem} · {identidade.ocorrencias} ocorrência(s){identidade.linhas.length ? ` · linha(s) ${identidade.linhas.slice(0, 10).join(", ")}${identidade.linhas.length > 10 ? "…" : ""}` : ""}</p>
      <p><span className="text-[var(--muted-foreground)]">Valor no ciclo:</span> <strong className="tabular-nums">{money.format(identidade.valor)}</strong></p>
    </div>
  );
}

// ─── Vincular cadastro ────────────────────────────────────────────────────────────────────────

function VincularDialog({ identidade, sugestao, onClose, onConcluido }: {
  identidade: IdentidadeDoCiclo; sugestao: Alvo | null; onClose: () => void; onConcluido: (mensagem: string) => void;
}) {
  const [escolhido, setEscolhido] = useState<Alvo | null>(sugestao);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Alvo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscaErro, setBuscaErro] = useState("");
  const { salvando, erro, executar } = useAcao();

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) { setResultados([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/admin/importacao/identidades/fornecedores?q=${encodeURIComponent(termo)}`, { signal: controller.signal });
        const payload = await res.json().catch(() => null);
        if (!res.ok) { setBuscaErro(payload?.error ?? "Não foi possível buscar cadastros."); return; }
        setResultados(payload?.fornecedores ?? []);
        setBuscaErro("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setBuscaErro("Não foi possível buscar cadastros.");
      } finally {
        setBuscando(false);
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [q]);

  const confirmar = () => escolhido && executar(async () => {
    const { ok, payload } = await postJson(`/api/admin/importacao/identidades/${identidade.id}/vincular`, { profissionalId: escolhido.profissionalId });
    if (!ok) return payload?.error ?? "Não foi possível vincular.";
    onConcluido(payload?.status === "JA_VINCULADO"
      ? `"${identidade.valorBruto}" já estava vinculado a ${payload.codigoCanonico}.`
      : `"${identidade.valorBruto}" vinculado a ${payload?.codigoCanonico ?? escolhido.codigo}.`);
    return null;
  });

  return (
    <DialogShell titulo="Vincular cadastro" onClose={onClose} busy={salvando} testId="identidade-vincular-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={escolhido && !sugestao ? () => setEscolhido(null) : onClose} disabled={salvando}>{escolhido && !sugestao ? "Voltar" : "Cancelar"}</Button>
          <Button onClick={() => void confirmar()} disabled={!escolhido || salvando}><Link2 size={14} />{salvando ? "Vinculando…" : "Confirmar vínculo"}</Button>
        </>
      )}
    >
      {escolhido ? (
        <>
          <p><strong className="break-words">{identidade.valorBruto}</strong> será vinculado a:</p>
          <div className="grid gap-0.5 rounded-lg border border-[var(--border)] bg-[#fafaf9] p-3 text-xs" data-testid="identidade-alvo">
            <strong className="text-[13px]">{escolhido.responsavel}</strong>
            <span className="font-technical text-[var(--muted-foreground)]">{escolhido.codigo}{escolhido.razaoSocial ? ` · ${escolhido.razaoSocial}` : ""}</span>
          </div>
          {sugestao && <p className="text-[#92400E]">Sugestão (não aplicada) por nome parecido — confirme que é a mesma pessoa/empresa.</p>}
          <ResumoIdentidade identidade={identidade} />
          <p className="text-[var(--muted-foreground)]">As {identidade.ocorrencias} ocorrência(s) deste ciclo passam para o cadastro sem reimportar e sem mudar valores. O nome vira alias para as próximas importações; o nome e o código do cadastro não mudam.</p>
          {sugestao && (
            <button type="button" className="justify-self-start text-[12px] font-semibold text-[var(--primary)] underline underline-offset-2" onClick={() => { setEscolhido(null); }}>
              Escolher outro cadastro
            </button>
          )}
        </>
      ) : (
        <>
          <p>Vincular <strong className="break-words">&quot;{identidade.valorBruto}&quot;</strong> a um cadastro do Administrativo. Busque por nome, código ou razão social.</p>
          <Input autoFocus aria-label="Buscar cadastro" placeholder="Nome, código ou razão social" value={q} onChange={(e) => setQ(e.target.value)} />
          {buscando && <p className="text-xs text-[var(--muted-foreground)]">Buscando…</p>}
          {buscaErro && <p className="text-xs text-[var(--error)]">{buscaErro}</p>}
          {!buscando && q.trim().length >= 2 && !resultados.length && !buscaErro && <p className="text-xs text-[var(--muted-foreground)]">Nenhum cadastro ativo encontrado.</p>}
          <ul className="grid gap-1" data-testid="identidade-busca-resultados">
            {resultados.map((r) => (
              <li key={r.profissionalId}>
                <button type="button" onClick={() => setEscolhido(r)}
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left text-xs transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]">
                  <span className="block font-semibold">{r.responsavel}</span>
                  <span className="block break-words text-[var(--muted-foreground)]">{r.codigo}{r.razaoSocial ? ` · ${r.razaoSocial}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {erro && <p className="text-[var(--error)]" role="alert">{erro}</p>}
    </DialogShell>
  );
}

// ─── Descartar ────────────────────────────────────────────────────────────────────────────────

function DescartarDialog({ identidade, onClose, onConcluido }: { identidade: IdentidadeDoCiclo; onClose: () => void; onConcluido: (mensagem: string) => void }) {
  const { salvando, erro, executar } = useAcao();
  const confirmar = () => executar(async () => {
    const { ok, payload } = await postJson(`/api/admin/importacao/identidades/${identidade.id}/descartar`);
    if (!ok) return payload?.error ?? "Não foi possível descartar.";
    onConcluido(`"${identidade.valorBruto}" descartado deste ciclo.`);
    return null;
  });
  return (
    <DialogShell titulo={`Descartar ${identidade.valorBruto} desta medição?`} onClose={onClose} busy={salvando} testId="identidade-descartar-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="danger" onClick={() => void confirmar()} disabled={salvando}><Trash2 size={14} />{salvando ? "Descartando…" : "Descartar"}</Button>
        </>
      )}
    >
      <p><strong>{identidade.ocorrencias} ocorrência(s) serão desconsideradas.</strong> Esses registros não irão compor os valores nem o BM deste ciclo ({money.format(identidade.valor)}).</p>
      <ResumoIdentidade identidade={identidade} />
      <p className="text-[var(--muted-foreground)]">Vale só para este ciclo: nenhum fornecedor, cadastro ou alias é excluído, e outros ciclos não são afetados.</p>
      {erro && <p className="text-[var(--error)]" role="alert">{erro}</p>}
    </DialogShell>
  );
}

// ─── Ações de uma identidade (lista da importação e detalhe do fornecedor) ───────────────────

export function AcoesIdentidade({ identidade, sugestao, onNovoFornecedor, onAlterado, compacto = false }: {
  identidade: IdentidadeDoCiclo;
  sugestao: Alvo | null;
  onNovoFornecedor?: NovoFornecedorDaImportacao;
  onAlterado: (mensagem: string) => void;
  compacto?: boolean;
}) {
  const [dialogo, setDialogo] = useState<"sugestao" | "vincular" | "novo" | "descartar" | null>(null);
  const concluir = (mensagem: string) => { setDialogo(null); onAlterado(mensagem); };
  const plausivel = pareceNomeDeFornecedor(identidade.valorBruto);
  if (identidade.status !== "PENDENTE") return null;
  return (
    <>
      <div className={`flex flex-wrap gap-2 ${compacto ? "" : "pl-6"}`} data-testid="identidade-acoes">
        {sugestao && plausivel && (
          <Button variant="outline" className="h-8" onClick={() => setDialogo("sugestao")}><Link2 size={13} /> Vincular à sugestão</Button>
        )}
        {plausivel && <Button variant="secondary" className="h-8" onClick={() => setDialogo("vincular")}><Search size={13} /> Vincular cadastro</Button>}
        {plausivel && onNovoFornecedor && <Button variant="ghost" className="h-8" onClick={() => setDialogo("novo")}><UserPlus size={13} /> Cadastrar novo</Button>}
        <Button variant="ghost" className="h-8 text-[var(--error)]" onClick={() => setDialogo("descartar")}><Trash2 size={13} /> Descartar</Button>
      </div>
      {dialogo === "sugestao" && sugestao && <VincularDialog identidade={identidade} sugestao={sugestao} onClose={() => setDialogo(null)} onConcluido={concluir} />}
      {dialogo === "vincular" && <VincularDialog identidade={identidade} sugestao={null} onClose={() => setDialogo(null)} onConcluido={concluir} />}
      {dialogo === "descartar" && <DescartarDialog identidade={identidade} onClose={() => setDialogo(null)} onConcluido={concluir} />}
      {dialogo === "novo" && onNovoFornecedor && (
        <DialogShell titulo="Cadastrar novo fornecedor" onClose={() => setDialogo(null)} testId="identidade-novo-dialog"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setDialogo(null)}>Cancelar</Button>
              <Button onClick={() => { setDialogo(null); onNovoFornecedor(identidade.valorBruto, identidade.id); }}><UserPlus size={14} /> Abrir cadastro</Button>
            </>
          )}
        >
          <p>&quot;{identidade.valorBruto}&quot; não corresponde a nenhum cadastro.</p>
          <p>O cadastro oficial do Administrativo será aberto só com o nome preenchido. Complete os dados obrigatórios e salve: o registro pendente é vinculado ao novo cadastro automaticamente, sem reimportar.</p>
          <p className="text-[var(--muted-foreground)]">Se for alguém já cadastrado com outro nome, use &quot;Vincular cadastro&quot;.</p>
        </DialogShell>
      )}
    </>
  );
}

function useIdentidadesDoCiclo(ciclo: string | null | undefined) {
  const [identidades, setIdentidades] = useState<IdentidadeDoCiclo[]>([]);
  const [sugestoes, setSugestoes] = useState<Record<string, Alvo | null>>({});
  const [podeResolver, setPodeResolver] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    if (!ciclo || !/^\d{4}$/.test(ciclo)) { setCarregando(false); return; }
    try {
      const res = await fetch(`/api/admin/importacao/identidades?ciclo=${encodeURIComponent(ciclo)}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) { setErro(payload?.error ?? "Não foi possível carregar as identidades."); return; }
      setIdentidades(payload.identidades ?? []);
      setSugestoes(payload.sugestoes ?? {});
      setPodeResolver(Boolean(payload.podeResolver));
      setErro("");
    } catch {
      setErro("Não foi possível carregar as identidades.");
    } finally {
      setCarregando(false);
    }
  }, [ciclo]);
  useEffect(() => { void carregar(); }, [carregar]);
  const sugestaoDe = useCallback((i: IdentidadeDoCiclo) => {
    for (const rotulo of i.sugestoesCadastro) if (sugestoes[rotulo]) return sugestoes[rotulo];
    return null;
  }, [sugestoes]);
  return { identidades, sugestaoDe, podeResolver, carregando, erro, carregar };
}

/** Ações do registro pendente a partir do detalhe do fornecedor (tela Fornecedores). */
export function ResolverCadastroPendente({ ciclo, identidadeId, onNovoFornecedor, onAlterado }: {
  ciclo: string; identidadeId: string; onNovoFornecedor?: NovoFornecedorDaImportacao; onAlterado: (mensagem: string) => void;
}) {
  const { identidades, sugestaoDe, podeResolver, carregando } = useIdentidadesDoCiclo(ciclo);
  const identidade = identidades.find((i) => i.id === identidadeId);
  return (
    <div className="grid gap-2 rounded-lg border border-[#f2dbb7] bg-[var(--warning-soft)] p-3 text-xs" data-testid="cadastro-pendente-detalhe">
      <p className="font-semibold text-[var(--warning)]">Cadastro pendente de vínculo</p>
      <p className="text-[var(--foreground)]">Este registro está no ciclo e compõe os totais, mas o BM fica indisponível até o vínculo com um cadastro.</p>
      {carregando ? <p className="text-[var(--muted-foreground)]">Carregando…</p> : identidade && podeResolver ? (
        <AcoesIdentidade identidade={identidade} sugestao={sugestaoDe(identidade)} onNovoFornecedor={onNovoFornecedor} onAlterado={onAlterado} compacto />
      ) : !podeResolver ? <p className="text-[var(--muted-foreground)]">Somente o perfil ADMIN pode vincular, cadastrar ou descartar.</p> : null}
    </div>
  );
}

type Filtro = "PENDENTES" | "COM_SUGESTAO" | "SEM_SUGESTAO" | "RESOLVIDOS" | "DESCARTADOS";
const FILTROS: Array<{ id: Filtro; label: string }> = [
  { id: "PENDENTES", label: "Pendentes" },
  { id: "COM_SUGESTAO", label: "Com sugestão" },
  { id: "SEM_SUGESTAO", label: "Sem sugestão" },
  { id: "RESOLVIDOS", label: "Resolvidos" },
  { id: "DESCARTADOS", label: "Descartados" },
];

/**
 * Central de identidades do ciclo depois da importação: pendentes (no ciclo, BM bloqueado),
 * resolvidas (vínculo humano ou automático) e descartadas. Nada é aplicado sem clique explícito.
 */
export function IdentidadesDoCicloPanel({ ciclo, onNovoFornecedor }: { ciclo: string; onNovoFornecedor?: NovoFornecedorDaImportacao }) {
  const { identidades, sugestaoDe, podeResolver, carregando, erro, carregar } = useIdentidadesDoCiclo(ciclo);
  const [filtro, setFiltro] = useState<Filtro>("PENDENTES");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");

  const contagem = useMemo(() => ({
    pendentes: identidades.filter((i) => i.status === "PENDENTE").length,
    resolvidos: identidades.filter((i) => i.status === "VINCULADO" || i.status === "AUTO_VINCULADO").length,
    descartados: identidades.filter((i) => i.status === "DESCARTADO").length,
  }), [identidades]);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = identidades.filter((i) => {
    if (termo && !`${i.valorBruto} ${i.codigoCanonico ?? ""} ${i.sugestoesCadastro.join(" ")}`.toLocaleLowerCase("pt-BR").includes(termo)) return false;
    if (filtro === "RESOLVIDOS") return i.status === "VINCULADO" || i.status === "AUTO_VINCULADO";
    if (filtro === "DESCARTADOS") return i.status === "DESCARTADO";
    if (i.status !== "PENDENTE") return false;
    if (filtro === "COM_SUGESTAO") return i.sugestoesCadastro.length > 0;
    if (filtro === "SEM_SUGESTAO") return i.sugestoesCadastro.length === 0;
    return true;
  });

  if (!carregando && !erro && identidades.length === 0) return null;
  return (
    <div className="grid gap-3 text-[var(--foreground)]" data-testid="identidades-do-ciclo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" data-testid="identidades-contador">
          {carregando ? "Carregando identidades…" : `${contagem.pendentes} cadastro(s) pendente(s) de vínculo`}
        </p>
        <p className="text-[11px] text-[var(--muted-foreground)]">{contagem.resolvidos} resolvido(s) · {contagem.descartados} descartado(s)</p>
      </div>
      {!podeResolver && !carregando && <p className="text-[11px] text-[var(--muted-foreground)]">Somente o perfil ADMIN pode vincular, cadastrar ou descartar.</p>}
      {erro && <p className="rounded-lg bg-[var(--error-soft)] p-3 text-xs text-[var(--error)]">{erro}</p>}
      {toast && <p className="rounded-lg bg-[var(--success-soft)] p-3 text-xs text-[var(--success)]" role="status">{toast}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input aria-label="Buscar identidade" placeholder="Buscar nome" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar identidades">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}
              className={`h-8 rounded-lg border px-2.5 text-[11px] font-semibold transition ${filtro === f.id ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]" : "border-[var(--border)] bg-white text-[#555555] hover:border-[var(--border-strong)]"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid gap-2" data-testid="identidades-lista">
        {visiveis.map((i) => {
          const aberto = abertos.has(i.id);
          const status = STATUS[i.status];
          const linhas = aberto ? i.linhas : i.linhas.slice(0, LINHAS_VISIVEIS);
          return (
            <li key={i.id}>
              <Card className="grid gap-2 p-3">
                <div className="flex items-start gap-2" data-testid="identidade-card" data-valor={i.valorBruto}>
                  <button type="button" className="mt-0.5 text-[var(--muted-foreground)]" aria-expanded={aberto} aria-label={aberto ? `Recolher ${i.valorBruto}` : `Expandir ${i.valorBruto}`}
                    onClick={() => setAbertos((prev) => { const next = new Set(prev); if (next.has(i.id)) next.delete(i.id); else next.add(i.id); return next; })}>
                    {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <div className="grid min-w-0 flex-1 gap-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all text-[13px] font-semibold">{i.valorBruto}</span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <span className="text-[var(--muted-foreground)]">{i.ocorrencias} ocorrência(s) · <span className="tabular-nums">{money.format(i.valor)}</span></span>
                    </div>
                    <p className="text-[var(--muted-foreground)]">
                      {i.origem}{linhas.length ? ` · linha(s) ${linhas.join(", ")}` : ""}{!aberto && i.linhas.length > LINHAS_VISIVEIS ? "…" : ""}
                    </p>
                    {(i.status === "VINCULADO" || i.status === "AUTO_VINCULADO") && i.codigoCanonico && (
                      <p className="text-[var(--success)]">→ {i.codigoCanonico}{i.status === "AUTO_VINCULADO" ? " (resolvido automaticamente)" : i.resolvidoPorNome ? ` · por ${i.resolvidoPorNome}` : ""}</p>
                    )}
                    {i.status === "DESCARTADO" && <p className="text-[var(--muted-foreground)]">Fora deste ciclo{i.descartadoPorNome ? ` · por ${i.descartadoPorNome}` : ""}</p>}
                    {i.status === "PENDENTE" && i.sugestoesCadastro.length > 0 && <p className="text-[#92400E]">Sugestão (não aplicada): {i.sugestoesCadastro.join("; ")}</p>}
                    {i.status === "PENDENTE" && !pareceNomeDeFornecedor(i.valorBruto) && (
                      <p className="flex items-center gap-1 text-[var(--error)]"><AlertTriangle size={12} /> Não parece nome de fornecedor — corrija a coluna PROJETISTA na planilha.</p>
                    )}
                  </div>
                </div>
                {podeResolver && (
                  <AcoesIdentidade identidade={i} sugestao={sugestaoDe(i)} onNovoFornecedor={onNovoFornecedor}
                    onAlterado={(mensagem) => { setToast(mensagem); void carregar(); }} />
                )}
              </Card>
            </li>
          );
        })}
        {!visiveis.length && !carregando && (
          <li className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--muted-foreground)]">
            {filtro === "PENDENTES" && contagem.pendentes === 0 ? "Nenhum cadastro pendente neste ciclo." : "Nenhuma identidade neste filtro."}
          </li>
        )}
      </ul>
    </div>
  );
}

// ─── Bloqueio estrutural (importação não concluiu) ────────────────────────────────────────────

function DescartarLinhasDialog({ grupo, ciclo, onClose, onConcluido }: {
  grupo: EtlUnresolvedIdentity; ciclo: string; onClose: () => void; onConcluido: (mensagem: string) => void;
}) {
  const { salvando, erro, executar } = useAcao();
  const linhas = grupo.chaves ?? [];
  const confirmar = () => executar(async () => {
    const { ok, payload } = await postJson("/api/admin/importacao/identidades/linhas/descartar", { ciclo, origem: grupo.origem, linhas });
    if (!ok) return payload?.error ?? "Não foi possível descartar as linhas.";
    onConcluido(`${payload?.descartadas ?? linhas.length} linha(s) descartada(s) deste ciclo. Reimporte a medição para concluir.`);
    return null;
  });
  return (
    <DialogShell titulo={`Descartar ${grupo.ocorrencias} linha(s) sem PROJETISTA?`} onClose={onClose} busy={salvando} testId="linhas-descartar-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="danger" onClick={() => void confirmar()} disabled={salvando || !linhas.length}><Trash2 size={14} />{salvando ? "Descartando…" : "Descartar linhas"}</Button>
        </>
      )}
    >
      <p>Essas linhas da aba {grupo.origem} têm dados de medição, mas nenhum fornecedor. Descartadas, <strong>não irão compor os valores nem o BM do ciclo {ciclo}</strong>.</p>
      <p className="text-[var(--muted-foreground)]">Se a linha pertence a alguém, prefira preencher PROJETISTA na planilha e reimportar.</p>
      <ul className="grid max-h-48 gap-0.5 overflow-y-auto rounded-lg border border-[var(--border)] bg-[#fafaf9] p-2 text-[11px]">
        {linhas.map((l) => <li key={l.chave}>Linha {l.linha}: documento {l.numeroDocumento ?? "—"}{l.evidencia ? ` · ${l.evidencia}` : ""}</li>)}
      </ul>
      {erro && <p className="text-[var(--error)]" role="alert">{erro}</p>}
    </DialogShell>
  );
}

/** Erros estruturais que bloquearam a importação. Só "sem PROJETISTA" pode ser descartado aqui. */
export function PendenciasEstruturais({ detalhes, ciclo, podeResolver }: { detalhes: EtlUnresolvedIdentity[]; ciclo: string | null; podeResolver: boolean }) {
  const [descartando, setDescartando] = useState<EtlUnresolvedIdentity | null>(null);
  const [descartados, setDescartados] = useState<Set<string>>(new Set());
  const [mensagem, setMensagem] = useState("");
  return (
    <div className="grid gap-2 text-[var(--foreground)]" data-testid="pendencias-estruturais">
      {mensagem && (
        <p className="flex items-center gap-2 rounded-lg border border-[#cde9d5] bg-[var(--success-soft)] p-3 text-xs font-semibold text-[var(--success)]" role="status">
          <Check size={14} /> {mensagem}
        </p>
      )}
      {detalhes.map((d) => {
        const chave = `${d.status}-${d.origem}-${d.valor}`;
        const jaDescartado = descartados.has(chave);
        return (
          <div key={chave} className="grid gap-1 rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] p-3 text-xs text-[var(--error)]"
            data-testid={d.status === "SEM_PROJETISTA" ? "identidades-sem-projetista" : "identidade-bloqueio"}>
            {d.status === "SEM_PROJETISTA" ? (
              <>
                <p className="font-semibold">{d.ocorrencias} linha(s) com dados de medição sem PROJETISTA na aba {d.origem}.</p>
                <p>Corrija a planilha (preencha PROJETISTA) e reimporte, ou descarte conscientemente essas ocorrências.</p>
              </>
            ) : (
              <>
                <p className="break-all font-semibold">&quot;{d.valor}&quot; — {BLOQUEIO_LABEL[d.status] ?? d.status}</p>
                <p>{d.status === "PROJETISTA_INVALIDO" ? "A coluna PROJETISTA contém texto que não é nome de fornecedor (documento, GRD, descrição). Corrija a planilha." : "Resolva a ambiguidade no Painel Administrativo antes de reimportar."}</p>
                {!!d.candidatos?.length && <p>Candidatos: {d.candidatos.join("; ")}</p>}
              </>
            )}
            <p>{d.origem}{d.coluna ? ` · coluna ${d.coluna}` : ""} · linha(s) {d.linhas.join(", ")}{d.ocorrencias > d.linhas.length ? "…" : ""}</p>
            {!!d.exemplos?.length && (
              <ul className="grid gap-0.5 text-[11px]">
                {d.exemplos.map((e) => <li key={e.linha}>Linha {e.linha}: documento {e.numeroDocumento ?? "—"}{e.evidencia ? ` · ${e.evidencia}` : ""}</li>)}
              </ul>
            )}
            {d.status === "SEM_PROJETISTA" && podeResolver && ciclo && !!d.chaves?.length && !jaDescartado && (
              <div className="pt-1">
                <Button variant="secondary" className="h-8" onClick={() => setDescartando(d)}><Trash2 size={13} /> Descartar estas linhas</Button>
              </div>
            )}
            {jaDescartado && <p className="font-semibold text-[var(--success)]">Linhas descartadas — reimporte a medição.</p>}
          </div>
        );
      })}
      {descartando && ciclo && (
        <DescartarLinhasDialog grupo={descartando} ciclo={ciclo} onClose={() => setDescartando(null)}
          onConcluido={(msg) => {
            setDescartados((prev) => new Set(prev).add(`${descartando.status}-${descartando.origem}-${descartando.valor}`));
            setDescartando(null);
            setMensagem(msg);
          }} />
      )}
    </div>
  );
}
