"use client";

import { MotionConfig } from "framer-motion";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { assinarPreferencia, lerPreferenciaSalva, resolverTema, salvarPreferencia, type PreferenciaTema } from "@/lib/tema";

// ─── Blur context ─────────────────────────────────────────────────────────────

type BlurCtx = { blur: boolean; toggleBlur: () => void };
const BlurContext = createContext<BlurCtx>({ blur: false, toggleBlur: () => {} });

export function useBlur() { return useContext(BlurContext); }

// ─── Tema (claro/escuro/sistema) ──────────────────────────────────────────────

type TemaCtx = { preferencia: PreferenciaTema; setPreferencia: (valor: PreferenciaTema) => void };
const TemaContext = createContext<TemaCtx>({ preferencia: null, setPreferencia: () => {} });

export function useTema() { return useContext(TemaContext); }

export function Providers({ children }: { children: React.ReactNode }) {
  const [blur, setBlur] = useState(false);
  const preferencia = useSyncExternalStore(assinarPreferencia, lerPreferenciaSalva, () => null);

  useEffect(() => {
    const sistema = matchMedia("(prefers-color-scheme: dark)");
    // Lê a preferência real, não o estado: na hidratação o estado ainda é null e aplicaria o tema do sistema por um instante.
    const aplicar = () => document.documentElement.classList.toggle("dark", resolverTema(lerPreferenciaSalva(), sistema.matches) === "escuro");
    aplicar();
    if (preferencia !== null) return;
    sistema.addEventListener("change", aplicar);
    return () => sistema.removeEventListener("change", aplicar);
  }, [preferencia]);

  return (
    <TemaContext.Provider value={{ preferencia, setPreferencia: salvarPreferencia }}>
      <BlurContext.Provider value={{ blur, toggleBlur: () => setBlur((v) => !v) }}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </BlurContext.Provider>
    </TemaContext.Provider>
  );
}
