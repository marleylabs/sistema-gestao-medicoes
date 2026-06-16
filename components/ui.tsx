import { clsx } from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-transparent px-3 text-sm font-semibold transition",
        "bg-[#AF1B1B] text-white hover:bg-[#8C1616] focus:outline-none focus:ring-2 focus:ring-[#AF1B1B]/40",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d8dee8] bg-white text-[#1A1A1A] transition hover:bg-[#f2f4f7]",
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm outline-none",
        "focus:border-[#AF1B1B] focus:ring-2 focus:ring-[#AF1B1B]/20",
        props.className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "h-9 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm outline-none",
        "focus:border-[#AF1B1B] focus:ring-2 focus:ring-[#AF1B1B]/20",
        props.className,
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "min-h-20 w-full rounded-md border border-[#cfd7e3] bg-white px-3 py-2 text-sm outline-none",
        "focus:border-[#AF1B1B] focus:ring-2 focus:ring-[#AF1B1B]/20",
        props.className,
      )}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#1A1A1A]">
      <span>{label}</span>
      {children}
    </label>
  );
}
