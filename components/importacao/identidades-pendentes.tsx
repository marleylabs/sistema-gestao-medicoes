"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Link2, Search, UserPlus } from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { pareceNomeDeFornecedor } from "@/lib/identidade-plausivel";

/** Detalhe de identidade do etl UnresolvedIdentityError (ver etl/ingest_medicoes.py). */
export type EtlUnresolvedIdentity = {
  valor: string;
  origem: string;
  coluna?: string;
  ciclo?: string;
  status: "NAO_RESOLVIDO" | "AMBIGUO" | "CONFLITO_ALIAS" | "SEM_PROJETISTA";
  candidatos?: string[];
  ocorrencias: number;
  linhas: number[];
  sugestoesCadastro?: string[];
  exemplos?: Array<{ linha: number; numeroDocumento: string | null; evidencia: string | null }>;
};

type Alvo = { profissionalId: string; codigo: string; responsavel: string; razaoSocial: string | null };
type Resolucao =
  | { status: "RESOLVIDO"; via: "CODIGO" | "ALIAS" | "NOME_LEGADO"; profissionalId: string; codigoCanonico: string }
  | { status: "NAO_RESOLVIDO"; valor: string }
  | { status: "AMBIGUO"; valor: string; candidatos: Array<{ profissionalId: string; codigoCanonico: string }> };
type Verificada = { valor: string; resolucao: Resolucao; mesmoNomeNormalizado: Alvo | null };

type Filtro = "TODOS" | "COM_SUGESTAO" | "SEM_SUGESTAO" | "RESOLVIDOS";
const FILTROS: Array<{ id: Filtro; label: string }> = [
  { id: "TODOS", label: "Todos" },
  { id: "COM_SUGESTAO", label: "Com sugestão" },
  { id: "SEM_SUGESTAO", label: "Sem sugestão" },
  { id: "RESOLVIDOS", label: "Resolvidos" },
];

const STATUS_LABEL: Record<EtlUnresolvedIdentity["status"], string> = {
  NAO_RESOLVIDO: "não encontrado",
  AMBIGUO: "ambíguo",
  CONFLITO_ALIAS: "código já é alias de outro fornecedor",
  SEM_PROJETISTA: "sem PROJETISTA",
};

const LINHAS_VISIVEIS = 5;

type Dialogo =
  | { tipo: "vincular"; item: EtlUnresolvedIdentity; alvo: Alvo; origemSugestao: string }
  | { tipo: "escolher"; item: EtlUnresolvedIdentity }
  | { tipo: "novo"; item: EtlUnresolvedIdentity };

function chave(item: EtlUnresolvedIdentity) {
  return `${item.origem}::${item.valor}`;
}

/**
 * Resolução das identidades que bloquearam a importação. Nada é aplicado sem clique explícito:
 * sugestões são só sugestões; "Vincular" cria um alias (ADMIN, revalidado no servidor); "Novo"
 * abre o cadastro oficial do Painel Administrativo só com o nome preenchido. Nunca reimporta
 * sozinho — quando tudo resolve, pede a reimportação.
 */
