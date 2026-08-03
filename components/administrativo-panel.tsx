"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Download, Edit3, FileSpreadsheet, RefreshCw, Save, Upload, X } from "lucide-react";
import { Button, Card, Input, SectionHeader } from "@/components/ui";

type CadastroFornecedor = {
  id: string;
  cnpjNormalizado: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  razaoSocial: string;
  statusContrato: string | null;
  objetoContrato: string | null;
  cargo: string | null;
  cpf: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  tipoCt: string | null;
  tipoContrato: string | null;
  valorHora: number | null;
  valorA1Equivalente: number | null;
  valorDocumento: number | null;
  inicio: string | null;
  final: string | null;
  statusCadastro: string | null;
  primeiroAditivo: string | null;
  segundoAditivo: string | null;
  diasAteVencimento: number | null;
  validadeLabel: string;
  validadeTone: "danger" | "warning" | "notice" | "success" | "neutral";
  pendencias: string[];
  updatedAt: string | null;
};

type ImportResult = {
  total: number;
  criados: number;
  atualizados: number;
  usuariosCriados: number;
  senhasTemporarias: { usuario: string; nome: string; senha: string }[];
};

function dateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

const toneClass: Record<CadastroFornecedor["validadeTone"], string> = {
  danger: "bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]",
  warning: "bg-[#FFF7ED] text-[#C2410C] ring-[#FDBA74]",
  notice: "bg-[#EFF6FF] text-[#1D4ED8] ring-[#BFDBFE]",
  success: "bg-[#F0FDF4] text-[#15803D] ring-[#BBF7D0]",
  neutral: "bg-[#F3F4F6] text-[#6B7280] ring-[#E5E7EB]",
};

