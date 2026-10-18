import type { Page } from "@playwright/test";

/**
 * Clica em fechar e acompanha a saída animada quadro a quadro: o alvo ainda existe, fica inerte e o foco
 * sai dele. Exige o motion ligado no teste (`reducedMotion: "no-preference"`); o resto da suíte o reduz.
 */
export async function fecharEMedir(page: Page, botaoFechar: string, alvo: string) {
  return page.evaluate(async ([botao, seletor]) => {
    document.querySelector<HTMLElement>(botao)!.click();
    const quadro = () => new Promise((ok) => requestAnimationFrame(() => ok(null)));
    let medida = { saindo: false, inerte: false, focoDentro: true };
    for (let i = 0; i < 20 && !medida.inerte; i++) {
      await quadro();
      const el = document.querySelector(seletor);
      if (!el) break;
      medida = { saindo: true, inerte: !!el.closest("[inert]"), focoDentro: true };
    }
    // O navegador tira o foco de um elemento inerte na etapa de renderização seguinte.
    await quadro();
    const el = document.querySelector(seletor);
    return { ...medida, focoDentro: !!el && el.contains(document.activeElement) };
  }, [botaoFechar, alvo] as const);
}
