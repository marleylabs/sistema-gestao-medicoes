"use client";

import { useState } from "react";
import { ChevronLeft, Menu, X } from "lucide-react";
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
  topBarRight?: React.ReactNode;
  children: React.ReactNode;
};

function NavButton({ item, active, collapsed, onNavigate, onClose }: {
  item: NavItem; active: boolean; collapsed: boolean;
  onNavigate: (id: string) => void; onClose?: () => void;
}) {
  return (
    <button
      onClick={() => { onNavigate(item.id); onClose?.(); }}
      title={collapsed ? item.label : undefined}
      className={clsx(
        "group relative flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-all duration-150",
        active ? "bg-white text-[#AF1B1B] shadow-sm" : "text-white/80 hover:bg-white/15 hover:text-white",
      )}
    >
      <span className={clsx("shrink-0 transition-transform duration-150", active && "scale-105")}>{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge ? (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F59E0B] px-1 text-xs font-bold text-white">
          {item.badge}
        </span>
      ) : null}
      {collapsed && item.badge ? (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#F59E0B]" />
      ) : null}
    </button>
  );
}

export function AppShell({
  activeSection,
  onNavigate,
  navItems,
  pageTitle,
  topBarRight,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (mobile = false) => (
    <>
      {/* Logo */}
      <div
        className={clsx(
          "flex min-h-[64px] items-center gap-3 border-b border-white/15",
          collapsed && !mobile ? "justify-center px-0" : "px-4",
        )}
      >
        <span className="inline-flex h-11 w-11 shrink-0 overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo2.png" alt="PMF - PROJETA" className="h-full w-full object-cover" />
        </span>
        {(!collapsed || mobile) && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold text-white">En Passant</div>
            <div className="text-[10px] italic font-bold text-white/60 leading-snug">Movimento lateral em busca de novos objetivos</div>
          </div>
        )}
        {mobile && (
          <button
            className="ml-auto rounded-lg p-1.5 text-white/70 hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 p-2 pt-3" aria-label="Menu principal">
        {navItems
          .filter((item) => !item.hidden && !item.bottom)
          .map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeSection === item.id}
              collapsed={collapsed && !mobile}
              onNavigate={onNavigate}
              onClose={mobile ? () => setMobileOpen(false) : undefined}
            />
          ))}

        <div className="flex-1" />

        {navItems
          .filter((item) => !item.hidden && item.bottom)
          .map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeSection === item.id}
              collapsed={collapsed && !mobile}
              onNavigate={onNavigate}
              onClose={mobile ? () => setMobileOpen(false) : undefined}
            />
          ))}
      </nav>

      {/* Collapse toggle — desktop only */}
      {!mobile && (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex justify-center items-center border-t border-white/15 py-3 text-white/50 transition-colors hover:text-white"
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          <ChevronLeft
            size={20}
            className={clsx("shrink-0 transition-transform duration-300", collapsed && "rotate-180")}
          />
        </button>
      )}
    </>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F5F5F5]">

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col bg-[#AF1B1B] transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent(true)}
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside
        className={clsx(
          "relative hidden h-full shrink-0 flex-col bg-[#AF1B1B] transition-all duration-300 ease-in-out lg:flex",
          collapsed ? "w-[64px]" : "w-[212px]",
        )}
      >
        {sidebarContent(false)}
      </aside>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex shrink-0 min-h-[56px] items-center justify-between gap-2 border-b border-[#E5E7EB] bg-white px-3 sm:px-6 shadow-[0_1px_3px_0_rgb(0,0,0,0.06)]">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              className="flex shrink-0 items-center justify-center rounded-lg p-2 text-[#555555] hover:bg-[#F3F4F6] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
            <h1 className="truncate text-base font-bold text-[#1A1A1A] sm:text-lg">{pageTitle}</h1>
          </div>
          {topBarRight}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
