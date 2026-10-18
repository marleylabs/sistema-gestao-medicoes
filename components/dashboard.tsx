"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Banknote, Clock3, Edit3, HardHat, Trash2, UserCheck, Users } from "lucide-react";
import type { DashboardData } from "@/components/types";
import { BlurValue, Button, Card, Input, SectionHeader } from "@/components/ui";
import { cicloToDates, cicloToMesReferencia } from "@/lib/ciclo";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number   = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent  = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });

function dateLabel(value: string) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T00:00:00`));
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon,
  iconBg,
  iconColor,
  sensitive,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  sensitive?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-stat-label uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{title}</p>
          <p className="text-stat-value mt-1.5 text-[var(--foreground)]">
            {sensitive ? <BlurValue>{value}</BlurValue> : value}
          </p>
        </div>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}
        >
          {icon}
        </span>
      </div>
    </Card>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard({ data }: { data: DashboardData | null }) {
  if (!data) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]" />
          <span className="text-sm text-[var(--muted-foreground)]">Carregando indicadores...</span>
        </div>
      </Card>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Valor total medido"
          value={currency.format(data.cards.totalMedido)}
          icon={<Banknote size={19} />}
          iconBg="bg-[var(--primary-soft)]"
          iconColor="text-[var(--primary)]"
          sensitive
        />
        <KpiCard
          title="Horas contabilizadas"
          value={`${number.format(data.cards.totalHoras)} HH`}
          icon={<Clock3 size={19} />}
          iconBg="bg-[var(--success-soft)]"
          iconColor="text-[var(--success)]"
        />
        <KpiCard
          title="Profissionais ATO"
          value={number.format(data.cards.atosAtivos)}
          icon={<UserCheck size={19} />}
          iconBg="bg-[var(--warning-soft)]"
          iconColor="text-[var(--warning)]"
        />
        <KpiCard
          title="Equipe de produção"
          value={number.format(data.cards.producaoAtivos)}
          icon={<HardHat size={19} />}
          iconBg="bg-[var(--error-soft)]"
          iconColor="text-[var(--primary)]"
        />
      </div>
    </section>
  );
}

// ─── TiposPrecos ──────────────────────────────────────────────────────────────

function TiposPrecos({ itens }: { itens: DashboardData["tiposPrecos"] }) {
  const itensVisiveis = itens.filter((item) => item.tipo2?.trim().toUpperCase() !== "DESCONTO");

  if (!itensVisiveis.length) {
    return (
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
            <Users size={16} />
          </span>
          <h3 className="text-sm font-bold text-[var(--foreground)]">Tipos e Preços por fornecedor</h3>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">Nenhum documento cadastrado.</p>
      </Card>
    );
  }

  const porColaborador = itensVisiveis.reduce<Record<string, { nome: string; docs: Array<{ tipo2: string; condicao: string }> }>>((acc, r) => {
    if (!acc[r.codigo]) acc[r.codigo] = { nome: r.nome, docs: [] };
    acc[r.codigo].docs.push({ tipo2: r.tipo2, condicao: r.condicao });
    return acc;
  }, {});

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
          <Users size={14} />
        </span>
        <h3 className="text-sm font-bold text-[var(--foreground)]">Tipos e Preços por fornecedor</h3>
      </div>
      <div className="overflow-auto max-h-[260px]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--surface-muted)]">
            <tr>
              {["Fornecedor", "Tipo DG/DOC/HH", "Preço Unit."].map((h, i) => (
                <th key={h} className={`text-table-header border-b border-[var(--border)] px-4 py-2.5 text-[var(--muted-foreground)] ${i > 0 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(porColaborador).map(([codigo, { nome, docs }], gi) =>
              docs.map((doc, di) => (
                <tr key={`${codigo}-${di}`} className={`border-b border-[var(--surface-hover)] last:border-0 ${(gi + di) % 2 === 0 ? "" : "bg-[var(--surface-muted)]"}`}>
                  <td className="px-4 py-2.5 font-medium text-[var(--foreground)]">{nome}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--muted-foreground)]">{doc.tipo2}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--foreground)]">
                    <BlurValue>{currency.format(parseFloat(doc.condicao) || 0)}</BlurValue>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── MapaPagamentoResumo ──────────────────────────────────────────────────────

type ContextForm = {
  mesReferencia: string;
  producaoLabel: string;
  producaoInicio: string;
  producaoFim: string;
  atoLabel: string;
  atoCiclo: string;
};

const emptyContextForm: ContextForm = {
  mesReferencia: "",
  producaoLabel: "MEDIÇÃO:",
  producaoInicio: "",
  producaoFim: "",
  atoLabel: "CICLO:",
  atoCiclo: "",
};

export function MapaPagamentoResumo({
  data,
  isAdmin = false,
  onChanged,
  ciclo = "2605",
}: {
  data: DashboardData | null;
  isAdmin?: boolean;
  onChanged?: () => Promise<void> | void;
  ciclo?: string;
}) {
  const contexto = data?.contextoMapa;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContextForm>(emptyContextForm);
  const [saving, setSaving] = useState(false);

  // Datas derivadas automaticamente do ciclo (fallback quando não há dados manuais)
  const datas = /^\d{4}$/.test(ciclo) ? cicloToDates(ciclo) : { atoInicio: "", atoFim: "", producaoInicio: "", producaoFim: "" };

  const producaoInicio = contexto?.producaoInicio || datas.producaoInicio;
  const producaoFim    = contexto?.producaoFim    || datas.producaoFim;
  const atoInicio      = datas.atoInicio;
  const atoFim         = datas.atoFim;

  useEffect(() => {
    setForm({
      mesReferencia: contexto?.mesReferencia ?? (/^\d{4}$/.test(ciclo) ? cicloToMesReferencia(ciclo) : ""),
      producaoLabel: contexto?.producaoLabel ?? "MEDIÇÃO:",
      producaoInicio: contexto?.producaoInicio ?? datas.producaoInicio,
      producaoFim: contexto?.producaoFim ?? datas.producaoFim,
      atoLabel: contexto?.atoLabel ?? "CICLO:",
      atoCiclo: contexto?.atoCiclo ?? ciclo,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, ciclo]);

  async function saveContext() {
    setSaving(true);
    try {
      const res = await fetch("/api/mapa-pagamento/contexto", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ciclo }),
      });
      if (!res.ok) throw new Error("Falha ao salvar configuração.");
      setEditing(false);
      await onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function deleteContext() {
    if (!window.confirm("Remover as configurações do ciclo?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/mapa-pagamento/contexto?ciclo=${ciclo}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Falha ao remover configuração.");
      setEditing(false);
      await onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  if (!contexto) {
    return (
      <section className="grid min-w-0 gap-5">
        <TiposPrecos itens={data?.tiposPrecos ?? []} />
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <SectionHeader
        title="Visão financeira"
        description="Tipos, preços por fornecedor e distribuição de valor medido por contrato."
        action={undefined}
      />

      {editing && (
        <ContextEditor form={form} setForm={setForm} saving={saving} onCancel={() => setEditing(false)} onSave={saveContext} />
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {/* Tipos e Preços por fornecedor */}
        <TiposPrecos itens={data?.tiposPrecos ?? []} />

        {/* Contracts table */}
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-3.5">
            <h3 className="text-sm font-bold text-[var(--foreground)]">Distribuição por contrato</h3>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--surface-muted)]">
                  {["Contrato", "Valor medido", "Participação"].map((h, i) => (
                    <th
                      key={h}
                      className={`text-table-header border-b border-[var(--border)] px-4 py-2.5 text-[var(--muted-foreground)] ${i > 0 ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contexto.contratos.map((contrato, i) => {
                  const rateio = contexto.rateio.find((r) => r.contrato === contrato.contrato);
                  const isTotal = contrato.contrato === "TOTAL";
                  return (
                    <tr
                      key={contrato.contrato}
                      className={`border-b border-[var(--surface-hover)] last:border-0 ${isTotal ? "bg-[var(--surface-muted)] font-semibold" : i % 2 === 0 ? "" : "bg-[var(--surface-muted)]"}`}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--foreground)]">{contrato.contrato}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]"><BlurValue>{currency.format(contrato.valor)}</BlurValue></td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">{rateio ? <BlurValue>{percent.format(rateio.percentual)}</BlurValue> : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {contexto.valorNaoClassificado > 0 && (
            <p className="border-t border-[var(--surface-hover)] px-5 py-2.5 text-xs text-[var(--warning)]">
              Valor ainda não classificado por contrato: <BlurValue>{currency.format(contexto.valorNaoClassificado)}</BlurValue> ({percent.format(contexto.percentualNaoClassificado / 100)})
            </p>
          )}
        </Card>
      </div>
    </section>
  );
}

// ─── ContextEditor ────────────────────────────────────────────────────────────

function ContextEditor({
  form,
  setForm,
  saving,
  onCancel,
  onSave,
}: {
  form: ContextForm;
  setForm: Dispatch<SetStateAction<ContextForm>>;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  function update(field: keyof ContextForm, value: string) {
    setForm((cur) => ({ ...cur, [field]: value }));
  }

  return (
    <Card className="p-5">
      <p className="mb-4 text-sm font-semibold text-[var(--foreground)]">Editar configuração do ciclo</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <LabelField label="Mês de referência">
          <Input value={form.mesReferencia} onChange={(e) => update("mesReferencia", e.target.value)} />
        </LabelField>
        <LabelField label="Início produção">
          <Input type="date" value={form.producaoInicio} onChange={(e) => update("producaoInicio", e.target.value)} />
        </LabelField>
        <LabelField label="Fim produção">
          <Input type="date" value={form.producaoFim} onChange={(e) => update("producaoFim", e.target.value)} />
        </LabelField>
        <LabelField label="Ciclo ATO">
          <Input value={form.atoCiclo} onChange={(e) => update("atoCiclo", e.target.value)} />
        </LabelField>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button onClick={onSave} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
      </div>
    </Card>
  );
}

function LabelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-[var(--foreground)]">
      <span className="text-label text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}
