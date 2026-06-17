"use client";

import { createContext, useContext, useState } from "react";

// ─── Blur context ─────────────────────────────────────────────────────────────

type BlurCtx = { blur: boolean; toggleBlur: () => void };
const BlurContext = createContext<BlurCtx>({ blur: false, toggleBlur: () => {} });

export function useBlur() { return useContext(BlurContext); }

export function Providers({ children }: { children: React.ReactNode }) {
  const [blur, setBlur] = useState(false);
  return (
    <BlurContext.Provider value={{ blur, toggleBlur: () => setBlur((v) => !v) }}>
      {children}
    </BlurContext.Provider>
  );
}
