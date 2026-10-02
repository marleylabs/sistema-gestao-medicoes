"use client";

import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { normalizeTipoCondicaoFixa } from "@/lib/condicao-fixa";
import { normalizeFonteMedicao } from "@/lib/fonte-medicao";
import { INTERNAL_PERFIL_OPTIONS } from "@/lib/perfis";
import { AdminSidePanel, PanelSection } from "@/components/administrativo/admin-side-panel";
import {
  dateInputValue,
  formatCadastroInput,
  maskCnpj,
  maskCpf,
  maskPhone,
  normalizeEmail,
  type CadastroFornecedor,
  type Funcionario,
} from "@/components/administrativo/shared";

export function cadastroFormFromItem(item: CadastroFornecedor) {
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
    tipoCondicaoFixa: normalizeTipoCondicaoFixa(item.tipoCondicaoFixa),
    valorCondicaoFixaComProducao: item.valorCondicaoFixaComProducao?.toString() ?? "",
    valorCondicaoFixaSemProducao: item.valorCondicaoFixaSemProducao?.toString() ?? "",
    fonteMedicao: normalizeFonteMedicao(item.fonteMedicao),
    primeiroAditivo: item.primeiroAditivo ?? "",
    segundoAditivo: item.segundoAditivo ?? "",
  };
}

type EditForm = ReturnType<typeof cadastroFormFromItem>;

export const NOVO_FORNECEDOR_FORM_INICIAL = {
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
  tipoCondicaoFixa: "FIXA",
  valorCondicaoFixaComProducao: "",
  valorCondicaoFixaSemProducao: "",
  fonteMedicao: "DOCUMENTOS",
};

type CreateForm = typeof NOVO_FORNECEDOR_FORM_INICIAL;

type FieldOpts = { type?: string; placeholder?: string; inputMode?: "numeric" | "email"; full?: boolean };
type FieldDef<K extends string> = [K, string, FieldOpts?];
type SectionDef<K extends string> = { title: string; columns?: 2 | 3; fields: FieldDef<K>[] };

const CNPJ_OPTS: FieldOpts = { placeholder: "00.000.000/0000-00", inputMode: "numeric" };
const EMAIL_OPTS: FieldOpts = { type: "email", placeholder: "nome@empresa.com.br", inputMode: "email" };
const TELEFONE_OPTS: FieldOpts = { placeholder: "(00) 00000-0000", inputMode: "numeric" };

/**
 * Seções do cadastro (create) — MESMOS campos, rótulos e payload do antigo modal "Cadastro"
 * (POST /api/admin/administrativo/fornecedores/manual). Status continua calculado pela vigência.
 */
const CREATE_SECTIONS: { antes: SectionDef<keyof CreateForm>[]; depois: SectionDef<keyof CreateForm>[] } = {
  antes: [
    {
      title: "Identificação",
      fields: [
        ["responsavel", "Nome / Responsável"],
        ["cnpj", "CNPJ", CNPJ_OPTS],
        ["razaoSocial", "Razão social"],
        ["cargo", "Função"],
      ],
    },
  ],
  depois: [
    { title: "Contato", fields: [["email", "E-mail", EMAIL_OPTS], ["telefone", "Telefone", TELEFONE_OPTS]] },
    { title: "Contrato", columns: 3, fields: [["tipoContrato", "Tipo contrato"], ["inicio", "Início", { type: "date" }], ["final", "Fim", { type: "date" }]] },
    {
      title: "Precificação",
      columns: 3,
      fields: [["valorHora", "Hora", { inputMode: "numeric" }], ["valorDocumento", "Documento", { inputMode: "numeric" }], ["valorA1Equivalente", "A1 equivalente", { inputMode: "numeric" }]],
    },
  ],
};

/**
 * Seções da edição — MESMOS campos, rótulos e payload do antigo modal de edição
 * (PATCH /api/admin/administrativo/fornecedores/[id]); só reorganizados por assunto.
 */