function CadastroCard({ item, onSaved }: { item: CadastroFornecedor; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    responsavel: item.responsavel,
    razaoSocial: item.razaoSocial,
    cnpj: item.cnpj ?? "",
    cpf: item.cpf ?? "",
    email: item.email ?? "",
    telefone: item.telefone ?? "",
    cargo: item.cargo ?? "",
    statusContrato: item.statusContrato ?? "",
    statusCadastro: item.statusCadastro ?? "",
    inicio: dateInputValue(item.inicio),
    final: dateInputValue(item.final),
    objetoContrato: item.objetoContrato ?? "",
    tipoCt: item.tipoCt ?? "",
    tipoContrato: item.tipoContrato ?? "",
    valorHora: item.valorHora?.toString() ?? "",
    valorA1Equivalente: item.valorA1Equivalente?.toString() ?? "",
    valorDocumento: item.valorDocumento?.toString() ?? "",
    primeiroAditivo: item.primeiroAditivo ?? "",
    segundoAditivo: item.segundoAditivo ?? "",
  });

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/administrativo/fornecedores/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      alert(payload.error ?? "Não foi possível salvar o cadastro.");
      return;
    }
    setEditing(false);
    onSaved();
  }

  return (
    <Card className={`overflow-hidden ${item.pendencias.length ? "border-[#FCA5A5]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{item.responsavel}</h3>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${toneClass[item.validadeTone]}`}>
              {item.validadeLabel}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-[#6B7280]">{item.razaoSocial}</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-semibold text-[#555555] transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          {editing ? <X size={13} /> : <Edit3 size={13} />}
          {editing ? "Fechar" : "Editar"}
        </button>
      </div>

      {editing ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {[
            ["responsavel", "Responsável"],
            ["razaoSocial", "Razão social"],
            ["cnpj", "CNPJ"],
            ["cpf", "CPF"],
            ["email", "E-mail"],
            ["telefone", "Telefone"],
            ["cargo", "Cargo"],
            ["statusContrato", "Status CT"],
            ["statusCadastro", "Status"],
            ["objetoContrato", "Objeto do contrato"],
            ["tipoCt", "Tipo CT"],
            ["tipoContrato", "Tipo contrato"],
            ["valorHora", "Hora"],
            ["valorA1Equivalente", "A1 equivalente"],
            ["valorDocumento", "Documento"],
            ["primeiroAditivo", "1º Adi"],
            ["segundoAditivo", "2º Ad"],
          ].map(([field, label]) => (
            <label key={field} className="grid gap-1 text-xs font-semibold text-[#555555]">
              {label}
              <Input value={form[field as keyof typeof form]} onChange={(e) => update(field as keyof typeof form, e.target.value)} />
            </label>
          ))}
          <label className="grid gap-1 text-xs font-semibold text-[#555555]">
            Início
            <Input type="date" value={form.inicio} onChange={(e) => update("inicio", e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[#555555]">
            Final
            <Input type="date" value={form.final} onChange={(e) => update("final", e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              <Save size={14} />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 p-4 text-xs text-[#555555] sm:grid-cols-2">
          <div><span className="font-bold text-[#1A1A1A]">CNPJ:</span> {item.cnpj ?? "-"}</div>
          <div><span className="font-bold text-[#1A1A1A]">Código:</span> {item.colaboradorCodigo ?? "-"}</div>
          <div><span className="font-bold text-[#1A1A1A]">E-mail:</span> {item.email ?? "-"}</div>
          <div><span className="font-bold text-[#1A1A1A]">Telefone:</span> {item.telefone ?? "-"}</div>
          <div><span className="font-bold text-[#1A1A1A]">Início:</span> {fmtDate(item.inicio)}</div>
          <div><span className="font-bold text-[#1A1A1A]">Final:</span> {fmtDate(item.final)}</div>
          {item.pendencias.length > 0 && (
            <div className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[#B91C1C] sm:col-span-2">
              Pendência: {item.pendencias.join(", ")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function AdministrativoPanel() {
  const [items, setItems] = useState<CadastroFornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/administrativo/fornecedores");
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.responsavel, item.razaoSocial, item.cnpj, item.colaboradorCodigo, item.email]
        .some((value) => value?.toLowerCase().includes(q)),
    );
  }, [items, search]);

  const vencidos = items.filter((item) => item.diasAteVencimento !== null && item.diasAteVencimento < 0).length;
  const vencendo = items.filter((item) => item.diasAteVencimento !== null && item.diasAteVencimento >= 0 && item.diasAteVencimento <= 30).length;
  const pendencias = items.filter((item) => item.pendencias.length > 0);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/administrativo/fornecedores", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) {
      setError(payload.error ?? "Não foi possível importar a planilha.");
      return;
    }
    setResult(payload);
    setFile(null);
    await load();
  }

  return (
    <div className="mx-auto grid w-full gap-6" style={{ maxWidth: "88rem" }}>
      <SectionHeader
        title="Painel Administrativo"
        description="Cadastros cadastrais dos fornecedores, vencimentos e bloqueios para envio de NF."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/admin/templates/administrativo"
              download
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#555555] shadow-sm transition hover:border-[#2563EB] hover:text-[#2563EB]"
            >
              <Download size={14} />
              Baixar máscara
            </a>
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs font-bold uppercase text-[#6B7280]">Total</p><p className="mt-1 text-2xl font-bold">{items.length}</p></Card>
        <Card className="p-4"><p className="text-xs font-bold uppercase text-[#6B7280]">Vencidos</p><p className="mt-1 text-2xl font-bold text-[#B91C1C]">{vencidos}</p></Card>
        <Card className="p-4"><p className="text-xs font-bold uppercase text-[#6B7280]">Vencem em 30 dias</p><p className="mt-1 text-2xl font-bold text-[#D97706]">{vencendo}</p></Card>
        <Card className="p-4"><p className="text-xs font-bold uppercase text-[#6B7280]">Pendências</p><p className="mt-1 text-2xl font-bold text-[#2563EB]">{pendencias.length}</p></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]"><FileSpreadsheet size={18} /></span>
            <div>
              <p className="text-sm font-bold text-[#1A1A1A]">Importar Consulta PJ</p>
              <p className="text-xs text-[#6B7280]">A planilha atualiza os cadastros e cria usuários apenas quando ainda não existem.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#D1D5DB] bg-[#FAFAFA] text-center transition hover:border-[#2563EB] hover:bg-[#EFF6FF]"
          >
            <Upload size={22} className="text-[#2563EB]" />
            <span className="text-sm font-semibold text-[#1A1A1A]">{file ? file.name : "Clique para selecionar ou trocar a planilha"}</span>
            <span className="text-xs text-[#6B7280]">.xlsx ou .xlsm</span>
          </button>
          {error && <div className="rounded-lg bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#B91C1C]">{error}</div>}
          {result && (
            <div className="rounded-lg bg-[#F0FDF4] px-4 py-3 text-sm text-[#15803D]">
              Importação concluída: {result.total} registro(s), {result.criados} novo(s), {result.atualizados} atualizado(s), {result.usuariosCriados} usuário(s) criado(s).
            </div>
          )}
          {result?.senhasTemporarias?.length ? (
            <div className="grid gap-2 rounded-lg bg-[#FFFBEB] p-3">
              <p className="text-xs font-bold uppercase text-[#92400E]">Senhas temporárias geradas</p>
              {result.senhasTemporarias.map((entry) => (
                <p key={entry.usuario} className="text-xs text-[#92400E]">
                  <strong>{entry.usuario}</strong> - {entry.nome}: <span className="font-mono font-bold">{entry.senha}</span>
                </p>
              ))}
            </div>
          ) : null}
          <Button onClick={upload} disabled={!file || uploading}>
            <Upload size={14} />
            {uploading ? "Importando..." : "Importar cadastros"}
          </Button>
        </div>
      </Card>

      {pendencias.length > 0 && (
        <Card className="overflow-hidden border-[#FCA5A5]">
          <div className="border-b border-[#FECACA] bg-[#FEF2F2] px-5 py-4">
            <div className="flex items-center gap-2 text-[#B91C1C]">
              <AlertTriangle size={18} />
              <p className="text-sm font-bold">Fornecedores com pendências</p>
            </div>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {pendencias.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-lg border border-[#FECACA] bg-white px-3 py-2 text-xs">
                <p className="font-bold text-[#1A1A1A]">{item.responsavel}</p>
                <p className="mt-1 text-[#B91C1C]">{item.pendencias.join(", ")}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <Input placeholder="Buscar por responsável, razão social, CNPJ, código ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>

      {loading ? (
        <Card className="p-6 text-sm text-[#6B7280]">Carregando cadastros...</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-[#6B7280]">Nenhum cadastro encontrado.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((item) => <CadastroCard key={item.id} item={item} onSaved={load} />)}
        </div>
      )}

      <div className="grid gap-2 text-xs text-[#6B7280] sm:grid-cols-2">
        <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> Validade calculada pela coluna FINAL.</span>
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} /> NF só libera com cadastro válido e CNPJ compatível.</span>
      </div>
    </div>
  );
}
