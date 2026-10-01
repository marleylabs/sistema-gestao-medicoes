"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Clock, MessageCircle, XCircle } from "lucide-react";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { formatCicloLabel } from "@/lib/ciclo";
import type { CalculoBoletim, DocumentoBoletim } from "@/lib/boletim-calculo";
import { getPortalStatusMeta } from "@/lib/portal-fornecedor";

/**
 * Peças visuais do Portal do Fornecedor (components/colaborador-app.tsx). Só apresentação: estado,
 * chamadas de API e regras continuam em ColaboradorApp; status vem de lib/portal-fornecedor.ts e
 * TODOS os valores do BM vêm do cálculo canônico (lib/boletim-calculo.ts), recebido pronto.
 */

/** Documento como o Portal recebe de GET /api/colaborador/me (campos usados na lista). */
export type DocumentoPortal = DocumentoBoletim & {
  id: string;
  formato: string | null;
  equivalenteA1Horas: number;
  percentualEmissao: number;
  condicao: string | null;
  precoUnitario: number;
  obs: string | null;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percentual = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatDataHora(value: string | null | undefined) {
  return value ? dataHora.format(new Date(value)) : null;
}

function competencia(ciclo: string) {
  try {
    return formatCicloLabel(ciclo);
  } catch {
    return null;
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function PortalStatusBadge({ status }: { status: string }) {
  const { label, badge } = getPortalStatusMeta(status);
  const Icone = badge === "success" ? CheckCircle2 : status === "CANCELADO" ? XCircle : status === "REVISAO_SOLICITADA" ? MessageCircle : Clock;
  return (
    <Badge variant={badge} className="h-6 shrink-0 px-2.5 text-[11px]">
      <span className="inline-flex items-center gap-1" data-testid="portal-status">
        <Icone size={12} aria-hidden />
        {label}
      </span>
    </Badge>
  );
}

// ─── Resumo principal ─────────────────────────────────────────────────────────

function Dado({ label, children, technical, largo }: { label: string; children: ReactNode; technical?: boolean; largo?: boolean }) {
  return (
    <div className={`min-w-0 ${largo ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
      <dd className={`mt-0.5 break-words text-[13px] font-medium text-[var(--foreground)] ${technical ? "font-technical" : ""}`}>{children}</dd>
    </div>
  );
}

export function BoletimResumoPortal({
  nome,
  codigo,
  ciclo,
  revisaoLabel,
  status,
  totalMedicao,
  rev,
  totalAPagar,
  documento,
  razaoSocial,
  email,
}: {
  nome: string;
  codigo: string;
  ciclo: string;
  revisaoLabel: string | null;
  status: string;
  totalMedicao: number;
  rev: number;
  totalAPagar: number;
  documento: string | null;
  razaoSocial: string | null;
  email: string | null;
}) {
  const mes = competencia(ciclo);
  return (
    <Card className="overflow-hidden">
      <section className="p-5 sm:p-6" aria-labelledby="portal-bm-titulo" data-testid="portal-bm-resumo">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow text-[var(--primary)]">Boletim de Medição</p>
            <h2 id="portal-bm-titulo" className="mt-1 break-words text-section-title text-[var(--foreground)]">{nome}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--muted-foreground)]">
              <span>Ciclo <span className="font-technical font-semibold text-[var(--foreground)]">{ciclo}</span></span>
              {mes && <><span aria-hidden>·</span><span>{mes}</span></>}
              {revisaoLabel && <Badge variant="brand">{revisaoLabel}</Badge>}
            </p>
          </div>
          <PortalStatusBadge status={status} />
        </div>

        <div className="mt-5 grid gap-5 border-t border-[var(--border)] pt-5 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] md:gap-8">
          <div>
            <p className="text-stat-label uppercase tracking-wide text-[var(--muted-foreground)]">Total da medição</p>
            <p className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.01em] text-[var(--foreground)] tabular-nums" data-testid="portal-bm-valor">
              {brl.format(totalMedicao)}
            </p>
            {rev !== 0 && (
              <dl className="mt-2 grid gap-1 text-[12px]">
                <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">REV / Ajustes</dt><dd className="tabular-nums text-[var(--foreground)]" data-testid="portal-bm-rev">{brl.format(rev)}</dd></div>
                <div className="flex justify-between gap-4 font-semibold"><dt className="text-[var(--foreground)]">Total a pagar</dt><dd className="tabular-nums text-[var(--foreground)]" data-testid="portal-bm-total-pagar">{brl.format(totalAPagar)}</dd></div>
              </dl>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Dado label="ID" technical>{codigo}</Dado>
            <Dado label="CPF / CNPJ" technical>{documento || "Cadastro em atualização"}</Dado>
            <Dado label="Razão social" largo>{razaoSocial || "Cadastro em atualização"}</Dado>
            <Dado label="E-mail" largo>{email || "Cadastro em atualização"}</Dado>
          </dl>
        </div>
      </section>
    </Card>
  );
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export function PortalFeedback({ message }: { message: { text: string; type: "success" | "info" } | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={`mt-4 flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] font-medium ${
        message.type === "success"
          ? "border-[#cde9d5] bg-[var(--success-soft)] text-[var(--success)]"
          : "border-[var(--border)] bg-[#fafaf8] text-[var(--foreground)]"
      }`}
    >
      {message.type === "success" && <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />}
      <span>{message.text}</span>
    </div>
  );
}

/** Cabeçalho de um estado já concluído (aprovado, revisão solicitada, cancelado...) — ícone + texto, nunca só cor. */
export function EstadoConcluido({
  tone,
  titulo,
  detalhe,
  children,
}: {
  tone: "success" | "warning" | "neutral";
  titulo: string;
  detalhe?: string | null;
  children?: ReactNode;
}) {
  const Icone = tone === "success" ? CheckCircle2 : tone === "warning" ? MessageCircle : XCircle;
  const cor = tone === "success" ? "bg-[var(--success-soft)] text-[var(--success)]" : tone === "warning" ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[#f1f1ef] text-[var(--muted-foreground)]";
  return (
    <div className="flex items-start gap-3">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cor}`}>
        <Icone size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-card-title text-[var(--foreground)]">{titulo}</h2>
        {detalhe && <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{detalhe}</p>}
        {children}
      </div>
    </div>
  );
}

// ─── Composição ───────────────────────────────────────────────────────────────

function Linha({ label, children, forte, negativo, detalhe }: { label: string; children: ReactNode; forte?: boolean; negativo?: boolean; detalhe?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 text-[13px] ${forte ? "mt-1 border-t border-[var(--border)] pt-3 font-semibold" : ""}`}>
      <span className={forte ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>
        {label}
        {detalhe && <span className="ml-1 text-[11px] text-[var(--muted-foreground)]">· {detalhe}</span>}
      </span>
      <span className={`whitespace-nowrap tabular-nums ${negativo ? "text-[var(--error)]" : "text-[var(--foreground)]"} ${forte ? "text-[15px]" : ""}`}>{children}</span>
    </div>
  );
}

export function ComposicaoPortal({ calculo }: { calculo: CalculoBoletim }) {
  const c = calculo;
  const naoClassificado = c.participacao.documentosPendentes > 0 ? c.participacao : null;
  return (
    <Card className="p-5 sm:p-6">
      <section aria-labelledby="portal-composicao-titulo" data-testid="portal-composicao">
        <h2 id="portal-composicao-titulo" className="text-card-title text-[var(--foreground)]">Composição do boletim</h2>
        <p className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">Como o total da medição deste ciclo é formado.</p>
        <div className="mt-4 grid gap-6 md:grid-cols-2 md:gap-10">
          <div>
            <Linha label="Condições fixas" detalhe={c.totalCondicoesFixas > 0 ? (c.adicionais > 0 ? `${c.tipoCondicaoFixa} · inclui adicionais de ${brl.format(c.adicionais)}` : c.tipoCondicaoFixa) : undefined}>
              {c.totalCondicoesFixas > 0 ? brl.format(c.totalCondicoesFixas) : "–"}
            </Linha>
            <Linha label="Documentos medidos" detalhe={`${c.documentosMedidos.length} doc.`}>{brl.format(c.totalDocumentos)}</Linha>
            <Linha label="Descontos" negativo={c.totalDescontos > 0}>{c.totalDescontos > 0 ? `- ${brl.format(c.totalDescontos)}` : "–"}</Linha>
            <Linha label="Total da medição" forte>{brl.format(c.totalMedicao)}</Linha>
            {c.rev !== 0 && (
              <>
                <Linha label="REV / Ajustes">{brl.format(c.rev)}</Linha>
                <Linha label="Total a pagar" forte>{brl.format(c.totalAPagar)}</Linha>
              </>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Distribuição por contrato</p>
            {c.participacao.participacoes.length || naoClassificado ? (
              <ul className="mt-2 grid gap-2">
                {c.participacao.participacoes.map((contrato) => (
                  <li key={contrato.nome} className="grid gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 break-words font-medium text-[var(--foreground)]">{contrato.nome}</span>
                      <span className="tabular-nums text-[var(--muted-foreground)]">{percentual.format(contrato.percentual / 100)}</span>
                    </div>
                    <span className="h-1.5 overflow-hidden rounded-full bg-[#efefec]" aria-hidden>
                      <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, Math.max(0, contrato.percentual))}%` }} />
                    </span>
                  </li>
                ))}
                {naoClassificado && (
                  <li className="flex items-baseline justify-between gap-3 text-[13px]" title={`${naoClassificado.documentosPendentes} documento(s) sem contrato (CTO) válido`}>
                    <span className="font-medium text-[var(--warning)]">Não classificado</span>
                    <span className="tabular-nums text-[var(--warning)]">{percentual.format(naoClassificado.percentualNaoClassificado / 100)}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--muted-foreground)]">Nenhum contrato informado.</p>
            )}
          </div>
        </div>
      </section>
    </Card>
  );
}

