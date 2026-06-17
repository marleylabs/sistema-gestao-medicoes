"use client";

import { type ReactNode, useEffect, useRef, useMemo, useState } from "react";
import { Edit3, MessageCircle, Plus, Search, Send, Trash2, X } from "lucide-react";
import { Badge, BlurValue, Button, Card, Field, IconButton, Input, Select } from "@/components/ui";
import type { MapaPagamentoItem, Profissional } from "@/components/types";

type Revisao = {
  id: string;
  colaboradorCodigo: string;
  colaboradorNome: string | null;
  proximaRevisaoLabel: string;
  pontosDiscordancia: string | null;
  respostaAdmin: string | null;
  revisaoSolicitadaAt: string | null;
};

type SgcStatusEntry = {
  status: string;
  revisaoNumero: number;
  id: string;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function normalizeText(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function statusLabel(item: MapaPagamentoItem) {
  return normalizeText(item.ato) === "PRODUCAO" ? "PRODUÇÃO" : "ATO";
}

function money(value: number) {
  return value ? currency.format(value) : "–";
}

function currencyInputValue(value: number) {
  return currency.format(value || 0);
}

function formatCurrencyInput(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return currencyInputValue(0);
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return currencyInputValue(Number.isFinite(parsed) ? parsed : 0);
}

function ratio(value: number) {
  return value ? percent.format(value) : "–";
}

function contractParticipation(item: MapaPagamentoItem, contrato: string) {
  const total = item.intrSossego + item.salobo + item.acg + item.escadasAlumar;
  const allocation = normalizeText(item.ato);
  if (allocation === normalizeText(contrato)) return 1;
  if (allocation !== "PRODUCAO") return 0;
  if (contrato === "Intr. Sossego") return item.intrSossego;
  if (contrato === "Salobo") return item.salobo;
  if (contrato === "ACG") return item.acg;
  if (contrato === "Escadas Alumar") return item.escadasAlumar;
  if (contrato === "Não alocado") {
    const named = ["INTR. SOSSEGO", "SALOBO", "ACG", "ESCADAS ALUMAR"];
    return total === 0 && !named.includes(allocation) ? 1 : 0;
  }
  return 0;
}

export function MapaPagamentoTable({
  itens,
  profissionais = [],
  selectedCodigo,
  selectedContrato,
  isAdmin = false,
  onChanged,
  revisoes = [],
  sgcStatus = {},
  onEnviarBm,
  ciclo = "2605",
}: {
  itens: MapaPagamentoItem[];
  profissionais?: Profissional[];
  selectedCodigo: string;
  selectedContrato: string;
  isAdmin?: boolean;
  onChanged?: () => Promise<void> | void;
  revisoes?: Revisao[];
  sgcStatus?: Record<string, SgcStatusEntry>;
  onEnviarBm?: (colaboradorCodigo: string) => Promise<void>;
  ciclo?: string;
}) {
  const [search, setSearch]           = useState("");
  const [status, setStatus]           = useState("");
  const [sortOrder, setSortOrder]     = useState("");
  const [editingItem, setEditingItem] = useState<MapaPagamentoItem | null>(null);
  const [isCreating, setIsCreating]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [enviandoCodigo, setEnviandoCodigo] = useState<string | null>(null);

  const alocacoesUnicas = useMemo(
    () => [...new Set(itens.map((i) => i.ato).filter(Boolean) as string[])].sort(),
    [itens],
  );

  const revisaoMap = useMemo(
    () => new Map(revisoes.map((r) => [r.colaboradorCodigo, r])),
    [revisoes],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    const result = itens.filter((item) => {
      const s = statusLabel(item);
      const matchStatus      = status ? s === status : true;
      const matchColab       = selectedCodigo ? item.projetistaCodigo === selectedCodigo : true;
      const matchContract    = selectedContrato ? contractParticipation(item, selectedContrato) > 0 : true;
      const searchable       = [item.ato, item.projetistaCodigo, item.responsavel, item.cpfCnpj, item.razaoSocial]
        .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return matchStatus && matchColab && matchContract && (!q || searchable.includes(q));
    });

    if (!sortOrder) return result;
    return [...result].sort((a, b) => {
      const an = a.responsavel ?? a.projetistaCodigo ?? "";
      const bn = b.responsavel ?? b.projetistaCodigo ?? "";
      const cmp = an.localeCompare(bn, "pt-BR", { sensitivity: "base" });
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }, [itens, search, selectedCodigo, selectedContrato, sortOrder, status]);

  const filterDescription = selectedContrato
    ? `${filteredItems.length} participantes alocados em ${selectedContrato}`
    : `${filteredItems.length} participantes com pagamento no ciclo atual`;

  return (
    <Card className="overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="border-b border-[#E5E7EB] bg-white px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1A1A1A]">Pagamentos por colaborador</h2>
            <p className="mt-0.5 text-sm text-[#555555]">{filterDescription}</p>
          </div>
          <div className="flex flex-1 flex-wrap items-end gap-3 xl:justify-end">
            <label className="grid min-w-[200px] flex-1 gap-1.5 text-xs font-semibold text-[#555555]">
              Pesquisar
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={14} />
                <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, nome ou empresa" />
              </span>
            </label>
            <label className="grid min-w-[140px] gap-1.5 text-xs font-semibold text-[#555555]">
              Tipo de atuação
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos</option>
                <option value="ATO">ATO</option>
                <option value="PRODUÇÃO">Produção</option>
              </Select>
            </label>
            <label className="grid min-w-[160px] gap-1.5 text-xs font-semibold text-[#555555]">
              Ordenar por nome
              <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="">Padrão da planilha</option>
                <option value="asc">A → Z</option>
                <option value="desc">Z → A</option>
              </Select>
            </label>
            {isAdmin && (
              <Button onClick={() => setIsCreating(true)} className="shrink-0">
                <Plus size={15} />
                Adicionar
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Payment modal ── */}
      {isAdmin && (isCreating || editingItem) && (
        <PaymentModal
          item={editingItem}
          ciclo={ciclo}
          saving={saving}
          profissionais={profissionais}
          alocacoes={alocacoesUnicas}
          onCancel={() => { setIsCreating(false); setEditingItem(null); }}
          onSave={async (payload) => {
            setSaving(true);
            try {
              const url = editingItem ? `/api/mapa-pagamento/${editingItem.id}` : "/api/mapa-pagamento";
              const res = await fetch(url, {
                method: editingItem ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, ciclo }),
              });
              if (!res.ok) throw new Error("Falha ao salvar pagamento.");
              setIsCreating(false);
              setEditingItem(null);
              await onChanged?.();
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {/* ── Table ── */}
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1380px] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#F9FAFB]">
              {[
                { label: "Alocação", align: "left" },
                { label: "Projetista", align: "left" },
                { label: "CPF / CNPJ", align: "left" },
                { label: "Razão social", align: "left" },
                { label: "Intr. Sossego", align: "right" },
                { label: "Salobo", align: "right" },
                { label: "ACG", align: "right" },
                { label: "Escadas Alumar", align: "right" },
                { label: "Pagamento", align: "right" },
                { label: "Revisão", align: "right" },
                { label: "Atuação", align: "left" },
                ...(isAdmin ? [{ label: "Ações", align: "right" }] : []),
              ].map(({ label, align }) => (
                <th
                  key={label}
                  className={`border-b border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#555555] text-${align}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item, i) => {
              const codigo = item.projetistaCodigo ?? "";
              const revisao = revisaoMap.get(codigo);
              const hasRevisao = !!revisao;
              const dropdownOpen = openDropdownId === item.id;
              const sgcEntry = sgcStatus[codigo];
              const sgcStatusValue = sgcEntry?.status ?? "AGUARDANDO_ENVIO";
              const isRevisaoEnvio = sgcStatusValue === "REVISAO_SOLICITADA";
              const temAlteracao = isRevisaoEnvio && revisao?.revisaoSolicitadaAt && item.updatedAt
                ? new Date(item.updatedAt) > new Date(revisao.revisaoSolicitadaAt)
                : true;
              const podeEnviar = isAdmin && onEnviarBm && ["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA"].includes(sgcStatusValue) && temAlteracao;
              const enviando = enviandoCodigo === codigo;
              const isAprovado = sgcStatusValue === "APROVADO";
              const isPendente = sgcStatusValue === "PENDENTE";

              return (
                <tr
                  key={item.id}
                  className={`border-b last:border-0 transition-colors ${
                    isAprovado
                      ? "border-[#BBF7D0] bg-[#F0FDF4] hover:bg-[#DCFCE7]"
                      : isPendente
                      ? "border-[#D1D5DB] bg-[#E5E7EB] hover:bg-[#D1D5DB]"
                      : hasRevisao
                      ? "border-[#FDE68A] bg-[#FFFBEB] hover:bg-[#FEF3C7]"
                      : `border-[#F3F4F6] hover:bg-[#F9FAFB] ${i % 2 !== 0 ? "bg-[#FAFAFA]" : "bg-white"}`
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-[#1A1A1A]">{item.ato ?? "–"}</td>
                  <td className="px-4 py-3 font-semibold text-[#1A1A1A]">
                    <div className="flex items-center gap-2">
                      {item.responsavel ?? item.projetistaCodigo ?? "–"}
                      {isAprovado && (
                        <Badge variant="success" className="shrink-0">Aprovado</Badge>
                      )}
                      {isPendente && (
                        <Badge variant="neutral" className="shrink-0">Aguardando</Badge>
                      )}
                      {!isAprovado && !isPendente && hasRevisao && (
                        <Badge variant="warning" className="shrink-0">Revisão</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#555555]"><BlurValue>{item.cpfCnpj ?? "–"}</BlurValue></td>
                  <td className="px-4 py-3 text-[#555555]">{item.razaoSocial ?? "–"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.intrSossego)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.salobo)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.acg)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">{ratio(item.escadasAlumar)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#1A1A1A]"><BlurValue>{money(item.valor)}</BlurValue></td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555555]">
                    {sgcEntry && sgcEntry.revisaoNumero > 0 ? `Rev. ${sgcEntry.revisaoNumero}` : "–"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusLabel(item) === "ATO" ? "primary" : "success"}>
                      {statusLabel(item)}
                    </Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {(podeEnviar || (isRevisaoEnvio && !temAlteracao)) && (
                          <Button
                            disabled={enviando || !temAlteracao}
                            title={
                              !temAlteracao
                                ? "Faça alguma alteração no pagamento antes de reenviar"
                                : isRevisaoEnvio
                                ? "Reenviar medição revisada"
                                : "Enviar BM para o colaborador"
                            }
                            onClick={async () => {
                              setEnviandoCodigo(codigo);
                              try { await onEnviarBm!(codigo); } finally { setEnviandoCodigo(null); }
                            }}
                            className={`h-8 shrink-0 gap-1 whitespace-nowrap px-2 text-xs font-semibold ${
                              isRevisaoEnvio
                                ? "border border-[#FCD34D] bg-[#FFFBEB] !text-[#D97706] hover:bg-[#FEF3C7]"
                                : "border border-[#BFDBFE] bg-[#EFF6FF] !text-[#2563EB] hover:bg-[#DBEAFE]"
                            }`}
                            variant="ghost"
                          >
                            <Send size={12} />
                            {enviando ? "Enviando…" : isRevisaoEnvio ? "Reenviar BM" : "Enviar BM"}
                          </Button>
                        )}
                        {hasRevisao && (
                          <div className="relative">
                            <IconButton
                              className="border-[#FCD34D] bg-[#FFFBEB] text-[#D97706] hover:border-[#F59E0B] hover:bg-[#FEF3C7]"
                              title="Ver comentário do colaborador"
                              onClick={() => setOpenDropdownId(dropdownOpen ? null : item.id)}
                            >
                              <MessageCircle size={14} />
                            </IconButton>
                            {dropdownOpen && (
                              <ComentarioDropdown
                                revisao={revisao}
                                onClose={() => setOpenDropdownId(null)}
                                onRespondido={onChanged}
                                ciclo={ciclo}
                              />
                            )}
                          </div>
                        )}
                        <IconButton
                          className="hover:border-[#2563EB] hover:text-[#2563EB]"
                          title="Editar pagamento"
                          onClick={() => setEditingItem(item)}
                        >
                          <Edit3 size={14} />
                        </IconButton>
                        <IconButton
                          className="hover:border-[#DC2626] hover:text-[#DC2626]"
                          title="Excluir pagamento"
                          onClick={async () => {
                            if (!window.confirm("Excluir este pagamento?")) return;
                            const res = await fetch(`/api/mapa-pagamento/${item.id}`, { method: "DELETE" });
                            if (!res.ok) throw new Error("Falha ao excluir pagamento.");
                            await onChanged?.();
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!filteredItems.length && (
              <tr>
                <td colSpan={isAdmin ? 12 : 11} className="px-4 py-12 text-center text-sm text-[#9CA3AF]">
                  Nenhuma linha encontrada com os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── ComentarioDropdown ───────────────────────────────────────────────────────

function ComentarioDropdown({ revisao, onClose, onRespondido, ciclo = "2605" }: { revisao: Revisao; onClose: () => void; onRespondido?: () => void; ciclo?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [resposta, setResposta] = useState(revisao.respostaAdmin ?? "");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado]   = useState(!!revisao.respostaAdmin);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  async function enviarResposta() {
    if (!resposta.trim()) return;
    setEnviando(true);
    await fetch("/api/sgc/responder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colaboradorCodigo: revisao.colaboradorCodigo, resposta: resposta.trim(), ciclo }),
    });
    setEnviando(false);
    setEnviado(true);
    onRespondido?.();
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-[#FCD34D] bg-white shadow-xl"
    >
      {/* Header */}
      <div className="border-b border-[#FEF3C7] bg-[#FFFBEB] px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-[#D97706]">Revisão solicitada</p>
        <p className="mt-0.5 text-sm font-semibold text-[#1A1A1A]">
          {revisao.colaboradorNome ?? revisao.colaboradorCodigo}
        </p>
        <p className="text-xs text-[#555555]">{revisao.proximaRevisaoLabel}</p>
      </div>

      {/* Comentário do colaborador */}
      <div className="border-b border-[#F3F4F6] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Comentário do colaborador</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[#1A1A1A]">
          {revisao.pontosDiscordancia ?? "Nenhum comentário informado."}
        </p>
      </div>

      {/* Resposta do admin */}
      <div className="p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">
          {enviado ? "Resposta enviada" : "Responder"}
        </p>

        {enviado ? (
          <div className="space-y-2">
            <p className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-sm text-[#15803D]">
              {resposta}
            </p>
            <button
              className="text-xs text-[#2563EB] hover:underline"
              onClick={() => setEnviado(false)}
            >
              Editar resposta
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              className="min-h-20 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 resize-none"
              placeholder="Digite sua resposta ao colaborador…"
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
            />
            <Button
              className="w-full"
              onClick={enviarResposta}
              disabled={enviando || !resposta.trim()}
            >
              <Send size={13} />
              {enviando ? "Enviando…" : "Enviar resposta"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

type DocLine = {
  _key: string;
  id?: string;
  se: string;
  contrato: string;
  numeroDocumento: string;
  formato: string;
  equivalenteA1Horas: string;
  percentualEmissao: string;
  tipo2: string;
  condicao: string;
  obs: string;
  _dirty: boolean;
};

function newDocLine(): DocLine {
  return {
    _key: Math.random().toString(36).slice(2),
    se: "", contrato: "", numeroDocumento: "", formato: "",
    equivalenteA1Horas: "0", percentualEmissao: "0", tipo2: "", condicao: "0",
    obs: "", _dirty: true,
  };
}

function docValorMedido(doc: DocLine): number {
  const a1eq  = parseFloat(doc.equivalenteA1Horas) || 0;
  const pct   = (parseFloat(doc.percentualEmissao) || 0) / 100;
  const preco = parseFloat(doc.condicao) || 0;
  return a1eq * preco * pct;
}

type PaymentForm = {
  ato: string;
  projetistaCodigo: string;
  responsavel: string;
  cpfCnpj: string;
  razaoSocial: string;
  intrSossego: string;
  salobo: string;
  acg: string;
  escadasAlumar: string;
  horas: string;
  valor: string;
  rev: string;
  status: string;
};

function paymentForm(item: MapaPagamentoItem | null): PaymentForm {
  return {
    ato: item?.ato ?? "",
    projetistaCodigo: item?.projetistaCodigo ?? "",
    responsavel: item?.responsavel ?? "",
    cpfCnpj: item?.cpfCnpj ?? "",
    razaoSocial: item?.razaoSocial ?? "",
    intrSossego: String(item?.intrSossego ?? 0),
    salobo: String(item?.salobo ?? 0),
    acg: String(item?.acg ?? 0),
    escadasAlumar: String(item?.escadasAlumar ?? 0),
    horas: String(item?.horas ?? 0),
    valor: currencyInputValue(item?.valor ?? 0),
    rev: String(item?.rev ?? 0),
    status: item?.status ?? "",
  };
}

function PaymentModal({
  item,
  ciclo,
  saving,
  profissionais,
  alocacoes: alocacoesCiclo,
  onCancel,
  onSave,
}: {
  item: MapaPagamentoItem | null;
  ciclo: string;
  saving: boolean;
  profissionais: Profissional[];
  alocacoes: string[];
  onCancel: () => void;
  onSave: (payload: PaymentForm) => Promise<void>;
}) {
  const [form, setForm] = useState<PaymentForm>(() => paymentForm(item));
  const [codigoQuery, setCodigoQuery] = useState(item?.projetistaCodigo ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [alocacoesGlobais, setAlocacoesGlobais] = useState<string[]>([]);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // ── Document lines ──
  const [docs, setDocs] = useState<DocLine[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsSaving, setDocsSaving] = useState(false);
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());

  const codigo = form.projetistaCodigo;

  useEffect(() => {
    if (!item || !codigo || !ciclo) return;
    setDocsLoading(true);
    fetch(`/api/mapa-pagamento/documentos?codigo=${encodeURIComponent(codigo)}&ciclo=${encodeURIComponent(ciclo)}`)
      .then((r) => r.json())
      .then((data: Array<{ id: string; se: string; contrato: string | null; numeroDocumento: string | null; formato: string | null; equivalenteA1Horas: number; percentualEmissao: number; tipo2: string | null; condicao: string | null; obs: string | null; }>) => {
        setDocs(data.map((d) => ({
          _key: d.id,
          id: d.id,
          se: d.se ?? "",
          contrato: d.contrato ?? "",
          numeroDocumento: d.numeroDocumento ?? "",
          formato: d.formato ?? "",
          equivalenteA1Horas: String(d.equivalenteA1Horas),
          percentualEmissao: String(Math.round(d.percentualEmissao * 100)),
          tipo2: d.tipo2 ?? "",
          condicao: d.condicao ?? "0",
          obs: d.obs ?? "",
          _dirty: false,
        })));
      })
      .catch(() => {})
      .finally(() => setDocsLoading(false));
  }, [item, codigo, ciclo]);

  const totalDocsValor = docs.reduce((s, d) => s + docValorMedido(d), 0);

  function updateDoc(key: string, field: keyof Omit<DocLine, "_key" | "id" | "_dirty">, value: string) {
    setDocs((cur) => cur.map((d) => d._key === key ? { ...d, [field]: value, _dirty: true } : d));
  }

  async function saveDocLine(doc: DocLine) {
    setDocsSaving(true);
    try {
      const payload = {
        codigo,
        ciclo,
        se: doc.se,
        contrato: doc.contrato,
        numeroDocumento: doc.numeroDocumento,
        formato: doc.formato,
        equivalenteA1Horas: parseFloat(doc.equivalenteA1Horas) || 0,
        percentualEmissao: (parseFloat(doc.percentualEmissao) || 0) / 100,
        tipo2: doc.tipo2,
        condicao: doc.condicao,
        obs: doc.obs || null,
      };

      if (doc.id) {
        const res = await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const updated = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: updated.id, _dirty: false } : d));
      } else {
        const res = await fetch("/api/mapa-pagamento/documentos", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const created = await res.json() as { id: string };
        setDocs((cur) => cur.map((d) => d._key === doc._key ? { ...d, id: created.id, _dirty: false } : d));
      }
    } finally {
      setDocsSaving(false);
    }
  }

  async function deleteDocLine(doc: DocLine) {
    if (!doc.id) { setDocs((cur) => cur.filter((d) => d._key !== doc._key)); return; }
    setDeletingDocIds((s) => new Set(s).add(doc.id!));
    try {
      await fetch(`/api/mapa-pagamento/documentos/${doc.id}`, { method: "DELETE" });
      setDocs((cur) => cur.filter((d) => d._key !== doc._key));
    } finally {
      setDeletingDocIds((s) => { const n = new Set(s); n.delete(doc.id!); return n; });
    }
  }

  useEffect(() => {
    fetch("/api/mapa-pagamento/alocacoes")
      .then((r) => r.json())
      .then((data: string[]) => setAlocacoesGlobais(data))
      .catch(() => {});
  }, []);

  const alocacoes = useMemo(
    () => [...new Set([...alocacoesGlobais, ...alocacoesCiclo])].sort(),
    [alocacoesGlobais, alocacoesCiclo],
  );

  const suggestions = useMemo(() => {
    const q = codigoQuery.trim().toLowerCase();
    if (!q) return profissionais.slice(0, 8);
    return profissionais
      .filter((p) =>
        (p.codigo ?? "").toLowerCase().includes(q) ||
        (p.nome ?? "").toLowerCase().includes(q) ||
        (p.nomeCompleto ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [codigoQuery, profissionais]);

  function selectProfissional(p: Profissional) {
    setCodigoQuery(p.codigo ?? "");
    setForm((cur) => ({
      ...cur,
      projetistaCodigo: p.codigo ?? "",
      responsavel: p.nomeCompleto || p.nome || "",
      cpfCnpj: maskCpfCnpj(p.cpf || p.cnpj || cur.cpfCnpj),
      razaoSocial: p.razaoSocial || cur.razaoSocial,
    }));
    setShowSuggestions(false);
  }

  function update(field: keyof PaymentForm, value: string) {
    setForm((cur) => ({ ...cur, [field]: value }));
  }

  function maskCpfCnpj(v: string) {
    const d = v.replace(/\D/g, "");
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  function maskPercent(v: string) {
    const d = v.replace(/[^\d,\.]/g, "").replace(",", ".");
    const n = parseFloat(d);
    if (isNaN(n)) return "";
    return String(Math.min(Math.max(n, 0), 100));
  }

  // close suggestions on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onCancel(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A]">
              {item ? "Editar pagamento" : "Novo pagamento"}
            </h2>
            <p className="mt-0.5 text-sm text-[#555555]">
              {item ? "Atualize os dados do colaborador no ciclo atual." : "Preencha os dados para cadastrar um novo colaborador."}
            </p>
          </div>
          <IconButton onClick={onCancel} title="Fechar"><X size={16} /></IconButton>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(100vh - 220px)" }}>

          {/* Seção: Identificação */}
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Identificação</p>
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Alocação — combobox com digitação livre */}
            <MField label="Alocação">
              <input
                className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                list="alocacoes-list"
                value={form.ato ?? ""}
                onChange={(e) => update("ato", e.target.value)}
                placeholder="Selecione ou digite…"
                autoComplete="off"
              />
              <datalist id="alocacoes-list">
                {alocacoes.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </MField>

            {/* Nome (código) — autocomplete */}
            <MField label="Nome (código)">
              <div className="relative" ref={suggestionsRef}>
                <input
                  className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  placeholder="Digite o código ou nome…"
                  value={codigoQuery}
                  onChange={(e) => { setCodigoQuery(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 top-10 z-10 w-full overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white shadow-lg" style={{ maxHeight: "240px" }}>
                    {suggestions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#F5F5F5] border-b border-[#F3F4F6] last:border-0"
                        onMouseDown={() => selectProfissional(p)}
                      >
                        <span className="text-sm font-semibold text-[#1A1A1A]">{p.codigo}</span>
                        <span className="text-xs text-[#555555]">{p.nomeCompleto || p.nome}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </MField>

            {/* Projetista — auto-preenchido, editável */}
            <MField label="Projetista (nome completo)">
              <Input
                value={form.responsavel}
                onChange={(e) => update("responsavel", e.target.value)}
                placeholder="Preenchido automaticamente"
              />
            </MField>

            {/* CPF / CNPJ */}
            <MField label="CPF / CNPJ">
              <Input
                value={form.cpfCnpj}
                onChange={(e) => update("cpfCnpj", maskCpfCnpj(e.target.value))}
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                maxLength={18}
                inputMode="numeric"
              />
            </MField>

            {/* Razão social */}
            <MField label="Razão social" className="sm:col-span-2">
              <Input value={form.razaoSocial} onChange={(e) => update("razaoSocial", e.target.value)} />
            </MField>
          </div>

          {/* Seção: Alocação por contrato */}
          <p className="mb-3 mt-6 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Participação por contrato</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(["intrSossego", "salobo", "acg", "escadasAlumar"] as const).map((field, i) => (
              <MField key={field} label={["Intr. Sossego", "Salobo", "ACG", "Escadas Alumar"][i]}>
                <div className="relative">
                  <Input
                    value={form[field]}
                    onChange={(e) => update(field, maskPercent(e.target.value))}
                    onBlur={(e) => {
                      const n = parseFloat(e.target.value);
                      update(field, isNaN(n) ? "0" : String(n));
                    }}
                    placeholder="0"
                    inputMode="decimal"
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#9CA3AF]">%</span>
                </div>
              </MField>
            ))}
          </div>

          {/* Seção: Pagamento */}
          <p className="mb-3 mt-6 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Pagamento</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <MField label="Horas contabilizadas">
              <div className="relative">
                <Input
                  inputMode="decimal"
                  value={form.horas}
                  onChange={(e) => update("horas", e.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="0"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#9CA3AF]">h</span>
              </div>
            </MField>
            <MField label="Valor previsto">
              <Input
                inputMode="decimal"
                value={form.valor}
                onBlur={(e) => update("valor", formatCurrencyInput(e.target.value))}
                onChange={(e) => update("valor", e.target.value)}
                placeholder="R$ 0,00"
              />
            </MField>
            <MField label="Revisão">
              <Input value={form.rev} onChange={(e) => update("rev", e.target.value)} placeholder="0" />
            </MField>
          </div>

          {/* Seção: Documentos medidos */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">Documentos medidos</p>
            <div className="flex items-center gap-3">
              {totalDocsValor > 0 && (
                <button
                  type="button"
                  className="rounded-md border border-[#2563EB]/30 bg-[#EFF6FF] px-3 py-1 text-xs font-semibold text-[#2563EB] hover:bg-[#DBEAFE]"
                  onClick={() => update("valor", formatCurrencyInput(String(totalDocsValor)))}
                >
                  Usar total ({currency.format(totalDocsValor)})
                </button>
              )}
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F5F5F5]"
                onClick={() => setDocs((cur) => [...cur, newDocLine()])}
              >
                <Plus size={13} /> Adicionar linha
              </button>
            </div>
          </div>

          {docsLoading ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">Carregando documentos…</p>
          ) : docs.length === 0 ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">Nenhum documento. Clique em "Adicionar linha" para inserir.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#E5E7EB]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                    {["SE", "CTO", "NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH", "Preço Unit.", "Valor Medido", "Observação", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 text-left font-semibold text-[#555555]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => {
                    const valorMedido = docValorMedido(doc);
                    const isDeleting = doc.id ? deletingDocIds.has(doc.id) : false;
                    return (
                      <tr key={doc._key} className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FAFAFA]">
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-20 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.se} onChange={(e) => updateDoc(doc._key, "se", e.target.value)} placeholder="SE-001" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-24 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.contrato} onChange={(e) => updateDoc(doc._key, "contrato", e.target.value)} placeholder="CTO-X" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-24 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.numeroDocumento} onChange={(e) => updateDoc(doc._key, "numeroDocumento", e.target.value)} placeholder="NR-0001" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.formato} onChange={(e) => updateDoc(doc._key, "formato", e.target.value)} placeholder="A1" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.equivalenteA1Horas} onChange={(e) => updateDoc(doc._key, "equivalenteA1Horas", e.target.value)} placeholder="0" inputMode="decimal" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <input className="h-7 w-16 rounded border border-[#E5E7EB] px-2 pr-5 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.percentualEmissao} onChange={(e) => updateDoc(doc._key, "percentualEmissao", e.target.value)} placeholder="100" inputMode="decimal" />
                            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#9CA3AF]">%</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input className="h-7 w-28 rounded border border-[#E5E7EB] px-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.tipo2} onChange={(e) => updateDoc(doc._key, "tipo2", e.target.value)} placeholder="Tipo" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#9CA3AF]">R$</span>
                            <input className="h-7 w-24 rounded border border-[#E5E7EB] pl-7 pr-2 text-xs focus:border-[#2563EB] focus:outline-none" value={doc.condicao} onChange={(e) => updateDoc(doc._key, "condicao", e.target.value)} placeholder="0" inputMode="decimal" />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-[#1A1A1A]">
                          {currency.format(valorMedido)}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={`h-7 w-40 rounded border px-2 text-xs focus:outline-none focus:ring-1 ${doc._dirty ? "border-[#F59E0B]/60 bg-[#FFFBEB] placeholder:text-[#D97706]/60 focus:border-[#F59E0B] focus:ring-[#F59E0B]/30" : "border-[#E5E7EB] bg-white placeholder:text-[#D1D5DB] focus:border-[#2563EB] focus:ring-[#2563EB]/20"}`}
                            value={doc.obs}
                            onChange={(e) => updateDoc(doc._key, "obs", e.target.value)}
                            placeholder="Observação…"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={docsSaving}
                              className="rounded p-1 text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-40"
                              onClick={() => saveDocLine(doc)}
                              title="Salvar linha"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              className="rounded p-1 text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40"
                              onClick={() => deleteDocLine(doc)}
                              title="Excluir linha"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {docs.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB]">
                      <td colSpan={8} className="px-2 py-2 text-right text-xs font-bold text-[#555555]">Total medido:</td>
                      <td className="px-2 py-2 text-right text-xs font-bold text-[#1A1A1A]">{currency.format(totalDocsValor)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-[#E5E7EB] px-6 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onSave(form)} disabled={saving}>
            {saving ? "Salvando…" : item ? "Salvar alterações" : "Cadastrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1.5 text-xs font-semibold text-[#555555] ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
