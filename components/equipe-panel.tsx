"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Badge, Button, Card, SectionHeader } from "@/components/ui";

type MembroEquipe = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  ultimo_login_at: string | null;
};

const PERFIL_LABEL: Record<string, string> = {
  ADMIN:   "Administrador",
  MEDICAO: "Medição",
};

const PERFIL_COLOR: Record<string, string> = {
  ADMIN:   "bg-[#AF1B1B]/10 text-[#AF1B1B]",
  MEDICAO: "bg-[#EFF6FF] text-[#2563EB]",
};

function fmtDate(iso: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function EquipePanel() {
  const [equipe, setEquipe]   = useState<MembroEquipe[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/usuarios");
    if (res.ok) {
      const todos: MembroEquipe[] = await res.json();
      setEquipe(todos.filter((u) => u.perfil === "MEDICAO" || u.perfil === "ADMIN"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ativos   = equipe.filter((u) => u.ativo).length;
  const admins   = equipe.filter((u) => u.perfil === "ADMIN").length;
  const medicao  = equipe.filter((u) => u.perfil === "MEDICAO").length;

  return (
    <div className="grid gap-6 mx-auto w-full" style={{ maxWidth: "80rem" }}>
      <SectionHeader
        title="Equipe de Medição"
        description="Membros internos com acesso ao sistema de medição."
        action={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Atualizar
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Total</p>
          <p className="mt-1 text-2xl font-bold text-[#1A1A1A]">{equipe.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Administradores</p>
          <p className="mt-1 text-2xl font-bold text-[#AF1B1B]">{admins}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#555555]">Medição</p>
          <p className="mt-1 text-2xl font-bold text-[#2563EB]">{medicao}</p>
        </Card>
      </div>

      {loading ? (
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#AF1B1B]" />
            <span className="text-sm text-[#555555]">Carregando equipe…</span>
          </div>
        </Card>
      ) : equipe.length === 0 ? (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-[#555555]">
            <Users size={18} />
            <span className="text-sm">Nenhum membro encontrado.</span>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {equipe.map((u) => (
            <div key={u.id} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
              u.ativo
                ? u.perfil === "ADMIN"
                  ? "border-[#AF1B1B]/25 bg-[#FFF5F5]"
                  : "border-[#DBEAFE] bg-[#EFF6FF]/40"
                : "border-[#F3F4F6] bg-[#FAFAFA] opacity-50"
            }`}>
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                u.perfil === "ADMIN" ? "bg-[#AF1B1B]/10 text-[#AF1B1B]" : "bg-[#DBEAFE] text-[#2563EB]"
              }`}>
                <ShieldCheck size={15} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-sm font-semibold ${u.perfil === "ADMIN" ? "text-[#AF1B1B]" : "text-[#1D4ED8]"}`}>
                    {u.nome || u.usuario}
                  </span>
                  <Badge variant={u.ativo ? "brand" : "neutral"}>{u.ativo ? "Ativo" : "Inativo"}</Badge>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PERFIL_COLOR[u.perfil] ?? "bg-[#F3F4F6] text-[#555555]"}`}>
                    {PERFIL_LABEL[u.perfil] ?? u.perfil}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
                  <span className="font-mono">{u.usuario}</span>
                  {" · último acesso: "}{fmtDate(u.ultimo_login_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