// ─── Documentos ───────────────────────────────────────────────────────────────

export function DocumentosMedicaoPortal({
  calculo,
  observacoesContrato,
  codigo,
  ciclo,
}: {
  calculo: CalculoBoletim<DocumentoPortal>;
  observacoesContrato: string | null | undefined;
  codigo: string;
  ciclo: string;
}) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const c = { ...calculo, hasObs: calculo.documentosMedidos.some((d) => d.obs) || calculo.descontos.some((d) => d.obs) };
  const vazio = c.documentosMedidos.length === 0 && c.descontos.length === 0 && c.totalCondicoesFixas <= 0;
  const cabecalhos = ["Documento", "CTO", "Formato", "A1eq / HH", "% Emissão", "Tipo", "Preço unit.", "Valor medido", ...(c.hasObs ? ["Observação"] : [])];
  const condicaoFixaLabel = `Provento base contratual - ${c.tipoCondicaoFixa}`;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#fafaf8] sm:px-6"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={painelId}
      >
        <span className="min-w-0">
          <span className="block text-card-title text-[var(--foreground)]">Documentos da medição</span>
          <span className="mt-0.5 block text-[12px] text-[var(--muted-foreground)]">
            {c.documentosMedidos.length === 1 ? "1 documento vinculado" : `${c.documentosMedidos.length} documentos vinculados`} ao ID {codigo} no ciclo {ciclo}.
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--primary)]">
          <span className="hidden sm:inline">{aberto ? "Ocultar" : "Ver documentos"}</span>
          <ChevronDown size={16} className={`transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>

      {aberto && (
        <div id={painelId} className="border-t border-[var(--border)]" data-testid="portal-documentos">
          {vazio ? (
            <p className="px-5 py-6 text-center text-[13px] text-[var(--muted-foreground)] sm:px-6">Nenhum documento medido neste ciclo.</p>
          ) : (
            <>
              {/* Desktop largo: tabela. */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#fafaf8]">
                      {cabecalhos.map((h) => (
                        <th key={h} scope="col" className={`text-table-header whitespace-nowrap border-b border-[var(--border)] px-4 py-2.5 text-[var(--muted-foreground)] ${["A1eq / HH", "% Emissão", "Preço unit.", "Valor medido"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.totalCondicoesFixas > 0 && (
                      <tr className="border-b border-[var(--border)]">
                        <td className="px-4 py-3" colSpan={7}>
                          <span className="mr-2 inline-flex rounded-md border border-[var(--border)] bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Condição fixa</span>
                          <span className="font-medium text-[var(--foreground)]">{condicaoFixaLabel}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--foreground)]">{brl.format(c.totalCondicoesFixas)}</td>
                        {c.hasObs && <td className="px-4 py-3 text-[var(--muted-foreground)]">{observacoesContrato ?? "Base fixa"}</td>}
                      </tr>
                    )}
                    {c.documentosMedidos.map((d) => (
                      <tr key={d.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3">
                          <span className="block font-technical font-semibold text-[var(--foreground)]">{d.numeroDocumento ?? "–"}</span>
                          <span className="block text-[11px] text-[var(--muted-foreground)]">{d.projetoReferente}</span>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">{d.contrato ?? "–"}</td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">{d.formato ?? "–"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-foreground)]">{numero.format(d.equivalenteA1Horas)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-foreground)]">{d.percentualEmissao ? percentual.format(d.percentualEmissao) : "100%"}</td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">{d.tipo2 ?? "–"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-foreground)]">{d.precoUnitario ? brl.format(d.precoUnitario) : (d.condicao ?? "–")}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--foreground)]">{brl.format(d.valorMedido)}</td>
                        {c.hasObs && <td className="px-4 py-3 text-[var(--muted-foreground)]">{d.obs ?? ""}</td>}
                      </tr>
                    ))}
                    {c.descontos.map((d) => (
                      <tr key={d.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-3" colSpan={7}>
                          <span className="mr-2 inline-flex rounded-md border border-[#efc6c6] bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--error)]">Desconto</span>
                          <span className="font-medium text-[var(--error)]">{d.obs || d.numeroDocumento || "Desconto aplicado"}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--error)]">- {brl.format(Math.abs(d.valorMedido))}</td>
                        {c.hasObs && <td className="px-4 py-3 text-[var(--error)]">{d.obs ?? "Dedução"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile/tablet: lista legível, sem rolagem horizontal. */}
              <ul className="grid gap-2 p-4 lg:hidden">
                {c.totalCondicoesFixas > 0 && (
                  <li className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Condição fixa</p>
                        <p className="break-words text-[13px] font-medium text-[var(--foreground)]">{condicaoFixaLabel}</p>
                      </div>
                      <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-[var(--foreground)]">{brl.format(c.totalCondicoesFixas)}</p>
                    </div>
                  </li>
                )}
                {c.documentosMedidos.map((d) => (
                  <li key={d.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all font-technical text-[13px] font-semibold text-[var(--foreground)]">{d.numeroDocumento ?? "–"}</p>
                        <p className="break-words text-[11px] text-[var(--muted-foreground)]">{d.projetoReferente}{d.contrato ? ` · ${d.contrato}` : ""}</p>
                      </div>
                      <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-[var(--foreground)]">{brl.format(d.valorMedido)}</p>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div className="flex justify-between gap-2"><dt className="text-[var(--muted-foreground)]">Formato</dt><dd className="text-[var(--foreground)]">{d.formato ?? "–"}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-[var(--muted-foreground)]">Tipo</dt><dd className="text-[var(--foreground)]">{d.tipo2 ?? "–"}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-[var(--muted-foreground)]">A1eq / HH</dt><dd className="tabular-nums text-[var(--foreground)]">{numero.format(d.equivalenteA1Horas)}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-[var(--muted-foreground)]">% Emissão</dt><dd className="tabular-nums text-[var(--foreground)]">{d.percentualEmissao ? percentual.format(d.percentualEmissao) : "100%"}</dd></div>
                      <div className="col-span-2 flex justify-between gap-2"><dt className="text-[var(--muted-foreground)]">Preço unit.</dt><dd className="tabular-nums text-[var(--foreground)]">{d.precoUnitario ? brl.format(d.precoUnitario) : (d.condicao ?? "–")}</dd></div>
                    </dl>
                    {d.obs && <p className="mt-2 break-words text-[11px] text-[var(--muted-foreground)]">{d.obs}</p>}
                  </li>
                ))}
                {c.descontos.map((d) => (
                  <li key={d.id} className="rounded-lg border border-[#efc6c6] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--error)]">Desconto</p>
                        <p className="break-words text-[13px] font-medium text-[var(--error)]">{d.obs || d.numeroDocumento || "Desconto aplicado"}</p>
                      </div>
                      <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-[var(--error)]">- {brl.format(Math.abs(d.valorMedido))}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex justify-end border-t border-[var(--border)] px-5 py-3 sm:px-6">
                <p className="text-[13px] font-semibold text-[var(--foreground)]">
                  Total da medição: <span className="tabular-nums">{brl.format(c.totalMedicao)}</span>
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Diálogos ─────────────────────────────────────────────────────────────────

function PortalDialog({
  titulo,
  descricao,
  role = "dialog",
  busy,
  onClose,
  children,
  footer,
}: {
  titulo: string;
  descricao: string;
  role?: "dialog" | "alertdialog";
  busy: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-descricao`}
        className="ds-dialog flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden sm:w-[480px] sm:max-w-[92vw]"
      >
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 id={`${id}-titulo`} className="text-section-title text-[var(--foreground)]">{titulo}</h2>
          <p id={`${id}-descricao`} className="mt-1 text-[12px] text-[var(--muted-foreground)]">{descricao}</p>
        </div>
        {children && <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4">{children}</div>}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>
      </div>
    </div>
  );
}

function ErroDialogo({ erro }: { erro: string | null }) {
  if (!erro) return null;
  return (
    <p role="alert" className="rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-3 py-2 text-[13px] font-medium text-[var(--error)]">
      {erro}
    </p>
  );
}

export function AprovarBoletimDialog({
  fornecedor,
  ciclo,
  totalMedicao,
  rev,
  totalAPagar,
  saving,
  erro,
  onCancel,
  onConfirm,
}: {
  fornecedor: string;
  ciclo: string;
  totalMedicao: number;
  rev: number;
  totalAPagar: number;
  saving: boolean;
  erro: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <PortalDialog
      role="alertdialog"
      titulo="Aprovar boletim"
      descricao="Ao aprovar, você confirma os dados apresentados e o processo seguirá para o envio da Nota Fiscal."
      busy={saving}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" className="border-[var(--border-strong)]! h-10 w-full sm:w-auto" onClick={onCancel} disabled={saving} autoFocus>Cancelar</Button>
          <Button className="h-10 w-full sm:w-auto" onClick={onConfirm} disabled={saving} aria-busy={saving}>
            <CheckCircle2 size={15} aria-hidden />
            {saving ? "Aprovando..." : "Aprovar boletim"}
          </Button>
        </>
      }
    >
      <ErroDialogo erro={erro} />
      <dl className="grid gap-2 rounded-lg border border-[var(--border)] bg-[#fafaf8] p-3 text-[13px]">
        <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">Fornecedor</dt><dd className="min-w-0 break-words text-right font-medium text-[var(--foreground)]">{fornecedor}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">Ciclo</dt><dd className="font-technical font-semibold text-[var(--foreground)]">{ciclo}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">Total da medição</dt><dd className="font-semibold tabular-nums text-[var(--foreground)]">{brl.format(totalMedicao)}</dd></div>
        {rev !== 0 && <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">REV / Ajustes</dt><dd className="tabular-nums text-[var(--foreground)]">{brl.format(rev)}</dd></div>}
        <div className="flex justify-between gap-4"><dt className="font-semibold text-[var(--foreground)]">Total a pagar</dt><dd className="font-bold tabular-nums text-[var(--foreground)]">{brl.format(totalAPagar)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-[var(--muted-foreground)]">Ação</dt><dd className="font-medium text-[var(--foreground)]">Aprovar BM</dd></div>
      </dl>
    </PortalDialog>
  );
}

export function SolicitarRevisaoDialog({
  value,
  onChange,
  respostaAdmin,
  saving,
  erro,
  onCancel,
  onConfirm,
}: {
  value: string;
  onChange: (value: string) => void;
  respostaAdmin: string | null;
  saving: boolean;
  erro: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const campoId = useId();
  return (
    <PortalDialog
      titulo="Solicitar revisão"
      descricao="Descreva os pontos de discordância para análise da equipe de Medição."
      busy={saving}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" className="border-[var(--border-strong)]! h-10 w-full sm:w-auto" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button className="h-10 w-full sm:w-auto" onClick={onConfirm} disabled={saving} aria-busy={saving}>
            {saving ? "Enviando..." : "Solicitar revisão"}
          </Button>
        </>
      }
    >
      <ErroDialogo erro={erro} />
      {respostaAdmin && (
        <div className="rounded-lg border border-[var(--border)] bg-[#fafaf8] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Resposta da equipe de Medição</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--foreground)]">{respostaAdmin}</p>
        </div>
      )}
      <div className="grid gap-1.5">
        <label htmlFor={campoId} className="text-label text-[var(--foreground)]">Pontos de discordância</label>
        <Textarea
          id={campoId}
          className="min-h-32"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Descreva onde e por que os dados estão incorretos."
          autoFocus
        />
        <p className="text-helper text-[var(--muted-foreground)]">Informe com detalhes (mínimo de 10 caracteres) para a equipe conseguir corrigir.</p>
      </div>
    </PortalDialog>
  );
}

export function ResponderMedicaoDialog({
  value,
  onChange,
  respostaAdmin,
  pontosDiscordancia,
  observacaoColaborador,
  saving,
  erro,
  onCancel,
  onConfirm,
}: {
  value: string;
  onChange: (value: string) => void;
  respostaAdmin: string | null;
  pontosDiscordancia: string | null;
  observacaoColaborador: string | null;
  saving: boolean;
  erro: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const campoId = useId();
  const bloco = (titulo: string, texto: string) => (
    <div className="rounded-lg border border-[var(--border)] bg-[#fafaf8] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{titulo}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--foreground)]">{texto}</p>
    </div>
  );
  return (
    <PortalDialog
      titulo="Responder equipe de Medição"
      descricao="Leia o retorno recebido e envie uma resposta complementar para a equipe."
      busy={saving}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" className="border-[var(--border-strong)]! h-10 w-full sm:w-auto" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button className="h-10 w-full sm:w-auto" onClick={onConfirm} disabled={saving} aria-busy={saving}>{saving ? "Enviando..." : "Enviar resposta"}</Button>
        </>
      }
    >
      <ErroDialogo erro={erro} />
      {bloco("Resposta da equipe de Medição", respostaAdmin ?? "")}
      {pontosDiscordancia && bloco("Sua solicitação original", pontosDiscordancia)}
      {observacaoColaborador && bloco("Última resposta enviada", observacaoColaborador)}
      <div className="grid gap-1.5">
        <label htmlFor={campoId} className="text-label text-[var(--foreground)]">Sua resposta</label>
        <Textarea id={campoId} className="min-h-32" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Digite sua resposta para a equipe de Medição." autoFocus />
      </div>
    </PortalDialog>
  );
}
