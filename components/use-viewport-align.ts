"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Mantém um popover ancorado (position: absolute, filho de um wrapper `relative` do gatilho)
 * inteiro dentro da viewport: parte do lado preferido (borda esquerda ou direita alinhada ao
 * gatilho) e desloca o painel só o necessário para respeitar `margin` nas duas bordas da tela.
 * Mede antes do paint (sem piscar), a cada render do dono enquanto aberto (o gatilho pode se mover
 * quando o cabeçalho reflui) e no resize. Devolve o `left` a aplicar no painel (undefined até medir,
 * quando vale a classe padrão left-0/right-0 do próprio painel).
 */
export function useViewportAlign(
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  open: boolean,
  prefer: "left" | "right" = "left",
  margin = 16,
): CSSProperties | undefined {
  const [left, setLeft] = useState<number | undefined>(undefined);

  function medir() {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const largura = popoverRef.current?.offsetWidth ?? 0;
    if (!anchor || !largura) return;
    const viewport = document.documentElement.clientWidth;
    const preferido = prefer === "left" ? 0 : anchor.width - largura;
    const minimo = margin - anchor.left;
    const maximo = viewport - margin - largura - anchor.left;
    setLeft(Math.round(Math.min(Math.max(preferido, minimo), Math.max(minimo, maximo))));
  }

  useLayoutEffect(() => {
    if (open) medir();
    else setLeft(undefined);
  });

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return left === undefined ? undefined : { left, right: "auto" };
}
