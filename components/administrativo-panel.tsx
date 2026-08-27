"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Edit3, FileSpreadsheet, RefreshCw, Save, Upload, X } from "lucide-react";
import { Button, Card, IconButton, Input, PageContainer, PageHeader } from "@/components/ui";

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
  valorCondicaoFixa: number | null;
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

type StatusFilter = "todos" | "vencidos" | "vencendo" | "pendencias";

function dateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

const toneClass: Record<CadastroFornecedor["validadeTone"], string> = {
  danger: "bg-[#FFF1F1] text-[#DC3545] ring-[#DC3545]/30",
  warning: "bg-[#FFF8E1] text-[#B77900] ring-[#FFC107]/70",
  notice: "bg-[#EAF3FF] text-[#007BFF] ring-[#007BFF]/30",
  success: "bg-[#EAF7ED] text-[#28A745] ring-[#28A745]/30",
  neutral: "bg-[#F3F4F6] text-[#6B7280] ring-[#E5E7EB]",
};

const FILTER_LABELS: Record<StatusFilter, string> = {
  todos: "Todos",
  vencidos: "Vencidos",
  vencendo: "Próximo do vencimento",
  pendencias: "Pendências",
};

function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function maskCnpj(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function maskCpf(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})(\d)/, "$1-$2");
}

