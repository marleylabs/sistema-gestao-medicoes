"use client";

import { clsx } from "clsx";
import { Card as HeroCard, Chip as HeroChip } from "@heroui/react";
import { Filter, X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useEffect, useRef } from "react";
import { useBlur } from "@/components/providers";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { AnimatedText, EASE_SAIDA, useMontadoAposHidratacao } from "@/components/motion";

// ─── BlurValue ────────────────────────────────────────────────────────────────

export function BlurValue({ children, className }: { children: React.ReactNode; className?: string }) {
  const { blur } = useBlur();
  return (
    <span
      className={clsx(
        "transition-all duration-200 select-none",
        blur && "blur-sm pointer-events-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "success" | "ghost";

export function Button({
  className,
  variant = "primary",
  children,
  disabled,
  type = "button",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; aura?: boolean }) {
  const aura = props.aura;
  const nativeProps = { ...props };
  delete (nativeProps as { aura?: boolean }).aura;
  return (
    <button
      {...nativeProps}
      className={clsx(
        "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent px-3.5 text-[12px] font-semibold shadow-none transition-all duration-150 focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100",
        variant === "primary"   && "bg-[var(--primary)] text-[var(--on-solid)] hover:bg-[var(--primary-hover)]",
        variant === "secondary" && "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]",
        variant === "outline"   && "border-[var(--primary)] bg-[var(--surface)] text-[var(--primary)] hover:bg-[var(--primary-soft)]",
        variant === "danger"    && "bg-[var(--error)] text-[var(--on-solid)] hover:bg-[var(--error)]/90",
        variant === "success"   && "bg-[var(--success)] text-[var(--on-solid)] hover:bg-[var(--success)]/90",
        variant === "ghost"     && "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
        aura && variant === "primary" && "shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_12%,transparent),0_3px_10px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

export function IconButton({ className, children, disabled, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]",
        "shadow-none transition-all duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--foreground)] outline-none",
        "placeholder:text-[var(--muted-foreground)]/70 transition-all duration-150 hover:border-[var(--border-strong)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
        props.className,
      )}
    />
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--foreground)] outline-none transition-all duration-150 hover:border-[var(--border-strong)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
        props.className,
      )}
    />
  );
}

// ─── Textarea ─────────────────────────────────────────────────────────────────

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "min-h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--foreground)] outline-none",
        "placeholder:text-[var(--muted-foreground)]/70 transition-all duration-150",
        "hover:border-[var(--border-strong)]",
        "focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
        props.className,
      )}
    />
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-label grid gap-1.5 text-[var(--foreground)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = "brand" | "primary" | "success" | "warning" | "danger" | "neutral";

const CHIP_STYLES: Record<BadgeVariant, string> = {
  brand:   "bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--error)]/30",
  primary: "bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--error)]/30",
  success: "bg-[var(--success-soft)] text-[var(--success)] border border-[var(--success)]/30",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning)]/35",
  danger:  "bg-[var(--error-soft)] text-[var(--error)] border border-[var(--error)]/30",
  neutral: "bg-[var(--info-soft)] text-[var(--info)] border border-[var(--border)]",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <HeroChip
      className={clsx(
        "text-badge h-5 rounded-md px-2 py-0 uppercase tracking-[0.02em] shadow-none",
        CHIP_STYLES[variant],
        className,
      )}
    >
      {children}
    </HeroChip>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <HeroCard
      className={clsx("rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_2px_rgba(0,0,0,0.025)]", className)}
    >
      {children}
    </HeroCard>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-section-title text-[var(--foreground)]">{title}</h2>
        {description && <p className="text-page-description mt-0.5 text-[var(--muted-foreground)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow mb-1 text-[var(--primary)]">{eyebrow}</p>}
        <AnimatedText as="h1" texto={title} className="text-page-title text-[var(--foreground)]" />
        {description && <p className="text-page-description mt-1 max-w-3xl text-[var(--muted-foreground)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

// ─── PageContainer ────────────────────────────────────────────────────────────

export function PageContainer({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("mx-auto w-full max-w-[1520px] py-6", className)}>{children}</div>;
}

// ─── FilterButton / FilterChip ─────────────────────────────────────────────────
// Padrão de "Filtros" com dropdown compacto — introduzido no Painel Administrativo e reaproveitado
// aqui (Dashboard) para manter a mesma linguagem visual em toda a aplicação. Só o gatilho e o chip
// são compartilhados; o conteúdo do dropdown de cada tela continua específico (não vale a pena
// generalizar isso — os filtros de cada tela são conceitualmente diferentes).

export function FilterButton({
  count = 0,
  onClick,
  className,
}: {
  count?: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex h-9 items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 text-xs font-semibold transition",
        count > 0 ? "border-[var(--primary)] text-[var(--primary)]" : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)]",
        className,
      )}
    >
      <Filter size={14} />
      Filtros
      {count > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold text-[var(--on-solid)]">
          {count}
        </span>
      )}
    </button>
  );
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 text-[11px] font-semibold text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)]"
    >
      {label}
      <X size={10} />
    </button>
  );
}

