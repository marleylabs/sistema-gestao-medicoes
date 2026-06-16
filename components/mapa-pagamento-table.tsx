"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Edit3, Plus, Search, Trash2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import type { MapaPagamentoItem } from "@/components/types";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function normalizeText(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function statusLabel(item: MapaPagamentoItem) {
  return normalizeText(item.ato) === "PRODUCAO" ? "PRODUÇÃO" : "ATO";
}

function money(value: number) {
  return value ? currency.format(value) : "-";
}

function currencyInputValue(value: number) {
  return currency.format(value || 0);
}

function formatCurrencyInput(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return currencyInputValue(0);
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return currencyInputValue(Number.isFinite(parsed) ? parsed : 0);
}

function ratio(value: number) {
  return value ? percent.format(value) : "-";
}

function contractParticipation(item: MapaPagamentoItem, contrato: string) {
  const totalParticipation = item.intrSossego + item.salobo + item.acg + item.escadasAlumar;
  const allocation = normalizeText(item.ato);

  if (allocation === normalizeText(contrato)) return 1;
  if (allocation !== "PRODUCAO") return 0;

  if (contrato === "Intr. Sossego") return item.intrSossego;
  if (contrato === "Salobo") return item.salobo;
  if (contrato === "ACG") return item.acg;
  if (contrato === "Escadas Alumar") return item.escadasAlumar;
  if (contrato === "Não alocado") {
    const namedContracts = ["INTR. SOSSEGO", "SALOBO", "ACG", "ESCADAS ALUMAR"];
    return totalParticipation === 0 && !namedContracts.includes(allocation) ? 1 : 0;
  }
  return 0;
}

