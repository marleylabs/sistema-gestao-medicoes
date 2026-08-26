"use client";

import { clsx } from "clsx";
import { Card as HeroCard, Chip as HeroChip } from "@heroui/react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useBlur } from "@/components/providers";

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
        "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent px-3.5 text-[12px] font-semibold shadow-none transition-all duration-150 focus-visible:outline-none",
        variant === "primary"   && "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]",
        variant === "secondary" && "border-[var(--border)] bg-white text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-[#f7f7f5]",
        variant === "outline"   && "border-[var(--primary)] bg-white text-[var(--primary)] hover:bg-[var(--primary-soft)]",
        variant === "danger"    && "bg-[var(--error)] text-white hover:bg-[#a91f1f]",
        variant === "success"   && "bg-[var(--success)] text-white hover:bg-[#116b32]",
        variant === "ghost"     && "bg-transparent text-[var(--muted-foreground)] hover:bg-[#efefec] hover:text-[var(--foreground)]",
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
        "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--muted-foreground)]",
        "shadow-none transition-all duration-150 hover:border-[var(--border-strong)] hover:bg-[#f7f7f5] hover:text-[var(--foreground)] focus-visible:outline-none",
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
        "h-9 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[13px] text-[var(--foreground)] outline-none",
        "placeholder:text-[#999] transition-all duration-150 hover:border-[var(--border-strong)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
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
        "h-9 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-[13px] text-[var(--foreground)] outline-none transition-all duration-150 hover:border-[var(--border-strong)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_14%,transparent)]",
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
        "min-h-24 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[13px] text-[var(--foreground)] outline-none",
        "placeholder:text-[#9CA3AF] transition-all duration-150",
        "hover:border-[#D1D5DB]",
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
  brand:   "bg-[var(--primary-soft)] text-[var(--primary)] border border-[#f0caca]",
  primary: "bg-[var(--primary-soft)] text-[var(--primary)] border border-[#f0caca]",
  success: "bg-[var(--success-soft)] text-[var(--success)] border border-[#cde9d5]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border border-[#f2dbb7]",
  danger:  "bg-[var(--error-soft)] text-[var(--error)] border border-[#efc6c6]",
  neutral: "bg-[var(--info-soft)] text-[var(--info)] border border-[#dfe2e5]",
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
        <h1 className="text-page-title text-[var(--foreground)]">{title}</h1>
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
