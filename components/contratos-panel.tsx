"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Calendar, Check, Edit2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Input, SectionHeader } from "@/components/ui";

type Contrato = {
  id: string;
  nome: string;
  codigo: string | null;
  descricao: string | null;
  gestor: string | null;
  fiscal: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  valor_total: string | null;
  coluna_mapa: string | null;
  ativo: boolean;
  created_at: string;
};

type FormData = {
  nome: string;
  codigo: string;
  descricao: string;
  gestor: string;
  fiscal: string;
  data_inicio: string;
  data_fim: string;
  valor_total: string;
};

function fmtDate(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso + "T12:00:00"));
}

function fmtValor(v: string | null) {
  if (!v) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
}

function ContratoForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Contrato>;
  onSave: (data: FormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [nome,        setNome]        = useState(initial?.nome ?? "");
  const [codigo,      setCodigo]      = useState(initial?.codigo ?? "");
  const [descricao,   setDescricao]   = useState(initial?.descricao ?? "");
  const [gestor,      setGestor]      = useState(initial?.gestor ?? "");
  const [fiscal,      setFiscal]      = useState(initial?.fiscal ?? "");
  const [dataInicio,  setDataInicio]  = useState(initial?.data_inicio?.slice(0, 10) ?? "");
  const [dataFim,     setDataFim]     = useState(initial?.data_fim?.slice(0, 10) ?? "");
  const [valorTotal,  setValorTotal]  = useState(initial?.valor_total ?? "");

  return (
    <div className="grid gap-4 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
      {/* Linha 1: Nome + Código */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Nome do contrato *</label>
          <Input placeholder="Ex: Salobo" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Código (opcional)</label>
          <Input placeholder="Ex: SLBO-001" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </div>
      </div>

      {/* Linha 2: Gestor + Fiscal */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Gestor</label>
          <Input placeholder="Nome do gestor" value={gestor} onChange={(e) => setGestor(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Fiscal</label>
          <Input placeholder="Nome do fiscal" value={fiscal} onChange={(e) => setFiscal(e.target.value)} />
        </div>
      </div>

      {/* Linha 3: Datas + Valor */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Data de início</label>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs text-[#1A1A1A] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Data de término</label>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs text-[#1A1A1A] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-[11px] font-semibold text-[#555555]">Valor total (R$)</label>
          <Input
            type="number"
            placeholder="0,00"
            value={valorTotal}
            onChange={(e) => setValorTotal(e.target.value)}
          />
        </div>
      </div>

      {/* Linha 4: Descrição */}
      <div className="grid gap-1">
        <label className="text-[11px] font-semibold text-[#555555]">Descrição (opcional)</label>
        <Input placeholder="Descrição resumida do contrato" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#555555] hover:bg-[#F3F4F6]">
          <X size={12} className="mr-1 inline" />Cancelar
        </button>
        <button
          onClick={() => onSave({ nome, codigo, descricao, gestor, fiscal, data_inicio: dataInicio, data_fim: dataFim, valor_total: valorTotal })}
          disabled={saving || !nome.trim()}
          className="rounded-lg bg-[#AF1B1B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#8C1616] disabled:opacity-40"
        >
          <Check size={12} className="mr-1 inline" />{saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function ContratoRow({ c, onEdit, onToggle, onDelete }: {
  c: Contrato;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 transition-colors ${
      c.ativo ? "border-[#E5E7EB] bg-white" : "border-[#F3F4F6] bg-[#FAFAFA] opacity-60"
    }`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#555555]">
          <Building2 size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-[#1A1A1A]">{c.nome}</span>
            {c.codigo && <span className="rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#2563EB]">{c.codigo}</span>}
            <Badge variant={c.ativo ? "success" : "neutral"}>{c.ativo ? "Ativo" : "Inativo"}</Badge>
          </div>
          {c.descricao && <p className="mt-0.5 text-[11px] text-[#9CA3AF]">{c.descricao}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={onEdit} className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] hover:border-[#2563EB] hover:text-[#2563EB]">
            <Edit2 size={12} className="mr-1 inline" />Editar
          </button>
          <button onClick={onToggle} className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] hover:border-[#F59E0B] hover:text-[#D97706]">
            {c.ativo ? "Desativar" : "Ativar"}
          </button>
          <button onClick={onDelete} className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] hover:border-[#DC2626] hover:text-[#DC2626]">
            <Trash2 size={12} className="mr-1 inline" />Excluir
          </button>
        </div>
      </div>

      {/* Detalhes */}
      {(c.gestor || c.fiscal || c.data_inicio || c.data_fim || c.valor_total) && (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-[#F3F4F6] pt-2.5">
          {c.gestor && (
            <span className="text-[11px] text-[#555555]"><span className="font-semibold text-[#9CA3AF]">Gestor:</span> {c.gestor}</span>
          )}
          {c.fiscal && (
            <span className="text-[11px] text-[#555555]"><span className="font-semibold text-[#9CA3AF]">Fiscal:</span> {c.fiscal}</span>
          )}
          {(c.data_inicio || c.data_fim) && (
            <span className="text-[11px] text-[#555555]">
              <Calendar size={10} className="mr-1 inline text-[#9CA3AF]" />
              {fmtDate(c.data_inicio)} → {fmtDate(c.data_fim)}
            </span>
          )}
          {c.valor_total && (
            <span className="text-[11px] font-semibold text-[#16A34A]">{fmtValor(c.valor_total)}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ContratosPanel() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [showNew, setShowNew]     = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/contratos");
    if (res.ok) setContratos(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(data: FormData) {
    setSaving(true); setError(null);
    const res = await fetch("/api/admin/contratos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Erro."); return; }
    setShowNew(false);
    load();
  }

  async function handleUpdate(id: string, data: FormData) {
    setSaving(true); setError(null);
    const res = await fetch(`/api/admin/contratos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Erro."); return; }
    setEditId(null);
    load();
  }

  async function handleToggle(c: Contrato) {
    await fetch(`/api/admin/contratos/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: !c.ativo }),
    });
    load();
  }

  async function handleDelete(c: Contrato) {
    if (!window.confirm(`Excluir o contrato "${c.nome}"? Esta ação não pode ser desfeita.`)) return;
    await fetch(`/api/admin/contratos/${c.id}`, { method: "DELETE" });
    load();
  }

  const ativos   = contratos.filter((c) => c.ativo).length;
  const inativos = contratos.filter((c) => !c.ativo).length;

  return (
    <div className="grid gap-6 mx-auto w-full" style={{ maxWidth: "80rem" }}>
      <SectionHeader
        title="Contratos"
        description="Gerencie os contratos disponíveis na plataforma."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Atualizar
            </Button>
            <Button onClick={() => { setShowNew(true); setEditId(null); setError(null); }} disabled={showNew}>
              <Plus size={14} />
              Novo contrato
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Total</p>
          <p className="mt-1 text-2xl font-bold text-[#1A1A1A]">{contratos.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Ativos</p>
          <p className="mt-1 text-2xl font-bold text-[#16A34A]">{ativos}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Inativos</p>
          <p className="mt-1 text-2xl font-bold text-[#9CA3AF]">{inativos}</p>
        </Card>
      </div>

      {error && (
        <div className="rounded-lg bg-[#FEE2E2] px-4 py-3 text-xs font-medium text-[#B91C1C]">{error}</div>
      )}

      {showNew && (
        <ContratoForm
          onSave={handleCreate}
          onCancel={() => { setShowNew(false); setError(null); }}
          saving={saving}
        />
      )}

      {loading ? (
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#AF1B1B]" />
            <span className="text-sm text-[#555555]">Carregando contratos…</span>
          </div>
        </Card>
      ) : contratos.length === 0 ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-[#555555]">
            <Building2 size={18} />
            <span className="text-sm">Nenhum contrato cadastrado.</span>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {contratos.map((c) =>
            editId === c.id ? (
              <ContratoForm
                key={c.id}
                initial={c}
                onSave={(data) => handleUpdate(c.id, data)}
                onCancel={() => { setEditId(null); setError(null); }}
                saving={saving}
              />
            ) : (
              <ContratoRow
                key={c.id}
                c={c}
                onEdit={() => { setEditId(c.id); setShowNew(false); setError(null); }}
                onToggle={() => handleToggle(c)}
                onDelete={() => handleDelete(c)}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
