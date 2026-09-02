"use client";

import { useEffect, useRef } from "react";

type Options = {
  /** Intervalo do polling em ms. */
  intervalMs: number;
  /** Se falso, o hook não agenda nada (nem listeners) — use para telas que não precisam de live refresh no momento. */
  enabled?: boolean;
};

/**
 * Camada central de atualização automática — reusada por Pagamentos, Portal do Fornecedor e
 * Financeiro em vez de cada tela inventar seu próprio setInterval solto. Dispara `callback`:
 * - periodicamente, a cada `intervalMs`, mas só quando a aba está visível (poupa carga com a aba
 *   oculta, sem parar o timer — ao voltar a ficar visível o próximo tick já dispara normal);
 * - imediatamente quando a aba volta a ficar visível (visibilitychange) ou a janela recupera foco;
 * - imediatamente quando a conexão volta (evento `online`).
 *
 * Não recarrega a página nem mexe em estado de formulário — só reexecuta o `callback` que o
 * chamador já usa para refetch, então composição com "não perder o que o usuário está digitando"
 * é responsabilidade do próprio `callback` (em geral, um `load({ silent: true })`).
 */
export function useLiveRefresh(callback: () => void, { intervalMs, enabled = true }: Options) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.hidden) return;
      callbackRef.current();
    };
    const interval = setInterval(tick, intervalMs);

    const onVisibility = () => { if (!document.hidden) callbackRef.current(); };
    const onFocus = () => callbackRef.current();
    const onOnline = () => callbackRef.current();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [intervalMs, enabled]);
}
