"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { clsx } from "clsx";

type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  hidden?: boolean;
  bottom?: boolean;
};

type AppShellProps = {
  activeSection: string;
  onNavigate: (id: string) => void;
  navItems: NavItem[];
  pageTitle: string;
  sidebarFooter?: React.ReactNode;
  children: React.ReactNode;
};

function NavButton({ item, active, onNavigate, onClose }: {
  item: NavItem; active: boolean;
  onNavigate: (id: string) => void; onClose?: () => void;
}) {
  return (
    <button
      onClick={() => { onNavigate(item.id); onClose?.(); }}
      className={clsx(
        "group relative flex h-[38px] w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        active ? "bg-[var(--primary)] text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="truncate">{item.label}</span>
      {item.badge ? (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F59E0B] px-1 text-xs font-bold text-white">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

function OperationalAction({ item, active, onNavigate, onClose }: {
  item: NavItem; active: boolean; onNavigate: (id: string) => void; onClose?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => { onNavigate(item.id); onClose?.(); }}
      className={clsx(
        "group mx-2.5 flex min-h-[54px] w-[calc(100%-20px)] items-center gap-3 rounded-lg border px-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50",
        active
          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
          : "border-[rgba(175,27,27,0.55)] bg-[rgba(175,27,27,0.08)] text-white hover:border-[var(--primary)] hover:bg-[var(--primary)]",
      )}
    >
      <span className="shrink-0 text-[#ef8d8d] transition-colors group-hover:text-white">{item.icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-semibold">{item.label}</span>
        <span className="mt-1 block truncate text-[10px] text-white/45 transition-colors group-hover:text-white/75">Nova base de medições</span>
      </span>
    </button>
  );
}

export function AppShell({
  activeSection,
  onNavigate,
  navItems,
  pageTitle,
  sidebarFooter,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  const sidebarContent = (mobile = false) => (
    <>
      {/* Logo */}
      <div className="flex min-h-[70px] shrink-0 items-center gap-3 border-b border-white/[0.08] px-4">
        <span className="inline-flex h-11 w-11 shrink-0 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo2.png" alt="PMF - PROJETA" className="h-full w-full object-cover" />
        </span>
        <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold text-white">En Passant</div>
            <div className="mt-0.5 truncate text-[10px] text-white/45">Gestão de medições</div>
        </div>
        {mobile && (
          <button
            className="ml-auto rounded-lg p-1.5 text-white/70 hover:text-white"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3" aria-label="Menu principal">
        {navItems
          .filter((item) => !item.hidden && !item.bottom)
          .map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeSection === item.id}
              onNavigate={onNavigate}
              onClose={mobile ? () => setMobileOpen(false) : undefined}
            />
          ))}

      </nav>

      <div className="shrink-0 border-t border-white/[0.08] py-2.5">
        {navItems.filter((item) => !item.hidden && item.bottom).map((item) => (
          <OperationalAction
            key={item.id}
            item={item}
            active={activeSection === item.id}
            onNavigate={onNavigate}
            onClose={mobile ? () => setMobileOpen(false) : undefined}
          />
        ))}
        {sidebarFooter && <div className={clsx("px-2.5", navItems.some((item) => !item.hidden && item.bottom) && "mt-2.5 border-t border-white/[0.08] pt-2.5")}>{sidebarFooter}</div>}
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--background)]">

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-[min(288px,calc(100vw-24px))] flex-col bg-[var(--sidebar)] transition-transform duration-200 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent(true)}
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside
        className="relative hidden h-full w-[264px] shrink-0 flex-col bg-[var(--sidebar)] lg:flex"
      >
        {sidebarContent(false)}
      </aside>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile navigation header. Desktop page identity lives in content. */}
        <header className="flex min-h-[54px] shrink-0 items-center gap-2 border-b border-[var(--border)] bg-white px-3 lg:hidden">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              className="flex shrink-0 items-center justify-center rounded-lg p-2 text-[#555555] hover:bg-[#F3F4F6] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
            <h1 className="truncate text-[16px] font-bold tracking-[-0.01em] text-[var(--foreground)] sm:text-[18px]">{pageTitle}</h1>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-3 sm:px-5 lg:px-6 lg:pr-[76px]">
          {children}
        </main>
      </div>
    </div>
  );
}