const EDIT_SECTIONS: { antes: SectionDef<keyof EditForm>[]; depois: SectionDef<keyof EditForm>[] } = {
  antes: [
    { title: "Identificação", columns: 3, fields: [["responsavel", "Responsável"], ["cpf", "CPF", { placeholder: "000.000.000-00", inputMode: "numeric" }], ["cargo", "Cargo"]] },
    { title: "Empresa", fields: [["razaoSocial", "Razão social"], ["cnpj", "CNPJ", CNPJ_OPTS]] },
  ],
  depois: [
    { title: "Contato", fields: [["email", "E-mail", EMAIL_OPTS], ["telefone", "Telefone", TELEFONE_OPTS]] },
    {
      title: "Contrato",
      columns: 3,
      fields: [
        ["statusContrato", "Status CT"],
        ["tipoCt", "Tipo CT"],
        ["tipoContrato", "Tipo contrato"],
        ["inicio", "Início", { type: "date" }],
        ["final", "Fim", { type: "date" }],
        ["primeiroAditivo", "1º Adi"],
        ["segundoAditivo", "2º Ad"],
        ["objetoContrato", "Objeto do contrato", { full: true }],
      ],
    },
    {
      title: "Precificação",
      columns: 3,
      fields: [["valorHora", "Hora", { inputMode: "numeric" }], ["valorDocumento", "Documento", { inputMode: "numeric" }], ["valorA1Equivalente", "A1 equivalente", { inputMode: "numeric" }]],
    },
  ],
};

