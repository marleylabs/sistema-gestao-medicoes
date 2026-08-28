/**
 * Fonte única de verdade para montar URLs de e-mail a partir de APP_URL — nenhum template ou
 * evento deve concatenar string manualmente (evita barra dupla, evita hardcode de rota). Módulo
 * puro (sem "server-only"): usado tanto em produção (lib/email/events.ts) quanto em testes e no
 * script de pré-flight.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Remove barras finais — nunca concatenar strings soltas para montar a URL base. */
export function normalizeAppUrl(rawAppUrl: string | null | undefined): string {
  return (rawAppUrl ?? "").trim().replace(/\/+$/, "");
}

/**
 * Verdadeiro somente quando a URL é HTTPS e não aponta para um host local — condição exigida
 * para liberar envio real (EMAIL_TEST_MODE=false). Em modo de teste, localhost é aceitável.
 */
export function isProductionSafeAppUrl(rawAppUrl: string | null | undefined): boolean {
  const normalized = normalizeAppUrl(rawAppUrl);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") return false;
    if (LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

/** Remetente do Resend usando o domínio sandbox (@resend.dev) — nunca aceitável em produção. */
export function isResendDevSender(rawFromEmail: string | null | undefined): boolean {
  const value = (rawFromEmail ?? "").trim().toLowerCase();
  return /@resend\.dev>?\s*$/.test(value);
}

/** Monta a URL da raiz da aplicação (Portal do fornecedor / tela padrão) sem barra dupla. */
export function buildRootUrl(rawAppUrl: string | null | undefined): string {
  const base = normalizeAppUrl(rawAppUrl) || "http://localhost:3000";
  return `${base}/`;
}

/**
 * Monta a URL de uma seção do painel Administrativo/Equipe (deep-link real via
 * `?section=<secao>`, o único mecanismo de rota interna que a SPA em `components/medicoes-app.tsx`
 * expõe hoje — não existem rotas Next.js dedicadas para /financeiro, /medicao etc.).
 */
export function buildSectionUrl(rawAppUrl: string | null | undefined, section: string): string {
  const base = normalizeAppUrl(rawAppUrl) || "http://localhost:3000";
  return `${base}/?section=${encodeURIComponent(section)}`;
}

/** Monta a URL de login (fluxo real de PASSWORD_RESET hoje: senha temporária + rota /login). */
export function buildLoginUrl(rawAppUrl: string | null | undefined): string {
  const base = normalizeAppUrl(rawAppUrl) || "http://localhost:3000";
  return `${base}/login`;
}
