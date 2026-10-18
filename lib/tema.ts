export type Tema = "claro" | "escuro";
/** null = seguir o sistema operacional. */
export type PreferenciaTema = Tema | null;

export const TEMA_STORAGE_KEY = "tema";

export function resolverTema(preferencia: PreferenciaTema, sistemaEscuro: boolean): Tema {
  return preferencia ?? (sistemaEscuro ? "escuro" : "claro");
}

export function lerPreferenciaTema(valor: string | null): PreferenciaTema {
  return valor === "claro" || valor === "escuro" ? valor : null;
}

/** Roda inline no <head>, antes da pintura, para a página não piscar no tema errado. Sem localStorage, segue o sistema. */
export const SCRIPT_TEMA_INICIAL = `(function(){var s=matchMedia("(prefers-color-scheme: dark)").matches;var t=null;try{t=localStorage.getItem("${TEMA_STORAGE_KEY}")}catch(e){t=null}document.documentElement.classList.toggle("dark",t==="escuro"||(t!=="claro"&&s))})()`;
