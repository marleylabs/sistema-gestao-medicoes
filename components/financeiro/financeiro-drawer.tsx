"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, FileText } from "lucide-react";
import { Badge, BlurValue, Button } from "@/components/ui";
import { resumoBoletim, type BmData } from "@/components/boletim-medicao";
import { AdminSidePanel, DataItem, PanelSection } from "@/components/administrativo/admin-side-panel";
import { currency, fmtDate, mesmoTexto, statusInfo, valorAPagar, type FinanceiroItem } from "@/components/financeiro/shared";

function Linha({ label, children, forte, tom }: { label: string; children: ReactNode; forte?: boolean; tom?: "negativo" }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 text-sm ${forte ? "border-t border-[var(--border)] pt-2.5 font-semibold" : ""}`}>
      <span className={forte ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}>{label}</span>
      <span className={`whitespace-nowrap tabular-nums ${tom === "negativo" ? "text-[var(--error)]" : "text-[var(--foreground)]"}`}>{children}</span>
    </div>
  );
}

function LinkArquivo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] font-semibold text-[var(--foreground)] transition hover:border-[var(--border-strong)] hover:bg-[#f7f7f5]"
    >
      <FileText size={13} />
      {children}
    </a>
  );
}

/**
 * Detalhe financeiro do fornecedor no ciclo. Valor a pagar = mesma fonte da lista (valor + rev do
 * mapa). A composição (condições fixas, documentos medidos, descontos) vem do BM já existente
 * (GET /api/admin/bm, o mesmo do "Ver BM") pela função única `resumoBoletim` — nada recalculado
 * aqui. "Marcar pago" continua exigindo status APROVADO (regra do backend) e mantém o comprovante
 * opcional no mesmo PATCH de sempre.
 */
export function FinanceiroDrawer({
  item,
  ciclo,
  podeRegistrarPagamento,
  escEnabled,
  confirmando,
  enviando,
  erro,
  onIniciarPagamento,
  onCancelarPagamento,
  onArquivo,
  onConfirmarPagamento,
  onVerBm,
  onClose,
}: {
  item: FinanceiroItem;
  ciclo: string;
  podeRegistrarPagamento: boolean;
  escEnabled?: boolean;
  confirmando: boolean;
  enviando: boolean;
  erro: string | null;
  onIniciarPagamento: () => void;
  onCancelarPagamento: () => void;
  onArquivo: (file: File | null) => void;
  onConfirmarPagamento: () => void;
  onVerBm: () => void;
  onClose: () => void;
}) {
  const status = statusInfo(item.status);
  const [bm, setBm] = useState<BmData | null>(null);
  const [bmErro, setBmErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setBm(null);
    setBmErro(null);
    fetch(`/api/admin/bm?codigo=${encodeURIComponent(item.colaboradorCodigo)}&ciclo=${encodeURIComponent(ciclo)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (res.ok) setBm(payload as BmData);
        else setBmErro(payload.error ?? "Não foi possível carregar a composição do BM.");
      })
      .catch(() => { if (ativo) setBmErro("Não foi possível carregar a composição do BM."); });
    return () => { ativo = false; };
  }, [item.colaboradorCodigo, ciclo]);

  const resumo = bm ? resumoBoletim(bm) : null;
  // Mesmo total exibido no boletim impresso (líquido; na falta dele, valor + rev do pagamento).
  const totalBm = resumo ? (resumo.totalMedidoLiquido || resumo.totalMedicao) : null;
  const aPagar = valorAPagar(item);
  const podeMarcar = podeRegistrarPagamento && item.status === "APROVADO";

  return (
    <AdminSidePanel
      eyebrow={`Pagamento · Ciclo ${ciclo}`}
      title={item.colaboradorNome}
      subtitle={item.razaoSocial ?? undefined}
      escEnabled={escEnabled}
      closeDisabled={enviando}
      onClose={onClose}
      testId="financeiro-detalhe"
      meta={
        <>
          <Badge variant={status.badge}>{status.label}</Badge>
          {!mesmoTexto(item.colaboradorCodigo, item.colaboradorNome) && <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{item.colaboradorCodigo}</span>}
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onVerBm}>
            <FileText size={14} />
            Ver BM
          </Button>
          {podeMarcar && !confirmando && (
            <Button variant="success" onClick={onIniciarPagamento}>
              <CheckCircle2 size={14} />
              Marcar pago
            </Button>
          )}
        </>
      }
    >
      <PanelSection title="Resumo">
        <div className="rounded-lg border border-[var(--border)] bg-[#FAFAF8] px-4 py-3">
          <p className="text-[11px] text-[var(--muted-foreground)]">Valor a pagar</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-[var(--foreground)]" data-testid="financeiro-detalhe-valor">
            <BlurValue>{currency.format(aPagar)}</BlurValue>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">Mapa de pagamento do ciclo</p>
        </div>
        {item.rev !== 0 && (
          <div>
            <Linha label="Valor do mapa"><BlurValue>{currency.format(item.valor)}</BlurValue></Linha>
            <Linha label="Revisão"><BlurValue>{currency.format(item.rev)}</BlurValue></Linha>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Composição do BM">
        {bmErro ? (
          <p className="text-sm text-[var(--error)]">{bmErro}</p>
        ) : !resumo ? (
          <p className="text-sm text-[var(--muted-foreground)]">Carregando composição do BM…</p>
        ) : (
          <div data-testid="financeiro-composicao">
            <Linha label="Condições fixas"><BlurValue>{currency.format(resumo.ccFixoClt + resumo.ccFixoPj)}</BlurValue></Linha>
            <Linha label="Documentos medidos"><BlurValue>{currency.format(resumo.totalDocumentosMedidos)}</BlurValue></Linha>
            <Linha label="Descontos" tom={resumo.ccDescontos > 0 ? "negativo" : undefined}>
              {resumo.ccDescontos > 0 ? <BlurValue>{`- ${currency.format(resumo.ccDescontos)}`}</BlurValue> : "–"}
            </Linha>
            <Linha label="Total medido líquido" forte><BlurValue>{currency.format(totalBm ?? 0)}</BlurValue></Linha>
            {totalBm !== null && Math.abs(totalBm - aPagar) > 0.01 && (
              <p className="mt-2 text-[12px] text-[var(--warning)]">O total do BM difere do valor a pagar do mapa. Confira o boletim.</p>
            )}
          </div>
        )}
      </PanelSection>

      {resumo && (resumo.fixoAmount > 0.01 || bm?.pagamento?.condicoesFixas?.tipoContratacao) && (
        <PanelSection title="Condição fixa">
          <dl className="grid grid-cols-2 gap-3">
            <DataItem label="Valor aplicado no BM"><span className="tabular-nums"><BlurValue>{currency.format(resumo.fixoAmount)}</BlurValue></span></DataItem>
            <DataItem label="Contratação">{bm?.pagamento?.condicoesFixas?.tipoContratacao ?? "–"}</DataItem>
          </dl>
          <p className="text-[12px] text-[var(--muted-foreground)]">A configuração da condição fixa é mantida no Administrativo.</p>
        </PanelSection>
      )}

      {resumo && resumo.documentosDesconto.length > 0 && (
        <PanelSection title="Descontos">
          <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]">
            {resumo.documentosDesconto.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-[var(--foreground)]">{doc.obs || doc.numeroDocumento || "Dedução"}</span>
                <span className="shrink-0 tabular-nums text-[var(--error)]"><BlurValue>{`- ${currency.format(Math.abs(doc.valorMedido))}`}</BlurValue></span>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      <PanelSection title="Nota fiscal">
        {item.nfArquivoNome ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <dl className="grid gap-0.5">
              <DataItem label="Recebida em">{fmtDate(item.nfCarregadoAt)}</DataItem>
            </dl>
            <LinkArquivo href={`/api/admin/nf/${item.id}`}>Abrir NF</LinkArquivo>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">Aguardando o fornecedor enviar a nota fiscal.</p>
        )}
      </PanelSection>

      <PanelSection title="Pagamento">
        {item.status === "PAGO" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <dl className="grid gap-0.5">
              <DataItem label="Pago em">{fmtDate(item.pagoAt)}</DataItem>
            </dl>
            {item.comprovanteArquivoNome
              ? <LinkArquivo href={`/api/colaborador/comprovante/${item.id}`}>Ver comprovante</LinkArquivo>
              : <span className="text-[12px] text-[var(--muted-foreground)]">Registrado sem comprovante</span>}
          </div>
        ) : confirmando ? (
          <div className="grid gap-3 rounded-lg border border-[#cde9d5] bg-[var(--success-soft)] p-3" data-testid="financeiro-confirmar-pagamento">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--success)]">
              <CheckCircle2 size={15} />
              Confirmar pagamento — {item.colaboradorNome}
            </p>
            <label className="grid gap-1 text-label text-[var(--muted-foreground)]">
              Comprovante de pagamento opcional (PDF, JPG ou PNG)
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="block w-full text-sm text-[var(--foreground)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--success)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                onChange={(e) => onArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
            {erro && <p className="text-xs text-[var(--error)]">{erro}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onCancelarPagamento} disabled={enviando}>Cancelar</Button>
              <Button variant="success" onClick={onConfirmarPagamento} disabled={enviando}>
                {enviando ? "Confirmando…" : "Confirmar pagamento"}
              </Button>
            </div>
          </div>
        ) : item.status === "APROVADO" ? (
          <p className="text-sm text-[var(--muted-foreground)]">NF recebida — pagamento ainda não registrado.</p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">O pagamento é liberado depois que a NF for recebida.</p>
        )}
      </PanelSection>

      <PanelSection title="Linha do tempo">
        <ol className="grid gap-2" data-testid="financeiro-linha-do-tempo">
          {[
            { label: "Nota fiscal recebida", data: item.nfCarregadoAt },
            { label: "Pagamento registrado", data: item.status === "PAGO" ? item.pagoAt : null },
            { label: "Comprovante anexado", data: item.comprovanteCarregadoAt },
          ].map((evento) => (
            <li key={evento.label} className="flex items-center justify-between gap-3 text-sm">
              <span className={`flex items-center gap-2 ${evento.data ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${evento.data ? "bg-[var(--success)]" : "bg-[var(--border-strong)]"}`} />
                {evento.label}
              </span>
              <span className="whitespace-nowrap text-[12px] text-[var(--muted-foreground)]">{evento.data ? fmtDate(evento.data) : "Pendente"}</span>
            </li>
          ))}
        </ol>
      </PanelSection>
    </AdminSidePanel>
  );
}