export function MapaPagamentoTable({
  itens,
  selectedCodigo,
  selectedContrato,
  isAdmin = false,
  onChanged,
}: {
  itens: MapaPagamentoItem[];
  selectedCodigo: string;
  selectedContrato: string;
  isAdmin?: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [editingItem, setEditingItem] = useState<MapaPagamentoItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    const result = itens.filter((item) => {
      const currentStatus = statusLabel(item);
      const matchesStatus = status ? currentStatus === status : true;
      const matchesCollaborator = selectedCodigo ? item.projetistaCodigo === selectedCodigo : true;
      const matchesContract = selectedContrato ? contractParticipation(item, selectedContrato) > 0 : true;
      const searchable = [item.ato, item.projetistaCodigo, item.responsavel, item.cpfCnpj, item.razaoSocial]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      return matchesStatus && matchesCollaborator && matchesContract && (!normalizedSearch || searchable.includes(normalizedSearch));
    });

    if (!sortOrder) return result;

    return [...result].sort((left, right) => {
      const leftName = left.responsavel ?? left.projetistaCodigo ?? "";
      const rightName = right.responsavel ?? right.projetistaCodigo ?? "";
      const comparison = leftName.localeCompare(rightName, "pt-BR", {
        sensitivity: "base",
      });
      return sortOrder === "desc" ? -comparison : comparison;
    });
  }, [itens, search, selectedCodigo, selectedContrato, sortOrder, status]);

  const filterDescription = selectedContrato
    ? `${filteredItems.length} participantes alocados em ${selectedContrato}.`
    : `${filteredItems.length} participantes com pagamento no ciclo atual.`;

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-lg border border-[#d8dee8] bg-white">
      <div className="grid gap-3 border-b border-[#d8dee8] px-4 py-3 xl:grid-cols-[1fr_240px_170px_170px_auto] xl:items-end">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">Pagamentos por colaborador</h2>
          <p className="text-sm text-[#1A1A1A]">{filterDescription}</p>
        </div>
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Pesquisar colaborador</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]" size={16} />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, nome ou empresa" />
          </span>
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Tipo de atuação</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            <option value="ATO">ATO</option>
            <option value="PRODUÇÃO">Produção</option>
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Ordenar por nome</span>
          <Select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
            <option value="">Ordem da planilha</option>
            <option value="asc">A–Z</option>
            <option value="desc">Z–A</option>
          </Select>
        </label>
        {isAdmin ? (
          <Button onClick={() => setIsCreating(true)}>
            <Plus size={16} />
            Adicionar
          </Button>
        ) : null}
      </div>

      {isAdmin && (isCreating || editingItem) ? (
        <PaymentEditor
          item={editingItem}
          saving={saving}
          onCancel={() => {
            setIsCreating(false);
            setEditingItem(null);
          }}
          onSave={async (payload) => {
            setSaving(true);
            try {
              const url = editingItem ? `/api/mapa-pagamento/${editingItem.id}` : "/api/mapa-pagamento";
              const response = await fetch(url, {
                method: editingItem ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              if (!response.ok) throw new Error("Falha ao salvar pagamento.");
              setIsCreating(false);
              setEditingItem(null);
              await onChanged?.();
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1420px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#F5F5F5]">
            <tr>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Alocação</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Projetista</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">CPF / CNPJ</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Razão social</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Intr. Sossego</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Salobo</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">ACG</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Escadas Alumar</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Pagamento</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Revisão</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Atuação</th>
              {isAdmin ? <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id} className="border-b border-[#edf1f6] last:border-0 hover:bg-[#F5F5F5]">
                <td className="px-3 py-3 font-semibold text-[#1A1A1A]">{item.ato ?? "-"}</td>
                <td className="px-3 py-3 font-semibold text-[#1A1A1A]">{item.responsavel ?? item.projetistaCodigo ?? "-"}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">{item.cpfCnpj ?? "-"}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">{item.razaoSocial ?? "-"}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{ratio(item.intrSossego)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{ratio(item.salobo)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{ratio(item.acg)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{ratio(item.escadasAlumar)}</td>
                <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#1A1A1A]">{money(item.valor)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{money(item.rev)}</td>
                <td className="px-3 py-3">
                  <span className="inline-flex rounded-md bg-[#F5F5F5] px-2 py-1 text-xs font-bold text-[#AF1B1B]">{statusLabel(item)}</span>
                </td>
                {isAdmin ? (
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d8dee8] bg-white text-[#1A1A1A] hover:bg-[#f2f4f7]"
                        title="Alterar pagamento"
                        onClick={() => setEditingItem(item)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#AF1B1B] bg-white text-[#AF1B1B] hover:bg-[#F5F5F5]"
                        title="Excluir pagamento"
                        onClick={async () => {
                          if (!window.confirm("Excluir este pagamento?")) return;
                          const response = await fetch(`/api/mapa-pagamento/${item.id}`, { method: "DELETE" });
                          if (!response.ok) throw new Error("Falha ao excluir pagamento.");
                          await onChanged?.();
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {!filteredItems.length ? (
              <tr>
                <td colSpan={isAdmin ? 12 : 11} className="px-3 py-8 text-center text-sm text-[#1A1A1A]">
                  Nenhuma linha encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type PaymentForm = {
  ordem: string;
  ato: string;
  projetistaCodigo: string;
  responsavel: string;
  cpfCnpj: string;
  razaoSocial: string;
  intrSossego: string;
  salobo: string;
  acg: string;
  escadasAlumar: string;
  valor: string;
  rev: string;
  status: string;
};

function paymentForm(item: MapaPagamentoItem | null): PaymentForm {
  return {
    ordem: String(item?.ordem ?? ""),
    ato: item?.ato ?? "Produção",
    projetistaCodigo: item?.projetistaCodigo ?? "",
    responsavel: item?.responsavel ?? "",
    cpfCnpj: item?.cpfCnpj ?? "",
    razaoSocial: item?.razaoSocial ?? "",
    intrSossego: String(item?.intrSossego ?? 0),
    salobo: String(item?.salobo ?? 0),
    acg: String(item?.acg ?? 0),
    escadasAlumar: String(item?.escadasAlumar ?? 0),
    valor: currencyInputValue(item?.valor ?? 0),
    rev: String(item?.rev ?? 0),
    status: item?.status ?? "",
  };
}

function PaymentEditor({
  item,
  saving,
  onCancel,
  onSave,
}: {
  item: MapaPagamentoItem | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: PaymentForm) => Promise<void>;
}) {
  const [form, setForm] = useState<PaymentForm>(() => paymentForm(item));

  function update(field: keyof PaymentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="border-b border-[#d8dee8] bg-[#fbfcfd] p-4">
      <div className="mb-3 text-sm font-bold text-[#1A1A1A]">{item ? "Alterar pagamento" : "Adicionar pagamento"}</div>
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Field label="Ordem"><Input value={form.ordem} onChange={(event) => update("ordem", event.target.value)} /></Field>
        <Field label="Alocação"><Input value={form.ato} onChange={(event) => update("ato", event.target.value)} /></Field>
        <Field label="Código"><Input value={form.projetistaCodigo} onChange={(event) => update("projetistaCodigo", event.target.value)} /></Field>
        <Field label="Projetista"><Input value={form.responsavel} onChange={(event) => update("responsavel", event.target.value)} /></Field>
        <Field label="CPF / CNPJ"><Input value={form.cpfCnpj} onChange={(event) => update("cpfCnpj", event.target.value)} /></Field>
        <Field label="Razão social"><Input value={form.razaoSocial} onChange={(event) => update("razaoSocial", event.target.value)} /></Field>
        <Field label="Intr. Sossego"><Input value={form.intrSossego} onChange={(event) => update("intrSossego", event.target.value)} /></Field>
        <Field label="Salobo"><Input value={form.salobo} onChange={(event) => update("salobo", event.target.value)} /></Field>
        <Field label="ACG"><Input value={form.acg} onChange={(event) => update("acg", event.target.value)} /></Field>
        <Field label="Escadas Alumar"><Input value={form.escadasAlumar} onChange={(event) => update("escadasAlumar", event.target.value)} /></Field>
        <Field label="Pagamento">
          <Input
            inputMode="decimal"
            value={form.valor}
            onBlur={(event) => update("valor", formatCurrencyInput(event.target.value))}
            onChange={(event) => update("valor", event.target.value)}
          />
        </Field>
        <Field label="Revisão"><Input value={form.rev} onChange={(event) => update("rev", event.target.value)} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button className="bg-white text-[#1A1A1A] border-[#cfd7e3] hover:bg-[#eef1f5]" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => onSave(form)} disabled={saving}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
      <span>{label}</span>
      {children}
    </label>
  );
}
