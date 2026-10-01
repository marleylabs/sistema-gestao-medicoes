"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { Badge, BlurValue, Button } from "@/components/ui";
import type { BmData } from "@/components/boletim-medicao";
import { ComposicaoBoletim } from "@/components/boletim-resumo";
import { AdminSidePanel, DataItem, PanelSection } from "@/components/administrativo/admin-side-panel";
import type { Evidencia } from "@/components/evidencias/dados";
import { DivergenciasLeitura } from "@/components/divergencias/divergencias-medicao";
import type { DivergenciaDTO } from "@/lib/divergencia-comparacao";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataCurta = (v: string | null | undefined) => (v ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(v.length === 10 ? `${v}T12:00:00` : v)) : "–");
const dataHora = (v: string | null | undefined) => (v ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "–");

/** Entrada de GET /api/admin/conferencia (mesma rota e mesmo DTO do editor de pagamento de Fornecedores). */
type Divergencia = DivergenciaDTO;

/**
 * Detalhe de uma evidência (BM do fornecedor no ciclo) — SOMENTE conferência: nenhuma ação de
 * workflow. Composição e documentos de GET /api/admin/bm (resumo pela função única resumoBoletim);
 * divergências de GET /api/admin/conferencia, na MESMA apresentação documental do editor de
 * pagamento, em modo somente leitura (a resolução continua em Fornecedores); "Ver BM" abre o
 * BoletimMedicao completo, com a exportação/impressão de sempre.
 */
export function EvidenciaDrawer({
  evidencia,
  onVerBm,
  onClose,
  escEnabled,
}: {
  evidencia: Evidencia;
  onVerBm: () => void;
  onClose: () => void;
  escEnabled?: boolean;
}) {
  const [bm, setBm] = useState<BmData | null>(null);
  const [bmErro, setBmErro] = useState<string | null>(null);
  const [divergencias, setDivergencias] = useState<Divergencia[] | null>(null);
  const [divErro, setDivErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    setBm(null); setBmErro(null); setDivergencias(null); setDivErro(false);
    const q = `codigo=${encodeURIComponent(evidencia.colaboradorCodigo)}&ciclo=${encodeURIComponent(evidencia.ciclo)}`;
    fetch(`/api/admin/bm?${q}`).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!ativo) return;
      if (!res.ok) setBmErro(data.error ?? "Erro ao buscar boletim.");
      else if (!data.pagamento && !data.documentos?.length) setBmErro("Nenhuma medição encontrada para este fornecedor e ciclo.");
      else setBm(data as BmData);
    }).catch(() => { if (ativo) setBmErro("Erro ao buscar boletim."); });
    fetch(`/api/admin/conferencia?${q}`).then(async (res) => {
      if (!ativo) return;
      if (!res.ok) { setDivErro(true); setDivergencias([]); return; }
      setDivergencias((await res.json()) as Divergencia[]);
    }).catch(() => { if (ativo) { setDivErro(true); setDivergencias([]); } });
    return () => { ativo = false; };
  }, [evidencia.colaboradorCodigo, evidencia.ciclo]);

  const pendentes = divergencias?.filter((d) => d.status === "PENDENTE").length ?? 0;
  const documentos = bm?.documentos ?? [];

  return (
    <AdminSidePanel
      size="wide"
      eyebrow={`Evidência · Ciclo ${evidencia.ciclo}`}
      title={evidencia.nome}
      subtitle={evidencia.empresa ?? undefined}
      onClose={onClose}
      escEnabled={escEnabled}
      testId="evidencia-detalhe"
      meta={<Badge variant={evidencia.statusMeta.badge}>{evidencia.statusMeta.label}</Badge>}
      footer={<Button variant="secondary" onClick={onVerBm}><FileText size={14} />Ver BM</Button>}
    >
      <PanelSection title="Resumo">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="evidencia-resumo">
          <DataItem label="Ciclo" technical>{evidencia.ciclo}</DataItem>
          <DataItem label="Código" technical>{evidencia.colaboradorCodigo}</DataItem>
          <DataItem label="Valor do BM">{bm?.pagamento ? <BlurValue>{brl.format(bm.pagamento.valor)}</BlurValue> : evidencia.valor !== null ? <BlurValue>{brl.format(evidencia.valor)}</BlurValue> : "–"}</DataItem>
          <DataItem label="Revisão">{evidencia.revisaoNumero > 0 ? `Rev. ${evidencia.revisaoNumero}` : "Original"}</DataItem>
          <DataItem label="Aprovado pelo fornecedor em">{dataHora(evidencia.aprovadoAt)}</DataItem>
        </dl>
      </PanelSection>

      <PanelSection title="Composição do BM">
        {bmErro ? <p className="text-sm text-[var(--error)]">{bmErro}</p>
          : !bm ? <p className="text-sm text-[var(--muted-foreground)]">Carregando composição do BM…</p>
          : <ComposicaoBoletim bm={bm} testId="evidencia-composicao" />}
      </PanelSection>

      <PanelSection title={`Divergências${pendentes ? ` · ${pendentes} pendente(s)` : ""}`}>
        <div data-testid="evidencia-divergencias">
          {divergencias === null ? <p className="text-sm text-[var(--muted-foreground)]">Carregando divergências…</p>
            : divErro ? <p className="text-sm text-[var(--muted-foreground)]">Não foi possível carregar as divergências.</p>
            : divergencias.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">Nenhuma divergência registrada na conferência do fornecedor.</p>
            : (
              <DivergenciasLeitura divergencias={divergencias} />
            )}
          {pendentes > 0 && (
            <a href={`/fornecedores?ciclo=${encodeURIComponent(evidencia.ciclo)}`} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--primary)] hover:underline">
              Abrir Fornecedores no ciclo {evidencia.ciclo}<ArrowUpRight size={13} />
            </a>
          )}
        </div>
      </PanelSection>

      <PanelSection title={`Documentos medidos${documentos.length ? ` · ${documentos.length}` : ""}`}>
        {!bm ? <p className="text-sm text-[var(--muted-foreground)]">{bmErro ? "Sem documentos para exibir." : "Carregando documentos…"}</p>
          : documentos.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">Nenhum documento medido neste BM.</p>
          : (
            <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]" data-testid="evidencia-documentos">
              {documentos.map((d) => {
                const desconto = (d.tipo2 ?? "").toUpperCase().trim() === "DESCONTO";
                return (
                  <li key={d.id} className="flex min-w-0 items-start gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-technical text-[12.5px] font-semibold text-[var(--foreground)]">{d.numeroDocumento ?? "–"}</p>
                      <p className="truncate text-[12px] text-[var(--muted-foreground)]">{[d.projetoReferente, d.tituloPrimario].filter(Boolean).join(" · ") || "–"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                        {d.tipo2 && <Badge variant={desconto ? "danger" : "neutral"}>{desconto ? "Desconto" : d.tipo2}</Badge>}
                        {d.formato && <span>{d.formato}</span>}
                        {d.contrato && <span>· {d.contrato}</span>}
                        {d.dataCadastro && <span>· {dataCurta(d.dataCadastro)}</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 whitespace-nowrap tabular-nums ${desconto ? "text-[var(--error)]" : "text-[var(--foreground)]"}`}>
                      <BlurValue>{brl.format(d.valorMedido)}</BlurValue>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
      </PanelSection>
    </AdminSidePanel>
  );
}
