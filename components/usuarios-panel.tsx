"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck, ShieldOff, Trash2, UserCog, X } from "lucide-react";
import { Badge, Button, Card, Input, SectionHeader } from "@/components/ui";

type Usuario = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  primeiroLogin: boolean;
  senhaTemporaria: string | null;
  ultimoLoginAt: string | null;
  createdAt: string;
};

type NovoUsuarioForm = {
  usuario: string;
  nome: string;
  perfil: string;
  senha: string;
  confirmarSenha: string;
};

const PERFIL_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  MEDICAO: "Medição",
  COLABORADOR: "Fornecedor",
  FINANCEIRO: "Financeiro",
  DEPARTAMENTO_PESSOAL: "Departamento Pessoal",
};

const PERFIL_OPTIONS = [
  { value: "ADMIN",               label: "Administrador" },
  { value: "MEDICAO",             label: "Medição" },
  { value: "COLABORADOR",         label: "Fornecedor" },
  { value: "FINANCEIRO",          label: "Financeiro" },
  { value: "DEPARTAMENTO_PESSOAL", label: "Departamento Pessoal" },
];

const PERFIL_GROUPS = [
  { value: "ADMIN", label: "Administradores", description: "Acesso completo à plataforma." },
  { value: "MEDICAO", label: "Equipe de medição", description: "Operação e acompanhamento das medições." },
  { value: "FINANCEIRO", label: "Financeiro", description: "Notas fiscais, pagamentos e comprovantes." },
  { value: "COLABORADOR", label: "Fornecedores", description: "Acesso ao portal do colaborador." },
  { value: "DEPARTAMENTO_PESSOAL", label: "Departamento Pessoal", description: "Usuários reservados para etapa futura." },
];

