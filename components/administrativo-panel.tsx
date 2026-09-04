"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Edit3, EllipsisVertical, Eye, EyeOff, FileSpreadsheet, KeyRound, Plus, RefreshCw, Save, ShieldCheck, ShieldOff, Trash2, Upload, UserCog, X } from "lucide-react";
import { Button, Card, FilterButton, FilterChip, IconButton, Input, PageContainer, PageHeader } from "@/components/ui";
import { INTERNAL_PERFIL_OPTIONS, PERFIL_LABEL_LOOSE as PERFIL_LABEL, PERFIL_OPTIONS } from "@/lib/perfis";

type AcessoInfo = {
  id: string;
  usuario: string;
  perfil: string;
  ativo: boolean;
  email: string | null;
  primeiroLogin: boolean;
  senhaTemporaria: string | null;
};

type Funcionario = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  primeiroLogin: boolean;
  senhaTemporaria: string | null;
  email: string | null;
};

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
  acesso: AcessoInfo | null;
};

type PessoaItem =
  | { tipo: "FORNECEDOR"; nome: string; data: CadastroFornecedor }
  | { tipo: "FUNCIONARIO"; nome: string; data: Funcionario };

type TipoFilter = "todos" | "fornecedores" | "funcionarios";

const TIPO_FILTER_LABELS: Record<TipoFilter, string> = {
  todos: "Todos",
  fornecedores: "Fornecedores",
  funcionarios: "Funcionários",
};

type ImportResult = {
  total: number;
  criados: number;
  atualizados: number;
  usuariosCriados: number;
  senhasTemporarias: { usuario: string; nome: string; senha: string; email: string | null }[];
};

type AcessoOpcao = "ativo" | "inativo";
const ACESSO_LABELS: Record<AcessoOpcao, string> = { ativo: "Ativo", inativo: "Inativo" };

type SituacaoOpcao = "validos" | "vencidos" | "vencendo" | "pendencias";
const SITUACAO_LABELS: Record<SituacaoOpcao, string> = {
  validos: "Válido",
  vencidos: "Vencido",
  vencendo: "Próximo do vencimento",
  pendencias: "Pendência",
};

