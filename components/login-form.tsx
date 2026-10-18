"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { motion, useAnimationControls, useInView, useReducedMotion } from "framer-motion";
import { Eye, EyeOff, LockKeyhole, LogIn, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ui";
import { AlterarSenhaModal } from "@/components/alterar-senha-modal";
import { AnimatedText } from "@/components/motion";
import { useTema } from "@/components/providers";
import type { PreferenciaTema } from "@/lib/tema";

const PROXIMO_TEMA: { atual: PreferenciaTema; rotulo: string; proximo: PreferenciaTema; Icone: typeof Sun }[] = [
  { atual: "claro", rotulo: "Claro", proximo: "escuro", Icone: Sun },
  { atual: "escuro", rotulo: "Escuro", proximo: null, Icone: Moon },
  { atual: null, rotulo: "Sistema", proximo: "claro", Icone: Monitor },
];

function BotaoTema() {
  const { preferencia, setPreferencia } = useTema();
  const { rotulo, proximo, Icone } = PROXIMO_TEMA.find((opcao) => opcao.atual === preferencia) ?? PROXIMO_TEMA[2];
  const rotuloProximo = PROXIMO_TEMA.find((opcao) => opcao.atual === proximo)?.rotulo;
  const descricao = `Tema: ${rotulo}. Mudar para ${rotuloProximo}`;
  return (
    <IconButton className="absolute right-4 top-4 z-10 h-10 w-10" aria-label={descricao} title={descricao} onClick={() => setPreferencia(proximo)}>
      <Icone size={16} aria-hidden />
    </IconButton>
  );
}

/**
 * Brilho na cor primária que deriva devagar atrás do texto do painel. Decorativo; parado com motion reduzido
 * e enquanto não está visível (abaixo de lg o painel fica display:none e o loop não precisa rodar).
 */
function BrilhoDoPainel() {
  const reduzir = useReducedMotion();
  const controles = useAnimationControls();
  const ref = useRef<HTMLDivElement>(null);
  const visivel = useInView(ref);
  useEffect(() => {
    if (reduzir || !visivel) {
      controles.stop();
      return;
    }
    controles.start({ x: [0, 90, -50, 0], y: [0, -70, 40, 0], transition: { duration: 20, ease: "easeInOut", repeat: Infinity } });
  }, [reduzir, visivel, controles]);
  return (
    <motion.div
      ref={ref}
      aria-hidden
      initial={false}
      animate={controles}
      className="pointer-events-none absolute -right-24 top-1/4 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--primary)_32%,transparent),transparent_65%)] blur-2xl"
    />
  );
}

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

      <main className="relative grid min-h-screen bg-[var(--background)] lg:grid-cols-[minmax(420px,0.82fr)_1.18fr]">
        <BotaoTema />
        <section className="flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-md transition-[opacity,translate] duration-500 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none">
            <div className="mb-8 flex items-center gap-3">
              <span className="inline-flex h-11 w-11 overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="En Passant" className="h-full w-full object-cover" />
              </span>
              <div>
                <div className="text-lg font-bold text-[var(--foreground)]">En Passant</div>
                <div className="text-xs italic text-[var(--muted-foreground)]">Movimento lateral em busca de novos objetivos</div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_12px_36px_rgba(0,0,0,0.06)]">
              <div className="mb-6">
                <p className="text-eyebrow mb-1 text-[var(--primary)]">Acesso corporativo</p>
                <h1 className="text-page-title text-[var(--foreground)]">Acessar plataforma</h1>
                <p className="text-page-description mt-1 text-[var(--muted-foreground)]">Use o ID de acesso no padrão P0XXXXXX.</p>
              </div>

              <form className="grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                  <span>ID de acesso</span>
                  <span className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--foreground)]" size={17} />
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

                <label className="grid gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                  <span>Senha</span>
                  <span className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--foreground)]" size={17} />
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
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[var(--foreground)]"
                      onClick={() => setShowPassword((value) => !value)}
                      title={showPassword ? "Ocultar senha" : "Exibir senha"}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>

                {message ? <div role="alert" className="rounded-md border border-[var(--error)]/30 bg-[var(--error-soft)] px-3 py-2 text-sm font-medium text-[var(--error)]">{message}</div> : null}

                <Button type="submit" className="mt-1 w-full" disabled={loading} aura>
                  <LogIn size={17} />
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              </form>
            </div>
          </div>
        </section>

        <section className="relative hidden overflow-hidden bg-[var(--sidebar)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,white_5%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,white_5%,transparent)_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]"
          />
          <BrilhoDoPainel />
          <div className="relative text-[12px] font-semibold text-white/65">Controle integrado</div>
          <div className="relative max-w-xl">
            <AnimatedText as="h2" texto="Decisões financeiras com dados protegidos e rastreáveis." className="max-w-xl text-[32px] font-bold leading-[1.18] tracking-[-0.03em]" />
            <p className="mt-4 max-w-lg text-[13px] leading-6 text-white/60 transition-opacity delay-500 duration-700 starting:opacity-0 motion-reduce:transition-none">
              Indicadores de medição, ciclos, contratos e pagamentos em um único ambiente operacional.
            </p>
          </div>
          <div className="relative text-[11px] text-white/40">Acesso restrito a usuários autorizados.</div>
        </section>
      </main>
    </>
  );
}
