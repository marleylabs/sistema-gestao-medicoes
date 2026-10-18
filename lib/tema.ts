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

// Store externo da preferência: o servidor e a hidratação veem null (sem divergência no que depende do tema,
// como o ícone do login); o cliente lê o localStorage logo em seguida. Também sincroniza entre abas ("storage").
const ouvintes = new Set<() => void>();
let preferenciaEmMemoria: PreferenciaTema = null; // vale quando o localStorage está bloqueado

export function lerPreferenciaSalva(): PreferenciaTema {
  try {
    return lerPreferenciaTema(localStorage.getItem(TEMA_STORAGE_KEY));
  } catch {
    return preferenciaEmMemoria; // armazenamento bloqueado: a escolha vale só nesta aba
  }
}

export function assinarPreferencia(aviso: () => void) {
  ouvintes.add(aviso);
  window.addEventListener("storage", aviso);
  return () => {
    ouvintes.delete(aviso);
    window.removeEventListener("storage", aviso);
  };
}

export function salvarPreferencia(valor: PreferenciaTema) {
  preferenciaEmMemoria = valor;
  try {
    if (valor) localStorage.setItem(TEMA_STORAGE_KEY, valor);
    else localStorage.removeItem(TEMA_STORAGE_KEY);
  } catch {
    // sem armazenamento fica a cópia em memória
  }
  ouvintes.forEach((aviso) => aviso());
}
