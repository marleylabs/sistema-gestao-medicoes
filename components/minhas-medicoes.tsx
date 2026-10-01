"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, Circle, FileText, RotateCcw, Search, Trash2, UploadCloud, X } from "lucide-react";
import { AdminSidePanel, PanelSection } from "@/components/administrativo/admin-side-panel";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { ComposicaoPortal, PortalStatusBadge } from "@/components/portal-fornecedor";
import { Button, Card, IconButton } from "@/components/ui";
import {
  competenciaCiclo,
  eventosMedicao,
  filtrarMedicoes,
  proximoPasso,
  resumoPorStatus,
  ultimaAtualizacao,
  valoresMedicao,
} from "@/lib/minhas-medicoes";

/**
 * "Minhas Medições" do Portal do Fornecedor — acompanhamento dos BMs já aprovados (lista + detalhe
 * em painel lateral). Só apresentação: dados de GET /api/colaborador/medicoes (ordem do backend),
 * valores pelo cálculo canônico, status pelos rótulos do portal. As ações são as que já existiam:
 * enviar NF (AGUARDANDO_NF), ver NF, ver comprovante e ver o boletim.
 */

export type MedicaoAprovada = BmData & {
  id: string;
  status?: string;
  nfArquivoNome?: string | null;
  nfCarregadoAt?: string | null;
  comprovanteArquivoNome?: string | null;
  comprovanteCarregadoAt?: string | null;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const fmtData = (v: string | null | undefined) => (v ? dataCurta.format(new Date(v)) : "–");
const fmtDataHora = (v: string | null | undefined) => (v ? dataHora.format(new Date(v)) : null);

function readableFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

// ─── Lista ────────────────────────────────────────────────────────────────────

export function MinhasMedicoes({
  medicoes,
  loading,
  erro,
  fornecedorNome,
  onRecarregar,
}: {
  medicoes: MedicaoAprovada[];
  loading: boolean;
  erro: string | null;
  fornecedorNome: string;
  onRecarregar: () => void;
}) {
  const [status, setStatus] = useState("todos");
  const [busca, setBusca] = useState("");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const resumo = useMemo(() => resumoPorStatus(medicoes), [medicoes]);
  const visiveis = filtrarMedicoes(medicoes, status, busca);
  const aberta = medicoes.find((m) => m.id === abertaId) ?? null;

  if (loading && medicoes.length === 0) {
    return (
      <div aria-busy="true" data-testid="minhas-medicoes-carregando">
        <Card className="p-5">
          <p className="sr-only" role="status">Carregando medições…</p>
          <div className="grid gap-3" aria-hidden>
            {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-[#f1f1ef]" />)}
          </div>
        </Card>
      </div>
    );
  }

  if (erro) {
    return (
      <Card className="p-8 text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--error-soft)] text-[var(--error)]"><AlertCircle size={18} aria-hidden /></span>
        <h2 className="text-card-title text-[var(--foreground)]">Não foi possível carregar suas medições.</h2>
        <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">Verifique sua conexão e tente novamente.</p>
        <Button className="mt-4 h-10 px-4" onClick={onRecarregar}>Tentar novamente</Button>
      </Card>
    );
  }

  if (medicoes.length === 0) {
    return (
      <div data-testid="minhas-medicoes-vazio"><Card className="p-8 text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#f1f1ef] text-[var(--muted-foreground)]"><FileText size={18} aria-hidden /></span>
        <h2 className="text-card-title text-[var(--foreground)]">Você ainda não possui medições disponíveis.</h2>
        <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">As medições aparecem aqui depois que você aprova o boletim no Portal.</p>
      </Card></div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="minhas-medicoes">
      {/* Resumo leve = filtro por status (contagens dos status reais). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
          {[{ status: "todos", label: "Todas", total: medicoes.length }, ...resumo].map((r) => (
            <button
              key={r.status}
              type="button"
              aria-pressed={status === r.status}
              onClick={() => setStatus(r.status)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition-colors ${status === r.status ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]" : "border-[var(--border)] bg-white text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              {r.label} <span className="tabular-nums">{r.total}</span>
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:w-60">
          <span className="sr-only">Buscar por ciclo ou competência</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ciclo ou competência..." aria-label="Buscar por ciclo ou competência" className="h-9 w-full rounded-lg border border-[var(--border)] bg-white pl-8 pr-3 text-[13px] outline-none focus:border-[var(--primary)]" />
        </label>
      </div>

      {visiveis.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-[var(--muted-foreground)]">Nenhuma medição encontrada com estes filtros.</Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop: lista leve, linha inteira abre o detalhe. */}
          <table className="hidden w-full border-collapse text-[13px] md:table" data-testid="minhas-medicoes-tabela">
            <thead>
              <tr className="bg-[#fafaf8]">
                {["Ciclo", "Competência", "Status", "Total da medição", "Total a pagar", "Atualização", ""].map((h, i) => (
                  <th key={i} scope="col" className={`text-table-header border-b border-[var(--border)] px-4 py-2.5 text-[var(--muted-foreground)] ${h.startsWith("Total") ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((m) => {
                const v = valoresMedicao(m);
                return (
                  <tr
                    key={m.id}
                    tabIndex={0}
                    aria-label={`Abrir medição do ciclo ${m.ciclo}`}
                    onClick={() => setAbertaId(m.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAbertaId(m.id); } }}
                    className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[#fafaf8] focus-visible:bg-[#fafaf8]"
                    data-ciclo={m.ciclo}
                  >
                    <td className="px-4 py-3 font-technical font-semibold text-[var(--foreground)]">{m.ciclo}{m.revisaoLabel && <span className="ml-2 font-sans text-[11px] font-medium text-[var(--muted-foreground)]">{m.revisaoLabel}</span>}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{competenciaCiclo(m.ciclo) ?? "–"}</td>
                    <td className="px-4 py-3"><PortalStatusBadge status={m.status ?? ""} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-foreground)]">{brl.format(v.totalMedicao)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--foreground)]">{brl.format(v.totalAPagar)}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{fmtData(ultimaAtualizacao(m))}</td>
                    <td className="px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={16} aria-hidden /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Mobile: cards, sem tabela horizontal. */}
          <ul className="divide-y divide-[var(--border)] md:hidden" data-testid="minhas-medicoes-lista-mobile">
            {visiveis.map((m) => {
              const v = valoresMedicao(m);
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => setAbertaId(m.id)} aria-label={`Abrir medição do ciclo ${m.ciclo}`} className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left hover:bg-[#fafaf8]">
                    <span className="min-w-0">
                      <span className="block font-technical text-[14px] font-semibold text-[var(--foreground)]">Ciclo {m.ciclo}</span>
                      <span className="block text-[12px] text-[var(--muted-foreground)]">{competenciaCiclo(m.ciclo) ?? "–"}{m.revisaoLabel ? ` · ${m.revisaoLabel}` : ""}</span>
                      <span className="mt-2 block"><PortalStatusBadge status={m.status ?? ""} /></span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Total a pagar</span>
                      <span className="block text-[15px] font-bold tabular-nums text-[var(--foreground)]">{brl.format(v.totalAPagar)}</span>
                      <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">Atualizado em {fmtData(ultimaAtualizacao(m))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {aberta && (
        <DetalheMedicao medicao={aberta} fornecedorNome={fornecedorNome} onClose={() => setAbertaId(null)} onRecarregar={onRecarregar} />
      )}
    </div>
  );
}

// ─── Detalhe ──────────────────────────────────────────────────────────────────

function DetalheMedicao({ medicao: m, fornecedorNome, onClose, onRecarregar }: { medicao: MedicaoAprovada; fornecedorNome: string; onClose: () => void; onRecarregar: () => void }) {
  const [bmAberto, setBmAberto] = useState(false);
  const v = valoresMedicao(m);
  const passo = proximoPasso(m.status);
  const competencia = competenciaCiclo(m.ciclo);

  return (
    <>
      <AdminSidePanel
        eyebrow="Minhas Medições"
        title={`Ciclo ${m.ciclo}${competencia ? ` · ${competencia}` : ""}`}
        subtitle={fornecedorNome}
        meta={<><PortalStatusBadge status={m.status ?? ""} />{m.revisaoLabel && <span className="text-[12px] text-[var(--muted-foreground)]">{m.revisaoLabel}</span>}</>}
        escEnabled={!bmAberto}
        onClose={onClose}
        testId="minhas-medicoes-detalhe"
        footer={
          <Button className="h-10 w-full sm:w-auto" onClick={() => setBmAberto(true)}>
            <FileText size={15} aria-hidden />
            Ver boletim
          </Button>
        }
      >
        <PanelSection title="Valores">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Total a pagar</p>
            <p className="text-[26px] font-bold leading-tight tabular-nums text-[var(--foreground)]" data-testid="minhas-medicoes-total-pagar">{brl.format(v.totalAPagar)}</p>
          </div>
          <dl className="grid gap-1.5 text-[13px]">
            <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">Total da medição</dt><dd className="tabular-nums text-[var(--foreground)]" data-testid="minhas-medicoes-total-medicao">{brl.format(v.totalMedicao)}</dd></div>
            {v.rev !== 0 && <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">REV / Ajustes</dt><dd className="tabular-nums text-[var(--foreground)]" data-testid="minhas-medicoes-rev">{v.rev > 0 ? "+ " : ""}{brl.format(v.rev)}</dd></div>}
          </dl>
          {passo && <p role="note" className="rounded-lg border border-[var(--border)] bg-[#fafaf8] px-3 py-2 text-[13px] text-[var(--foreground)]" data-testid="minhas-medicoes-proximo-passo">{passo}</p>}
        </PanelSection>

        <PanelSection title="Nota fiscal">
          {m.status === "AGUARDANDO_NF" ? (
            <EnvioNotaFiscal onEnviada={onRecarregar} />
          ) : m.nfArquivoNome ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3.5 py-3">
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-[var(--foreground)]">Recebida</p>
                <p className="break-all text-[12px] text-[var(--muted-foreground)]">{m.nfArquivoNome}{fmtDataHora(m.nfCarregadoAt) ? ` · ${fmtDataHora(m.nfCarregadoAt)}` : ""}</p>
              </div>
              <a href={`/api/colaborador/nf/${m.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-[var(--border-strong)] px-3 text-[12px] font-semibold text-[var(--foreground)] hover:bg-[#fafaf8]">Visualizar NF</a>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--muted-foreground)]">Sem nota fiscal registrada.</p>
          )}
        </PanelSection>

        {m.status === "PAGO" && m.comprovanteArquivoNome && (
          <PanelSection title="Pagamento">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3.5 py-3">
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-[var(--foreground)]">Comprovante disponível</p>
                <p className="break-all text-[12px] text-[var(--muted-foreground)]">{m.comprovanteArquivoNome}{fmtDataHora(m.comprovanteCarregadoAt) ? ` · ${fmtDataHora(m.comprovanteCarregadoAt)}` : ""}</p>
              </div>
              <a href={`/api/colaborador/comprovante/${m.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-[var(--border-strong)] px-3 text-[12px] font-semibold text-[var(--foreground)] hover:bg-[#fafaf8]">Ver comprovante</a>
            </div>
          </PanelSection>
        )}

        <PanelSection title="Andamento">
          <ol className="grid gap-2.5" data-testid="minhas-medicoes-andamento">
            {eventosMedicao(m).map((e) => (
              <li key={e.chave} className="flex items-start gap-2.5 text-[13px]">
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${e.concluido ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`} aria-hidden>
                  {e.concluido ? <Check size={12} /> : <Circle size={8} fill="currentColor" />}
                </span>
                <span>
                  <span className="block font-medium text-[var(--foreground)]">{e.titulo}</span>
                  {e.data && <span className="block text-[12px] text-[var(--muted-foreground)]">{fmtDataHora(e.data)}</span>}
                  {!e.concluido && <span className="sr-only">(etapa atual)</span>}
                </span>
              </li>
            ))}
          </ol>
        </PanelSection>

        <div className="px-5 pb-5 sm:px-6">
          <ComposicaoPortal calculo={v} empilhado />
        </div>
      </AdminSidePanel>

      {bmAberto && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-[1px] sm:p-4 sm:pt-10" role="dialog" aria-modal="true" aria-label="Boletim de Medição">
          <div className="min-h-screen w-full max-w-5xl rounded-none bg-white shadow-2xl sm:min-h-0 sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Boletim de Medição · Ciclo {m.ciclo}</p>
              <IconButton onClick={() => setBmAberto(false)} title="Fechar boletim" aria-label="Fechar boletim"><X size={16} /></IconButton>
            </div>
            <div className="p-4 sm:p-5">
              <BoletimMedicao data={m} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Envio da NF (mesma chamada de sempre: POST /api/colaborador/nf) ─────────

function EnvioNotaFiscal({ onEnviada }: { onEnviada: () => void }) {
  const [nfFile, setNfFile] = useState<File | null>(null);
  const [nfUploading, setNfUploading] = useState(false);
  const [nfProgress, setNfProgress] = useState(0);
  const [nfError, setNfError] = useState<string | null>(null);
  const [draggingNf, setDraggingNf] = useState(false);
  const nfInputRef = useRef<HTMLInputElement | null>(null);

  function selectNfFile(file: File | null) {
    setNfError(null);
    setNfProgress(0);
    if (!file) {
      setNfFile(null);
      return;
    }
    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
    const allowedExtensions = /\.(pdf|jpg|jpeg|png)$/i;
    if (!allowedTypes.has(file.type) && !allowedExtensions.test(file.name)) {
      setNfFile(null);
      setNfError("Formato inválido. Envie PDF, JPG ou PNG.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNfFile(null);
      setNfError("A Nota Fiscal deve ter no máximo 10 MB.");
      return;
    }
    setNfFile(file);
  }

  async function uploadNf() {
    if (!nfFile) return;
    setNfUploading(true);
    setNfError(null);
    setNfProgress(4);
    const form = new FormData();
    form.append("nf", nfFile);
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/colaborador/nf");
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setNfProgress(Math.min(95, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onload = () => {
          const payload = (() => {
            try { return JSON.parse(xhr.responseText || "{}"); } catch { return {}; }
          })();
          if (xhr.status >= 200 && xhr.status < 300) {
            setNfProgress(100);
            resolve();
          } else {
            reject(new Error(payload.error ?? "Erro ao enviar a NF."));
          }
        };
        xhr.onerror = () => reject(new Error("Erro de conexão ao enviar a NF."));
        xhr.send(form);
      });
      setNfFile(null);
      onEnviada();
    } catch (error) {
      setNfError(error instanceof Error ? error.message : "Erro ao enviar a NF.");
    } finally {
      setNfUploading(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-[var(--muted-foreground)]">Arraste o arquivo ou selecione no computador. Formato aceito: PDF pesquisável, até 10 MB.</p>
      <input ref={nfInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => selectNfFile(e.target.files?.[0] ?? null)} />
      <div
        role="button"
        tabIndex={0}
        aria-label="Escolher arquivo da Nota Fiscal"
        className={`rounded-lg border border-dashed px-4 py-5 text-center transition ${draggingNf ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border-strong)] bg-white hover:bg-[#fafaf8]"}`}
        onClick={() => nfInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          nfInputRef.current?.click();
        }}
        onDragOver={(event) => { event.preventDefault(); setDraggingNf(true); }}
        onDragLeave={() => setDraggingNf(false)}
        onDrop={(event) => { event.preventDefault(); setDraggingNf(false); selectNfFile(event.dataTransfer.files?.[0] ?? null); }}
      >
        <UploadCloud size={22} className="mx-auto text-[var(--muted-foreground)]" aria-hidden />
        <p className="mt-2 text-[13px] font-semibold text-[var(--foreground)]">Clique para escolher ou arraste a Nota Fiscal</p>
        <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">PDF pesquisável</p>
      </div>
      {nfFile && (
        <div className="rounded-lg border border-[var(--border)] bg-white p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[var(--foreground)]">{nfFile.name}</p>
              <p className="text-[12px] text-[var(--muted-foreground)]">{readableFileSize(nfFile.size)}</p>
            </div>
            {nfError ? <IconButton onClick={uploadNf} title="Tentar novamente" aria-label="Tentar novamente"><RotateCcw size={15} /></IconButton> : null}
            <IconButton onClick={() => selectNfFile(null)} disabled={nfUploading} title="Remover arquivo" aria-label="Remover arquivo"><Trash2 size={15} /></IconButton>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#efefec]">
            <div className={`h-full rounded-full transition-all duration-200 ${nfError ? "bg-[var(--error)]" : "bg-[var(--success)]"}`} style={{ width: `${nfError ? 100 : nfProgress}%` }} />
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className={`flex items-center gap-1 text-[12px] ${nfError ? "text-[var(--error)]" : "text-[var(--muted-foreground)]"}`}>
              {nfError ? <AlertCircle size={13} aria-hidden /> : null}
              {nfError ?? (nfUploading ? `Enviando... ${nfProgress}%` : nfProgress === 100 ? "Arquivo enviado." : "Pronto para envio.")}
            </p>
            <Button className="h-10 w-full sm:w-auto" onClick={uploadNf} disabled={nfUploading}>
              {nfUploading ? "Enviando..." : nfError ? "Tentar novamente" : "Enviar NF"}
            </Button>
          </div>
        </div>
      )}
      {nfError && !nfFile && <p className="text-[12px] text-[var(--error)]">{nfError}</p>}
    </div>
  );
}
