"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, FileText, RefreshCw, RotateCcw, X } from "lucide-react";
import { Badge, BlurValue, Button, Card, Input, Select, SectionHeader } from "@/components/ui";
import { useBlur } from "@/components/providers";
import { BoletimMedicao, type BmData } from "@/components/boletim-medicao";
type CicloEntry = { ciclo: string; mesReferencia: string | null; updatedAt: string };

type FinanceiroItem = {
  id: string;
  colaboradorCodigo: string;
  colaboradorNome: string;
  status: string;
  nfArquivoNome: string | null;
  nfCarregadoAt: string | null;
  pagoAt: string | null;
  comprovanteArquivoNome: string | null;
  comprovanteCarregadoAt: string | null;
  valor: number;
  rev: number;
  cpfCnpj: string | null;
  razaoSocial: string | null;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function fmtDate(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function statusInfo(status: string) {
  if (status === "PAGO")         return { label: "Concluído",       badge: "success" as const, color: "text-[#16A34A]" };
  if (status === "APROVADO")     return { label: "Aguardando pgto.", badge: "brand"   as const, color: "text-[#2563EB]" };
  return                                { label: "Aguardando NF",   badge: "warning"  as const, color: "text-[#D97706]" };
}

function rowBg(status: string) {
  if (status === "PAGO")     return "border-[#BBF7D0] bg-[#F0FDF4]";
  if (status === "APROVADO") return "border-[#BFDBFE] bg-[#EFF6FF]";
  return "border-[#FDE68A] bg-[#FFFBEB]";
}

// ─── Fluxo do processo ────────────────────────────────────────────────────────

function ProcessFlow({ steps }: { steps: { label: string; desc: string; color: string; bg: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`flex items-center gap-2 rounded-lg ${s.bg} px-3 py-2`}>
            <span className={`text-xs font-bold ${s.color}`}>{s.label}</span>
            <span className="hidden text-[10px] text-[#9CA3AF] sm:inline">{s.desc}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight size={14} className="shrink-0 text-[#9CA3AF]" />}
        </div>
      ))}
    </div>
  );
}

const FINANCEIRO_FLOW = [
  { label: "Aguardando NF",   desc: "NF não enviada",       color: "text-[#D97706]", bg: "bg-[#FFFBEB]" },
  { label: "Aguardando pgto.", desc: "NF recebida",          color: "text-[#2563EB]", bg: "bg-[#EFF6FF]" },
  { label: "Concluído",       desc: "Pagamento realizado",   color: "text-[#16A34A]", bg: "bg-[#F0FDF4]" },
];

// ─── KPI cards ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}

// ─── FinanceiroPanel ─────────────────────────────────────────────────────────

