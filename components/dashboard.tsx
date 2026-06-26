"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Banknote, Clock3, Edit3, HardHat, Trash2, UserCheck, Users } from "lucide-react";
import type { DashboardData } from "@/components/types";
import { Badge, BlurValue, Button, Card, Input, SectionHeader } from "@/components/ui";
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
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#555555]">{title}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#1A1A1A]">
            {sensitive ? <BlurValue>{value}</BlurValue> : value}
          </p>
        </div>
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}
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
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#2563EB]" />
          <span className="text-sm text-[#555555]">Carregando indicadores...</span>
        </div>
      </Card>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <SectionHeader
        title="Resumo do ciclo"
        description="Indicadores consolidados de medição e participação."
        action={
          data.contextoMapa?.mesReferencia ? (
            <Badge variant="brand">{data.contextoMapa.mesReferencia}</Badge>
          ) : undefined
        }
      />

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Valor total medido"
          value={currency.format(data.cards.totalMedido)}
          icon={<Banknote size={19} />}
          iconBg="bg-[#EFF6FF]"
          iconColor="text-[#2563EB]"
          sensitive
        />
        <KpiCard
          title="Horas contabilizadas"
          value={`${number.format(data.cards.totalHoras)} HH`}
          icon={<Clock3 size={19} />}
          iconBg="bg-[#F0FDF4]"
          iconColor="text-[#16A34A]"
        />
        <KpiCard
          title="Profissionais ATO"
          value={number.format(data.cards.atosAtivos)}
          icon={<UserCheck size={19} />}
          iconBg="bg-[#FFFBEB]"
          iconColor="text-[#D97706]"
        />
        <KpiCard
          title="Equipe de produção"
          value={number.format(data.cards.producaoAtivos)}
          icon={<HardHat size={19} />}
          iconBg="bg-[#FEF2F2]"
          iconColor="text-[#AF1B1B]"
        />
      </div>
    </section>
  );
}

// ─── TiposPrecos ──────────────────────────────────────────────────────────────

function TiposPrecos({ itens }: { itens: DashboardData["tiposPrecos"] }) {
  if (!itens.length) {
    return (
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
            <Users size={16} />
          </span>
          <h3 className="text-sm font-bold text-[#1A1A1A]">Tipos e Preços por colaborador</h3>
        </div>
        <p className="text-sm text-[#555555]">Nenhum documento cadastrado.</p>
      </Card>
    );
  }

  const porColaborador = itens.reduce<Record<string, { nome: string; docs: Array<{ tipo2: string; condicao: string }> }>>((acc, r) => {
    if (!acc[r.codigo]) acc[r.codigo] = { nome: r.nome, docs: [] };
    acc[r.codigo].docs.push({ tipo2: r.tipo2, condicao: r.condicao });
    return acc;
  }, {});

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[#E5E7EB] px-5 py-3.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
          <Users size={14} />
        </span>
        <h3 className="text-sm font-bold text-[#1A1A1A]">Tipos e Preços por colaborador</h3>
      </div>
      <div className="overflow-auto max-h-[260px]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[#F9FAFB]">
            <tr>
              {["Colaborador", "Tipo DG/DOC/HH", "Preço Unit."].map((h, i) => (
                <th key={h} className={`border-b border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#555555] ${i > 0 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(porColaborador).map(([codigo, { nome, docs }], gi) =>
              docs.map((doc, di) => (
                <tr key={`${codigo}-${di}`} className={`border-b border-[#F3F4F6] last:border-0 ${(gi + di) % 2 === 0 ? "" : "bg-[#FAFAFA]"}`}>
                  <td className="px-4 py-2.5 font-medium text-[#1A1A1A]">{nome}</td>
                  <td className="px-4 py-2.5 text-right text-[#555555]">{doc.tipo2}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1A1A]">
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
        description="Tipos, preços por colaborador e distribuição de valor medido por contrato."
        action={undefined}
      />

      {editing && (
        <ContextEditor form={form} setForm={setForm} saving={saving} onCancel={() => setEditing(false)} onSave={saveContext} />
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {/* Tipos e Preços por colaborador */}
        <TiposPrecos itens={data?.tiposPrecos ?? []} />

        {/* Contracts table */}
        <Card className="overflow-hidden">
          <div className="border-b border-[#E5E7EB] px-5 py-3.5">
            <h3 className="text-sm font-bold text-[#1A1A1A]">Distribuição por contrato</h3>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="bg-[#F9FAFB]">
                  {["Contrato", "Valor medido", "Participação"].map((h, i) => (
                    <th
                      key={h}
                      className={`border-b border-[#E5E7EB] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#555555] ${i > 0 ? "text-right" : "text-left"}`}
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
                      className={`border-b border-[#F3F4F6] last:border-0 ${isTotal ? "bg-[#F9FAFB] font-semibold" : i % 2 === 0 ? "" : "bg-[#FAFAFA]"}`}
                    >
                      <td className="px-4 py-3 font-medium text-[#1A1A1A]">{contrato.contrato}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1A1A1A]"><BlurValue>{currency.format(contrato.valor)}</BlurValue></td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#1A1A1A]">{rateio ? <BlurValue>{percent.format(rateio.percentual)}</BlurValue> : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
      <p className="mb-4 text-sm font-semibold text-[#1A1A1A]">Editar configuração do ciclo</p>
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
    <label className="grid gap-1.5 text-sm font-medium text-[#1A1A1A]">
      <span className="text-xs font-semibold text-[#555555]">{label}</span>
      {children}
    </label>
  );
}
