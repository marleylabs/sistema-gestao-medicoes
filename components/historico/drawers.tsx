"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, FileText } from "lucide-react";
import { Badge, BlurValue, Button } from "@/components/ui";
import { formatParticipacao } from "@/components/mapa-pagamento-table";
import { resumoBoletim, type BmData } from "@/components/boletim-medicao";
import { AdminSidePanel, DataItem, PanelSection } from "@/components/administrativo/admin-side-panel";
import { valorAtribuido, type ContratoHistorico, type FornecedorHistorico, type MedicaoHistorico } from "@/components/historico/dados";
import { brl } from "@/components/historico/listas";

type FinanceiroItem = { id: string; colaboradorCodigo: string; nfArquivoNome: string | null; nfCarregadoAt: string | null; pagoAt: string | null; comprovanteArquivoNome: string | null; status: string };

const dataHora = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : null);

function LinhaValor({ label, children, forte, negativo }: { label: string; children: ReactNode; forte?: boolean; negativo?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-sm ${forte ? "border-t border-[var(--border)] pt-2.5 font-semibold" : ""}`}>
      <span className={forte ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{label}</span>
      <span className={`whitespace-nowrap tabular-nums ${negativo ? "text-[var(--error)]" : "text-[var(--foreground)]"}`}>{children}</span>
    </div>
  );
}

function LinkArquivo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] font-semibold text-[var(--foreground)] transition hover:border-[var(--border-strong)] hover:bg-[#f7f7f5]">
      <FileText size={13} />
      {children}
    </a>
  );
}

function Resumo({ itens }: { itens: { label: string; valor: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {itens.map((i) => (
        <div key={i.label} className="rounded-lg border border-[var(--border)] bg-[#FAFAF8] px-3 py-2.5">
          <dt className="text-[11px] text-[var(--muted-foreground)]">{i.label}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-[var(--foreground)]">{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Voltar({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null;
  return <Button variant="ghost" onClick={onBack}><ArrowLeft size={14} />Voltar</Button>;
}

/**
 * Detalhe de uma medição (BM do fornecedor no ciclo). Valor = mapaPagamentoItem.valor (mesmo de
 * /fornecedores). Composição pela função única `resumoBoletim` sobre GET /api/admin/bm; NF e
 * pagamento de GET /api/admin/financeiro do ciclo. Linha do tempo só com datas que existem.
 */
export function MedicaoDrawer({
  medicao,
  nomesContrato,
  publicadoNoPortal,
  onVerBm,
  onBack,
  onClose,
  escEnabled,
}: {
  medicao: MedicaoHistorico;
  nomesContrato: Map<string, string>;
  /** Informativo: o ciclo desta medição é o publicado no portal (a publicação fica em /fornecedores). */
  publicadoNoPortal?: boolean;
  onVerBm: () => void;
  onBack?: () => void;
  onClose: () => void;
  escEnabled?: boolean;
}) {
  const [bm, setBm] = useState<BmData | null>(null);
  const [bmErro, setBmErro] = useState<string | null>(null);
  const [fin, setFin] = useState<FinanceiroItem | null | undefined>(undefined);

  useEffect(() => {
    let ativo = true;
    setBm(null); setBmErro(null); setFin(undefined);
    const q = `codigo=${encodeURIComponent(medicao.codigo)}&ciclo=${encodeURIComponent(medicao.ciclo)}`;
    fetch(`/api/admin/bm?${q}`).then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!ativo) return;
      if (res.ok) setBm(payload as BmData); else setBmErro(payload.error ?? "Não foi possível carregar a composição do BM.");
    }).catch(() => { if (ativo) setBmErro("Não foi possível carregar a composição do BM."); });
    fetch(`/api/admin/financeiro?ciclo=${encodeURIComponent(medicao.ciclo)}`).then(async (res) => {
      const lista = res.ok ? ((await res.json()) as FinanceiroItem[]) : [];
      if (ativo) setFin(lista.find((f) => f.colaboradorCodigo === medicao.codigo) ?? null);
    }).catch(() => { if (ativo) setFin(null); });
    return () => { ativo = false; };
  }, [medicao.codigo, medicao.ciclo]);

  const resumo = bm ? resumoBoletim(bm) : null;
  const contratos = Object.entries(medicao.participacoes).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);

  return (
    <AdminSidePanel
      eyebrow={`Medição · Ciclo ${medicao.ciclo}`}
      title={medicao.nome}
      subtitle={medicao.empresa ?? undefined}
      onClose={onClose}
      onEscape={onBack ?? onClose}
      escEnabled={escEnabled}
      testId="historico-detalhe-medicao"
      meta={<><Badge variant={medicao.status.badge}>{medicao.status.label}</Badge>{publicadoNoPortal && <Badge variant="success">Publicado no portal</Badge>}</>}
      footer={<><Voltar onBack={onBack} /><Button variant="secondary" onClick={onVerBm}><FileText size={14} />Ver BM</Button></>}
    >
      <PanelSection title="Resumo">
        <Resumo itens={[
          { label: "Pagamento no mapa", valor: <BlurValue>{brl.format(medicao.valor)}</BlurValue> },
          { label: "Ciclo", valor: <span className="font-technical">{medicao.ciclo}</span> },
        ]} />
      </PanelSection>

      <PanelSection title="Empresa">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DataItem label="Razão social">{medicao.empresa ?? "–"}</DataItem>
          <DataItem label="CNPJ" technical><BlurValue>{medicao.cnpj ?? "–"}</BlurValue></DataItem>
        </dl>
      </PanelSection>

      <PanelSection title="Distribuição por contrato">
        {contratos.length ? (
          <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]">
            {contratos.map(([id, p]) => (
              <li key={id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-[var(--foreground)]">{nomesContrato.get(id) ?? id}</span>
                <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{formatParticipacao(p)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--muted-foreground)]">Nenhum contrato identificado nesta medição.</p>}
      </PanelSection>

      <PanelSection title="Composição do BM">
        {bmErro ? <p className="text-sm text-[var(--error)]">{bmErro}</p> : !resumo ? (
          <p className="text-sm text-[var(--muted-foreground)]">Carregando composição do BM…</p>
        ) : (
          <div data-testid="historico-composicao">
            <LinhaValor label="Condições fixas"><BlurValue>{brl.format(resumo.ccFixoClt + resumo.ccFixoPj)}</BlurValue></LinhaValor>
            <LinhaValor label="Documentos medidos"><BlurValue>{brl.format(resumo.totalDocumentosMedidos)}</BlurValue></LinhaValor>
            <LinhaValor label="Descontos" negativo={resumo.ccDescontos > 0}>{resumo.ccDescontos > 0 ? <BlurValue>{`- ${brl.format(resumo.ccDescontos)}`}</BlurValue> : "–"}</LinhaValor>
            <LinhaValor label="Total medido líquido" forte><BlurValue>{brl.format(resumo.totalMedidoLiquido || resumo.totalMedicao)}</BlurValue></LinhaValor>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{resumo.documentosProdutivos.length} documento(s) medido(s){resumo.documentosDesconto.length ? ` · ${resumo.documentosDesconto.length} desconto(s)` : ""}.</p>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Nota fiscal e pagamento">
        {fin === undefined ? <p className="text-sm text-[var(--muted-foreground)]">Carregando…</p> : fin === null ? (
          <p className="text-sm text-[var(--muted-foreground)]">Esta medição ainda não chegou à etapa financeira.</p>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <dl><DataItem label="NF recebida em">{dataHora(fin.nfCarregadoAt) ?? "Não enviada"}</DataItem></dl>
              {fin.nfArquivoNome && <LinkArquivo href={`/api/admin/nf/${fin.id}`}>Abrir NF</LinkArquivo>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <dl><DataItem label="Pago em">{fin.status === "PAGO" ? dataHora(fin.pagoAt) ?? "–" : "Não pago"}</DataItem></dl>
              {fin.status === "PAGO" && fin.comprovanteArquivoNome && <LinkArquivo href={`/api/colaborador/comprovante/${fin.id}`}>Ver comprovante</LinkArquivo>}
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Linha do tempo">
        <ol className="grid gap-2" data-testid="historico-linha-do-tempo">
          {[
            { label: "BM aprovado pelo fornecedor", data: medicao.sgc?.aprovadoAt ?? null },
            { label: "Nota fiscal recebida", data: fin?.nfCarregadoAt ?? null },
            { label: "Pagamento registrado", data: fin?.status === "PAGO" ? fin.pagoAt : null },
          ].map((e) => (
            <li key={e.label} className="flex items-center justify-between gap-3 text-sm">
              <span className={`flex items-center gap-2 ${e.data ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.data ? "bg-[var(--success)]" : "bg-[var(--border-strong)]"}`} />
                {e.label}
              </span>
              <span className="whitespace-nowrap text-[12px] text-[var(--muted-foreground)]">{dataHora(e.data) ?? "Sem registro"}</span>
            </li>
          ))}
        </ol>
      </PanelSection>
    </AdminSidePanel>
  );
}

function MedicaoLinha({ m, extra, onOpen }: { m: MedicaoHistorico; extra?: ReactNode; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`Abrir medição de ${m.nome} no ciclo ${m.ciclo}`} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-[#FAFAF8]">
        <span className="w-12 shrink-0 font-technical text-[12.5px] text-[var(--foreground)]">{m.ciclo}</span>
        <span className="min-w-0 flex-1">
          {extra ?? <Badge variant={m.status.badge}>{m.status.label}</Badge>}
        </span>
        <span className="shrink-0 tabular-nums text-[var(--foreground)]"><BlurValue>{brl.format(m.valor)}</BlurValue></span>
        <ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
      </button>
    </li>
  );
}

/** Trajetória do fornecedor: total, ciclos, contratos, última medição e a lista por ciclo. */
export function FornecedorHistoricoDrawer({
  fornecedor,
  nomesContrato,
  onAbrirMedicao,
  onClose,
  escEnabled,
}: {
  fornecedor: FornecedorHistorico;
  nomesContrato: Map<string, string>;
  onAbrirMedicao: (m: MedicaoHistorico) => void;
  onClose: () => void;
  escEnabled?: boolean;
}) {
  return (
    <AdminSidePanel eyebrow="Histórico do fornecedor" title={fornecedor.nome} subtitle={fornecedor.empresa ?? undefined} onClose={onClose} escEnabled={escEnabled} testId="historico-detalhe-fornecedor">
      <PanelSection title="Resumo">
        <Resumo itens={[
          { label: "Total medido", valor: <BlurValue>{brl.format(fornecedor.total)}</BlurValue> },
          { label: "Ciclos", valor: fornecedor.ciclos.length },
          { label: "Contratos", valor: fornecedor.contratoIds.length },
          { label: "Última medição", valor: <span className="font-technical">{fornecedor.ultimo}</span> },
        ]} />
      </PanelSection>
      <PanelSection title="Por ciclo">
        <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]" data-testid="historico-fornecedor-ciclos">
          {fornecedor.medicoes.map((m) => <MedicaoLinha key={m.key} m={m} onOpen={() => onAbrirMedicao(m)} />)}
        </ul>
      </PanelSection>
      <PanelSection title="Contratos">
        {fornecedor.contratoIds.length ? (
          <div className="flex flex-wrap gap-1.5">
            {fornecedor.contratoIds.map((id) => <span key={id} className="rounded-md border border-[var(--border)] bg-[#FAFAF8] px-2 py-0.5 text-[12px] text-[var(--foreground)]">{nomesContrato.get(id) ?? id}</span>)}
          </div>
        ) : <p className="text-sm text-[var(--muted-foreground)]">Nenhum contrato identificado.</p>}
      </PanelSection>
    </AdminSidePanel>
  );
}

/** Histórico do contrato (somente consulta): valor atribuído pela mesma regra do Dashboard. */
export function ContratoHistoricoDrawer({
  contrato,
  onAbrirMedicao,
  onClose,
  escEnabled,
}: {
  contrato: ContratoHistorico;
  onAbrirMedicao: (m: MedicaoHistorico) => void;
  onClose: () => void;
  escEnabled?: boolean;
}) {
  const porFornecedor = contrato.fornecedores.map((codigo) => {
    const lista = contrato.medicoes.filter((m) => m.codigo === codigo);
    return { codigo, nome: lista[0]?.nome ?? codigo, valor: valorAtribuido(lista, contrato.id) };
  }).sort((a, b) => b.valor - a.valor);
  return (
    <AdminSidePanel eyebrow="Histórico do contrato" title={contrato.nome} subtitle="Somente consulta" onClose={onClose} escEnabled={escEnabled} testId="historico-detalhe-contrato">
      <PanelSection title="Resumo">
        <Resumo itens={[
          { label: "Valor atribuído", valor: <BlurValue>{brl.format(contrato.valorAtribuido)}</BlurValue> },
          { label: "Fornecedores", valor: contrato.fornecedores.length },
          { label: "Ciclos", valor: contrato.ciclos.length },
          { label: "Medições", valor: contrato.medicoes.length },
        ]} />
        <p className="text-[11px] text-[var(--muted-foreground)]">Valor atribuído = pagamento de cada medição × participação do contrato (mesma regra da distribuição por contrato do Dashboard).</p>
      </PanelSection>
      <PanelSection title="Fornecedores envolvidos">
        <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]">
          {porFornecedor.map((f) => (
            <li key={f.codigo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-[var(--foreground)]">{f.nome}</span>
              <span className="shrink-0 tabular-nums text-[var(--foreground)]"><BlurValue>{brl.format(f.valor)}</BlurValue></span>
            </li>
          ))}
        </ul>
      </PanelSection>
      <PanelSection title="Medições">
        <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]" data-testid="historico-contrato-medicoes">
          {contrato.medicoes.map((m) => (
            <MedicaoLinha
              key={m.key}
              m={m}
              onOpen={() => onAbrirMedicao(m)}
              extra={<span className="block truncate text-[var(--foreground)]">{m.nome} <span className="text-[11px] text-[var(--muted-foreground)]">· {formatParticipacao(m.participacoes[contrato.id] ?? 0)}</span></span>}
            />
          ))}
        </ul>
      </PanelSection>
    </AdminSidePanel>
  );
}
