"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export function AlterarSenhaModal({ onSuccess }: { onSuccess: () => void }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (novaSenha.length < MIN_PASSWORD_LENGTH) { setError(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`); return; }
    if (novaSenha !== confirmar) { setError("As senhas não coincidem."); return; }
    setLoading(true);
    const res = await fetch("/api/auth/alterar-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novaSenha }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Erro ao alterar senha."); return; }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#D97706]">
            <KeyRound size={20} />
          </span>
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A]">Criar sua senha</h2>
            <p className="text-xs text-[#555555]">Este é seu primeiro acesso. Defina uma senha pessoal.</p>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Nova senha
            <Input
              type="password"
              placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
            Confirmar senha
            <Input
              type="password"
              placeholder="Repita a senha"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
            />
          </label>
          {error && <p className="rounded-md bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}
          <Button type="submit" className="mt-1 w-full" disabled={loading}>
            {loading ? "Salvando…" : "Definir senha e entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
