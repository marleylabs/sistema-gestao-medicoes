"use client";

import { clsx } from "clsx";
import { Button as HeroButton, Card as HeroCard, Chip as HeroChip } from "@heroui/react";
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

type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";

export function Button({
  className,
  variant = "primary",
  children,
  disabled,
  type = "button",
  onClick,
  title,
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <HeroButton
      className={clsx(
        "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent px-4 text-sm font-semibold shadow-none transition-all duration-150 focus:outline-none",
        variant === "primary"   && "bg-[#2563EB] text-white hover:bg-[#1D4ED8] shadow-sm",
        variant === "secondary" && "border-[#E5E7EB] bg-white text-[#1A1A1A] hover:bg-[#F5F5F5] shadow-sm",
        variant === "danger"    && "bg-[#DC2626] text-white hover:bg-[#B91C1C] shadow-sm",
        variant === "success"   && "bg-[#16A34A] text-white hover:bg-[#15803D] shadow-sm",
        variant === "ghost"     && "bg-transparent text-[#555555] hover:bg-[#F5F5F5] hover:text-[#1A1A1A]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      isDisabled={disabled}
      onPress={onClick ? () => (onClick as Function)() : undefined}
      type={type as "button" | "submit" | "reset"}
      {...({ title } as any)}
    >
      {children}
    </HeroButton>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

export function IconButton({ className, children, disabled, type = "button", onClick, title }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <HeroButton
      isIconOnly
      className={clsx(
        "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#555555]",
        "shadow-none transition-all duration-150 hover:border-[#D1D5DB] hover:bg-[#F5F5F5] hover:text-[#1A1A1A]",
        "focus:outline-none",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      isDisabled={disabled}
      onPress={onClick ? () => (onClick as Function)() : undefined}
      type={type as "button" | "submit" | "reset"}
      {...({ title } as any)}
    >
      {children}
    </HeroButton>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none",
        "placeholder:text-[#9CA3AF] transition-all duration-150",
        "hover:border-[#D1D5DB]",
        "focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20",
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
        "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none",
        "transition-all duration-150",
        "hover:border-[#D1D5DB]",
        "focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20",
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
        "min-h-24 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#1A1A1A] outline-none",
        "placeholder:text-[#9CA3AF] transition-all duration-150",
        "hover:border-[#D1D5DB]",
        "focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20",
        props.className,
      )}
    />
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-[#1A1A1A]">
      <span>{label}</span>
      {children}
    </label>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = "brand" | "primary" | "success" | "warning" | "danger" | "neutral";

const CHIP_STYLES: Record<BadgeVariant, string> = {
  brand:   "bg-[#AF1B1B] text-white border border-[#8C1616]",
  primary: "bg-[#2563EB] text-white border border-[#1D4ED8]",
  success: "bg-[#16A34A] text-white border border-[#15803D]",
  warning: "bg-[#D97706] text-white border border-[#B45309]",
  danger:  "bg-[#DC2626] text-white border border-[#B91C1C]",
  neutral: "bg-[#6B7280] text-white border border-[#4B5563]",
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
        "h-auto rounded-md px-2 py-0.5 text-xs font-semibold shadow-none",
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
      className={clsx("rounded-xl border border-[#E5E7EB] bg-white shadow-sm", className)}
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
        <h2 className="text-lg font-bold text-[#1A1A1A]">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-[#555555]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
