"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui";

/**
 * Painel lateral único da área Administrativo (detalhe, edição, cadastro, importação) — mesmo
 * padrão do drawer de /fornecedores e do editor de pagamento: à direita no desktop, tela cheia no
 * mobile. `size="detail"` para leitura; `size="wide"` para formulários (≈720–900px no desktop).
 * Modais de confirmação continuam por cima (z-[70]); enquanto um deles está aberto, o Esc do
 * painel é desligado (`escEnabled`) para não fechar o painel por baixo da confirmação.
 */
export function AdminSidePanel({
  eyebrow,
  title,
  subtitle,
  meta,
  size = "detail",
  onClose,
  onEscape,
  escEnabled = true,
  closeDisabled = false,
  footer,
  testId,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  size?: "detail" | "wide";
  onClose: () => void;
  /** Esc — padrão fecha; no modo edição volta ao detalhe. */
  onEscape?: () => void;
  escEnabled?: boolean;
  closeDisabled?: boolean;
  footer?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!escEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) (onEscape ?? onClose)();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [escEnabled, closeDisabled, onEscape, onClose]);

  const width = size === "wide" ? "sm:w-[88vw] lg:w-[clamp(720px,62vw,900px)]" : "sm:w-[520px]";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId}>
      {/* Backdrop só para clique do mouse; fechamento acessível = botão Fechar e Esc. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/30" onClick={() => { if (!closeDisabled) onClose(); }} />
      <aside ref={panelRef} tabIndex={-1} className={`relative flex h-full w-full max-w-full flex-col bg-[var(--surface)] shadow-2xl outline-none ${width}`}>
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <div className="min-w-0">
            {eyebrow && <p className="text-eyebrow mb-1 text-[var(--primary)]">{eyebrow}</p>}
            <h2 id={titleId} className="text-section-title break-words text-[var(--foreground)]">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-[var(--muted-foreground)]">{subtitle}</div>}
            {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
          <IconButton onClick={onClose} title="Fechar" disabled={closeDisabled}><X size={16} /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4 sm:px-6">{footer}</footer>}
      </aside>
    </div>
  );
}

/** Seção do painel — título curto em caixa alta (hierarquia do Customer Informations do Figma). */
export function PanelSection({ title, action, children, tone }: { title: string; action?: ReactNode; children: ReactNode; tone?: "danger" }) {
  return (
    <section className="grid gap-3 border-t border-[var(--border)] px-5 py-4 first:border-t-0 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className={`text-label ${tone === "danger" ? "text-[var(--error)]" : "text-[var(--muted-foreground)]"}`}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Par rótulo/valor somente leitura; `technical` usa Geist Mono (códigos, CNPJ, logins). */
export function DataItem({ label, children, technical, wide }: { label: string; children: ReactNode; technical?: boolean; wide?: boolean }) {
  return (
    <div className={`grid min-w-0 gap-0.5 ${wide ? "col-span-full" : ""}`}>
      <dt className="text-[11px] text-[var(--muted-foreground)]">{label}</dt>
      <dd className={`min-w-0 break-words text-sm text-[var(--foreground)] ${technical ? "font-technical text-[12.5px]" : ""}`}>{children}</dd>
    </div>
  );
}

/** Linha de configuração com ação discreta à direita (padrão "Privacy & Security" do Figma). */
export function SettingRow({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[11px] text-[var(--muted-foreground)]">{label}</p>
        <div className="mt-0.5 min-w-0 break-words text-sm text-[var(--foreground)]">{value}</div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</div>}
    </div>
  );
}