export function FinanceiroPanel({ ciclos }: { ciclos: CicloEntry[] }) {
  const { blur } = useBlur();
  const [selectedCiclo, setSelectedCiclo] = useState(ciclos[0]?.ciclo ?? "");
  const [items, setItems]                 = useState<FinanceiroItem[]>([]);
  const [loading, setLoading]             = useState(false);
  const [busca, setBusca]                 = useState("");
  const [uploadingId, setUploadingId]     = useState<string | null>(null);
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [uploadError, setUploadError]     = useState<string | null>(null);
  const [filterStatus, setFilterStatus]   = useState("todos");

  const load = useCallback(async () => {
    if (!selectedCiclo) return;
    setLoading(true);
    const res = await fetch(`/api/admin/financeiro?ciclo=${encodeURIComponent(selectedCiclo)}`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, [selectedCiclo]);

  useEffect(() => { load(); }, [load]);

  async function enviarComprovante(id: string) {
    if (!comprovanteFile) return;
    setUploadingId(id);
    setUploadError(null);
    const form = new FormData();
    form.append("id", id);
    form.append("comprovante", comprovanteFile);
    const res = await fetch("/api/admin/financeiro", { method: "PATCH", body: form });
    const payload = await res.json().catch(() => ({}));
    setUploadingId(null);
    if (!res.ok) { setUploadError(payload.error ?? "Erro ao enviar comprovante."); return; }
    setComprovanteFile(null);
    setUploadError(null);
    // fechar o form de upload
    setUploadFormId(null);
    load();
  }

  const [uploadFormId, setUploadFormId]   = useState<string | null>(null);
  const [bmData, setBmData]               = useState<BmData | null>(null);
  const [bmLoading, setBmLoading]         = useState(false);
  const [voltandoId, setVoltandoId]       = useState<string | null>(null);
  const [voltarError, setVoltarError]     = useState<{ id: string; msg: string } | null>(null);

  async function voltarBm(id: string) {
    setVoltandoId(id);
    setVoltarError(null);
    const res = await fetch("/api/admin/financeiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "VOLTAR_BM", id }),
    });
    const payload = await res.json().catch(() => ({}));
    setVoltandoId(null);
    if (!res.ok) { setVoltarError({ id, msg: payload.error ?? "Erro ao retornar BM." }); return; }
    load();
  }

  async function openBm(item: FinanceiroItem) {
    setBmLoading(true);
    setBmData(null);
    const res = await fetch(`/api/admin/bm?codigo=${encodeURIComponent(item.colaboradorCodigo)}&ciclo=${encodeURIComponent(selectedCiclo)}`);
    if (res.ok) setBmData(await res.json());
    setBmLoading(false);
  }

  const filtered = items.filter((item) => {
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
  });

  const totalValor = filtered.reduce((s, i) => s + i.valor + i.rev, 0);
  const nAguardandoNf = items.filter((i) => i.status === "AGUARDANDO_NF").length;
  const nAguardandoPgto = items.filter((i) => i.status === "APROVADO").length;
  const nConcluido = items.filter((i) => i.status === "PAGO").length;

  return (
    <div className="grid gap-6 mx-auto w-full" style={{ maxWidth: "80rem" }}>
      <SectionHeader
        title="Painel Financeiro"
        description="Acompanhe o fluxo de notas fiscais e pagamentos por ciclo."
        action={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Atualizar
          </Button>
        }
      />

      {/* Fluxo do processo */}
      <Card className="p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Fluxo do processo financeiro</p>
        <ProcessFlow steps={FINANCEIRO_FLOW} />
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Aguardando NF"    value={nAguardandoNf}    color="text-[#D97706]" />
        <KpiCard label="Aguardando pgto." value={nAguardandoPgto}  color="text-[#2563EB]" />
        <KpiCard label="Concluído"        value={nConcluido}        color="text-[#16A34A]" />
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid w-full gap-1.5 text-xs font-semibold text-[#555555] sm:w-auto">
            Ciclo
            <Select value={selectedCiclo} onChange={(e) => setSelectedCiclo(e.target.value)} className="sm:min-w-[160px]">
              {ciclos.map((c) => <option key={c.ciclo} value={c.ciclo}>{c.ciclo}</option>)}
            </Select>
          </label>
          <label className="grid w-full gap-1.5 text-xs font-semibold text-[#555555] sm:w-auto">
            Status
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="sm:min-w-[180px]">
              <option value="todos">Todos</option>
              <option value="AGUARDANDO_NF">Aguardando NF</option>
              <option value="APROVADO">Aguardando pgto.</option>
              <option value="PAGO">Concluído</option>
            </Select>
          </label>
          <div className="flex-1">
            <p className="mb-1.5 text-xs font-semibold text-[#555555]">Buscar</p>
            <Input
              placeholder="Nome, código ou empresa…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="min-w-[220px]"
            />
          </div>
        </div>
      </Card>

      {/* Modal BM */}
      {(bmData || bmLoading) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4 sm:pt-10">
          <div className="w-full max-w-5xl rounded-none bg-white shadow-2xl sm:rounded-xl min-h-screen sm:min-h-0">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <p className="text-sm font-semibold text-[#1A1A1A]">Boletim de Medição</p>
              <button
                onClick={() => { setBmData(null); setBmLoading(false); }}
                className="rounded-lg p-1.5 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#1A1A1A]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              {bmLoading ? (
                <div className="flex items-center gap-3 py-10 justify-center text-sm text-[#555555]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
                  Carregando boletim…
                </div>
              ) : bmData ? (
                <BoletimMedicao data={bmData} />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Tabela */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-3 p-6 text-sm text-[#555555]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
            Carregando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#9CA3AF]">
            Nenhum colaborador encontrado para este ciclo e filtro.
          </div>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                    {["Colaborador", "CNPJ / CPF", "Razão Social", "Valor", "Boletim", "Nota Fiscal", "Recebida em", "Status", ""].map((h, i) => (
                      <th key={i} className={`whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#555555] ${i >= 3 ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const { label, badge } = statusInfo(item.status);
                    const total = item.valor + item.rev;
                    const showUploadForm = uploadFormId === item.id;
                    return (
                      <>
                        <tr key={item.id} className={`transition-colors ${showUploadForm ? "" : "border-b last:border-0"} ${rowBg(item.status)}`}>
                          <td className="px-3 py-2.5">
                            <p className="font-semibold text-[#1A1A1A]">{item.colaboradorNome}</p>
                            <p className="text-[10px] font-mono text-[#9CA3AF]">{item.colaboradorCodigo}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-[#555555]">
                            <BlurValue>{item.cpfCnpj ?? "–"}</BlurValue>
                          </td>
                          <td className="px-3 py-2.5 text-[#555555]">{item.razaoSocial ?? "–"}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-[#1A1A1A]">
                            <BlurValue>{currency.format(total)}</BlurValue>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => openBm(item)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#1F3864]/10 px-2 py-1 text-[10px] font-medium text-[#1F3864] hover:bg-[#1F3864]/20"
                            >
                              <FileText size={11} />
                              Ver BM
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {item.nfArquivoNome ? (
                              <a
                                href={`/api/admin/nf/${item.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={item.nfArquivoNome}
                                className="inline-flex items-center justify-center rounded-lg bg-[#16A34A]/10 p-1.5 text-[#16A34A] hover:bg-[#16A34A]/20"
                              >
                                <FileText size={14} />
                              </a>
                            ) : (
                              <span className="text-[10px] text-[#9CA3AF]">–</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-[10px] text-[#555555]">{fmtDate(item.nfCarregadoAt)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            <Badge variant={badge}>{label}</Badge>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            <div className="flex flex-col items-end gap-1.5">
                              {item.status === "AGUARDANDO_NF" && !showUploadForm && (
                                <Button
                                  variant="ghost"
                                  className="h-7 border border-[#E5E7EB] px-2.5 text-[10px] text-[#6B7280] hover:bg-[#F9FAFB]"
                                  onClick={() => { setVoltarError(null); voltarBm(item.id); }}
                                  disabled={voltandoId === item.id}
                                >
                                  <RotateCcw size={11} />
                                  {voltandoId === item.id ? "Retornando…" : "Voltar BM"}
                                </Button>
                              )}
                              {item.status === "APROVADO" && !showUploadForm && (
                                <Button
                                  variant="success"
                                  className="h-7 px-2.5 text-[10px]"
                                  onClick={() => { setUploadFormId(item.id); setComprovanteFile(null); setUploadError(null); }}
                                >
                                  <CheckCircle2 size={12} />
                                  Marcar pago
                                </Button>
                              )}
                              {item.status === "PAGO" && (
                                <>
                                  <span className="text-[10px] text-[#555555]">{fmtDate(item.pagoAt)}</span>
                                  {item.comprovanteArquivoNome && (
                                    <a
                                      href={`/api/colaborador/comprovante/${item.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 rounded-lg bg-[#2563EB]/10 px-2 py-1 text-[10px] font-medium text-[#2563EB] hover:bg-[#2563EB]/20"
                                    >
                                      <FileText size={11} />
                                      Ver comprovante
                                    </a>
                                  )}
                                </>
                              )}
                              {voltarError?.id === item.id && (
                                <p className="text-[10px] text-[#B91C1C] max-w-[200px] text-right">{voltarError.msg}</p>
                              )}
                            </div>
                          </td>
                        </tr>
                        {showUploadForm && (
                          <tr className="border-b last:border-0 bg-[#F0FDF4]">
                            <td colSpan={9} className="px-5 py-4">
                              <div className="flex flex-wrap items-end gap-4 rounded-xl border border-[#BBF7D0] bg-white p-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-[#15803D]">
                                  <CheckCircle2 size={16} className="text-[#16A34A]" />
                                  Confirmar pagamento — {item.colaboradorNome}
                                </div>
                                <div className="flex flex-1 flex-wrap items-center gap-3">
                                  <div className="flex-1">
                                    <p className="mb-1 text-xs font-semibold text-[#555555]">Comprovante de pagamento (PDF, JPG ou PNG)</p>
                                    <input
                                      type="file"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      className="block w-full text-sm text-[#555555] file:mr-3 file:rounded-lg file:border-0 file:bg-[#16A34A] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-[#15803D]"
                                      onChange={(e) => { setComprovanteFile(e.target.files?.[0] ?? null); setUploadError(null); }}
                                    />
                                  </div>
                                  <div className="flex shrink-0 gap-2">
                                    <Button
                                      variant="success"
                                      className="h-9 px-4 text-xs"
                                      disabled={!comprovanteFile || uploadingId === item.id}
                                      onClick={() => enviarComprovante(item.id)}
                                    >
                                      {uploadingId === item.id ? "Enviando…" : "Confirmar pagamento"}
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      className="h-9 px-3 text-xs"
                                      onClick={() => { setUploadFormId(null); setComprovanteFile(null); setUploadError(null); }}
                                    >
                                      Cancelar
                                    </Button>
                                  </div>
                                </div>
                                {uploadError && <p className="w-full text-xs text-[#B91C1C]">{uploadError}</p>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB]">
                    <td colSpan={3} className="px-3 py-2.5 text-[10px] font-semibold text-[#555555]">
                      {filtered.length} colaborador(es)
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[11px] font-bold text-[#1A1A1A]">
                      <BlurValue>{currency.format(totalValor)}</BlurValue>
                    </td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
