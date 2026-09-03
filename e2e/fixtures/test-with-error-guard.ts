import { test as base, expect } from "@playwright/test";

/**
 * Extensão do `test` do Playwright que falha automaticamente se a página emitir um erro real de
 * runtime (pageerror — exceptions não capturadas, incluindo erros de render do React como o
 * `ReferenceError: status is not defined` encontrado nesta auditoria) ou um `console.error`
 * inesperado. Sem isso, um erro de render pode passar despercebido porque o React recupera
 * silenciosamente com client-side rendering.
 *
 * Allowlist mínima: só os avisos conhecidos e inevitáveis do ambiente de dev do Next.js.
 */
const ALLOWED_CONSOLE_PATTERNS = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  // Mensagem genérica do próprio navegador para QUALQUER resposta não-2xx — sem URL, portanto
  // redundante com o monitor de respostas HTTP acima (que tem URL/status exatos e já filtra o
  // 401 esperado de /api/auth/login). Mantém console.error focado no que ele foi criado para
  // pegar: exceptions reais de JS/React, não o eco genérico de uma falha de rede já monitorada.
  /Failed to load resource: the server responded with a status of \d+/i,
];

export const test = base.extend<{ forEachTest: void }>({
  forEachTest: [
    async ({ page }, use) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const networkErrors: string[] = [];

      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
        consoleErrors.push(text);
      });
      // O console.error do navegador para um recurso falho ("Failed to load resource...") não diz
      // QUAL URL — captura a resposta HTTP real para toda chamada de API que retornar 4xx/5xx
      // inesperado, para o erro apontar exatamente a rota causando o problema.
      page.on("response", (response) => {
        const url = response.url();
        if (!url.includes("/api/")) return;
        if (response.status() < 400) return;
        // 401 é sempre "sessão inválida/ausente" — nunca um bug de aplicação, é a resposta CORRETA
        // tanto para credenciais erradas (/api/auth/login) quanto para chamadas em voo de outros
        // painéis (ex.: polling de /api/usuario/me, /api/ciclos) que completam bem depois do logout
        // ter invalidado a sessão (e2e/login.spec.ts "logout" navega e desloga de propósito).
        if (response.status() === 401) return;
        // 404 de /api/mapa-pagamento/documentos é o retorno CORRETO para um código de fornecedor
        // que não existe — comportamento intencional sob teste em e2e/novo-pagamento.spec.ts
        // (cenário de erro controlado do bug de "Novo pagamento" silencioso).
        if (url.includes("/api/mapa-pagamento/documentos") && response.status() === 404) return;
        // 400 de /api/admin/administrativo/fornecedores/manual é o retorno CORRETO para CNPJ
        // inválido — comportamento intencional sob teste em e2e/administrativo-novo-fornecedor.spec.ts.
        if (url.includes("/api/admin/administrativo/fornecedores/manual") && response.status() === 400) return;
        // 400 de POST /api/mapa-pagamento é o retorno CORRETO para um projetistaCodigo que não
        // corresponde a nenhum Profissional real — comportamento intencional sob teste em
        // e2e/bm-available-fornecedor-manual.spec.ts.
        if (url.endsWith("/api/mapa-pagamento") && response.status() === 400) return;
        // 403/400 de /api/admin/administrativo/fornecedores/bulk-delete são os retornos CORRETOS
        // para perfil não autorizado (só ADMIN) e payload vazio/inválido — comportamento
        // intencional sob teste em e2e/administrativo-fornecedor-dedupe.spec.ts.
        if (url.endsWith("/api/admin/administrativo/fornecedores/bulk-delete") && (response.status() === 403 || response.status() === 400)) return;
        networkErrors.push(`${response.status()} ${response.request().method()} ${url}`);
      });

      await use();

      expect(pageErrors, `pageerror(s) inesperado(s) durante o teste:\n${pageErrors.join("\n")}`).toEqual([]);
      expect(networkErrors, `resposta(s) HTTP inesperada(s) durante o teste:\n${networkErrors.join("\n")}`).toEqual([]);
      expect(consoleErrors, `console.error(s) inesperado(s) durante o teste:\n${consoleErrors.join("\n")}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
