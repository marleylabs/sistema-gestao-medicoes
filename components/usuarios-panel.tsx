"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EllipsisVertical, Eye, EyeOff, Info, KeyRound, Plus, RefreshCw, ShieldCheck, ShieldOff, Trash2, UserCog, X } from "lucide-react";
import { Button, Card, Input, PageContainer, PageHeader } from "@/components/ui";

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
  ADMINISTRATIVO: "Administrativo",
};

const PERFIL_OPTIONS = [
  { value: "ADMIN",               label: "Administrador" },
  { value: "MEDICAO",             label: "Medição" },
  { value: "COLABORADOR",         label: "Fornecedor" },
  { value: "FINANCEIRO",          label: "Financeiro" },
  { value: "ADMINISTRATIVO",      label: "Administrativo" },
];

const PERFIL_GROUPS = [
  { value: "ADMIN", label: "Administradores", description: "Acesso completo à plataforma." },
  { value: "MEDICAO", label: "Equipe de medição", description: "Operação e acompanhamento das medições." },
  { value: "FINANCEIRO", label: "Financeiro", description: "Notas fiscais, pagamentos e comprovantes." },
  { value: "ADMINISTRATIVO", label: "Administrativo", description: "Cadastros, validade documental e dados cadastrais." },
  { value: "COLABORADOR", label: "Fornecedores", description: "Acesso ao portal do fornecedor." },
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
      <p className="text-label text-[var(--muted-foreground)]">Definir nova senha</p>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [novoPerfil, setNovoPerfil] = useState(u.perfil);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

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

  function runMenuAction(action: () => void) {
    setMenuOpen(false);
    action();
  }

  const perfilLabel = PERFIL_LABEL[u.perfil] ?? u.perfil;
  const isInternal = ["MEDICAO", "ADMIN", "FINANCEIRO", "ADMINISTRATIVO"].includes(u.perfil);
  const accent = u.ativo ? "border-[#E5E7EB] bg-white" : "border-[#E5E7EB] bg-[#F9FAFB] opacity-75";

  return (
    <div className={`flex min-h-[124px] flex-col overflow-visible rounded-xl border px-4 py-4 shadow-sm transition-colors sm:px-5 ${accent}`}>
      <div className="flex items-start gap-3.5">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          isInternal ? "bg-[#FEF2F2] text-[#AF1B1B] ring-1 ring-[#FECACA]" : "bg-[#EFF6FF] text-[#2563EB]"
        }`}>
          {(u.nome || u.usuario).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-5 text-[#111827]">{u.nome || u.usuario}</p>
              <p className="mt-0.5 truncate font-mono text-xs font-medium uppercase text-[#6B7280]">{u.usuario}</p>
            </div>

            <div className="flex shrink-0 items-start gap-2">
              <div className="flex flex-wrap justify-end gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  u.ativo ? "bg-[#DCFCE7] text-[#15803D] ring-1 ring-[#BBF7D0]" : "bg-[#F3F4F6] text-[#6B7280] ring-1 ring-[#E5E7EB]"
                }`}>
                  {u.ativo ? "Ativo" : "Inativo"}
                </span>
                {u.primeiroLogin && (
                  <span className="rounded-full bg-[#FFFBEB] px-2 py-0.5 text-[10px] font-bold uppercase text-[#D97706] ring-1 ring-[#FDE68A]">
                    1º acesso pendente
                  </span>
                )}
              </div>
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#4B5563] transition hover:border-[#D1D5DB] hover:bg-[#F9FAFB] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/25"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-label={`Ações de ${u.nome || u.usuario}`}
                  aria-expanded={menuOpen}
                >
                  <EllipsisVertical size={16} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-9 z-30 w-52 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-1.5 shadow-xl">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#374151] transition hover:bg-[#F9FAFB] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                      onClick={() => runMenuAction(toggleAtivo)}
                      disabled={loading}
                    >
                      {u.ativo ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                      {u.ativo ? "Desativar usuário" : "Ativar usuário"}
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#374151] transition hover:bg-[#F9FAFB] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                      onClick={() => runMenuAction(resetSenha)}
                      disabled={loading}
                    >
                      <RefreshCw size={14} />
                      Resetar senha
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#374151] transition hover:bg-[#F9FAFB] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                      onClick={() => runMenuAction(() => setShowSetSenha((value) => !value))}
                    >
                      <KeyRound size={14} />
                      Definir senha
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#374151] transition hover:bg-[#F9FAFB] hover:text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                      onClick={() => runMenuAction(() => { setShowSetPerfil((value) => !value); setNovoPerfil(u.perfil); })}
                    >
                      <UserCog size={14} />
                      Alterar função
                    </button>
                    {canDelete && (
                      <div className="mt-1 border-t border-[#F3F4F6] pt-1">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-[#B91C1C] transition hover:bg-[#FEF2F2] focus:outline-none focus:ring-2 focus:ring-[#DC2626]/20"
                          onClick={() => runMenuAction(excluirUsuario)}
                          disabled={loading}
                        >
                          <Trash2 size={14} />
                          Excluir usuário
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="inline-flex rounded-full bg-[#F9FAFB] px-2.5 py-1 text-[10px] font-semibold uppercase text-[#4B5563] ring-1 ring-[#E5E7EB]">
              {perfilLabel}
            </span>
            <span className="text-xs font-medium text-[#6B7280]">Último acesso: <span className="font-semibold text-[#374151]">{fmtDate(u.ultimoLoginAt)}</span></span>
          </div>
        </div>
      </div>

      {u.senhaTemporaria && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] px-2.5 py-1.5">
          <KeyRound size={13} className="shrink-0 text-[#D97706]" />
          <span className="text-xs font-medium text-[#92400E]">Senha temporária:</span>
          <span className={`font-mono text-sm font-bold tracking-widest text-[#92400E] ${showTemp ? "" : "blur-sm select-none"}`}>
            {u.senhaTemporaria}
          </span>
          <button className="ml-1 text-[#D97706] hover:text-[#92400E]" onClick={() => setShowTemp((v) => !v)} title={showTemp ? "Ocultar" : "Revelar"}>
            {showTemp ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      )}

      {u.primeiroLogin && !u.senhaTemporaria && (
        <div className="mt-3 inline-flex max-w-full items-center gap-2 self-start rounded-lg border border-[#FEF3C7] bg-[#FFFBEB] px-2.5 py-1.5 text-xs font-medium text-[#92400E]">
          <Info size={13} className="shrink-0 text-[#D97706]" />
          <span>Senha temporária não registrada. Resete a senha no menu de ações.</span>
        </div>
      )}

      {showSetSenha && (
        <div>
          <SetSenhaForm userId={u.id} onDone={() => { setShowSetSenha(false); onRefresh(); }} />
        </div>
      )}

      {showSetPerfil && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
          <p className="text-label text-[var(--muted-foreground)] shrink-0">Alterar função</p>
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
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10 backdrop-blur-[1px]">
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
          <div className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            ID de acesso
            <div className="flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-sm text-[#6B7280]">
              Gerado automaticamente no padrão P0XXXXXX
            </div>
          </div>
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
    <PageContainer className="grid gap-6">
      <PageHeader
        eyebrow="Administração"
        title="Gestão de usuários"
        description="Gerencie acessos, senhas e status dos fornecedores e usuários da plataforma."
        action={
          <div className="flex flex-wrap gap-2">
            {canCreateUsers && (
              <Button onClick={() => setCreateOpen(true)} aura>
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

      <CriarUsuarioModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-stat-label uppercase tracking-wide text-[var(--muted-foreground)]">Total</p>
          <p className="text-stat-value mt-1 text-[#1A1A1A]">{usuarios.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-stat-label uppercase tracking-wide text-[var(--muted-foreground)]">Ativos</p>
          <p className="text-stat-value mt-1 text-[#16A34A]">{ativos}</p>
        </Card>
        <Card className="p-4">
          <p className="text-stat-label uppercase tracking-wide text-[var(--muted-foreground)]">Aguardando 1º acesso</p>
          <p className="text-stat-value mt-1 text-[#D97706]">{aguardando}</p>
        </Card>
      </div>

      {/* Filtros */}
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

      {/* Lista */}
      {loading ? (
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#AF1B1B]" />
            <span className="text-sm text-[#555555]">Carregando usuários…</span>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-[#555555]">
            <UserCog size={18} />
            <span className="text-sm">Nenhum usuário encontrado.</span>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
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
    </PageContainer>
  );
}
