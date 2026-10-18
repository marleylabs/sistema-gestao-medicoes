"use client";

import { MotionConfig } from "framer-motion";
import { createContext, useContext, useEffect, useState } from "react";
import { lerPreferenciaTema, resolverTema, TEMA_STORAGE_KEY, type PreferenciaTema } from "@/lib/tema";

// ─── Blur context ─────────────────────────────────────────────────────────────

type BlurCtx = { blur: boolean; toggleBlur: () => void };
const BlurContext = createContext<BlurCtx>({ blur: false, toggleBlur: () => {} });

export function useBlur() { return useContext(BlurContext); }

// ─── Tema (claro/escuro/sistema) ──────────────────────────────────────────────

type TemaCtx = { preferencia: PreferenciaTema; setPreferencia: (valor: PreferenciaTema) => void };
const TemaContext = createContext<TemaCtx>({ preferencia: null, setPreferencia: () => {} });

export function useTema() { return useContext(TemaContext); }

function lerPreferenciaSalva(): PreferenciaTema {
  try {
    return lerPreferenciaTema(localStorage.getItem(TEMA_STORAGE_KEY));
  } catch {
    return null; // armazenamento bloqueado: segue o sistema
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [blur, setBlur] = useState(false);
  // Leitura já no primeiro render do cliente: um efeito depois aplicaria o tema do sistema por um instante.
  // Nada renderizado depende disso na hidratação (o seletor só aparece com o menu aberto).
  const [preferencia, setPreferenciaState] = useState<PreferenciaTema>(() => (typeof window === "undefined" ? null : lerPreferenciaSalva()));

  useEffect(() => {
    const sistema = matchMedia("(prefers-color-scheme: dark)");
    const aplicar = () => document.documentElement.classList.toggle("dark", resolverTema(preferencia, sistema.matches) === "escuro");
    aplicar();
    if (preferencia !== null) return;
    sistema.addEventListener("change", aplicar);
    return () => sistema.removeEventListener("change", aplicar);
  }, [preferencia]);

  function setPreferencia(valor: PreferenciaTema) {
    setPreferenciaState(valor);
    try {
      if (valor) localStorage.setItem(TEMA_STORAGE_KEY, valor);
      else localStorage.removeItem(TEMA_STORAGE_KEY);
    } catch {
      // sem armazenamento a escolha vale só nesta aba
    }
  }

  return (
    <TemaContext.Provider value={{ preferencia, setPreferencia }}>
      <BlurContext.Provider value={{ blur, toggleBlur: () => setBlur((v) => !v) }}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </BlurContext.Provider>
    </TemaContext.Provider>
  );
}