export function IdentidadesPendentes({
  detalhes,
  ciclo,
  onNovoFornecedor,
}: {
  detalhes: EtlUnresolvedIdentity[];
  ciclo?: string | null;
  onNovoFornecedor?: (nome: string) => void;
}) {
  const semProjetista = detalhes.filter((d) => d.status === "SEM_PROJETISTA");
  const identidades = useMemo(
    () => detalhes.filter((d) => d.status !== "SEM_PROJETISTA").sort((a, b) => b.ocorrencias - a.ocorrencias || a.valor.localeCompare(b.valor)),
    [detalhes],
  );
  const [verificadas, setVerificadas] = useState<Record<string, Verificada>>({});
  const [alvosSugestao, setAlvosSugestao] = useState<Record<string, Alvo | null>>({});
  const [podeResolver, setPodeResolver] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [toast, setToast] = useState("");

  const verificar = useCallback(async () => {
    if (!identidades.length) { setCarregando(false); return; }
    try {
      const res = await fetch("/api/admin/importacao/identidades/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valores: identidades.map((i) => i.valor),
          sugestoes: [...new Set(identidades.flatMap((i) => i.sugestoesCadastro ?? []))],
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) { setErro(payload?.error ?? "Não foi possível verificar as identidades."); return; }
      setVerificadas(Object.fromEntries((payload.identidades as Verificada[]).map((v) => [v.valor, v])));
      setAlvosSugestao(payload.sugestoes ?? {});
      setPodeResolver(Boolean(payload.podeResolver));
      setErro("");
    } catch {
      setErro("Não foi possível verificar as identidades.");
    } finally {
      setCarregando(false);
    }
  }, [identidades]);

  useEffect(() => { void verificar(); }, [verificar]);

  const resolvido = useCallback((item: EtlUnresolvedIdentity) => verificadas[item.valor]?.resolucao.status === "RESOLVIDO", [verificadas]);

  /** Sugestão vinculável: rótulo do ETL que aponta para UM fornecedor; ou o mesmo nome normalizado. */
  const sugestaoDe = useCallback((item: EtlUnresolvedIdentity): { alvo: Alvo; rotulo: string } | null => {
    for (const rotulo of item.sugestoesCadastro ?? []) {
      const alvo = alvosSugestao[rotulo];
      if (alvo) return { alvo, rotulo };
    }
    const igual = verificadas[item.valor]?.mesmoNomeNormalizado;
    return igual ? { alvo: igual, rotulo: igual.responsavel } : null;
  }, [alvosSugestao, verificadas]);

  const pendentes = identidades.filter((i) => !resolvido(i));
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = identidades.filter((item) => {
    if (termo && !`${item.valor} ${(item.sugestoesCadastro ?? []).join(" ")}`.toLocaleLowerCase("pt-BR").includes(termo)) return false;
    if (filtro === "RESOLVIDOS") return resolvido(item);
    if (resolvido(item)) return filtro === "TODOS";
    if (filtro === "COM_SUGESTAO") return Boolean(sugestaoDe(item) || item.sugestoesCadastro?.length);
    if (filtro === "SEM_SUGESTAO") return !sugestaoDe(item) && !item.sugestoesCadastro?.length;
    return true;
  });
  const tudoResolvido = !carregando && !erro && identidades.length > 0 && pendentes.length === 0 && semProjetista.length === 0;

  function alternar(k: string) {
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function aposVincular(mensagem: string) {
    setDialogo(null);
    setToast(mensagem);
    await verificar();
  }

  return (
    <div className="grid gap-3 text-[var(--foreground)]" data-testid="identidades-pendentes">
      {semProjetista.map((d) => (
        <div key={d.origem} className="grid gap-1 rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] p-3 text-xs text-[var(--error)]" data-testid="identidades-sem-projetista">
          <p className="font-semibold">
            {d.ocorrencias} linha(s) de medição sem PROJETISTA na aba {d.origem}.
          </p>
          <p>Preencha a coluna PROJETISTA dessas linhas na planilha e reimporte. Elas não são fornecedores e não podem ser vinculadas aqui.</p>
          <p>Linha(s): {d.linhas.join(", ")}{d.ocorrencias > d.linhas.length ? "…" : ""}</p>
          {!!d.exemplos?.length && (
            <ul className="grid gap-0.5 text-[11px]">
              {d.exemplos.map((e) => (
                <li key={e.linha}>Linha {e.linha}: documento {e.numeroDocumento ?? "—"}{e.evidencia ? ` · ${e.evidencia}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {identidades.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold" data-testid="identidades-contador">
              {carregando ? "Verificando identidades…" : `${pendentes.length} de ${identidades.length} identidade(s) pendente(s)`}
            </p>
            {!podeResolver && !carregando && (
              <p className="text-[11px] text-[var(--muted-foreground)]">Somente o perfil ADMIN pode vincular ou cadastrar fornecedores.</p>
            )}
          </div>

          {tudoResolvido && (
            <div className="flex items-center gap-2 rounded-lg border border-[#cde9d5] bg-[var(--success-soft)] p-3 text-xs font-semibold text-[var(--success)]" data-testid="identidades-todas-resolvidas">
              <Check size={14} />
              Todas as identidades foram resolvidas. Reimporte a medição.
            </div>
          )}
          {erro && <p className="rounded-lg bg-[var(--error-soft)] p-3 text-xs text-[var(--error)]">{erro}</p>}
          {toast && <p className="rounded-lg bg-[var(--success-soft)] p-3 text-xs text-[var(--success)]" role="status">{toast}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input aria-label="Buscar identidade" placeholder="Buscar nome" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar identidades">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filtro === f.id}
                  onClick={() => setFiltro(f.id)}
                  className={`h-8 rounded-lg border px-2.5 text-[11px] font-semibold transition ${filtro === f.id ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]" : "border-[var(--border)] bg-white text-[#555555] hover:border-[var(--border-strong)]"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <ul className="grid gap-2" data-testid="etl-identidades-nao-resolvidas">
            {visiveis.map((item) => {
              const k = chave(item);
              const aberto = abertos.has(k);
              const ok = resolvido(item);
              const verificada = verificadas[item.valor];
              const sugestao = ok ? null : sugestaoDe(item);
              const plausivel = pareceNomeDeFornecedor(item.valor);
              const acionavel = podeResolver && !ok && plausivel && item.status === "NAO_RESOLVIDO";
              const linhasVisiveis = aberto ? item.linhas : item.linhas.slice(0, LINHAS_VISIVEIS);
              return (
                <li key={k}>
                  <Card className="grid gap-2 p-3" >
                    <div className="flex items-start gap-2" data-testid="identidade-card" data-valor={item.valor}>
                      <button
                        type="button"
                        className="mt-0.5 text-[var(--muted-foreground)]"
                        aria-expanded={aberto}
                        aria-label={aberto ? `Recolher ${item.valor}` : `Expandir ${item.valor}`}
                        onClick={() => alternar(k)}
                      >
                        {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <div className="grid min-w-0 flex-1 gap-1 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all text-[13px] font-semibold">{item.valor}</span>
                          {ok ? (
                            <Badge variant="success">Resolvido</Badge>
                          ) : (
                            <Badge variant={item.status === "NAO_RESOLVIDO" ? "warning" : "danger"}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
                          )}
                          <span className="text-[var(--muted-foreground)]">{item.ocorrencias} ocorrência(s)</span>
                        </div>
                        <p className="text-[var(--muted-foreground)]">
                          {item.origem}{item.coluna ? ` · coluna ${item.coluna}` : ""}
                          {linhasVisiveis.length ? ` · linha(s) ${linhasVisiveis.join(", ")}` : ""}
                          {!aberto && item.linhas.length > LINHAS_VISIVEIS ? "…" : ""}
                          {aberto && item.ocorrencias > item.linhas.length ? ` (mostrando ${item.linhas.length} de ${item.ocorrencias})` : ""}
                        </p>
                        {ok && verificada?.resolucao.status === "RESOLVIDO" && (
                          <p className="text-[var(--success)]">→ {verificada.resolucao.codigoCanonico}</p>
                        )}
                        {!ok && !!item.sugestoesCadastro?.length && (
                          <p className="text-[#92400E]">Sugestão (não aplicada): {item.sugestoesCadastro.join("; ")}</p>
                        )}
                        {!ok && !item.sugestoesCadastro?.length && sugestao && (
                          <p className="text-[#92400E]">Sugestão (não aplicada): {sugestao.alvo.responsavel} (mesmo nome normalizado)</p>
                        )}
                        {!ok && !!item.candidatos?.length && <p>Candidatos: {item.candidatos.join("; ")}</p>}
                        {!ok && item.status !== "NAO_RESOLVIDO" && (
                          <p className="text-[var(--muted-foreground)]">Resolva o conflito no Painel Administrativo antes de reimportar.</p>
                        )}
                        {!ok && !plausivel && (
                          <p className="flex items-center gap-1 text-[var(--error)]" data-testid="identidade-nao-parece-nome">
                            <AlertTriangle size={12} />
                            Não parece nome de fornecedor — corrija a coluna {item.coluna ?? "PROJETISTA"} na planilha.
                          </p>
                        )}
                      </div>
                    </div>
                    {acionavel && (
                      <div className="flex flex-wrap gap-2 pl-6">
                        {sugestao && (
                          <Button variant="outline" className="h-8" onClick={() => setDialogo({ tipo: "vincular", item, alvo: sugestao.alvo, origemSugestao: sugestao.rotulo })}>
                            <Link2 size={13} /> Vincular à sugestão
                          </Button>
                        )}
                        <Button variant="secondary" className="h-8" onClick={() => setDialogo({ tipo: "escolher", item })}>
                          <Search size={13} /> Escolher fornecedor
                        </Button>
                        {onNovoFornecedor && (
                          <Button variant="ghost" className="h-8" onClick={() => setDialogo({ tipo: "novo", item })}>
                            <UserPlus size={13} /> Confirmar como novo fornecedor
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
            {!visiveis.length && !carregando && (
              <li className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--muted-foreground)]">Nenhuma identidade neste filtro.</li>
            )}
          </ul>
        </>
      )}

      {dialogo?.tipo === "vincular" && (
        <ConfirmarVinculoDialog
          item={dialogo.item}
          alvo={dialogo.alvo}
          ciclo={ciclo}
          onClose={() => setDialogo(null)}
          onVinculado={(msg) => void aposVincular(msg)}
        />
      )}
      {dialogo?.tipo === "escolher" && (
        <EscolherFornecedorDialog
          item={dialogo.item}
          ciclo={ciclo}
          onClose={() => setDialogo(null)}
          onVinculado={(msg) => void aposVincular(msg)}
        />
      )}
      {dialogo?.tipo === "novo" && onNovoFornecedor && (
        <DialogShell titulo="Confirmar como novo fornecedor" onClose={() => setDialogo(null)} testId="identidade-novo-dialog"
          footer={(
            <>
              <Button variant="secondary" onClick={() => setDialogo(null)}>Cancelar</Button>
              <Button onClick={() => { const nome = dialogo.item.valor; setDialogo(null); onNovoFornecedor(nome); }}>
                <UserPlus size={14} /> Abrir cadastro
              </Button>
            </>
          )}
        >
          <p>&quot;{dialogo.item.valor}&quot; não corresponde a nenhum fornecedor cadastrado.</p>
          <p>O cadastro do Painel Administrativo será aberto com o nome preenchido. Complete os dados obrigatórios (CNPJ, condições) e salve; depois volte aqui e reimporte a medição.</p>
          <p className="text-[var(--muted-foreground)]">Se for uma pessoa já cadastrada com outro nome, use &quot;Escolher fornecedor&quot;.</p>
        </DialogShell>
      )}
    </div>
  );
}

function DialogShell({
  titulo,
  children,
  footer,
  onClose,
  busy = false,
  testId,
}: {
  titulo: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  testId: string;
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
          <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">{titulo}</h2>
        </div>
        <div className="grid min-h-0 gap-2 overflow-y-auto px-5 py-4 text-[13px] text-[var(--foreground)]">{children}</div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

function useCriarAlias(item: EtlUnresolvedIdentity, ciclo: string | null | undefined, onVinculado: (msg: string) => void) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const travaRef = useRef(false);
  async function criar(alvo: Alvo) {
    // Trava síncrona: duplo clique nunca dispara duas requisições (o servidor também é idempotente).
    if (travaRef.current) return;
    travaRef.current = true;
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/admin/importacao/identidades/alias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: item.valor, profissionalId: alvo.profissionalId, aba: item.origem, ciclo: ciclo ?? item.ciclo ?? null, linhas: item.linhas }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) { setErro(payload?.error ?? "Não foi possível vincular o nome."); return; }
      onVinculado(payload?.status === "JA_EXISTE"
        ? `"${item.valor}" já estava vinculado a ${payload.codigoCanonico}.`
        : `"${item.valor}" vinculado a ${payload?.codigoCanonico ?? alvo.codigo}.`);
    } catch {
      setErro("Não foi possível vincular o nome.");
    } finally {
      travaRef.current = false;
      setSalvando(false);
    }
  }
  return { salvando, erro, criar };
}

function ResumoVinculo({ item, alvo }: { item: EtlUnresolvedIdentity; alvo: Alvo }) {
  return (
    <div className="grid gap-1 rounded-lg border border-[var(--border)] bg-[#fafaf9] p-3 text-xs">
      <p><span className="text-[var(--muted-foreground)]">Nome na planilha:</span> <strong>{item.valor}</strong> ({item.origem}, {item.ocorrencias} ocorrência(s))</p>
      <p><span className="text-[var(--muted-foreground)]">Fornecedor:</span> <strong>{alvo.responsavel}</strong></p>
      <p><span className="text-[var(--muted-foreground)]">Código:</span> {alvo.codigo}{alvo.razaoSocial ? ` · ${alvo.razaoSocial}` : ""}</p>
    </div>
  );
}

function ConfirmarVinculoDialog({ item, alvo, ciclo, onClose, onVinculado }: {
  item: EtlUnresolvedIdentity; alvo: Alvo; ciclo?: string | null; onClose: () => void; onVinculado: (msg: string) => void;
}) {
  const { salvando, erro, criar } = useCriarAlias(item, ciclo, onVinculado);
  return (
    <DialogShell titulo="Vincular à sugestão" onClose={onClose} busy={salvando} testId="identidade-vincular-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void criar(alvo)} disabled={salvando}><Link2 size={14} />{salvando ? "Vinculando…" : "Confirmar vínculo"}</Button>
        </>
      )}
    >
      <p>Confirme que é a <strong>mesma pessoa/empresa</strong>. A sugestão vem de nome parecido e nunca é aplicada sozinha.</p>
      <ResumoVinculo item={item} alvo={alvo} />
      <p className="text-[var(--muted-foreground)]">O nome da planilha vira um alias do fornecedor; o nome e o código do cadastro não mudam.</p>
      {erro && <p className="text-[var(--error)]" role="alert">{erro}</p>}
    </DialogShell>
  );
}

function EscolherFornecedorDialog({ item, ciclo, onClose, onVinculado }: {
  item: EtlUnresolvedIdentity; ciclo?: string | null; onClose: () => void; onVinculado: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Alvo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscaErro, setBuscaErro] = useState("");
  const [escolhido, setEscolhido] = useState<Alvo | null>(null);
  const { salvando, erro, criar } = useCriarAlias(item, ciclo, onVinculado);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) { setResultados([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/admin/importacao/identidades/fornecedores?q=${encodeURIComponent(termo)}`, { signal: controller.signal });
        const payload = await res.json().catch(() => null);
        if (!res.ok) { setBuscaErro(payload?.error ?? "Não foi possível buscar fornecedores."); return; }
        setResultados(payload?.fornecedores ?? []);
        setBuscaErro("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setBuscaErro("Não foi possível buscar fornecedores.");
      } finally {
        setBuscando(false);
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [q]);

  return (
    <DialogShell titulo="Escolher fornecedor" onClose={onClose} busy={salvando} testId="identidade-escolher-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={escolhido ? () => setEscolhido(null) : onClose} disabled={salvando}>{escolhido ? "Voltar" : "Cancelar"}</Button>
          <Button onClick={() => escolhido && void criar(escolhido)} disabled={!escolhido || salvando}><Link2 size={14} />{salvando ? "Vinculando…" : "Confirmar vínculo"}</Button>
        </>
      )}
    >
      {escolhido ? (
        <>
          <p>Confirme que é a <strong>mesma pessoa/empresa</strong>.</p>
          <ResumoVinculo item={item} alvo={escolhido} />
          <p className="text-[var(--muted-foreground)]">O nome da planilha vira um alias do fornecedor; o nome e o código do cadastro não mudam.</p>
        </>
      ) : (
        <>
          <p>Vincular <strong>&quot;{item.valor}&quot;</strong> a um fornecedor cadastrado. Busque por nome, código ou razão social.</p>
          <Input autoFocus aria-label="Buscar fornecedor" placeholder="Nome, código ou razão social" value={q} onChange={(e) => setQ(e.target.value)} />
          {buscando && <p className="text-xs text-[var(--muted-foreground)]">Buscando…</p>}
          {buscaErro && <p className="text-xs text-[var(--error)]">{buscaErro}</p>}
          {!buscando && q.trim().length >= 2 && !resultados.length && !buscaErro && (
            <p className="text-xs text-[var(--muted-foreground)]">Nenhum fornecedor ativo encontrado.</p>
          )}
          <ul className="grid gap-1" data-testid="identidade-busca-resultados">
            {resultados.map((r) => (
              <li key={r.profissionalId}>
                <button type="button" onClick={() => setEscolhido(r)}
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left text-xs transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]">
                  <span className="block font-semibold">{r.responsavel}</span>
                  <span className="block text-[var(--muted-foreground)]">{r.codigo}{r.razaoSocial ? ` · ${r.razaoSocial}` : ""}</span>
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