function maskPhone(value: string | null | undefined) {
  const digits = digitsOnly(value).slice(0, 11);
  if (digits.length <= 2) return digits.replace(/^(\d{0,2})/, (_, ddd) => (ddd ? `(${ddd}` : ""));
  if (digits.length <= 6) return digits.replace(/^(\d{2})(\d{0,4})/, "($1) $2");
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d{0,4})(\d{0,4})/, "($1) $2-$3");
  return digits.replace(/^(\d{2})(\d{0,5})(\d{0,4})/, "($1) $2-$3");
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function displayText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s./&()-])([\p{L}])/gu, (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("pt-BR")}`)
    .replace(/\b(Ltda|Me|Epp|Sa|S\/A)\b/g, (match) => match.toLocaleUpperCase("pt-BR"))
    .replace(/\b(E|Da|Das|De|Do|Dos)\b/g, (match) => match.toLocaleLowerCase("pt-BR"));
}

function compactId(value: string) {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function vigenciaLabel(inicio: string | null, final: string | null) {
  return `${fmtDate(inicio)} a ${fmtDate(final)}`;
}

function fmtCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);
}

function formatCadastroInput(field: string, value: string) {
  if (field === "cnpj") return maskCnpj(value);
  if (field === "cpf") return maskCpf(value);
  if (field === "telefone") return maskPhone(value);
  if (field === "email") return value.trimStart();
  return value;
}

function cadastroFormFromItem(item: CadastroFornecedor) {
  return {
    responsavel: item.responsavel,
    razaoSocial: item.razaoSocial,
    cnpj: maskCnpj(item.cnpj ?? item.cnpjNormalizado),
    cpf: maskCpf(item.cpf ?? ""),
    email: item.email ?? "",
    telefone: maskPhone(item.telefone ?? ""),
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
    valorCondicaoFixa: item.valorCondicaoFixa?.toString() ?? "",
    primeiroAditivo: item.primeiroAditivo ?? "",
    segundoAditivo: item.segundoAditivo ?? "",
  };
}

const CADASTRO_FIELDS: [keyof ReturnType<typeof cadastroFormFromItem>, string][] = [
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
  ["valorCondicaoFixa", "Condição fixa"],
  ["primeiroAditivo", "1º Adi"],
  ["segundoAditivo", "2º Ad"],
];

function FornecedorEditModal({
  item,
  onClose,
  onSuccess,
  onError,
}: {
  item: CadastroFornecedor;
  onClose: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => cadastroFormFromItem(item));

  // Recarrega o formulário sempre que o fornecedor selecionado mudar (troca ou reabertura) —
  // nunca deixa resíduo do fornecedor anterior.
  useEffect(() => {
    setForm(cadastroFormFromItem(item));
  }, [item]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [saving, onClose]);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: formatCadastroInput(field, value) }));
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
      onError(payload.error ?? "Não foi possível salvar o cadastro.");
      return;
    }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex max-h-[calc(100vh-16px)] w-full flex-col overflow-hidden sm:max-h-[85vh] sm:w-[820px] sm:max-w-[90vw]">
        {/* Header — fixo */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-bold text-[#1A1A1A]">{displayText(item.responsavel)}</h2>
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${toneClass[item.validadeTone]}`}>
                {item.validadeLabel}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#6B7280]">{displayText(item.razaoSocial)}</p>
          </div>
          <IconButton onClick={onClose} title="Fechar" disabled={saving}><X size={16} /></IconButton>
        </div>

        {/* Body — scroll interno */}
        <div className="grid flex-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {CADASTRO_FIELDS.map(([field, label]) => (
            <label key={field} className="text-label grid gap-1 text-[var(--muted-foreground)]">
              {label}
              <Input
                type={field === "email" ? "email" : "text"}
                inputMode={field === "email" ? "email" : ["cnpj", "cpf", "telefone"].includes(field) ? "numeric" : undefined}
                value={form[field]}
                onChange={(e) => update(field, e.target.value)}
                onBlur={(e) => {
                  if (field === "email") update(field, normalizeEmail(e.target.value));
                }}
                placeholder={
                  field === "cnpj" ? "00.000.000/0000-00" :
                  field === "cpf" ? "000.000.000-00" :
                  field === "telefone" ? "(00) 00000-0000" :
                  field === "email" ? "nome@empresa.com.br" :
                  undefined
                }
              />
            </label>
          ))}
          <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
            Início
            <Input type="date" value={form.inicio} onChange={(e) => update("inicio", e.target.value)} />
          </label>
          <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
            Final
            <Input type="date" value={form.final} onChange={(e) => update("final", e.target.value)} />
          </label>
        </div>

        {/* Footer — fixo */}
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            <Save size={14} />
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CadastroCard({ item, onEdit }: { item: CadastroFornecedor; onEdit: (item: CadastroFornecedor) => void }) {
  return (
    <Card className={`flex h-full min-h-[168px] flex-col overflow-hidden ${item.pendencias.length ? "border-[#FCA5A5]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{displayText(item.responsavel)}</h3>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${toneClass[item.validadeTone]}`}>
              {item.validadeLabel}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-[#6B7280]">{displayText(item.razaoSocial)}</p>
        </div>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-semibold text-[#555555] transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <Edit3 size={13} />
          Editar
        </button>
      </div>

      <div className="grid flex-1 content-start gap-x-8 gap-y-3 px-5 py-4 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <span className="text-[#64748B]">CNPJ</span>
          <p className="font-technical mt-0.5 truncate font-semibold text-[#1F2937]">{item.cnpj ?? "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#64748B]">ID</span>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[11px] font-semibold text-[#1F2937]" title={item.id}>{compactId(item.id)}</span>
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#2563EB]"
              onClick={() => navigator.clipboard?.writeText(item.id)}
              aria-label="Copiar ID"
              title="Copiar ID"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
        <div className="min-w-0">
          <span className="text-[#64748B]">E-mail</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{normalizeEmail(item.email) || "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#64748B]">Telefone</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{maskPhone(item.telefone) || "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#64748B]">Condição fixa</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{item.valorCondicaoFixa ? fmtCurrency(item.valorCondicaoFixa) : "-"}</p>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <span className="text-[#64748B]">Vigência</span>
          <p className="mt-0.5 inline-flex rounded-full bg-[#F8FAFC] px-2.5 py-1 font-semibold text-[#334155] ring-1 ring-[#E2E8F0]">
            {vigenciaLabel(item.inicio, item.final)}
          </p>
        </div>
        {item.pendencias.length > 0 && (
          <div className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[#B91C1C] sm:col-span-2">
            Pendência: {item.pendencias.join(", ")}
          </div>
        )}
      </div>
    </Card>
  );
}

export function AdministrativoPanel() {
  const [items, setItems] = useState<CadastroFornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFornecedor, setSelectedFornecedor] = useState<CadastroFornecedor | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/administrativo/fornecedores");
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !q || [item.responsavel, item.razaoSocial, item.cnpj, item.colaboradorCodigo, item.email]
        .some((value) => value?.toLowerCase().includes(q));
      const matchesStatus =
        statusFilter === "todos" ||
        (statusFilter === "vencidos" && item.diasAteVencimento !== null && item.diasAteVencimento < 0) ||
        (statusFilter === "vencendo" && item.diasAteVencimento !== null && item.diasAteVencimento >= 0 && item.diasAteVencimento <= 30) ||
        (statusFilter === "pendencias" && item.pendencias.length > 0);
      return matchesSearch && matchesStatus;
    });
  }, [items, search, statusFilter]);

  const vencidos = items.filter((item) => item.diasAteVencimento !== null && item.diasAteVencimento < 0).length;
  const vencendo = items.filter((item) => item.diasAteVencimento !== null && item.diasAteVencimento >= 0 && item.diasAteVencimento <= 30).length;
  const pendencias = items.filter((item) => item.pendencias.length > 0);
  const filterCounts: Record<StatusFilter, number> = {
    todos: items.length,
    vencidos,
    vencendo,
    pendencias: pendencias.length,
  };

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
    <PageContainer className="grid w-full gap-6">
      <PageHeader
        eyebrow="Administrativo"
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
        <Card className="p-4"><p className="text-stat-label uppercase text-[var(--muted-foreground)]">Total</p><p className="text-stat-value mt-1">{items.length}</p></Card>
        <Card className="p-4"><p className="text-stat-label uppercase text-[var(--muted-foreground)]">Vencidos</p><p className="text-stat-value mt-1 text-[#B91C1C]">{vencidos}</p></Card>
        <Card className="p-4"><p className="text-stat-label uppercase text-[var(--muted-foreground)]">Vencem em 30 dias</p><p className="text-stat-value mt-1 text-[#D97706]">{vencendo}</p></Card>
        <Card className="p-4"><p className="text-stat-label uppercase text-[var(--muted-foreground)]">Pendências</p><p className="text-stat-value mt-1 text-[#2563EB]">{pendencias.length}</p></Card>
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

      <Card className="grid gap-4 p-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${
                statusFilter === filter
                  ? "border-[#2563EB] bg-[#2563EB] text-white shadow-sm"
                  : "border-[#E5E7EB] bg-white text-[#555555] hover:border-[#2563EB] hover:text-[#2563EB]"
              }`}
            >
              {FILTER_LABELS[filter]}
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusFilter === filter ? "bg-white/20 text-white" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
                {filterCounts[filter]}
              </span>
            </button>
          ))}
        </div>
        <Input placeholder="Buscar por responsável, razão social, CNPJ ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>

      {loading ? (
        <Card className="p-6 text-sm text-[#6B7280]">Carregando cadastros...</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-[#6B7280]">Nenhum cadastro encontrado.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((item) => <CadastroCard key={item.id} item={item} onEdit={setSelectedFornecedor} />)}
        </div>
      )}

      {selectedFornecedor && (
        <FornecedorEditModal
          item={selectedFornecedor}
          onClose={() => setSelectedFornecedor(null)}
          onSuccess={async () => {
            setSelectedFornecedor(null);
            setToast({ tone: "success", message: "Fornecedor atualizado com sucesso." });
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[60] rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            toast.tone === "success" ? "bg-[#16A34A]" : "bg-[#DC2626]"
          }`}
        >
          {toast.message}
        </div>
      )}
    </PageContainer>
  );
}
