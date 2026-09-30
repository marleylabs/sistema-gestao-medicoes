"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CircleCheckBig, Clock3, Download, FileClock, RefreshCw, Search, X } from "lucide-react";
import { BlurValue, Button, Card, IconButton, Input, PageContainer, PageHeader, Select } from "@/components/ui";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
import { DashboardKpiCard } from "@/components/dashboard-pilot/dashboard-kpi-card";
import { FinanceiroDrawer } from "@/components/financeiro/financeiro-drawer";
import { FinanceiroTable } from "@/components/financeiro/financeiro-table";
import {
  STATUS_FILTRO_LABEL,
  STATUS_FINANCEIROS,
  currency,
  valorAPagar,
  type CicloEntry,
  type FinanceiroItem,
} from "@/components/financeiro/shared";
import { useLiveRefresh } from "@/hooks/use-live-refresh";

const number = new Intl.NumberFormat("pt-BR");

/**
 * Financeiro — fechamento financeiro por ciclo (NF → pagamento). Resumo, tabela e detalhe usam a
 * MESMA fonte (GET /api/admin/financeiro: status do SGC + valor/rev do mapa do ciclo). Nenhuma regra,
 * status, transição, e-mail ou permissão mudou: "Marcar pago" continua só para APROVADO, com
 * comprovante opcional, pelo mesmo PATCH (que registra o log e dispara PAYMENT_COMPLETED).
 * ADMINISTRATIVO (exportOnly) continua vendo só o ciclo + exportação.
 */
