"use client";

import { FormEvent, useState } from "react";
import { Eye, EyeOff, LockKeyhole, LogIn, UserRound } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { AlterarSenhaModal } from "@/components/alterar-senha-modal";

export function LoginForm() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, senha }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.message ?? "Não foi possível entrar.");
      setLoading(false);
      return;
    }
    if (data.requirePasswordChange) {
      setRequirePasswordChange(true);
      setLoading(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <>
      {requirePasswordChange && (
        <AlterarSenhaModal onSuccess={() => window.location.assign("/")} />
      )}

      <main className="grid min-h-screen bg-[var(--background)] lg:grid-cols-[minmax(420px,0.82fr)_1.18fr]">
        <section className="flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-3">
              <span className="inline-flex h-11 w-11 overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="En Passant" className="h-full w-full object-cover" />
              </span>
              <div>
                <div className="text-lg font-bold text-[#1A1A1A]">En Passant</div>
                <div className="text-xs italic text-[#9CA3AF]">Movimento lateral em busca de novos objetivos</div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-[0_12px_36px_rgba(0,0,0,0.06)]">
              <div className="mb-6">
                <p className="text-eyebrow mb-1 text-[var(--primary)]">Acesso corporativo</p>
                <h1 className="text-page-title text-[var(--foreground)]">Acessar plataforma</h1>
                <p className="text-page-description mt-1 text-[var(--muted-foreground)]">Use o ID de acesso no padrão P0XXXXXX.</p>
              </div>

              <form className="grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
                  <span>ID de acesso</span>
                  <span className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]" size={17} />
                    <Input
                      className="pl-10"
                      autoComplete="username"
                      placeholder="P0504889"
                      value={usuario}
                      onChange={(event) => setUsuario(event.target.value)}
                      required
                    />
                  </span>
                </label>

                <label className="grid gap-1.5 text-sm font-semibold text-[#1A1A1A]">
                  <span>Senha</span>
                  <span className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#1A1A1A]" size={17} />
                    <Input
                      className="px-10"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={senha}
                      onChange={(event) => setSenha(event.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#1A1A1A]"
                      onClick={() => setShowPassword((value) => !value)}
                      title={showPassword ? "Ocultar senha" : "Exibir senha"}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>

                {message ? <div className="rounded-md bg-[#F5F5F5] px-3 py-2 text-sm font-medium text-[#AF1B1B]">{message}</div> : null}

                <Button type="submit" className="mt-1 w-full" disabled={loading} aura>
                  <LogIn size={17} />
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              </form>
            </div>
          </div>
        </section>

        <section className="hidden bg-[var(--sidebar)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="text-[12px] font-semibold text-white/65">Controle integrado</div>
          <div className="max-w-xl">
            <h2 className="max-w-xl text-[32px] font-bold leading-[1.18] tracking-[-0.03em]">Decisões financeiras com dados protegidos e rastreáveis.</h2>
            <p className="mt-4 max-w-lg text-[13px] leading-6 text-white/60">
              Indicadores de medição, ciclos, contratos e pagamentos em um único ambiente operacional.
            </p>
          </div>
          <div className="text-[11px] text-white/40">Acesso restrito a usuários autorizados.</div>
        </section>
      </main>
    </>
  );
}
