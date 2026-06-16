"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Banknote, Clock3, Edit3, HardHat, Trash2, UserCheck } from "lucide-react";
import type { DashboardData } from "@/components/types";
import { Button, Input } from "@/components/ui";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function Card({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-[#d8dee8] bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[#1A1A1A]">{title}</span>
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${tone}`}>{icon}</span>
      </div>
      <div className="mt-3 text-2xl font-bold tracking-normal text-[#1A1A1A]">{value}</div>
    </div>
  );
}

export function Dashboard({ data }: { data: DashboardData | null }) {
  if (!data) {
    return <div className="rounded-lg border border-[#d8dee8] bg-white p-6 text-sm text-[#1A1A1A]">Carregando indicadores...</div>;
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">Resumo do ciclo</h2>
          <p className="text-sm text-[#1A1A1A]">Indicadores consolidados de medição e participação.</p>
        </div>
        {data.contextoMapa?.mesReferencia ? (
          <div className="text-sm font-semibold text-[#AF1B1B]">{data.contextoMapa.mesReferencia}</div>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Valor total medido" value={currency.format(data.cards.totalMedido)} icon={<Banknote size={18} />} tone="bg-[#F5F5F5] text-[#AF1B1B]" />
        <Card title="Horas contabilizadas" value={`${number.format(data.cards.totalHoras)} HH`} icon={<Clock3 size={18} />} tone="bg-[#F5F5F5] text-[#AF1B1B]" />
        <Card title="Profissionais ATO" value={number.format(data.cards.atosAtivos)} icon={<UserCheck size={18} />} tone="bg-[#F5F5F5] text-[#AF1B1B]" />
        <Card title="Equipe de produção" value={number.format(data.cards.producaoAtivos)} icon={<HardHat size={18} />} tone="bg-[#F5F5F5] text-[#AF1B1B]" />
      </div>
    </section>
  );
}

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
}: {
  data: DashboardData | null;
  isAdmin?: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const contexto = data?.contextoMapa;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContextForm>(emptyContextForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      mesReferencia: contexto?.mesReferencia ?? "",
      producaoLabel: contexto?.producaoLabel ?? "MEDIÇÃO:",
      producaoInicio: contexto?.producaoInicio ?? "",
      producaoFim: contexto?.producaoFim ?? "",
      atoLabel: contexto?.atoLabel ?? "CICLO:",
      atoCiclo: contexto?.atoCiclo ?? "",
    });
  }, [contexto]);

  async function saveContext() {
    setSaving(true);
    try {
      const response = await fetch("/api/mapa-pagamento/contexto", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error("Falha ao salvar configuração.");
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
      const response = await fetch("/api/mapa-pagamento/contexto", { method: "DELETE" });
      if (!response.ok) throw new Error("Falha ao remover configuração.");
      setEditing(false);
      await onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  if (!contexto) {
    return (
      <section className="rounded-lg border border-[#d8dee8] bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[#1A1A1A]">Configuração do ciclo não cadastrada.</div>
          {isAdmin ? (
            <Button onClick={() => setEditing(true)}>
              <Edit3 size={16} />
              Adicionar
            </Button>
          ) : null}
        </div>
        {editing ? (
          <ContextEditor form={form} setForm={setForm} saving={saving} onCancel={() => setEditing(false)} onSave={saveContext} />
        ) : null}
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A1A]">Configuração do ciclo</h2>
          <p className="text-sm text-[#1A1A1A]">Períodos de apuração e distribuição financeira por contrato.</p>
        </div>
        {isAdmin ? (
          <div className="flex gap-2">
            <Button className="bg-[#AF1B1B] text-white hover:bg-[#8C1616]" onClick={() => setEditing((value) => !value)}>
              <Edit3 size={16} />
              {editing ? "Cancelar" : "Alterar"}
            </Button>
            <Button className="bg-[#AF1B1B] hover:bg-[#8C1616]" onClick={deleteContext} disabled={saving}>
              <Trash2 size={16} />
              Excluir
            </Button>
          </div>
        ) : null}
      </div>

      {editing ? (
        <ContextEditor form={form} setForm={setForm} saving={saving} onCancel={() => setEditing(false)} onSave={saveContext} />
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3 rounded-lg border border-[#d8dee8] bg-white p-4">
          <h3 className="text-base font-bold text-[#1A1A1A]">Períodos de apuração</h3>
          <div className="rounded-md bg-[#F5F5F5] p-3">
            <div className="text-xs font-bold uppercase text-[#1A1A1A]">Produção</div>
            <div className="mt-1 text-sm font-semibold text-[#1A1A1A]">
              {contexto.producaoInicio ? dateLabel(contexto.producaoInicio) : "-"} a {contexto.producaoFim ? dateLabel(contexto.producaoFim) : "-"}
            </div>
          </div>
          <div className="rounded-md bg-[#F5F5F5] p-3">
            <div className="text-xs font-bold uppercase text-[#1A1A1A]">ATO</div>
            <div className="mt-1 text-sm font-semibold text-[#1A1A1A]">Ciclo {contexto.atoCiclo ?? "-"}</div>
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-[#d8dee8] bg-white">
          <div className="border-b border-[#d8dee8] px-4 py-3">
            <h3 className="text-base font-bold text-[#1A1A1A]">Distribuição por contrato</h3>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="bg-[#F5F5F5]">
                <tr>
                  <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Contrato</th>
                  <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Valor medido</th>
                  <th className="border-b border-[#d8dee8] px-3 py-3 text-right text-xs font-bold uppercase text-[#1A1A1A]">Participação</th>
                </tr>
              </thead>
              <tbody>
                {contexto.contratos.map((contrato) => {
                  const rateio = contexto.rateio.find((item) => item.contrato === contrato.contrato);
                  return (
                    <tr key={contrato.contrato} className="border-b border-[#edf1f6] last:border-0">
                      <td className="px-3 py-3 font-semibold text-[#1A1A1A]">{contrato.contrato}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{currency.format(contrato.valor)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-[#1A1A1A]">{rateio ? percent.format(rateio.percentual) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

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
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="rounded-lg border border-[#d8dee8] bg-white p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Mês de referência</span>
          <Input value={form.mesReferencia} onChange={(event) => update("mesReferencia", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Início produção</span>
          <Input type="date" value={form.producaoInicio} onChange={(event) => update("producaoInicio", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Fim produção</span>
          <Input type="date" value={form.producaoFim} onChange={(event) => update("producaoFim", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
          <span>Ciclo ATO</span>
          <Input value={form.atoCiclo} onChange={(event) => update("atoCiclo", event.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button className="bg-white text-[#1A1A1A] border-[#cfd7e3] hover:bg-[#eef1f5]" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={onSave} disabled={saving}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
