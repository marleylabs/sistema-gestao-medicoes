"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, CircleSlash, FileSpreadsheet, MinusCircle, Search } from "lucide-react";
import { Badge, Button, Textarea } from "@/components/ui";
import {
  STATUS_CAMPO_LABEL,
  agruparPorDocumento,
  compararDivergencia,
  decisaoRegistrada,
  filtrarDocumentos,
  rotuloContagem,
  type AcaoDivergencia,
  type CampoComparado,
  type DivergenciaDTO,
  type StatusCampo,
} from "@/lib/divergencia-comparacao";

/**
 * Divergências da Medição — análise da conferência do fornecedor pela Equipe de Medição, por
 * DOCUMENTO (comparação campo a campo). Só apresentação: os dados vêm de GET
 * /api/admin/conferencia e as decisões chamam as mesmas rotas de sempre (incluir/descartar) via
 * `onResolver`, com nomes e consequências descritos em lib/divergencia-comparacao.ts.
 */

const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const fmtData = (v: string | null | undefined) => (v ? dataHora.format(new Date(v)) : null);

type Filtro = "todos" | "pendentes" | "resolvidos";

function StatusCampoChip({ status }: { status: StatusCampo }) {
  const estilo: Record<StatusCampo, { classe: string; icone: ReactNode }> = {
    IGUAL: { classe: "text-[var(--success)]", icone: <Check size={13} aria-hidden /> },
    DIVERGENTE: { classe: "font-semibold text-[var(--error)]", icone: <AlertTriangle size={13} aria-hidden /> },
    AUSENTE_EQUIPE: { classe: "text-[var(--warning)]", icone: <MinusCircle size={13} aria-hidden /> },
    NAO_COMPARADO: { classe: "text-[var(--muted-foreground)]", icone: <CircleSlash size={13} aria-hidden /> },
  };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[12px] ${estilo[status].classe}`} data-status-campo={status}>
      {estilo[status].icone}
      {STATUS_CAMPO_LABEL[status]}
    </span>
  );
}

function Valor({ valor, ausente, destaque }: { valor: string | null; ausente: string; destaque: boolean }) {
  if (valor === null) return <span className="italic text-[var(--muted-foreground)]">{ausente}</span>;
  return <span className={`font-technical break-all ${destaque ? "font-bold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>{valor}</span>;
}

function Comparacao({ campos }: { campos: CampoComparado[] }) {
  const ausenteEquipe = "Não existe na medição da equipe";
  const ausenteFornecedor = "Não informado pelo fornecedor";
  return (
    <>
      {/* Desktop: tabela. */}
      <table className="hidden w-full border-collapse text-[13px] md:table" data-testid="divergencia-comparacao">
        <thead>
          <tr className="bg-[#fafaf8]">
            {["Campo", "Equipe / Sistema", "Fornecedor", "Status"].map((h) => (
              <th key={h} scope="col" className="text-table-header border-b border-[var(--border)] px-3 py-2 text-left text-[var(--muted-foreground)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {campos.map((c) => {
            const destaque = c.status === "DIVERGENTE";
            return (
              <tr key={c.chave} data-campo={c.chave} data-status-campo={c.status} className={`border-b border-[var(--border)] last:border-0 ${destaque ? "bg-[var(--error-soft)]" : ""}`}>
                <th scope="row" className={`px-3 py-2 text-left font-medium ${destaque ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>{c.label}</th>
                <td className="px-3 py-2"><Valor valor={c.equipe} ausente={ausenteEquipe} destaque={destaque} /></td>
                <td className="px-3 py-2"><Valor valor={c.fornecedor} ausente={ausenteFornecedor} destaque={destaque} /></td>
                <td className="px-3 py-2"><StatusCampoChip status={c.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Mobile: um bloco por campo, sem tabela horizontal. */}
      <ul className="grid gap-2 md:hidden" data-testid="divergencia-comparacao-mobile">
        {campos.map((c) => {
          const destaque = c.status === "DIVERGENTE";
          return (
            <li key={c.chave} className={`rounded-lg border p-3 ${destaque ? "border-[#efc6c6] bg-[var(--error-soft)]" : "border-[var(--border)]"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-[var(--foreground)]">{c.label}</span>
                <StatusCampoChip status={c.status} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-3 text-[13px]">
                <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Equipe</dt><dd><Valor valor={c.equipe} ausente={ausenteEquipe} destaque={destaque} /></dd></div>
                <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Fornecedor</dt><dd><Valor valor={c.fornecedor} ausente={ausenteFornecedor} destaque={destaque} /></dd></div>
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ConfirmarDecisaoDialog({
  divergencia,
  acao,
  observacao,
  enviando,
  erro,
  onCancelar,
  onConfirmar,
}: {
  divergencia: DivergenciaDTO;
  acao: AcaoDivergencia;
  observacao: string;
  enviando: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const id = useId();
  const { campos, divergentes, tipo } = compararDivergencia(divergencia);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onCancelar(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enviando, onCancelar]);
  const criaDocumento = acao.acao === "incluir" && !divergencia.idMedicaoExistente;
  const linhas = criaDocumento ? campos.filter((c) => c.chave !== "nrVale") : divergentes;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="ds-dialog flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden sm:w-[520px] sm:max-w-[92vw]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">{acao.label}</h2>
          <p id={`${id}-d`} className="mt-1 text-[12px] text-[var(--muted-foreground)]">{acao.consequencia}</p>
        </div>
        <div className="grid min-h-0 gap-3 overflow-y-auto px-5 py-4 text-[13px]">
          {erro && <p role="alert" className="rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-3 py-2 font-medium text-[var(--error)]">{erro}</p>}
          <p><span className="text-[var(--muted-foreground)]">Documento:</span> <span className="font-technical font-semibold">{divergencia.nrVale}</span></p>
          {linhas.length > 0 && tipo !== "AMBIGUA" && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th scope="col" className="py-1 pr-2">Campo</th>
                  {!criaDocumento && <th scope="col" className="py-1 pr-2">Valor atual</th>}
                  <th scope="col" className="py-1">{criaDocumento ? "Será criado com" : "Valor adotado"}</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((c) => (
                  <tr key={c.chave} className="border-t border-[var(--border)]">
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">{c.label}</th>
                    {!criaDocumento && <td className="font-technical py-1.5 pr-2">{c.equipe ?? "—"}</td>}
                    <td className="font-technical py-1.5 font-semibold">{acao.acao === "incluir" ? c.fornecedor ?? "—" : c.equipe ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {observacao.trim() && (
            <div className="rounded-lg border border-[var(--border)] bg-[#fafaf8] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Observação da análise</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{observacao.trim()}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="border-[var(--border-strong)]! h-10 w-full sm:w-auto" onClick={onCancelar} disabled={enviando} autoFocus>Cancelar</Button>
          <Button className="h-10 w-full sm:w-auto" onClick={onConfirmar} disabled={enviando} aria-busy={enviando}>
            {enviando ? "Registrando..." : acao.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DocumentoDivergencia({
  divergencia,
  aberto,
  onAlternar,
  observacao,
  onObservacao,
  onDecidir,
  ocupado,
}: {
  divergencia: DivergenciaDTO;
  aberto: boolean;
  onAlternar: () => void;
  observacao: string;
  onObservacao: (valor: string) => void;
  onDecidir: (acao: AcaoDivergencia) => void;
  ocupado: boolean;
}) {
  const painelId = useId();
  const campoObsId = useId();
  const d = divergencia;
  const { tipo, campos, divergentes, resumo, acoes } = compararDivergencia(d);
  const pendente = d.status === "PENDENTE";
  const decisao = decisaoRegistrada(d);
  const meta = [d.fornecedor.tipo, d.fornecedor.formato, `Emissão ${campos.find((c) => c.chave === "percentualEmissao")?.fornecedor ?? "—"}`].filter(Boolean).join(" · ");

  return (
    <li className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]" data-testid="divergencia-documento" data-nr-vale={d.nrVale} data-status={d.status}>
      <button type="button" className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fafaf8]" onClick={onAlternar} aria-expanded={aberto} aria-controls={painelId}>
        <span className="min-w-0">
          <span className="block break-all font-technical text-[14px] font-bold text-[var(--foreground)]">{d.nrVale}</span>
          <span className="mt-0.5 block text-[12px] text-[var(--muted-foreground)]">{meta}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {pendente ? <Badge variant="warning">Pendente</Badge> : <Badge variant="success">Resolvido</Badge>}
          <span className={`inline-flex items-center gap-1 text-[12px] ${pendente ? "font-semibold text-[var(--error)]" : "text-[var(--muted-foreground)]"}`}>
            {pendente && <AlertTriangle size={12} aria-hidden />}
            {rotuloContagem(tipo, divergentes.length)}
          </span>
          <ChevronDown size={16} aria-hidden className={`text-[var(--muted-foreground)] transition-transform ${aberto ? "rotate-180" : ""}`} />
        </span>
      </button>

      {aberto && (
        <div id={painelId} className="grid gap-4 border-t border-[var(--border)] px-4 py-4">
          <p role="note" className={`rounded-lg border px-3 py-2 text-[13px] ${pendente ? "border-[#f2dbb7] bg-[var(--warning-soft)] text-[var(--foreground)]" : "border-[var(--border)] bg-[#fafaf8] text-[var(--muted-foreground)]"}`} data-testid="divergencia-resumo">
            {resumo}
          </p>

          <Comparacao campos={campos} />

          {pendente ? (
            <>
              <div className="grid gap-1.5">
                <label htmlFor={campoObsId} className="text-label text-[var(--foreground)]">Observação da análise</label>
                <Textarea id={campoObsId} className="min-h-[60px]" placeholder="Registre o motivo da decisão, se necessário..." value={observacao} onChange={(e) => onObservacao(e.target.value)} />
                <p className="text-helper text-[var(--muted-foreground)]">
                  Obrigatória para “{acoes.equipe.label}” — o motivo aparece para o fornecedor. Opcional para “{acoes.fornecedor.label}”.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {([["Lado da equipe", acoes.equipe], ["Lado do fornecedor", acoes.fornecedor]] as const).map(([lado, acao]) => {
                  const bloqueada = acao.exigeObservacao && !observacao.trim();
                  return (
                    <div key={acao.acao} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{lado}</p>
                      <p className="text-[12px] text-[var(--muted-foreground)]">{acao.consequencia}</p>
                      <Button
                        variant="secondary"
                        className="border-[var(--border-strong)]! mt-auto h-10 w-full sm:w-auto sm:self-start"
                        onClick={() => onDecidir(acao)}
                        disabled={ocupado || bloqueada}
                        title={bloqueada ? "Informe a observação da análise (motivo) para esta decisão" : undefined}
                        data-acao={acao.acao}
                      >
                        {acao.label}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <dl className="grid gap-2 rounded-lg border border-[var(--border)] bg-[#fafaf8] p-3 text-[13px] sm:grid-cols-2" data-testid="divergencia-decisao">
              <div><dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Decisão</dt><dd className="font-semibold text-[var(--foreground)]">{decisao?.label ?? d.status}</dd></div>
              {tipo === "CAMPOS" && divergentes.length > 0 && (
                <div><dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Valor adotado</dt><dd className="font-technical">{divergentes.map((c) => `${c.label}: ${(d.status === "INCLUIDA" ? c.fornecedor : c.equipe) ?? "—"}`).join(" · ")}</dd></div>
              )}
              <div className="sm:col-span-2"><dt className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{d.status === "DESCARTADA" ? "Motivo" : "Observação"}</dt><dd className="whitespace-pre-wrap break-words">{d.observacao || "—"}</dd></div>
              <div className="sm:col-span-2 text-[12px] text-[var(--muted-foreground)]">
                Resolvido por {d.resolvidoPorNome ?? "—"}{d.resolvidoEm ? ` em ${fmtData(d.resolvidoEm)}` : ""}
              </div>
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

export function DivergenciasMedicao({
  divergencias,
  erro,
  onRecarregar,
  onResolver,
}: {
  divergencias: DivergenciaDTO[];
  erro: string | null;
  onRecarregar: () => void;
  /** Chama a rota de sempre; devolve a mensagem de erro do backend, ou null em sucesso. */
  onResolver: (id: string, acao: "incluir" | "descartar", observacao: string) => Promise<string | null>;
}) {
  const { documentos, total, pendentes, resolvidos } = useMemo(() => agruparPorDocumento(divergencias), [divergencias]);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [observacoes, setObservacoes] = useState<Record<string, string>>({});
  const [confirmacao, setConfirmacao] = useState<{ id: string; acao: AcaoDivergencia } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroDialogo, setErroDialogo] = useState<string | null>(null);
  const enviandoRef = useRef(false);
  const inicializado = useRef(false);

  // Primeiro pendente aberto; demais (e todos os resolvidos) recolhidos — nunca escondidos.
  useEffect(() => {
    if (inicializado.current || documentos.length === 0) return;
    inicializado.current = true;
    const primeiro = documentos.find((d) => d.status === "PENDENTE");
    if (primeiro) setAbertos(new Set([primeiro.id]));
  }, [documentos]);

  const visiveis = filtrarDocumentos(documentos, filtro, busca);
  const arquivo = divergencias.find((d) => d.arquivo?.nome)?.arquivo ?? null;
  const confirmando = confirmacao ? documentos.find((d) => d.id === confirmacao.id) ?? null : null;

  function alternar(id: string) {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  async function confirmar() {
    if (!confirmacao || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErroDialogo(null);
    const falha = await onResolver(confirmacao.id, confirmacao.acao.acao, observacoes[confirmacao.id]?.trim() ?? "");
    enviandoRef.current = false;
    setEnviando(false);
    if (falha) { setErroDialogo(falha); return; }
    const resolvido = confirmacao.id;
    setConfirmacao(null);
    // Recolhe o resolvido e abre o próximo pendente.
    const proximo = documentos.find((d) => d.status === "PENDENTE" && d.id !== resolvido);
    setAbertos((atual) => {
      const novo = new Set(atual);
      novo.delete(resolvido);
      if (proximo) novo.add(proximo.id);
      return novo;
    });
  }

  if (erro) {
    return (
      <div className="grid gap-2" data-testid="divergencias-medicao">
        <h3 className="text-card-title text-[var(--foreground)]">Divergências da Medição</h3>
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-3 py-2 text-[13px] text-[var(--error)]">
          {erro}
          <Button variant="secondary" className="border-[var(--border-strong)]! h-8 px-3 text-xs" onClick={onRecarregar}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  const filtros: Array<[Filtro, string, number]> = [["todos", "Todos", total], ["pendentes", "Pendentes", pendentes], ["resolvidos", "Resolvidos", resolvidos]];

  return (
    <div className="grid gap-3" data-testid="divergencias-medicao">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-card-title text-[var(--foreground)]">Divergências da Medição</h3>
          <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]" data-testid="divergencias-resumo">
            {total} documento{total !== 1 ? "s" : ""} com divergência · {pendentes} pendente{pendentes !== 1 ? "s" : ""} · {resolvidos} resolvido{resolvidos !== 1 ? "s" : ""}
          </p>
          {pendentes === 0 && total > 0 && <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--success)]"><Check size={13} aria-hidden />Todas as divergências foram resolvidas.</p>}
        </div>
        {arquivo?.nome && (
          <p className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]" data-testid="divergencias-arquivo">
            <FileSpreadsheet size={14} aria-hidden />
            <span className="break-all">{arquivo.nome}</span>
            {arquivo.carregadoEm && <span>· enviado em {fmtData(arquivo.carregadoEm)}</span>}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-full rounded-lg border border-[var(--border)] bg-white p-0.5 sm:w-auto" role="group" aria-label="Filtrar documentos">
          {filtros.map(([valor, label, n]) => (
            <button key={valor} type="button" aria-pressed={filtro === valor} onClick={() => setFiltro(valor)} className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors sm:flex-none ${filtro === valor ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
              {label} <span className="tabular-nums">({n})</span>
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Buscar documento por NR VALE</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar documento..." aria-label="Buscar documento por NR VALE" className="h-9 w-full rounded-lg border border-[var(--border)] bg-white pl-8 pr-3 text-[13px] outline-none focus:border-[var(--primary)]" />
        </label>
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[13px] text-[var(--muted-foreground)]">Nenhum documento neste filtro.</p>
      ) : (
        <ul className="grid gap-2">
          {visiveis.map((d) => (
            <DocumentoDivergencia
              key={d.id}
              divergencia={d}
              aberto={abertos.has(d.id)}
              onAlternar={() => alternar(d.id)}
              observacao={observacoes[d.id] ?? ""}
              onObservacao={(valor) => setObservacoes((atual) => ({ ...atual, [d.id]: valor }))}
              onDecidir={(acao) => { setErroDialogo(null); setConfirmacao({ id: d.id, acao }); }}
              ocupado={enviando}
            />
          ))}
        </ul>
      )}

      {confirmacao && confirmando && (
        <ConfirmarDecisaoDialog
          divergencia={confirmando}
          acao={confirmacao.acao}
          observacao={observacoes[confirmacao.id] ?? ""}
          enviando={enviando}
          erro={erroDialogo}
          onCancelar={() => { if (!enviandoRef.current) setConfirmacao(null); }}
          onConfirmar={() => void confirmar()}
        />
      )}
    </div>
  );
}