type AdminDeletionResult = {
  requested: number;
  administrativeDeleted: number;
  usersDeactivated: number;
  usersDeleted: number;
  professionalsDeleted: number;
  professionalsPreservedForHistory: number;
  measurementHistoryPreserved: number;
  errors: { id: string; error: string }[];
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
  danger: "bg-[#FFF1F1] text-[#DC3545] ring-[#DC3545]/30",
  warning: "bg-[#FFF8E1] text-[#B77900] ring-[#FFC107]/70",
  notice: "bg-[#EAF3FF] text-[#007BFF] ring-[#007BFF]/30",
  success: "bg-[#EAF7ED] text-[#28A745] ring-[#28A745]/30",
  neutral: "bg-[#F3F4F6] text-[#6B7280] ring-[#E5E7EB]",
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
  // Bug corrigido: mostrava "31/08/2026 a -" (conector errado + traço solto). Sem nenhuma data,
  // mostra só "-"; com Início e sem Fim, "31/08/2026 → -" (nunca corta o texto).
  if (!inicio && !final) return "-";
  return `${fmtDate(inicio)} → ${fmtDate(final)}`;
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
            Fim
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

const NOVO_FORNECEDOR_FORM_INICIAL = {
  responsavel: "",
  razaoSocial: "",
  cnpj: "",
  email: "",
  telefone: "",
  cargo: "",
  inicio: "",
  final: "",
  tipoContrato: "",
  valorHora: "",
  valorA1Equivalente: "",
  valorDocumento: "",
  valorCondicaoFixa: "",
};

type NovoFornecedorForm = typeof NOVO_FORNECEDOR_FORM_INICIAL;

const FORNECEDOR_SECTIONS: { title: string; columns?: 2 | 3; fields: [keyof NovoFornecedorForm, string, { type?: string; placeholder?: string; inputMode?: "numeric" | "email" }?][] }[] = [
  {
    title: "Identificação",
    fields: [
      ["responsavel", "Nome / Responsável"],
      ["cnpj", "CNPJ", { placeholder: "00.000.000/0000-00", inputMode: "numeric" }],
      ["razaoSocial", "Razão social"],
      ["cargo", "Função"],
    ],
  },
  {
    title: "Contato",
    fields: [
      ["email", "E-mail", { type: "email", placeholder: "nome@empresa.com.br", inputMode: "email" }],
      ["telefone", "Telefone", { placeholder: "(00) 00000-0000", inputMode: "numeric" }],
    ],
  },
  {
    title: "Contrato",
    // Status deixou de ser digitado manualmente — passa a depender exclusivamente do cálculo
    // automático por vigência (lib/cadastro-fornecedor.ts:cadastroStatusVisual, com base em
    // Início/Fim), o mesmo que já alimenta os cards e indicadores. 3 colunas porque a seção
    // ficou com 3 campos (Tipo contrato, Início, Fim) — evita célula vazia no grid de 2 colunas.
    columns: 3,
    fields: [
      ["tipoContrato", "Tipo contrato"],
      ["inicio", "Início", { type: "date" }],
      ["final", "Fim", { type: "date" }],
    ],
  },
  {
    title: "Precificação",
    fields: [
      ["valorHora", "Hora", { inputMode: "numeric" }],
      ["valorDocumento", "Documento", { inputMode: "numeric" }],
      ["valorA1Equivalente", "A1 equivalente", { inputMode: "numeric" }],
      ["valorCondicaoFixa", "Condição fixa", { inputMode: "numeric" }],
    ],
  },
];

/**
 * Formulário de fornecedor — fonte única, reaproveitada dentro da aba "Fornecedor" do modal
 * unificado "Cadastro" (ver `CadastroModal`, abaixo). Puramente apresentacional: estado e envio
 * ficam no componente pai, para sobreviver à troca de aba sem perder o que o usuário digitou.
 */
function FornecedorForm({ form, onChange }: { form: NovoFornecedorForm; onChange: (field: keyof NovoFornecedorForm, value: string) => void }) {
  let firstFieldAssigned = false;
  return (
    <div className="grid gap-6">
      {FORNECEDOR_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#AF1B1B]">{section.title}</p>
          <div className={`grid gap-3 ${section.columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {section.fields.map(([field, label, opts]) => {
              const isFirst = !firstFieldAssigned;
              if (isFirst) firstFieldAssigned = true;
              return (
                <label key={field} className="text-label grid gap-1 text-[var(--muted-foreground)]">
                  {label}
                  <Input
                    autoFocus={isFirst}
                    type={opts?.type ?? "text"}
                    inputMode={opts?.inputMode}
                    value={form[field]}
                    onChange={(e) => onChange(field, e.target.value)}
                    onBlur={(e) => { if (field === "email") onChange(field, normalizeEmail(e.target.value)); }}
                    placeholder={opts?.placeholder}
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const NOVO_FUNCIONARIO_FORM_INICIAL: { nome: string; perfil: string; email: string } = {
  nome: "",
  perfil: INTERNAL_PERFIL_OPTIONS[0]?.value ?? "ADMINISTRATIVO",
  email: "",
};
type NovoFuncionarioForm = typeof NOVO_FUNCIONARIO_FORM_INICIAL;

/** Formulário de funcionário — fonte única, reaproveitada na aba "Funcionário" do `CadastroModal`. */
function FuncionarioForm({ form, onChange }: { form: NovoFuncionarioForm; onChange: (field: keyof NovoFuncionarioForm, value: string) => void }) {
  return (
    <div className="grid max-w-sm gap-3">
      <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
        Nome
        <Input autoFocus value={form.nome} onChange={(e) => onChange("nome", e.target.value)} />
      </label>
      <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
        Perfil
        <select
          value={form.perfil}
          onChange={(e) => onChange("perfil", e.target.value)}
          className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none transition hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        >
          {INTERNAL_PERFIL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
        E-mail
        <Input
          type="email"
          placeholder="nome@empresa.com.br"
          value={form.email}
          onChange={(e) => onChange("email", e.target.value)}
          onBlur={(e) => onChange("email", normalizeEmail(e.target.value))}
        />
      </label>
    </div>
  );
}

type CadastroAba = "FORNECEDOR" | "FUNCIONARIO";

/**
 * Modal único "Cadastro" — substitui os antigos "Novo fornecedor"/"Novo funcionário" (dois botões
 * no cabeçalho) por abas dentro do mesmo modal. Formulários reaproveitados de `FornecedorForm`/
 * `FuncionarioForm` (única fonte de verdade); cada aba mantém seu próprio estado no componente pai
 * para não perder o que já foi digitado ao alternar — só reseta quando o modal fecha por completo.
 */
function CadastroModal({
  isAdmin,
  onClose,
  onFornecedorSuccess,
  onFuncionarioSuccess,
  onError,
}: {
  isAdmin: boolean;
  onClose: () => void;
  onFornecedorSuccess: (usuarioCriado: { usuario: string; nome: string; senha: string; email: string | null } | null) => void;
  onFuncionarioSuccess: (usuario: Funcionario) => void;
  onError: (message: string) => void;
}) {
  const [aba, setAba] = useState<CadastroAba>("FORNECEDOR");
  const [fornecedorForm, setFornecedorForm] = useState<NovoFornecedorForm>(NOVO_FORNECEDOR_FORM_INICIAL);
  const [funcionarioForm, setFuncionarioForm] = useState<NovoFuncionarioForm>(NOVO_FUNCIONARIO_FORM_INICIAL);
  const [savingFornecedor, setSavingFornecedor] = useState(false);
  const [savingFuncionario, setSavingFuncionario] = useState(false);
  const saving = aba === "FORNECEDOR" ? savingFornecedor : savingFuncionario;

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

  function updateFornecedor(field: keyof NovoFornecedorForm, value: string) {
    setFornecedorForm((prev) => ({ ...prev, [field]: formatCadastroInput(field, value) }));
  }

  function updateFuncionario(field: keyof NovoFuncionarioForm, value: string) {
    setFuncionarioForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveFornecedor() {
    // Duplo clique/duplo submit não pode criar dois cadastros — ignora enquanto já está salvando.
    if (savingFornecedor) return;
    setSavingFornecedor(true);
    try {
      const res = await fetch("/api/admin/administrativo/fornecedores/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fornecedorForm),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(payload.error ?? "Não foi possível cadastrar o fornecedor.");
        return;
      }
      onFornecedorSuccess(payload.usuarioCriado ?? null);
    } finally {
      setSavingFornecedor(false);
    }
  }

  async function saveFuncionario() {
    if (savingFuncionario) return;
    setSavingFuncionario(true);
    try {
      const res = await fetch("/api/admin/administrativo/funcionarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(funcionarioForm),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(payload.error ?? "Não foi possível cadastrar o funcionário.");
        return;
      }
      onFuncionarioSuccess(payload as Funcionario);
    } finally {
      setSavingFuncionario(false);
    }
  }

  // Funcionário é ação sensível (perfil interno + senha automática) — mesmo gate que já existia
  // no botão "Novo funcionário" anterior. Não amplia permissão nenhuma, só reorganiza a UI.
  const TABS: { value: CadastroAba; label: string }[] = isAdmin
    ? [
        { value: "FORNECEDOR", label: "Fornecedor" },
        { value: "FUNCIONARIO", label: "Funcionário" },
      ]
    : [{ value: "FORNECEDOR", label: "Fornecedor" }];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex max-h-[calc(100vh-16px)] w-full flex-col overflow-hidden sm:max-h-[85vh] sm:w-[820px] sm:max-w-[90vw]">
        {/* Header — fixo */}
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#1A1A1A]">Cadastro</h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">Cadastre fornecedores ou funcionários da plataforma.</p>
          </div>
          <IconButton onClick={onClose} title="Fechar" disabled={saving}><X size={16} /></IconButton>
        </div>

        {/* Abas — genuínas (texto + linha inferior), não botões grandes. Some sozinha quando só
            resta uma opção (perfil sem permissão para cadastrar funcionário). */}
        {TABS.length > 1 && (
        <div role="tablist" aria-label="Tipo de cadastro" className="flex gap-5 border-b border-[#E5E7EB] px-5">
          {TABS.map((tab) => {
            const active = aba === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                id={`cadastro-tab-${tab.value}`}
                aria-selected={active}
                aria-controls={`cadastro-panel-${tab.value}`}
                onClick={() => setAba(tab.value)}
                disabled={saving}
                className={`-mb-px border-b-2 px-1 py-3 text-sm transition ${
                  active
                    ? "border-[#AF1B1B] font-bold text-[#AF1B1B]"
                    : "border-transparent font-medium text-[#6B7280] hover:text-[#374151]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        )}

        {/* Body — scroll interno; só a aba ativa é renderizada, mas o estado vive no pai (não se
            perde ao trocar de aba). */}
        <div className="flex-1 overflow-y-auto p-5">
          <div id="cadastro-panel-FORNECEDOR" role="tabpanel" aria-labelledby="cadastro-tab-FORNECEDOR" hidden={aba !== "FORNECEDOR"}>
            {aba === "FORNECEDOR" && <FornecedorForm form={fornecedorForm} onChange={updateFornecedor} />}
          </div>
          <div id="cadastro-panel-FUNCIONARIO" role="tabpanel" aria-labelledby="cadastro-tab-FUNCIONARIO" hidden={aba !== "FUNCIONARIO"}>
            {aba === "FUNCIONARIO" && <FuncionarioForm form={funcionarioForm} onChange={updateFuncionario} />}
          </div>
        </div>

        {/* Footer — fixo; acompanha a aba ativa. */}
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          {aba === "FORNECEDOR" ? (
            <Button onClick={saveFornecedor} disabled={saving}>
              <Save size={14} />
              {savingFornecedor ? "Cadastrando..." : "Cadastrar fornecedor"}
            </Button>
          ) : (
            <Button onClick={saveFuncionario} disabled={saving}>
              <Plus size={14} />
              {savingFuncionario ? "Cadastrando..." : "Cadastrar funcionário"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AlterarPerfilModal({
  target,
  onClose,
  onSaved,
  onError,
}: {
  target: { usuarioId: string; nome: string; perfilAtual: string };
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [perfil, setPerfil] = useState(target.perfilAtual);
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setSaving(true);
    const res = await fetch(`/api/admin/usuarios/${target.usuarioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_perfil", perfil }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      onError(payload.error ?? "Não foi possível alterar o perfil.");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[380px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Alterar perfil</h2>
          <p className="mt-0.5 text-xs text-[#6B7280]">{target.nome}</p>
        </div>
        <div className="p-5">
          <select
            value={perfil}
            onChange={(e) => setPerfil(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none transition hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          >
            {INTERNAL_PERFIL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || perfil === target.perfilAtual}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal de credencial — ÚNICO lugar da aplicação onde uma senha temporária em texto puro chega a
 * ser exibida, e só imediatamente após a operação que a gerou (criação de fornecedor/funcionário,
 * ou redefinição de senha). Nunca persiste: `senha` vive só no estado React deste componente,
 * nunca é salva em nenhuma coluna nova, e desaparece ao fechar (`onClose` limpa o state do pai —
 * recarregar a página ou reabrir o card jamais a revela de novo).
 */
function CredencialModal({
  titulo,
  nome,
  email,
  usuario,
  senha,
  onClose,
}: {
  titulo: string;
  nome: string;
  email: string | null;
  usuario?: string;
  senha: string;
  onClose: () => void;
}) {
  const [visivel, setVisivel] = useState(false);
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[420px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">{titulo}</h2>
        </div>
        <div className="grid gap-3 p-5 text-sm">
          <div>
            <span className="text-xs text-[#64748B]">Nome</span>
            <p className="font-semibold text-[#1F2937]">{nome}</p>
          </div>
          {usuario && (
            <div>
              <span className="text-xs text-[#64748B]">Login</span>
              <p className="font-mono font-semibold text-[#1F2937]">{usuario}</p>
            </div>
          )}
          {email && (
            <div>
              <span className="text-xs text-[#64748B]">E-mail</span>
              <p className="font-semibold text-[#1F2937]">{email}</p>
            </div>
          )}
          <div className="rounded-lg bg-[#FFFBEB] px-3 py-2">
            <span className="text-xs text-[#92400E]">Senha temporária</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="flex-1 truncate rounded-md border border-[#FDE68A] bg-white px-2 py-1 font-mono text-sm font-bold text-[#92400E]">
                {visivel ? senha : "•".repeat(Math.max(senha.length, 8))}
              </span>
              <button
                type="button"
                onClick={() => setVisivel((v) => !v)}
                title={visivel ? "Ocultar senha" : "Mostrar senha"}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#FDE68A] bg-white text-[#92400E] transition hover:bg-[#FFFBEB]"
              >
                {visivel ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(senha); setCopiado(true); }}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[#FDE68A] bg-white px-2 text-[11px] font-semibold text-[#92400E] transition hover:bg-[#FFFBEB]"
              >
                <Copy size={12} />
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-[#92400E]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Esta senha será exibida somente agora — feche este modal só depois de repassá-la ao usuário.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmResetSenhaModal({
  nome,
  confirming,
  onCancel,
  onConfirm,
}: {
  nome: string;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[380px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Redefinir senha</h2>
          <p className="mt-1 text-xs text-[#6B7280]">
            Gerar uma nova senha temporária para <strong className="text-[#374151]">{nome}</strong>? A senha atual deixa de funcionar imediatamente.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={confirming}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={confirming}>
            <KeyRound size={14} />
            {confirming ? "Redefinindo..." : "Redefinir senha"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResetSenhaButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-[11px] font-semibold text-[#555555] transition hover:border-[#2563EB] hover:text-[#2563EB]"
    >
      <KeyRound size={12} />
      Redefinir senha
    </button>
  );
}

type MenuAction = { label: string; icon: React.ReactNode; onClick: () => void; tone?: "danger" };

/**
 * Menu de ações "..." compacto — mesmo padrão de painel flutuante já usado no arquivo
 * (ref + listener de `mousedown` para fechar ao clicar fora, ver `FiltrosDropdown`). Agrupa ações
 * secundárias (Alterar perfil, Ativar/Desativar acesso, Excluir) para reduzir a altura do card,
 * mantendo Editar/Redefinir senha sempre visíveis fora do menu.
 */
function ActionsMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  if (actions.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#94A3B8] transition hover:border-[#D1D5DB] hover:text-[#374151]"
      >
        <EllipsisVertical size={14} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-30 w-48 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-1.5 shadow-xl">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); action.onClick(); }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition hover:bg-[#F9FAFB] ${
                action.tone === "danger" ? "text-[#B91C1C] hover:bg-[#FEF2F2]" : "text-[#374151]"
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CadastroCard({
  item,
  onEdit,
  onDelete,
  isAdmin,
  selected,
  onToggleSelected,
  onResetSenha,
  onToggleAtivo,
}: {
  item: CadastroFornecedor;
  onEdit: (item: CadastroFornecedor) => void;
  onDelete: (item: CadastroFornecedor) => void;
  isAdmin: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  onResetSenha: (usuarioId: string, nome: string, email: string | null) => void;
  onToggleAtivo: (usuarioId: string, ativoAtual: boolean) => void;
}) {
  const menuActions: MenuAction[] = [];
  if (isAdmin && item.acesso) {
    menuActions.push({
      label: item.acesso.ativo ? "Desativar acesso" : "Ativar acesso",
      icon: item.acesso.ativo ? <ShieldOff size={13} /> : <ShieldCheck size={13} />,
      onClick: () => onToggleAtivo(item.acesso!.id, item.acesso!.ativo),
    });
  }
  if (isAdmin) {
    menuActions.push({ label: "Excluir fornecedor", icon: <Trash2 size={13} />, tone: "danger", onClick: () => onDelete(item) });
  }

  return (
    <Card className={`overflow-hidden ${item.pendencias.length ? "border-[#FCA5A5]" : ""} ${selected ? "ring-2 ring-[#AF1B1B]/40" : ""}`}>
      <div className="flex items-start justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          {/* Checkbox de seleção em massa só faz sentido para quem pode excluir (só ADMIN). */}
          {isAdmin && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelected(item.id)}
              aria-label={`Selecionar ${item.responsavel}`}
              className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#AF1B1B]"
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{displayText(item.responsavel)}</h3>
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1 bg-[#EFF6FF] text-[#2563EB] ring-[#BFDBFE]">
                Fornecedor
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1 ${toneClass[item.validadeTone]}`}>
                {item.validadeLabel}
              </span>
              {item.acesso && (
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${item.acesso.ativo ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
                  {item.acesso.ativo ? "Ativo" : "Inativo"}
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-[#6B7280]">{displayText(item.razaoSocial)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-[11px] font-semibold text-[#555555] transition hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            <Edit3 size={12} />
            Editar
          </button>
          <ActionsMenu actions={menuActions} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#E5E7EB] px-4 py-2.5 text-xs sm:grid-cols-4">
        <div className="min-w-0">
          <span className="text-[#94A3B8]">CNPJ</span>
          <p className="font-technical mt-0.5 truncate font-semibold text-[#1F2937]">{item.cnpj ?? "-"}</p>
        </div>
        {/* Código P0 real = login do Usuario (perfil COLABORADOR) vinculado a este fornecedor —
            o mesmo tipo de valor que o card de Funcionário já exibe (Usuario.usuario). NÃO é
            `colaboradorCodigo`/`Profissional.codigo`: esse é a identidade de negócio usada na
            resolução do Mapa de Pagamento/importação e, na ausência de um código herdado, cai
            para o próprio nome (ex.: "ANDERSON MARLEY") — daí o bug de mostrar nome no lugar do
            P0. Sem `acesso` vinculado (fornecedor sem Usuario ainda resolvido), mostra "-", nunca
            inventado. */}
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Código</span>
          <p className="font-technical mt-0.5 truncate font-semibold text-[#1F2937]">{item.acesso?.usuario || "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#94A3B8]">E-mail</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{normalizeEmail(item.email) || "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Telefone</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{maskPhone(item.telefone) || "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Função</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{item.cargo || "-"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Perfil</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{item.acesso ? (PERFIL_LABEL[item.acesso.perfil] ?? item.acesso.perfil) : "-"}</p>
        </div>
        {/* Vigência precisa de espaço para nunca cortar o texto — quebra linha se precisar em vez
            de truncar (bug anterior: "31/08/2026 a -" comprimido num pill de largura fixa). Por
            último e span-2 no mobile: preenche a grade em linhas completas (sem lacuna) mesmo com
            o novo campo Código somando 7 itens no total. */}
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <span className="text-[#94A3B8]">Vigência</span>
          <p className="mt-0.5 whitespace-normal break-words font-semibold text-[#1F2937]">
            {vigenciaLabel(item.inicio, item.final)}
          </p>
        </div>
      </div>

      {item.pendencias.length > 0 && (
        <div className="border-t border-[#FECACA] bg-[#FEF2F2] px-4 py-1.5 text-[11px] text-[#B91C1C]">
          Pendência: {item.pendencias.join(", ")}
        </div>
      )}

      {isAdmin && item.acesso && (
        <div className="border-t border-[#E5E7EB] px-4 py-2">
          <ResetSenhaButton onClick={() => onResetSenha(item.acesso!.id, item.responsavel, item.acesso!.email)} />
        </div>
      )}
    </Card>
  );
}

function FuncionarioCard({
  item,
  isAdmin,
  onResetSenha,
  onToggleAtivo,
  onSetPerfil,
  onExcluir,
}: {
  item: Funcionario;
  isAdmin: boolean;
  onResetSenha: (usuarioId: string, nome: string, email: string | null) => void;
  onToggleAtivo: (usuarioId: string, ativoAtual: boolean) => void;
  onSetPerfil: (usuarioId: string, nome: string, perfilAtual: string) => void;
  onExcluir: (usuarioId: string, nome: string) => void;
}) {
  const menuActions: MenuAction[] = isAdmin
    ? [
        { label: "Alterar perfil", icon: <UserCog size={13} />, onClick: () => onSetPerfil(item.id, item.nome, item.perfil) },
        {
          label: item.ativo ? "Desativar acesso" : "Ativar acesso",
          icon: item.ativo ? <ShieldOff size={13} /> : <ShieldCheck size={13} />,
          onClick: () => onToggleAtivo(item.id, item.ativo),
        },
        { label: "Excluir", icon: <Trash2 size={13} />, tone: "danger", onClick: () => onExcluir(item.id, item.nome) },
      ]
    : [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-bold text-[#1A1A1A]">{displayText(item.nome)}</h3>
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1 bg-[#FEF2F2] text-[#AF1B1B] ring-[#FECACA]">
              Funcionário
            </span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${item.ativo ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
              {item.ativo ? "Ativo" : "Inativo"}
            </span>
          </div>
          <p className="truncate text-[11px] text-[#6B7280]">{item.email ?? "Sem e-mail cadastrado"}</p>
        </div>
        <ActionsMenu actions={menuActions} />
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-2 border-t border-[#E5E7EB] px-4 py-2.5 text-xs">
        {/* Funcionário não tem Profissional/colaboradorCodigo (esse cadastro nunca existe para
            perfil interno) — o código canônico dele é o próprio login (`Usuario.usuario`, formato
            P0xxxxxx, já gerado por generateUniqueInternalAccessCode). Nunca "-" aqui: todo Usuario
            sempre tem `usuario` preenchido. */}
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Código</span>
          <p className="font-technical mt-0.5 truncate font-semibold text-[#1F2937]">{item.usuario}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Perfil</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{PERFIL_LABEL[item.perfil] ?? item.perfil}</p>
        </div>
        <div className="min-w-0">
          <span className="text-[#94A3B8]">Acesso</span>
          <p className="mt-0.5 truncate font-semibold text-[#1F2937]">{item.ativo ? "Ativo" : "Inativo"}</p>
        </div>
      </div>

      {isAdmin && (
        <div className="border-t border-[#E5E7EB] px-4 py-2">
          <ResetSenhaButton onClick={() => onResetSenha(item.id, item.nome, item.email)} />
        </div>
      )}
    </Card>
  );
}

// Confirmação forte por digitação — só exigida para exclusão em massa (2+ itens); exclusão
// individual usa UX mais simples (nome/CNPJ/ID visíveis já é confirmação suficiente).
const BULK_CONFIRM_THRESHOLD = 2;

function DeleteConfirmModal({
  items,
  onClose,
  onDone,
}: {
  items: CadastroFornecedor[];
  onClose: () => void;
  onDone: (result: AdminDeletionResult) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const isBulk = items.length >= BULK_CONFIRM_THRESHOLD;
  const confirmPhrase = `EXCLUIR ${items.length}`;
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = !isBulk || confirmText.trim().toUpperCase() === confirmPhrase;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [deleting, onClose]);

  async function confirmDelete() {
    // Duplo clique/duplo submit não pode disparar duas exclusões em paralelo.
    if (deleting || !canConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/administrativo/fornecedores/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: items.map((item) => item.id) }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) {
        onDone({
          requested: items.length, administrativeDeleted: 0, usersDeactivated: 0, usersDeleted: 0,
          professionalsDeleted: 0, professionalsPreservedForHistory: 0, measurementHistoryPreserved: 0,
          errors: [{ id: "-", error: payload?.error ?? "Não foi possível excluir os fornecedores selecionados." }],
        });
        return;
      }
      onDone(payload as AdminDeletionResult);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[480px] sm:max-w-[90vw]">
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">
            {isBulk ? `Excluir ${items.length} fornecedores definitivamente?` : "Excluir fornecedor definitivamente?"}
          </h2>
          <IconButton onClick={onClose} title="Fechar" disabled={deleting}><X size={16} /></IconButton>
        </div>
        <div className="grid gap-3 p-5 text-sm text-[#374151]">
          <p className="text-xs text-[#6B7280]">
            {isBulk
              ? "Os cadastros administrativos e acessos selecionados serão removidos. Registros históricos da Equipe de Medição serão preservados."
              : "O cadastro administrativo e o acesso deste fornecedor serão removidos. Informações históricas relacionadas a medições, BMs, pagamentos, notas fiscais e comprovantes serão preservadas."}
          </p>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-[#F8FAFC] p-2 ring-1 ring-[#E2E8F0]">
            {items.map((item) => (
              <div key={item.id} className="grid gap-0.5 border-b border-[#E5E7EB] px-1.5 py-1.5 text-xs last:border-0">
                <p className="font-semibold text-[#1F2937]">{displayText(item.responsavel)}</p>
                <p className="font-technical text-[11px] text-[#64748B]">CNPJ {item.cnpj ?? "-"} · ID {compactId(item.id)}</p>
              </div>
            ))}
          </div>
          {isBulk && (
            <label className="grid gap-1 text-xs font-semibold text-[#374151]">
              Digite <span className="font-technical text-[#AF1B1B]">{confirmPhrase}</span> para habilitar a exclusão
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={confirmPhrase} autoFocus />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>Cancelar</Button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting || !canConfirm}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#DC2626] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={14} />
            {deleting ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Dropdown compacto "Filtros" — substitui as antigas linhas de botões (Tipo + Situação cadastral)
 * por um único controle, seguindo o mesmo padrão de painel flutuante já usado no projeto (ref +
 * listener de `mousedown` para fechar ao clicar fora — ver `ComentarioDropdown` em
 * components/mapa-pagamento-table.tsx). Dois grupos lógicos: USUÁRIOS (Tipo/Perfil/Acesso, valem
 * para fornecedor e funcionário) e FORNECEDORES (Situação cadastral, só fornecedor).
 */
function FiltrosDropdown({
  tipoFiltro,
  onTipoChange,
  perfilFiltro,
  onPerfilChange,
  acessoFiltro,
  onToggleAcesso,
  situacaoFiltro,
  onToggleSituacao,
  onClear,
  activeCount,
}: {
  tipoFiltro: TipoFilter;
  onTipoChange: (value: TipoFilter) => void;
  perfilFiltro: string;
  onPerfilChange: (value: string) => void;
  acessoFiltro: Set<AcessoOpcao>;
  onToggleAcesso: (value: AcessoOpcao) => void;
  situacaoFiltro: Set<SituacaoOpcao>;
  onToggleSituacao: (value: SituacaoOpcao) => void;
  onClear: () => void;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const situacaoDisabled = tipoFiltro === "funcionarios";

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div className="relative shrink-0" ref={ref}>
      <FilterButton count={activeCount} onClick={() => setOpen((v) => !v)} />

      {open && (
        <div className="absolute right-0 top-10 z-40 w-[300px] max-w-[90vw] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#AF1B1B]">Usuários</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Fechar"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#374151]"
            >
              <X size={12} />
            </button>
          </div>

          <div className="mt-2 grid gap-3">
            <div>
              <p className="text-label mb-1 text-[var(--muted-foreground)]">Tipo</p>
              <div className="grid gap-1.5">
                {(["todos", "fornecedores", "funcionarios"] as TipoFilter[]).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-xs text-[#374151]">
                    <input
                      type="radio"
                      name="administrativo-tipo-filtro"
                      checked={tipoFiltro === value}
                      onChange={() => onTipoChange(value)}
                      className="accent-[#AF1B1B]"
                    />
                    {TIPO_FILTER_LABELS[value]}
                  </label>
                ))}
              </div>
            </div>

            <label className="grid gap-1 text-xs text-[#374151]">
              Perfil
              <select
                value={perfilFiltro}
                onChange={(e) => onPerfilChange(e.target.value)}
                className="h-8 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs text-[#1A1A1A] outline-none transition hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
              >
                <option value="todos">Todos os perfis</option>
                {PERFIL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div>
              <p className="text-label mb-1 text-[var(--muted-foreground)]">Acesso</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {(["ativo", "inativo"] as AcessoOpcao[]).map((value) => (
                  <label key={value} className="flex items-center gap-1.5 text-xs text-[#374151]">
                    <input
                      type="checkbox"
                      checked={acessoFiltro.has(value)}
                      onChange={() => onToggleAcesso(value)}
                      className="accent-[#AF1B1B]"
                    />
                    {ACESSO_LABELS[value]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="my-3 border-t border-[#E5E7EB]" />

          <p className="text-[10px] font-bold uppercase tracking-wider text-[#AF1B1B]">Fornecedores</p>
          <div className="mt-2">
            <p className="text-label mb-1 text-[var(--muted-foreground)]">Situação cadastral</p>
            <div className={`grid gap-1.5 ${situacaoDisabled ? "opacity-40" : ""}`}>
              {(["validos", "vencidos", "vencendo", "pendencias"] as SituacaoOpcao[]).map((value) => (
                <label key={value} className="flex items-center gap-2 text-xs text-[#374151]">
                  <input
                    type="checkbox"
                    disabled={situacaoDisabled}
                    checked={situacaoFiltro.has(value)}
                    onChange={() => onToggleSituacao(value)}
                    className="accent-[#AF1B1B]"
                  />
                  {SITUACAO_LABELS[value]}
                </label>
              ))}
            </div>
            {situacaoDisabled && (
              <p className="mt-1 text-[10px] text-[#94A3B8]">Não se aplica a funcionários.</p>
            )}
          </div>

          <div className="mt-4 flex justify-between border-t border-[#E5E7EB] pt-3">
            <button type="button" onClick={onClear} className="text-xs font-semibold text-[#6B7280] transition hover:text-[#374151]">
              Limpar filtros
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-[#AF1B1B]">
              Concluído
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdministrativoPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [items, setItems] = useState<CadastroFornecedor[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<TipoFilter>("todos");
  const [perfilFiltro, setPerfilFiltro] = useState("todos");
  const [acessoFiltro, setAcessoFiltro] = useState<Set<AcessoOpcao>>(new Set());
  const [situacaoFiltro, setSituacaoFiltro] = useState<Set<SituacaoOpcao>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFornecedor, setSelectedFornecedor] = useState<CadastroFornecedor | null>(null);
  const [creatingCadastro, setCreatingCadastro] = useState(false);
  // Credencial (senha temporária) exibida SOMENTE logo após criar usuário ou redefinir senha —
  // vive só neste estado em memória, nunca é persistida, e some ao fechar o modal (nunca reaparece
  // num F5 ou reabrindo o card depois).
  const [credencial, setCredencial] = useState<{ titulo: string; nome: string; email: string | null; usuario?: string; senha: string } | null>(null);
  const [resetSenhaTarget, setResetSenhaTarget] = useState<{ usuarioId: string; nome: string; email: string | null } | null>(null);
  const [resettingSenha, setResettingSenha] = useState(false);
  const [perfilTarget, setPerfilTarget] = useState<{ usuarioId: string; nome: string; perfilAtual: string } | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Guarda tanto a exclusão individual (1 item, disparada pelo botão da lixeira no card) quanto a
  // exclusão em massa (a seleção inteira) — o mesmo modal/endpoint atende os dois casos.
  const [deleteTargets, setDeleteTargets] = useState<CadastroFornecedor[] | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const [resFornecedores, resFuncionarios] = await Promise.all([
      fetch("/api/admin/administrativo/fornecedores"),
      fetch("/api/admin/administrativo/funcionarios"),
    ]);
    if (resFornecedores.ok) {
      const data: CadastroFornecedor[] = await resFornecedores.json();
      setItems(data);
      // Nunca mantém selecionado um ID que não existe mais na listagem (ex.: excluído por outra
      // sessão, ou por uma exclusão em massa recém-concluída).
      const validIds = new Set(data.map((item) => item.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => validIds.has(id))));
    }
    if (resFuncionarios.ok) setFuncionarios(await resFuncionarios.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !q || [item.responsavel, item.razaoSocial, item.cnpj, item.colaboradorCodigo, item.email]
        .some((value) => value?.toLowerCase().includes(q));
      const matchesPerfil = perfilFiltro === "todos" || item.acesso?.perfil === perfilFiltro;
      const matchesAcesso = acessoFiltro.size === 0
        ? true
        : item.acesso
          ? (acessoFiltro.has("ativo") && item.acesso.ativo) || (acessoFiltro.has("inativo") && !item.acesso.ativo)
          : false;
      // Mesma regra atual (cadastroStatusVisual, baseada em Início/Fim) — "Próximo do vencimento"
      // continua sendo dias<=30, sem nova lógica de datas.
      const matchesSituacao = situacaoFiltro.size === 0 ||
        (situacaoFiltro.has("validos") && item.validadeTone === "success") ||
        (situacaoFiltro.has("vencidos") && item.diasAteVencimento !== null && item.diasAteVencimento < 0) ||
        (situacaoFiltro.has("vencendo") && item.diasAteVencimento !== null && item.diasAteVencimento >= 0 && item.diasAteVencimento <= 30) ||
        (situacaoFiltro.has("pendencias") && item.pendencias.length > 0);
      return matchesSearch && matchesPerfil && matchesAcesso && matchesSituacao;
    });
  }, [items, search, perfilFiltro, acessoFiltro, situacaoFiltro]);

  const filteredFuncionarios = useMemo(() => {
    const q = search.trim().toLowerCase();
    return funcionarios.filter((f) => {
      const matchesSearch = !q || [f.nome, f.email, f.usuario].some((value) => value?.toLowerCase().includes(q));
      const matchesPerfil = perfilFiltro === "todos" || f.perfil === perfilFiltro;
      const matchesAcesso = acessoFiltro.size === 0 || (acessoFiltro.has("ativo") && f.ativo) || (acessoFiltro.has("inativo") && !f.ativo);
      // Situação cadastral é conceito de fornecedor (vigência) — funcionário nunca é classificado
      // por ela; qualquer critério de situação ativo simplesmente não inclui funcionário na lista
      // (nunca gera "vencido"/"pendente" indevido para quem não tem vigência).
      const matchesSituacao = situacaoFiltro.size === 0;
      return matchesSearch && matchesPerfil && matchesAcesso && matchesSituacao;
    });
  }, [funcionarios, search, perfilFiltro, acessoFiltro, situacaoFiltro]);

  // Lista unificada exibida nos cards.
  const visiblePessoas: PessoaItem[] = useMemo(() => {
    const list: PessoaItem[] = [];
    if (tipoFiltro !== "funcionarios") {
      for (const item of filtered) list.push({ tipo: "FORNECEDOR", nome: item.responsavel, data: item });
    }
    if (tipoFiltro !== "fornecedores") {
      for (const item of filteredFuncionarios) list.push({ tipo: "FUNCIONARIO", nome: item.nome, data: item });
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [filtered, filteredFuncionarios, tipoFiltro]);

  function toggleAcessoFiltro(value: AcessoOpcao) {
    setAcessoFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleSituacaoFiltro(value: SituacaoOpcao) {
    setSituacaoFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function limparFiltros() {
    setTipoFiltro("todos");
    setPerfilFiltro("todos");
    setAcessoFiltro(new Set());
    setSituacaoFiltro(new Set());
  }

  // Chips compactos abaixo da busca — um por critério ativo ("Todos" nunca conta como filtro).
  const filtroChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (tipoFiltro !== "todos") chips.push({ key: "tipo", label: TIPO_FILTER_LABELS[tipoFiltro], onRemove: () => setTipoFiltro("todos") });
    if (perfilFiltro !== "todos") chips.push({ key: "perfil", label: PERFIL_LABEL[perfilFiltro] ?? perfilFiltro, onRemove: () => setPerfilFiltro("todos") });
    for (const value of acessoFiltro) chips.push({ key: `acesso-${value}`, label: `Acesso: ${ACESSO_LABELS[value]}`, onRemove: () => toggleAcessoFiltro(value) });
    for (const value of situacaoFiltro) chips.push({ key: `situacao-${value}`, label: SITUACAO_LABELS[value], onRemove: () => toggleSituacaoFiltro(value) });
    return chips;
  }, [tipoFiltro, perfilFiltro, acessoFiltro, situacaoFiltro]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));
  // Selecionar/desmarcar "todos" respeita o conjunto atualmente filtrado/pesquisado (item
  // explícito do pedido) — mas a seleção em si sobrevive à troca de filtro/busca (trocar o filtro
  // não perde seleção por engano); a barra de ações em massa e o modal operam sobre TODA a
  // seleção real, mesmo itens que saíram do filtro atual.
  const selectedItems = items.filter((item) => selectedIds.has(item.id));

  function pedirResetSenha(usuarioId: string, nome: string, email: string | null) {
    setResetSenhaTarget({ usuarioId, nome, email });
  }

  async function confirmarResetSenha() {
    if (!resetSenhaTarget) return;
    const { usuarioId, nome, email } = resetSenhaTarget;
    setResettingSenha(true);
    try {
      const res = await fetch(`/api/admin/usuarios/${usuarioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_senha" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetSenhaTarget(null);
        setToast({ tone: "error", message: payload.error ?? "Não foi possível redefinir a senha." });
        return;
      }
      // A senha só existe nesta resposta — nunca fica persistida em texto puro além do hash já
      // atualizado pelo backend. Mostrada no CredencialModal; se o admin fechar sem copiar, só
      // resta redefinir de novo (mais seguro do que guardar a senha em algum lugar "por garantia").
      setResetSenhaTarget(null);
      setCredencial({ titulo: "Senha redefinida com sucesso", nome, email, senha: payload.senhaTemporaria });
      await load();
    } finally {
      setResettingSenha(false);
    }
  }

  async function toggleAtivoUsuario(usuarioId: string, ativoAtual: boolean) {
    const res = await fetch(`/api/admin/usuarios/${usuarioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_ativo" }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast({ tone: "error", message: payload.error ?? "Não foi possível alterar o acesso." });
      return;
    }
    setToast({ tone: "success", message: ativoAtual ? "Acesso desativado." : "Acesso ativado." });
    await load();
  }

  async function excluirFuncionario(usuarioId: string, nome: string) {
    if (!window.confirm(`Excluir o funcionário "${nome}"? Ele perderá acesso, mas o histórico será preservado.`)) return;
    const res = await fetch(`/api/admin/usuarios/${usuarioId}`, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast({ tone: "error", message: payload.error ?? "Não foi possível excluir o funcionário." });
      return;
    }
    setToast({ tone: "success", message: "Funcionário excluído." });
    await load();
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const item of filtered) next.delete(item.id);
        return next;
      }
      const next = new Set(prev);
      for (const item of filtered) next.add(item.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function handleDeletionDone(resultado: AdminDeletionResult) {
    setDeleteTargets(null);
    clearSelection();
    // Identidade histórica preservada NUNCA é apresentada como erro — é o resultado esperado e
    // correto da política (ver lib/cadastro-fornecedor.ts:deleteFornecedoresDefinitivamente).
    const partes: string[] = [];
    if (resultado.administrativeDeleted > 0) {
      partes.push(`${resultado.administrativeDeleted} cadastro(s) administrativo(s) removido(s)`);
    }
    if (resultado.professionalsPreservedForHistory > 0) {
      partes.push(
        `${resultado.professionalsPreservedForHistory} identidade(s) histórica(s) preservada(s) por possuírem registros de medição`,
      );
    }
    if (resultado.errors.length > 0) partes.push(`${resultado.errors.length} falharam por erro técnico`);
    const mensagem = partes.length > 0 ? `${partes.join(". ")}.` : "Nenhum fornecedor foi excluído.";
    setToast({ tone: resultado.errors.length === 0 ? "success" : "error", message: mensagem });
    load();
  }

  // Usada só pelo banner "Fornecedores com pendências" abaixo do upload — independe dos filtros.
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
            <Button onClick={() => setCreatingCadastro(true)}>
              <Plus size={14} />
              Cadastro
            </Button>
          </div>
        }
      />

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
              <p className="text-xs font-bold uppercase text-[#92400E]">
                {result.senhasTemporarias.length} usuário(s) criado(s) — senhas temporárias
              </p>
              <div className="grid gap-1.5">
                {result.senhasTemporarias.map((entry) => (
                  <div key={entry.usuario} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#FDE68A] bg-white px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-[#92400E]">
                      <strong>{entry.nome}</strong> {entry.email ? `· ${entry.email}` : ""} <span className="font-mono text-[10px] text-[#B45309]">({entry.usuario})</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono font-bold text-[#92400E]">{entry.senha}</span>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(entry.senha)}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-[#FDE68A] bg-white px-1.5 text-[10px] font-semibold text-[#92400E] transition hover:bg-[#FFFBEB]"
                      >
                        <Copy size={10} />
                        Copiar
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              {/* Só existem nesta resposta de importação (nunca persistidas em texto puro) —
                  atualizar a página ou reabrir o painel não as traz de volta. */}
              <p className="flex items-start gap-1.5 text-[11px] text-[#92400E]">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                Essas senhas serão exibidas somente nesta importação — copie agora antes de sair desta tela.
              </p>
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

      <Card className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-[220px] flex-1"
            placeholder="Buscar por nome, e-mail, razão social ou CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <FiltrosDropdown
            tipoFiltro={tipoFiltro}
            onTipoChange={setTipoFiltro}
            perfilFiltro={perfilFiltro}
            onPerfilChange={setPerfilFiltro}
            acessoFiltro={acessoFiltro}
            onToggleAcesso={toggleAcessoFiltro}
            situacaoFiltro={situacaoFiltro}
            onToggleSituacao={toggleSituacaoFiltro}
            onClear={limparFiltros}
            activeCount={filtroChips.length}
          />
        </div>

        {filtroChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {filtroChips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
            ))}
          </div>
        )}

        {isAdmin && filtered.length > 0 && (
          <label className="flex w-fit items-center gap-2 text-xs font-semibold text-[#555555]">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="h-3.5 w-3.5 cursor-pointer accent-[#AF1B1B]"
            />
            Selecionar todos {filtered.length !== items.length ? "(filtrados)" : ""}
          </label>
        )}
      </Card>

      {loading ? (
        <Card className="p-6 text-sm text-[#6B7280]">Carregando cadastros...</Card>
      ) : visiblePessoas.length === 0 ? (
        <Card className="p-6 text-sm text-[#6B7280]">Nenhum cadastro encontrado.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visiblePessoas.map((pessoa) =>
            pessoa.tipo === "FORNECEDOR" ? (
              <CadastroCard
                key={pessoa.data.id}
                item={pessoa.data}
                onEdit={setSelectedFornecedor}
                onDelete={(target) => setDeleteTargets([target])}
                isAdmin={isAdmin}
                selected={selectedIds.has(pessoa.data.id)}
                onToggleSelected={toggleSelected}
                onResetSenha={pedirResetSenha}
                onToggleAtivo={toggleAtivoUsuario}
              />
            ) : (
              <FuncionarioCard
                key={pessoa.data.id}
                item={pessoa.data}
                isAdmin={isAdmin}
                onResetSenha={pedirResetSenha}
                onToggleAtivo={toggleAtivoUsuario}
                onSetPerfil={(usuarioId, nome, perfilAtual) => setPerfilTarget({ usuarioId, nome, perfilAtual })}
                onExcluir={excluirFuncionario}
              />
            ),
          )}
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

      {creatingCadastro && (
        <CadastroModal
          isAdmin={isAdmin}
          onClose={() => setCreatingCadastro(false)}
          onFornecedorSuccess={async (usuarioCriado) => {
            setCreatingCadastro(false);
            if (usuarioCriado) {
              // Usuario novo (COLABORADOR) criado junto do cadastro — mesma senha automática de
              // sempre (generateTempPassword/hashPassword), só que agora efetivamente exibida.
              setCredencial({
                titulo: "Fornecedor cadastrado com sucesso",
                nome: usuarioCriado.nome,
                email: usuarioCriado.email,
                usuario: usuarioCriado.usuario,
                senha: usuarioCriado.senha,
              });
            } else {
              // Fornecedor já tinha Usuario vinculado (reaproveitado) — nenhuma senha nova gerada.
              setToast({ tone: "success", message: "Fornecedor cadastrado com sucesso." });
            }
            await load();
          }}
          onFuncionarioSuccess={async (usuario) => {
            setCreatingCadastro(false);
            if (usuario.senhaTemporaria) {
              setCredencial({
                titulo: "Funcionário criado com sucesso",
                nome: usuario.nome,
                email: usuario.email,
                usuario: usuario.usuario,
                senha: usuario.senhaTemporaria,
              });
            } else {
              setToast({ tone: "success", message: "Funcionário cadastrado com sucesso." });
            }
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {credencial && (
        <CredencialModal
          titulo={credencial.titulo}
          nome={credencial.nome}
          email={credencial.email}
          usuario={credencial.usuario}
          senha={credencial.senha}
          onClose={() => setCredencial(null)}
        />
      )}

      {resetSenhaTarget && (
        <ConfirmResetSenhaModal
          nome={resetSenhaTarget.nome}
          confirming={resettingSenha}
          onCancel={() => setResetSenhaTarget(null)}
          onConfirm={confirmarResetSenha}
        />
      )}

      {perfilTarget && (
        <AlterarPerfilModal
          target={perfilTarget}
          onClose={() => setPerfilTarget(null)}
          onSaved={async () => {
            setPerfilTarget(null);
            setToast({ tone: "success", message: "Perfil atualizado." });
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {isAdmin && selectedItems.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-lg">
          <span className="text-xs font-bold text-[#1A1A1A]">
            {selectedItems.length} {selectedItems.length === 1 ? "fornecedor selecionado" : "fornecedores selecionados"}
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="inline-flex h-8 items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#555555] transition hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            Cancelar seleção
          </button>
          <button
            type="button"
            onClick={() => setDeleteTargets(selectedItems)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#DC2626] px-3 text-xs font-bold text-white transition hover:bg-[#B91C1C]"
          >
            <Trash2 size={13} />
            Excluir definitivamente
          </button>
        </div>
      )}

      {deleteTargets && (
        <DeleteConfirmModal
          items={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onDone={handleDeletionDone}
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