function FormSections<K extends string>({
  sections,
  values,
  onChange,
  autoFocusFirst,
}: {
  sections: SectionDef<K>[];
  values: Record<K, string>;
  onChange: (field: K, value: string) => void;
  autoFocusFirst?: boolean;
}) {
  let first = autoFocusFirst;
  return (
    <>
      {sections.map((section) => (
        <PanelSection key={section.title} title={section.title}>
          <div className={`grid gap-3 ${section.columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
            {section.fields.map(([field, label, opts]) => {
              const focus = first;
              first = false;
              return (
                <label key={field} className={`text-label grid gap-1 text-[var(--muted-foreground)] ${opts?.full ? "col-span-full" : ""}`}>
                  {label}
                  <Input
                    autoFocus={focus}
                    type={opts?.type ?? "text"}
                    inputMode={opts?.inputMode}
                    value={values[field]}
                    onChange={(e) => onChange(field, e.target.value)}
                    onBlur={(e) => { if (field === "email") onChange(field, normalizeEmail(e.target.value)); }}
                    placeholder={opts?.placeholder}
                  />
                </label>
              );
            })}
          </div>
        </PanelSection>
      ))}
    </>
  );
}

/**
 * Configuração de medição + Condição fixa — sempre logo após Identificação/Empresa (visíveis, nunca
 * escondidas no fim do formulário). Mesmas opções e mesmos campos de sempre; regra de resolução
 * continua em lib/condicao-fixa.ts::resolveCondicaoFixa e lib/fonte-medicao.ts.
 */
function MedicaoECondicaoSections({
  fonte,
  tipo,
  valorFixo,
  valorComProducao,
  valorSemProducao,
  onChange,
}: {
  fonte: string;
  tipo: string;
  valorFixo: string;
  valorComProducao: string;
  valorSemProducao: string;
  onChange: (field: "fonteMedicao" | "tipoCondicaoFixa" | "valorCondicaoFixa" | "valorCondicaoFixaComProducao" | "valorCondicaoFixaSemProducao", value: string) => void;
}) {
  const auxiliares = fonte === "DOCUMENTOS_AUXILIARES";
  const condicional = tipo === "CONDICIONAL_PRODUCAO";
  return (
    <>
      <PanelSection title="Configuração de medição">
        <label className="text-label grid max-w-md gap-1 text-[var(--muted-foreground)]">
          Fonte da medição
          <Select value={fonte} onChange={(e) => onChange("fonteMedicao", e.target.value)}>
            <option value="DOCUMENTOS">Documentos</option>
            <option value="DOCUMENTOS_AUXILIARES">Documentos Auxiliares (BM AUX)</option>
          </Select>
          <span className="text-[11px] font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
            Define qual aba da planilha será considerada para a produção deste fornecedor.
            {auxiliares && " As medições de produção serão consideradas pela aba Documentos Auxiliares."}
          </span>
        </label>
      </PanelSection>
      <PanelSection title="Condição fixa">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
            Tipo
            <Select value={tipo} onChange={(e) => onChange("tipoCondicaoFixa", e.target.value)}>
              <option value="FIXA">Fixa</option>
              <option value="CONDICIONAL_PRODUCAO">Condicional por produção</option>
            </Select>
          </label>
          {!condicional && (
            <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
              Valor fixo mensal/contratual
              <Input inputMode="numeric" value={valorFixo} onChange={(e) => onChange("valorCondicaoFixa", e.target.value)} />
            </label>
          )}
          {condicional && (
            <>
              <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
                Valor com produção
                <Input inputMode="numeric" value={valorComProducao} onChange={(e) => onChange("valorCondicaoFixaComProducao", e.target.value)} />
              </label>
              <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
                Valor sem produção
                <Input inputMode="numeric" value={valorSemProducao} onChange={(e) => onChange("valorCondicaoFixaSemProducao", e.target.value)} />
              </label>
            </>
          )}
        </div>
      </PanelSection>
    </>
  );
}

type UsuarioCriado = { usuario: string; nome: string; senha: string; email: string | null } | null;

/**
 * Editor ÚNICO de fornecedor da área Administrativo — `create` e `edit` compartilham painel,
 * seções e componentes; cada modo mantém exatamente os campos, validações (backend) e endpoints
 * que já existiam. Edit: Cancelar/Esc voltam ao detalhe; X fecha tudo.
 */
export function FornecedorEditor(props: {
  mode: "create";
  onClose: () => void;
  onCreated: (usuarioCriado: UsuarioCriado) => void;
  onError: (message: string) => void;
  escEnabled?: boolean;
} | {
  mode: "edit";
  item: CadastroFornecedor;
  onClose: () => void;
  onBack: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  escEnabled?: boolean;
}) {
  const [createForm, setCreateForm] = useState<CreateForm>(NOVO_FORNECEDOR_FORM_INICIAL);
  const [editForm, setEditForm] = useState<EditForm | null>(() => (props.mode === "edit" ? cadastroFormFromItem(props.item) : null));
  const [saving, setSaving] = useState(false);

  function updateCreate(field: keyof CreateForm, value: string) {
    setCreateForm((prev) => ({ ...prev, [field]: formatCadastroInput(field, value) }));
  }
  function updateEdit(field: keyof EditForm, value: string) {
    setEditForm((prev) => (prev ? { ...prev, [field]: formatCadastroInput(field, value) } : prev));
  }

  async function save() {
    // Duplo clique/duplo submit nunca cria dois cadastros — ignora enquanto já está salvando.
    if (saving) return;
    setSaving(true);
    try {
      if (props.mode === "create") {
        const res = await fetch("/api/admin/administrativo/fornecedores/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createForm),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          props.onError(payload.error ?? "Não foi possível cadastrar o fornecedor.");
          return;
        }
        props.onCreated(payload.usuarioCriado ?? null);
      } else {
        const res = await fetch(`/api/admin/administrativo/fornecedores/${props.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editForm),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          props.onError(payload.error ?? "Não foi possível salvar o cadastro.");
          return;
        }
        props.onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  const isCreate = props.mode === "create";
  const footer = (
    <>
      <Button variant="secondary" onClick={isCreate ? props.onClose : props.onBack} disabled={saving}>Cancelar</Button>
      <Button onClick={save} disabled={saving}>
        <Save size={14} />
        {isCreate ? (saving ? "Cadastrando..." : "Cadastrar fornecedor") : (saving ? "Salvando..." : "Salvar alterações")}
      </Button>
    </>
  );

  if (props.mode === "create") {
    return (
      <AdminSidePanel
        size="wide"
        eyebrow="Administrativo"
        title="Novo fornecedor"
        subtitle="Cadastro mestre do fornecedor: identificação, medição, condição fixa e contrato."
        onClose={props.onClose}
        escEnabled={props.escEnabled}
        closeDisabled={saving}
        footer={footer}
        testId="administrativo-editor"
      >
        <FormSections sections={CREATE_SECTIONS.antes} values={createForm} onChange={updateCreate} autoFocusFirst />
        <MedicaoECondicaoSections
          fonte={normalizeFonteMedicao(createForm.fonteMedicao)}
          tipo={normalizeTipoCondicaoFixa(createForm.tipoCondicaoFixa)}
          valorFixo={createForm.valorCondicaoFixa}
          valorComProducao={createForm.valorCondicaoFixaComProducao}
          valorSemProducao={createForm.valorCondicaoFixaSemProducao}
          onChange={updateCreate}
        />
        <FormSections sections={CREATE_SECTIONS.depois} values={createForm} onChange={updateCreate} />
      </AdminSidePanel>
    );
  }

  const form = editForm ?? cadastroFormFromItem(props.item);
  return (
    <AdminSidePanel
      size="wide"
      eyebrow="Editar cadastro"
      title={props.item.responsavel}
      subtitle={props.item.razaoSocial}
      onClose={props.onClose}
      onEscape={props.onBack}
      escEnabled={props.escEnabled}
      closeDisabled={saving}
      footer={footer}
      testId="administrativo-editor"
    >
      <FormSections sections={EDIT_SECTIONS.antes} values={form} onChange={updateEdit} autoFocusFirst />
      <MedicaoECondicaoSections
        fonte={form.fonteMedicao}
        tipo={form.tipoCondicaoFixa}
        valorFixo={form.valorCondicaoFixa}
        valorComProducao={form.valorCondicaoFixaComProducao}
        valorSemProducao={form.valorCondicaoFixaSemProducao}
        onChange={updateEdit}
      />
      <FormSections sections={EDIT_SECTIONS.depois} values={form} onChange={updateEdit} />
    </AdminSidePanel>
  );
}

const NOVO_FUNCIONARIO_FORM_INICIAL: { nome: string; perfil: string; email: string } = {
  nome: "",
  perfil: INTERNAL_PERFIL_OPTIONS[0]?.value ?? "ADMINISTRATIVO",
  email: "",
};

/**
 * Cadastro de funcionário (perfil interno + senha automática) — mesmos campos e endpoint do antigo
 * modal "Cadastro" (aba Funcionário, só ADMIN), agora no mesmo painel lateral.
 */
export function FuncionarioCreatePanel({
  onClose,
  onCreated,
  onError,
  escEnabled,
}: {
  onClose: () => void;
  /** Resposta da criação: a senha inicial vem SÓ aqui (exibição única), nunca da listagem. */
  onCreated: (usuario: Funcionario & { senhaTemporaria: string | null }) => void;
  onError: (message: string) => void;
  escEnabled?: boolean;
}) {
  const [form, setForm] = useState(NOVO_FUNCIONARIO_FORM_INICIAL);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/administrativo/funcionarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(payload.error ?? "Não foi possível cadastrar o funcionário.");
        return;
      }
      onCreated(payload as Funcionario & { senhaTemporaria: string | null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminSidePanel
      eyebrow="Administrativo"
      title="Novo funcionário"
      subtitle="Usuário interno da plataforma, com senha temporária automática."
      onClose={onClose}
      escEnabled={escEnabled}
      closeDisabled={saving}
      testId="administrativo-editor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            <Plus size={14} />
            {saving ? "Cadastrando..." : "Cadastrar funcionário"}
          </Button>
        </>
      }
    >
      <PanelSection title="Identificação">
        <div className="grid gap-3">
          <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
            Nome
            <Input autoFocus value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
          </label>
          <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
            Perfil
            <Select value={form.perfil} onChange={(e) => setForm((f) => ({ ...f, perfil: e.target.value }))}>
              {INTERNAL_PERFIL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </label>
          <label className="text-label grid gap-1 text-[var(--muted-foreground)]">
            E-mail
            <Input
              type="email"
              placeholder="nome@empresa.com.br"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              onBlur={(e) => setForm((f) => ({ ...f, email: normalizeEmail(e.target.value) }))}
            />
          </label>
        </div>
      </PanelSection>
    </AdminSidePanel>
  );
}