// ─── Linha de tabela ──────────────────────────────────────────────────────────

/** Classes da linha clicável que abre um painel; a do item aberto fica realçada com a barra primária (marque também `data-aberta`). */
export function classeLinha(aberta: boolean) {
  return clsx(
    "cursor-pointer border-b border-[var(--border)] transition-[background-color,box-shadow] last:border-0 focus-visible:outline-none",
    aberta
      ? "bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)] focus-visible:shadow-[inset_3px_0_0_var(--primary),inset_0_0_0_2px_var(--primary)]"
      : "hover:bg-[var(--surface-muted)] focus-visible:bg-[var(--surface-muted)]",
  );
}

// ─── Aba ──────────────────────────────────────────────────────────────────────

/** Aba de uma lista `role="tablist"`. O sublinhado desliza entre as abas: `grupo` é o `layoutId`, único por lista. */
export function Aba({
  ativa,
  grupo,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { ativa: boolean; grupo: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      className={clsx(
        "relative border-b-2 border-transparent pb-2.5 pt-1 text-sm transition-colors xl:-mb-3",
        ativa ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
      {ativa && (
        <motion.span
          layoutId={grupo}
          aria-hidden
          className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-[var(--primary)]"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

/** Bloco cinza pulsante no lugar do conteúdo que ainda está carregando. Tamanho e forma vêm do `className`. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("block animate-pulse rounded-lg bg-[var(--surface-hover)] motion-reduce:animate-none", className)} />;
}

/** Carregamento acessível: linhas de skeleton com o texto lido pelo leitor de tela (`sr-only`). */
export function Carregando({
  texto,
  linhas = 3,
  altura = "h-11",
  anunciar = true,
  className,
}: {
  texto: string;
  linhas?: number;
  altura?: string;
  /** false nos carregamentos secundários de um mesmo painel: só o primeiro é anunciado pelo leitor de tela. */
  anunciar?: boolean;
  className?: string;
}) {
  return (
    <div role={anunciar ? "status" : undefined} className={clsx("grid gap-2", className)}>
      <span className="sr-only">{texto}</span>
      {Array.from({ length: linhas }, (_, i) => <Skeleton key={i} className={altura} />)}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

/**
 * Aviso flutuante no canto: entra deslizando e sai com fade. `mensagem` null esconde; o tempo de exibição fica com quem chama.
 * A região viva fica sempre montada: leitores de tela costumam ignorar uma região que nasce junto com o texto.
 */
export function Toast({
  mensagem,
  tom = "success",
  camada = "z-[80]",
}: {
  mensagem: string | null;
  tom?: "success" | "error";
  camada?: string;
}) {
  return (
    <div role="status" aria-live="polite">
      <AnimatePresence>
        {mensagem && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_SAIDA } }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            className={clsx(
              "fixed bottom-5 right-5 rounded-lg px-4 py-3 text-sm font-semibold text-[var(--on-solid)] shadow-lg",
              tom === "success" ? "bg-[var(--success)]" : "bg-[var(--error)]",
              camada,
            )}
          >
            {mensagem}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const SELETOR_FOCAVEL = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Modais abertos, do mais antigo ao mais novo: só o do topo prende o foco. */
const modaisAbertos: HTMLElement[] = [];

/** Foco do diálogo: entra ao abrir (se nada lá dentro já tem foco), o Tab circula só nele e volta ao elemento anterior ao fechar. */
function usePrenderFoco(caixaRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focaveis = () => [...caixa.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)].filter((el) => el.getClientRects().length > 0);
    modaisAbertos.push(caixa);
    if (!caixa.contains(document.activeElement)) (focaveis()[0] ?? caixa).focus({ preventScroll: true });
    function prender(event: KeyboardEvent) {
      if (event.key !== "Tab" || modaisAbertos[modaisAbertos.length - 1] !== caixa) return;
      const lista = focaveis();
      const dentro = caixa!.contains(document.activeElement);
      if (!lista.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (!dentro || document.activeElement === lista[0])) {
        event.preventDefault();
        lista[lista.length - 1].focus();
      } else if (!event.shiftKey && (!dentro || document.activeElement === lista[lista.length - 1])) {
        event.preventDefault();
        lista[0].focus();
      }
    }
    document.addEventListener("keydown", prender);
    return () => {
      document.removeEventListener("keydown", prender);
      modaisAbertos.splice(modaisAbertos.indexOf(caixa), 1);
      if (anterior?.isConnected) anterior.focus({ preventScroll: true });
    };
  }, [caixaRef]);
}

/**
 * Invólucro único dos modais (overlay + contêiner `ds-dialog`). Entra com escala e fade e sai mais rápido;
 * a saída exige AnimatePresence no ponto que abre. Durante a saída fica inerte (sem clique, teclado nem leitor de tela).
 * `sobreposicao`: camada e alinhamento do overlay (classes estáticas, ex.: "z-[90] items-end sm:items-center").
 * `variante="tela"`: documento grande (ex.: Boletim de Medição) — sem a caixa `ds-dialog`, overlay rolável e
 * tela cheia no celular; o contêiner vem todo do `className`.
 */
export function Modal({
  role = "dialog",
  rotuloId,
  descricaoId,
  rotulo,
  ocupado,
  testId,
  sobreposicao = "z-[70] items-center",
  variante = "caixa",
  className,
  children,
}: {
  role?: "dialog" | "alertdialog";
  rotuloId?: string;
  descricaoId?: string;
  rotulo?: string;
  ocupado?: boolean;
  testId?: string;
  sobreposicao?: string;
  variante?: "caixa" | "tela";
  className?: string;
  children: React.ReactNode;
}) {
  const presente = useIsPresent();
  const reduzir = useReducedMotion();
  const animar = useMontadoAposHidratacao() && !reduzir;
  const caixaRef = useRef<HTMLDivElement>(null);
  usePrenderFoco(caixaRef);
  const duracao = (s: number) => (reduzir ? 0 : s);
  return (
    // O motion.div não repassa `inert` ao DOM: o invólucro "contents" (sem caixa própria) leva o atributo.
    <div className="contents" inert={!presente}>
      <motion.div
        className={clsx(
          "fixed inset-0 flex justify-center bg-black/40 backdrop-blur-[1px]",
          variante === "tela" ? "items-start overflow-y-auto p-0 sm:p-4 sm:pt-10" : "p-2 sm:p-4",
          sobreposicao,
        )}
        initial={animar ? { opacity: 0 } : false}
        animate={{ opacity: 1, transition: { duration: duracao(0.2) } }}
        exit={{ opacity: 0, transition: { duration: duracao(0.14) } }}
      >
        <motion.div
          role={role}
          aria-modal="true"
          aria-labelledby={rotuloId}
          aria-describedby={descricaoId}
          aria-label={rotulo}
          aria-busy={ocupado}
          data-testid={testId}
          ref={caixaRef}
          tabIndex={-1}
          className={clsx(variante === "caixa" && "ds-dialog", "outline-none", className)}
          initial={animar ? { opacity: 0, scale: 0.97 } : false}
          animate={{ opacity: 1, scale: 1, transition: { duration: duracao(0.2), ease: EASE_SAIDA } }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: duracao(0.14), ease: "easeIn" } }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}
