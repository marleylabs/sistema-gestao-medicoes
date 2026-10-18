"use client";

import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

// Primitivas de motion (spec docs/brain/specs/layout-tema-motion.md). Com prefers-reduced-motion,
// todas renderizam o estado final na hora. Nunca usar em linhas de tabela nem com overshoot em valores.

const EASE_SAIDA = [0.22, 1, 0.36, 1] as const;

const semInscricao = () => () => {};
/**
 * false no servidor e na hidratação, true em montagens depois dela. O HTML do servidor já sai visível
 * (sem esperar o JS) e não diverge na hidratação; só o que monta depois (troca de tela) anima a entrada.
 */
function useMontadoAposHidratacao() {
  return useSyncExternalStore(semInscricao, () => true, () => false);
}

/** `chave`: ao mudar, repete a entrada sem remontar os filhos (o estado deles é preservado). */
export function FadeIn({ children, chave }: { children: React.ReactNode; chave?: string }) {
  const reduzir = useReducedMotion();
  const controles = useAnimationControls();
  const anterior = useRef(chave);

  // useLayoutEffect: esconde antes da pintura, senão o conteúdo novo pisca um frame antes de animar
  useLayoutEffect(() => {
    if (anterior.current === chave) return;
    anterior.current = chave;
    if (reduzir) return;
    controles.set({ opacity: 0, y: 8 });
    controles.start({ opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_SAIDA } });
  }, [chave, reduzir, controles]);

  return (
    <motion.div initial={false} animate={controles}>
      {children}
    </motion.div>
  );
}

/** Título que entra palavra por palavra. O leitor de tela lê o texto inteiro pelo aria-label do heading. */
export function AnimatedText({ texto, as: Tag = "h1", className }: { texto: string; as?: "h1" | "h2"; className?: string }) {
  const reduzir = useReducedMotion();
  const animar = useMontadoAposHidratacao() && !reduzir;
  const palavras = texto.split(" ");
  return (
    <Tag className={className} aria-label={texto}>
      {palavras.map((palavra, i) => (
        <span key={`${texto}-${i}`} aria-hidden>
          <motion.span
            className="inline-block"
            initial={animar ? { opacity: 0, y: "0.35em", filter: "blur(6px)" } : false}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.45, ease: EASE_SAIDA, delay: i * 0.05 }}
          >
            {palavra}
          </motion.span>
          {i < palavras.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}
