"use client";

import { animate, motion, useAnimationControls, useIsPresent, useMotionValue, useReducedMotion, useTransform, type Transition, type Variants } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

// Primitivas de motion (spec docs/brain/specs/layout-tema-motion.md). Com prefers-reduced-motion,
// todas renderizam o estado final na hora. Nunca usar em linhas de tabela nem com overshoot em valores.

export const EASE_SAIDA = [0.22, 1, 0.36, 1] as const;

const semInscricao = () => () => {};
/** false no servidor e na hidratação, true em montagens depois dela: só o que monta no cliente parte do estado inicial. */
export function useMontadoAposHidratacao() {
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

// Classes estáticas: o Tailwind só gera o que encontra escrito no código. Palavras além da lista usam o último atraso.
const ATRASO_PALAVRA = ["delay-0", "delay-[50ms]", "delay-[100ms]", "delay-[150ms]", "delay-[200ms]", "delay-[250ms]", "delay-[300ms]", "delay-[350ms]"];

/**
 * Título que entra palavra por palavra, só com CSS (@starting-style): anima na carga do servidor e quando o
 * título é montado depois (troca de tela), sem JS e sem divergência de hidratação. O leitor de tela lê o aria-label.
 */
export function AnimatedText({ texto, as: Tag = "h1", className }: { texto: string; as?: "h1" | "h2"; className?: string }) {
  const palavras = texto.split(" ");
  return (
    <Tag className={className} aria-label={texto}>
      {palavras.map((palavra, i) => (
        <span key={`${texto}-${i}`} aria-hidden>
          <span
            className={`inline-block transition-[opacity,translate,filter] duration-500 ease-out starting:translate-y-[0.35em] starting:opacity-0 starting:blur-sm motion-reduce:transition-none ${ATRASO_PALAVRA[Math.min(i, ATRASO_PALAVRA.length - 1)]}`}
          >
            {palavra}
          </span>
          {i < palavras.length - 1 && " "}
        </span>
      ))}
    </Tag>
  );
}

const staggerPai: Variants = { oculto: {}, visivel: { transition: { staggerChildren: 0.06 } } };
const staggerFilho: Variants = {
  oculto: { opacity: 0, y: 12 },
  visivel: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_SAIDA } },
};

/** Cascata para grades curtas de cards (até ~12 itens). No SSR e com motion reduzido, já renderiza o estado final. */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  const montado = useMontadoAposHidratacao();
  const reduzir = useReducedMotion();
  const animar = montado && !reduzir;
  return (
    <motion.div className={className} variants={staggerPai} initial={animar ? "oculto" : false} animate="visivel">
      {children}
    </motion.div>
  );
}

/** Grupo dentro de um Stagger (ex.: grade de KPIs): entra na vez dele na cascata e escalona os próprios filhos. */
export function StaggerGrupo({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerPai}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerFilho}>
      {children}
    </motion.div>
  );
}

/**
 * Número que conta até o valor final. Só exibição: o valor chega pronto do cálculo e `formatar` aplica a máscara.
 * O texto é um MotionValue (sem re-render por frame); o leitor de tela recebe sempre o valor final.
 */
export function CountUp({ valor, formatar }: { valor: number; formatar: (n: number) => string }) {
  const reduzir = useReducedMotion();
  const partirDoZero = useMontadoAposHidratacao() && !reduzir;
  const atual = useMotionValue(partirDoZero ? 0 : valor);
  const texto = useTransform(atual, formatar);

  useEffect(() => {
    if (reduzir) {
      atual.set(valor);
      return;
    }
    const controle = animate(atual, valor, { duration: 0.8, ease: EASE_SAIDA });
    return () => controle.stop();
  }, [valor, reduzir, atual]);

  return (
    <span>
      <motion.span aria-hidden>{texto}</motion.span>
      <span className="sr-only">{formatar(valor)}</span>
    </span>
  );
}

// Painéis laterais montados agora, incluindo o que está saindo. Troca de modo ou de item no mesmo lugar
// monta o novo antes de desmontar o anterior: com outro painel montado, a entrada não se repete.
let paineisMontados = 0;

/**
 * Animação dos painéis laterais (AdminSidePanel, FornecedorDrawer): desliza da direita na entrada e
 * volta na saída (exige AnimatePresence no ponto que abre). `presente` é false durante a saída: o painel
 * fica inerte (`inert`: sem clique, teclado nem leitor de tela) e desliga o Esc para não interceptar a próxima ação.
 */
export function usePainelSobreposto() {
  const reduzir = useReducedMotion();
  const montado = useMontadoAposHidratacao();
  const [entrar] = useState(() => montado && paineisMontados === 0);
  const presente = useIsPresent();

  useLayoutEffect(() => {
    paineisMontados++;
    return () => {
      paineisMontados--;
    };
  }, []);

  const animar = entrar && !reduzir;
  const entrada: Transition = { duration: reduzir ? 0 : 0.28, ease: EASE_SAIDA };
  const saida: Transition = { duration: reduzir ? 0 : 0.18, ease: "easeIn" };
  return {
    presente,
    fundo: { initial: animar ? { opacity: 0 } : false, animate: { opacity: 1, transition: entrada }, exit: { opacity: 0, transition: saida } },
    painel: { initial: animar ? { x: "100%" } : false, animate: { x: 0, transition: entrada }, exit: { x: "100%", transition: saida } },
  } as const;
}
