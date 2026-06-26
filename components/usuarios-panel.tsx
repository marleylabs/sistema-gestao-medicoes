"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, ShieldOff, UserCog } from "lucide-react";
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
    if (novaSenha.length < 8) { setError("Mínimo 8 caracteres."); return; }
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
      <Input type="password" placeholder="Nova senha (mín. 8)" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
      <Input type="password" placeholder="Confirmar senha" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
      {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar senha"}</Button>
        <Button variant="secondary" className="flex-1" onClick={onDone}>Cancelar</Button>
      </div>
    </div>
  );
}

function UsuarioRow({ u, onRefresh }: { u: Usuario; onRefresh: () => void }) {
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

  const perfilLabel = PERFIL_LABEL[u.perfil] ?? u.perfil;

  const isMedicao = u.perfil === "MEDICAO" || u.perfil === "ADMIN";
  const isAdmin   = u.perfil === "ADMIN";

  return (
    <div className={`rounded-lg border transition-colors ${
      isMedicao
        ? u.ativo ? "border-[#AF1B1B]/25 bg-[#FFF5F5]" : "border-[#F3F4F6] bg-[#FAFAFA] opacity-50"
        : u.ativo ? "border-[#E5E7EB] bg-white"          : "border-[#F3F4F6] bg-[#FAFAFA] opacity-50"
    }`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        {/* Barra lateral colorida */}
        {isMedicao && <span className="inline-flex h-5 w-1 shrink-0 rounded-full bg-[#AF1B1B]" />}

        {/* Identidade */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-sm font-semibold ${isMedicao ? "text-[#AF1B1B]" : "text-[#1A1A1A]"}`}>{u.nome || u.usuario}</span>
            <Badge variant={u.ativo ? "brand" : "neutral"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isMedicao ? "bg-[#AF1B1B]/10 text-[#AF1B1B]" : "bg-[#F3F4F6] text-[#555555]"}`}>{perfilLabel}</span>
            {u.primeiroLogin && <span className="rounded bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#D97706]">1º acesso pendente</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
            <span className="font-mono">{u.usuario}</span> · {fmtDate(u.ultimoLoginAt)}
          </p>
        </div>

        {/* Ações */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={toggleAtivo} disabled={loading} title={u.ativo ? "Desativar" : "Ativar"}
            className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] transition-colors hover:border-[#AF1B1B] hover:text-[#AF1B1B] disabled:opacity-40">
            {u.ativo ? <ShieldOff size={13} className="mr-1 inline" /> : <ShieldCheck size={13} className="mr-1 inline" />}
            {u.ativo ? "Desativar" : "Ativar"}
          </button>
          <button onClick={resetSenha} disabled={loading} title="Resetar senha"
            className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] transition-colors hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-40">
            <RefreshCw size={13} className="mr-1 inline" />Resetar
          </button>
          <button onClick={() => setShowSetSenha((v) => !v)} title="Definir senha"
            className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] transition-colors hover:border-[#16A34A] hover:text-[#16A34A]">
            <KeyRound size={13} className="mr-1 inline" />Senha
          </button>
          <button onClick={() => { setShowSetPerfil((v) => !v); setNovoPerfil(u.perfil); }} title="Alterar função"
            className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#555555] transition-colors hover:border-[#7C3AED] hover:text-[#7C3AED]">
            <UserCog size={13} className="mr-1 inline" />Função
          </button>
        </div>
      </div>

      {u.senhaTemporaria && (
        <div className="mx-4 mb-2.5 flex items-center gap-2 rounded-lg bg-[#FFFBEB] px-3 py-2">
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
        <div className="mx-4 mb-2.5">
          <SetSenhaForm userId={u.id} onDone={() => { setShowSetSenha(false); onRefresh(); }} />
        </div>
      )}

      {showSetPerfil && (
        <div className="mx-4 mb-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
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

export function UsuariosPanel() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "ativos" | "inativos">("todos");
  const [busca, setBusca] = useState("");

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

  return (
    <div className="grid gap-6">
      <div className="mx-auto w-full" style={{ maxWidth: "80rem" }}>
        <SectionHeader
          title="Gestão de usuários"
          description="Gerencie acessos, senhas e status dos colaboradores e usuários da plataforma."
          action={
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Atualizar
            </Button>
          }
        />
      </div>

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
        <div className="grid gap-3 mx-auto w-full" style={{ maxWidth: "80rem" }}>
          {filtered.map((u) => (
            <UsuarioRow key={u.id} u={u} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}
