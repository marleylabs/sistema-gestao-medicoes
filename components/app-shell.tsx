"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { clsx } from "clsx";

type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  hidden?: boolean;
};

type AppShellProps = {
  activeSection: string;
  onNavigate: (id: string) => void;
  navItems: NavItem[];
  pageTitle: string;
  topBarRight?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell({
  activeSection,
  onNavigate,
  navItems,
  pageTitle,
  topBarRight,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F5F5F5]">
      {/* ── Sidebar ── */}
      <aside
        className={clsx(
          "relative flex h-full shrink-0 flex-col bg-[#AF1B1B] transition-all duration-300 ease-in-out",
          collapsed ? "w-[64px]" : "w-[212px]",
        )}
      >
        {/* Logo */}
        <div
          className={clsx(
            "flex min-h-[64px] items-center gap-3 border-b border-white/15",
            collapsed ? "justify-center px-0" : "px-4",
          )}
        >
          <span className="inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo2.png" alt="PMF - PROJETA" className="h-full w-full object-cover" />
          </span>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-bold text-white">PMF - PROJETA</div>
              <div className="truncate text-[10px] font-medium text-white/60">Medições e Pagamentos</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 p-2 pt-3" aria-label="Menu principal">
          {navItems
            .filter((item) => !item.hidden)
            .map((item) => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    "group relative flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-white text-[#AF1B1B] shadow-sm"
                      : "text-white/80 hover:bg-white/15 hover:text-white",
                  )}
                >
                  <span className={clsx("shrink-0 transition-transform duration-150", active && "scale-105")}>
                    {item.icon}
                  </span>
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
            })}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className={clsx(
            "flex items-center gap-2 border-t border-white/15 py-3 text-xs font-medium text-white/60 transition-colors hover:text-white",
            collapsed ? "justify-center px-0" : "px-4",
          )}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          <ChevronLeft
            size={15}
            className={clsx("shrink-0 transition-transform duration-300", collapsed && "rotate-180")}
          />
          {!collapsed && <span>Recolher menu</span>}
        </button>
      </aside>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex shrink-0 min-h-[64px] items-center justify-between gap-4 border-b border-[#E5E7EB] bg-white px-6 shadow-[0_1px_3px_0_rgb(0,0,0,0.06)]">
          <div>
            <h1 className="text-lg font-bold text-[#1A1A1A]">{pageTitle}</h1>
          </div>
          {topBarRight}
        </header>

        {/* Page content */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