function fmtDate(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function SetSenhaForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setError("");
    if (novaSenha.length < 12) { setError("Mínimo 12 caracteres."); return; }
    if (novaSenha !== confirmar) { setError("Senhas não coincidem."); return; }
    setSaving(true);
    const res = await fetch(`/api/admin/usuarios/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_senha", novaSenha }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Erro."); return; }
    onDone();
  }

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
      <p className="text-xs font-semibold text-[#555555]">Definir nova senha</p>
      <Input type="password" placeholder="Nova senha (mín. 12)" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
      <Input type="password" placeholder="Confirmar senha" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
      {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar senha"}</Button>
        <Button variant="secondary" className="flex-1" onClick={onDone}>Cancelar</Button>
      </div>
    </div>
  );
}

function UsuarioCard({ u, onRefresh, canDelete }: { u: Usuario; onRefresh: () => void; canDelete: boolean }) {
  const [showTemp, setShowTemp] = useState(false);
  const [showSetSenha, setShowSetSenha] = useState(false);
  const [showSetPerfil, setShowSetPerfil] = useState(false);
  const [novoPerfil, setNovoPerfil] = useState(u.perfil);
  const [loading, setLoading] = useState(false);

  async function salvarPerfil() {
    setLoading(true);
    await fetch(`/api/admin/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_perfil", perfil: novoPerfil }),
    });
    setLoading(false);
    setShowSetPerfil(false);
    onRefresh();
  }

  async function toggleAtivo() {
    setLoading(true);
    await fetch(`/api/admin/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_ativo" }),
    });
    setLoading(false);
    onRefresh();
  }

  async function resetSenha() {
    if (!window.confirm(`Gerar nova senha temporária para ${u.nome || u.usuario}?`)) return;
    setLoading(true);
    const res = await fetch(`/api/admin/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_senha" }),
    });
    setLoading(false);
    if (res.ok) onRefresh();
  }

  async function excluirUsuario() {
    if (!window.confirm(`Excluir o usuário "${u.nome || u.usuario}"? Ele perderá acesso, mas o histórico será preservado.`)) return;
    setLoading(true);
    const res = await fetch(`/api/admin/usuarios/${u.id}`, { method: "DELETE" });
    const payload = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      alert(payload.error ?? "Não foi possível excluir o usuário.");
      return;
    }
    onRefresh();
  }

  const perfilLabel = PERFIL_LABEL[u.perfil] ?? u.perfil;
  const isInternal = ["MEDICAO", "ADMIN", "FINANCEIRO"].includes(u.perfil);
  const accent = u.perfil === "ADMIN"
    ? "border-[#AF1B1B]/30 bg-[#FFF5F5]"
    : u.perfil === "MEDICAO"
    ? "border-[#2563EB]/25 bg-[#EFF6FF]"
    : u.perfil === "FINANCEIRO"
    ? "border-[#16A34A]/25 bg-[#F0FDF4]"
    : "border-[#E5E7EB] bg-white";

  return (
    <div className={`flex min-h-[190px] flex-col rounded-xl border p-4 shadow-sm transition-colors ${u.ativo ? accent : "border-[#E5E7EB] bg-[#F9FAFB] opacity-70"}`}>
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          isInternal ? "bg-white text-[#AF1B1B] ring-1 ring-[#FECACA]" : "bg-[#EFF6FF] text-[#2563EB]"
        }`}>
          {(u.nome || u.usuario).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold text-[#1A1A1A]">{u.nome || u.usuario}</span>
            <Badge variant={u.ativo ? "brand" : "neutral"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
            {u.primeiroLogin && <span className="rounded bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#D97706]">1º acesso pendente</span>}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] uppercase tracking-wide text-[#9CA3AF]">{u.usuario}</p>
          <p className="mt-1 text-[11px] text-[#6B7280]">Último acesso: {fmtDate(u.ultimoLoginAt)}</p>
          <span className="mt-2 inline-flex rounded bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#555555] ring-1 ring-[#E5E7EB]">{perfilLabel}</span>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <div className={`grid grid-cols-2 gap-2 ${canDelete ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
          <button onClick={toggleAtivo} disabled={loading} title={u.ativo ? "Desativar" : "Ativar"}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-medium text-[#555555] transition-colors hover:border-[#AF1B1B] hover:text-[#AF1B1B] disabled:opacity-40">
            {u.ativo ? <ShieldOff size={13} className="mr-1 inline" /> : <ShieldCheck size={13} className="mr-1 inline" />}
            {u.ativo ? "Desativar" : "Ativar"}
          </button>
          <button onClick={resetSenha} disabled={loading} title="Resetar senha"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-medium text-[#555555] transition-colors hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-40">
            <RefreshCw size={13} className="mr-1 inline" />Resetar
          </button>
          <button onClick={() => setShowSetSenha((v) => !v)} title="Definir senha"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-medium text-[#555555] transition-colors hover:border-[#16A34A] hover:text-[#16A34A]">
            <KeyRound size={13} className="mr-1 inline" />Senha
          </button>
          <button onClick={() => { setShowSetPerfil((v) => !v); setNovoPerfil(u.perfil); }} title="Alterar função"
            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs font-medium text-[#555555] transition-colors hover:border-[#7C3AED] hover:text-[#7C3AED]">
            <UserCog size={13} className="mr-1 inline" />Função
          </button>
          {canDelete && (
            <button onClick={excluirUsuario} disabled={loading} title="Excluir usuário"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[#FECACA] bg-white px-2 text-xs font-medium text-[#B91C1C] transition-colors hover:border-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-40">
              <Trash2 size={13} className="mr-1 inline" />Excluir
            </button>
          )}
        </div>
      </div>

      {u.senhaTemporaria && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#FFFBEB] px-3 py-2">
          <KeyRound size={13} className="shrink-0 text-[#D97706]" />
          <span className="text-xs text-[#92400E]">Senha temporária:</span>
          <span className={`font-mono text-sm font-bold tracking-widest text-[#92400E] ${showTemp ? "" : "blur-sm select-none"}`}>
            {u.senhaTemporaria}
          </span>
          <button className="ml-1 text-[#D97706] hover:text-[#92400E]" onClick={() => setShowTemp((v) => !v)} title={showTemp ? "Ocultar" : "Revelar"}>
            {showTemp ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      )}

      {showSetSenha && (
        <div>
          <SetSenhaForm userId={u.id} onDone={() => { setShowSetSenha(false); onRefresh(); }} />
        </div>
      )}

      {showSetPerfil && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
          <p className="text-xs font-semibold text-[#555555] shrink-0">Alterar função</p>
          <select
            value={novoPerfil}
            onChange={(e) => setNovoPerfil(e.target.value)}
            className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A]"
          >
            {PERFIL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button onClick={salvarPerfil} disabled={loading || novoPerfil === u.perfil}
            className="rounded-lg bg-[#7C3AED] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:opacity-40">
            {loading ? "Salvando…" : "Salvar"}
          </button>
          <button onClick={() => setShowSetPerfil(false)}
            className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#555555] transition-colors hover:bg-[#F3F4F6]">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function CriarUsuarioModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<NovoUsuarioForm>({
    usuario: "",
    nome: "",
    perfil: "COLABORADOR",
    senha: "",
    confirmarSenha: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateField(field: keyof NovoUsuarioForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function resetAndClose() {
    setError("");
    setForm({ usuario: "", nome: "", perfil: "COLABORADOR", senha: "", confirmarSenha: "" });
    onClose();
  }

  async function criarUsuario() {
    setError("");
    if (form.senha !== form.confirmarSenha) {
      setError("As senhas não coincidem.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: form.usuario,
        nome: form.nome,
        perfil: form.perfil,
        senha: form.senha,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível criar o usuário.");
      return;
    }

    resetAndClose();
    onCreated();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-10">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#AF1B1B]">Administrador</p>
            <h3 className="text-lg font-bold text-[#1A1A1A]">Criar usuário</h3>
            <p className="mt-1 text-sm text-[#555555]">Defina o acesso inicial e o perfil do novo usuário da plataforma.</p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="rounded-lg border border-[#E5E7EB] p-2 text-[#6B7280] transition hover:bg-[#F3F4F6] hover:text-[#1A1A1A]"
            aria-label="Fechar criação de usuário"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Nome
            <Input
              placeholder="Nome exibido na plataforma"
              value={form.nome}
              onChange={(e) => updateField("nome", e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Usuário
            <Input
              placeholder="Login de acesso"
              value={form.usuario}
              onChange={(e) => updateField("usuario", e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Perfil
            <select
              value={form.perfil}
              onChange={(e) => updateField("perfil", e.target.value)}
              className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none transition hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            >
              {PERFIL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="hidden sm:block" />
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Senha inicial
            <Input
              type="password"
              placeholder="Mínimo 12 caracteres"
              value={form.senha}
              onChange={(e) => updateField("senha", e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Confirmar senha
            <Input
              type="password"
              placeholder="Repita a senha inicial"
              value={form.confirmarSenha}
              onChange={(e) => updateField("confirmarSenha", e.target.value)}
            />
          </label>
          {error && (
            <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-medium text-[#B91C1C] sm:col-span-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={resetAndClose} disabled={saving}>Cancelar</Button>
          <Button onClick={criarUsuario} disabled={saving}>
            <Plus size={14} />
            {saving ? "Criando…" : "Criar usuário"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function UsuariosPanel({ canCreateUsers = false }: { canCreateUsers?: boolean }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "ativos" | "inativos">("todos");
  const [busca, setBusca] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/usuarios");
    if (res.ok) setUsuarios(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = usuarios.filter((u) => {
    if (filtro === "ativos" && !u.ativo) return false;
    if (filtro === "inativos" && u.ativo) return false;
    if (busca) {
      const q = busca.toLowerCase();
      return u.nome?.toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q);
    }
    return true;
  });

  const ativos = usuarios.filter((u) => u.ativo).length;
  const aguardando = usuarios.filter((u) => u.primeiroLogin).length;
  const grouped = PERFIL_GROUPS
    .map((group) => ({
      ...group,
      usuarios: filtered.filter((u) => u.perfil === group.value),
    }))
    .filter((group) => group.usuarios.length > 0);

  return (
    <div className="grid gap-6">
      <div className="mx-auto w-full" style={{ maxWidth: "80rem" }}>
        <SectionHeader
          title="Gestão de usuários"
          description="Gerencie acessos, senhas e status dos colaboradores e usuários da plataforma."
          action={
            <div className="flex flex-wrap gap-2">
              {canCreateUsers && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus size={14} />
                  Novo usuário
                </Button>
              )}
              <Button variant="secondary" onClick={load} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Atualizar
              </Button>
            </div>
          }
        />
      </div>

      <CriarUsuarioModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3 mx-auto w-full" style={{ maxWidth: "80rem" }}>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Total</p>
          <p className="mt-1 text-2xl font-bold text-[#1A1A1A]">{usuarios.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Ativos</p>
          <p className="mt-1 text-2xl font-bold text-[#16A34A]">{ativos}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Aguardando 1º acesso</p>
          <p className="mt-1 text-2xl font-bold text-[#D97706]">{aguardando}</p>
        </Card>
      </div>

      {/* Filtros */}
      <div style={{ maxWidth: "80rem" }} className="mx-auto w-full">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Buscar por nome ou usuário…"
              className="min-w-[220px] flex-1"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {(["todos", "ativos", "inativos"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${filtro === f ? "bg-[#AF1B1B] text-white" : "bg-[#F3F4F6] text-[#555555] hover:bg-[#E5E7EB]"}`}
              >
                {f === "todos" ? "Todos" : f === "ativos" ? "Ativos" : "Inativos"}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ maxWidth: "80rem" }} className="mx-auto w-full">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#AF1B1B]" />
              <span className="text-sm text-[#555555]">Carregando usuários…</span>
            </div>
          </Card>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ maxWidth: "80rem" }} className="mx-auto w-full">
          <Card className="p-6">
            <div className="flex items-center gap-3 text-[#555555]">
              <UserCog size={18} />
              <span className="text-sm">Nenhum usuário encontrado.</span>
            </div>
          </Card>
        </div>
      ) : (
        <div className="mx-auto grid w-full gap-6" style={{ maxWidth: "80rem" }}>
          {grouped.map((group) => (
            <section key={group.value} className="grid gap-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-[#1A1A1A]">{group.label}</h3>
                  <p className="text-xs text-[#6B7280]">{group.description}</p>
                </div>
                <span className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-[#555555] ring-1 ring-[#E5E7EB]">
                  {group.usuarios.length} usuário(s)
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {group.usuarios.map((u) => (
                  <UsuarioCard key={u.id} u={u} onRefresh={load} canDelete={canCreateUsers} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