export function FinanceiroPanel({ ciclos, exportOnly = false }: { ciclos: CicloEntry[]; exportOnly?: boolean }) {
  const [selectedCiclo, setSelectedCiclo] = useState(ciclos[0]?.ciclo ?? "");
  const [items, setItems]                 = useState<FinanceiroItem[]>([]);
  const [loading, setLoading]             = useState(false);
  const [carregado, setCarregado]         = useState(false);
  const [busca, setBusca]                 = useState("");
  const [filterStatus, setFilterStatus]   = useState("todos");
  const [detalheId, setDetalheId]         = useState<string | null>(null);
  const [uploadFormId, setUploadFormId]   = useState<string | null>(null);
  const [uploadingId, setUploadingId]     = useState<string | null>(null);
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [uploadError, setUploadError]     = useState<string | null>(null);
  const [bmData, setBmData]               = useState<BmData | null>(null);
  const [bmLoading, setBmLoading]         = useState(false);
  const [bmError, setBmError]             = useState<string | null>(null);
  const [toast, setToast]                 = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCiclo && ciclos[0]?.ciclo) setSelectedCiclo(ciclos[0].ciclo);
  }, [ciclos, selectedCiclo]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!selectedCiclo || exportOnly) return;
    if (!opts?.silent) setLoading(true);
    const res = await fetch(`/api/admin/financeiro?ciclo=${encodeURIComponent(selectedCiclo)}`);
    if (res.ok) setItems(await res.json());
    if (!opts?.silent) setLoading(false);
    setCarregado(true);
  }, [exportOnly, selectedCiclo]);

  useEffect(() => { load(); }, [load]);

  // NF enviada pelo fornecedor com o Financeiro aberto aparece sem F5; `silent` evita piscar a lista.
  const loadSilent = useCallback(() => { load({ silent: true }); }, [load]);
  useLiveRefresh(loadSilent, { intervalMs: 8000, enabled: !exportOnly && !!selectedCiclo });

  function fecharPagamento() {
    setUploadFormId(null);
    setComprovanteFile(null);
    setUploadError(null);
  }

  async function enviarComprovante(id: string) {
    setUploadingId(id);
    setUploadError(null);
    const form = new FormData();
    form.append("id", id);
    if (comprovanteFile) form.append("comprovante", comprovanteFile);
    const res = await fetch("/api/admin/financeiro", { method: "PATCH", body: form });
    const payload = await res.json().catch(() => ({}));
    setUploadingId(null);
    if (!res.ok) { setUploadError(payload.error ?? "Erro ao confirmar pagamento."); return; }
    fecharPagamento();
    setToast("Pagamento registrado.");
    load();
  }

  async function openBm(item: FinanceiroItem) {
    setBmLoading(true);
    setBmData(null);
    setBmError(null);
    const res = await fetch(`/api/admin/bm?codigo=${encodeURIComponent(item.colaboradorCodigo)}&ciclo=${encodeURIComponent(selectedCiclo)}`);
    if (res.ok) {
      setBmData(await res.json());
    } else {
      // Resposta não-ok nunca é descartada em silêncio — a pessoa vê o motivo.
      const payload = await res.json().catch(() => ({}));
      setBmError(payload.error ?? "Não foi possível carregar o boletim de medição.");
    }
    setBmLoading(false);
  }

  function exportarPagamentosConcluidos() {
    if (!selectedCiclo) return;
    window.open(`/api/admin/financeiro/exportar?ciclo=${encodeURIComponent(selectedCiclo)}`, "_blank", "noopener,noreferrer");
  }

  const filtered = useMemo(() => items.filter((item) => {
    if (filterStatus !== "todos" && item.status !== filterStatus) return false;
    if (busca) {
      const q = busca.toLowerCase();
      return (
        item.colaboradorNome.toLowerCase().includes(q) ||
        item.colaboradorCodigo.toLowerCase().includes(q) ||
        (item.razaoSocial ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  }), [items, filterStatus, busca]);

  // Resumo do ciclo — mesma fonte e mesma conta da tabela (valorAPagar = valor + rev).
  const porStatus = useMemo(() => {
    const base = Object.fromEntries(STATUS_FINANCEIROS.map((s) => [s, { n: 0, valor: 0 }])) as Record<string, { n: number; valor: number }>;
    for (const item of items) {
      const alvo = base[item.status] ?? (base[item.status] = { n: 0, valor: 0 });
      alvo.n += 1;
      alvo.valor += valorAPagar(item);
    }
    return base;
  }, [items]);
  const totalCiclo = items.reduce((soma, item) => soma + valorAPagar(item), 0);
  const detalhe = detalheId ? items.find((item) => item.id === detalheId) ?? null : null;
  const cicloAtual = ciclos.find((c) => c.ciclo === selectedCiclo);
  const modalAberto = Boolean(bmData || bmLoading || bmError);

  const cicloSelect = (
    <label className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
      Ciclo
      <div className="w-[120px]">
        <Select value={selectedCiclo} onChange={(e) => { setSelectedCiclo(e.target.value); setDetalheId(null); fecharPagamento(); }} aria-label="Ciclo">
          {ciclos.map((c) => <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>)}
        </Select>
      </div>
    </label>
  );

  return (
    <PageContainer className="grid gap-6 pb-24">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
        <PageHeader
          eyebrow="Fechamento"
          title="Financeiro"
          description="Notas fiscais e pagamentos dos BMs aprovados, por ciclo."
        />
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {!exportOnly && (
            <IconButton onClick={() => load()} title="Atualizar" disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </IconButton>
          )}
          <Button className="w-full sm:w-auto" variant="secondary" onClick={exportarPagamentosConcluidos} disabled={!selectedCiclo || loading}>
            <Download size={14} />
            Exportar concluídos
          </Button>
        </div>
      </div>

      {exportOnly ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          {cicloSelect}
          <p className="text-[12px] text-[var(--muted-foreground)]">A exportação traz os pagamentos concluídos do ciclo selecionado.</p>
        </Card>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" data-testid="financeiro-resumo">
            <DashboardKpiCard
              compact
              title="Total do ciclo"
              value={<BlurValue>{carregado ? currency.format(totalCiclo) : "–"}</BlurValue>}
              detail={`${number.format(items.length)} BM(s) aprovado(s)${cicloAtual?.mesReferencia ? ` · ${cicloAtual.mesReferencia}` : ""}`}
              icon={<Banknote size={17} />}
              tone="brand"
            />
            <DashboardKpiCard
              compact
              title="Aguardando NF"
              value={carregado ? number.format(porStatus.AGUARDANDO_NF.n) : "–"}
              detail={carregado ? `${currency.format(porStatus.AGUARDANDO_NF.valor)} a receber NF` : "—"}
              icon={<FileClock size={17} />}
              tone={porStatus.AGUARDANDO_NF.n ? "warning" : "neutral"}
            />
            <DashboardKpiCard
              compact
              title="Aguardando pagamento"
              value={carregado ? number.format(porStatus.APROVADO.n) : "–"}
              detail={carregado ? `${currency.format(porStatus.APROVADO.valor)} com NF recebida` : "—"}
              icon={<Clock3 size={17} />}
              tone={porStatus.APROVADO.n ? "brand" : "neutral"}
            />
            <DashboardKpiCard
              compact
              title="Concluído"
              value={carregado ? number.format(porStatus.PAGO.n) : "–"}
              detail={carregado ? `${currency.format(porStatus.PAGO.valor)} pagos` : "—"}
              icon={<CircleCheckBig size={17} />}
              tone="success"
            />
          </div>

          {/* Tabela — Card com min-w-0/max-w-full (HeroUI Card é flex-col) + overflow-x-auto no wrapper direto da tabela. */}
          <Card className="w-full min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div role="tablist" aria-label="Status" className="-mx-5 flex gap-x-5 overflow-x-auto whitespace-nowrap px-5 xl:mx-0 xl:px-0">
                {(["todos", ...STATUS_FINANCEIROS] as string[]).map((valor) => {
                  const ativo = filterStatus === valor;
                  const count = valor === "todos" ? items.length : porStatus[valor]?.n ?? 0;
                  return (
                    <button
                      key={valor}
                      type="button"
                      role="tab"
                      aria-selected={ativo}
                      onClick={() => setFilterStatus(valor)}
                      className={`border-b-2 pb-2.5 pt-1 text-sm transition xl:-mb-3 ${ativo ? "border-[var(--primary)] font-semibold text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                    >
                      {valor === "todos" ? "Todos" : STATUS_FILTRO_LABEL[valor]} <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <span className="relative min-w-0 sm:w-[300px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#9CA3AF]" size={14} />
                  <Input
                    className="pl-8"
                    aria-label="Buscar pagamentos"
                    placeholder="Nome, ID ou empresa..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </span>
                {cicloSelect}
              </div>
            </div>

            {loading && !carregado ? (
              <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Carregando…</div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Nenhum pagamento encontrado para este ciclo e filtro.</div>
            ) : (
              <FinanceiroTable itens={filtered} onOpen={(item) => { setDetalheId(item.id); fecharPagamento(); }} />
            )}
          </Card>
        </>
      )}

      {!exportOnly && detalhe && (
        <FinanceiroDrawer
          item={detalhe}
          ciclo={selectedCiclo}
          podeRegistrarPagamento={!exportOnly}
          escEnabled={!modalAberto}
          confirmando={uploadFormId === detalhe.id}
          enviando={uploadingId === detalhe.id}
          erro={uploadFormId === detalhe.id ? uploadError : null}
          onIniciarPagamento={() => { setUploadFormId(detalhe.id); setComprovanteFile(null); setUploadError(null); }}
          onCancelarPagamento={fecharPagamento}
          onArquivo={(file) => { setComprovanteFile(file); setUploadError(null); }}
          onConfirmarPagamento={() => enviarComprovante(detalhe.id)}
          onVerBm={() => openBm(detalhe)}
          onClose={() => { setDetalheId(null); fecharPagamento(); }}
        />
      )}

      {/* Modal BM — boletim completo (mesmo componente/endpoint de sempre), acima do detalhe. */}
      {modalAberto && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-0 backdrop-blur-[1px] sm:p-4 sm:pt-10">
          <div className="min-h-screen w-full max-w-5xl rounded-none bg-white shadow-2xl sm:min-h-0 sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Boletim de Medição</p>
              <IconButton onClick={() => { setBmData(null); setBmLoading(false); setBmError(null); }} title="Fechar boletim">
                <X size={16} />
              </IconButton>
            </div>
            <div className="p-4 sm:p-5">
              {bmLoading ? (
                <div className="flex items-center justify-center gap-3 py-10 text-sm text-[var(--muted-foreground)]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]" />
                  Carregando boletim…
                </div>
              ) : bmError ? (
                <div className="rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-4 py-3 text-sm font-medium text-[var(--error)]">{bmError}</div>
              ) : bmData ? (
                <BoletimMedicao data={bmData} />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[80] rounded-lg bg-[#16A34A] px-4 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>
      )}
    </PageContainer>
  );
}
