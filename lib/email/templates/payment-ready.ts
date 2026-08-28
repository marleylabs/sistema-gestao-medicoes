import { emailLayout, escapeHtml, formatCurrencyBRL } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Disparado quando a NF enviada é validada com sucesso e o processo entra de fato na fila do
 * Financeiro (`app/api/colaborador/nf/route.ts`, transição AGUARDANDO_NF → APROVADO, só após
 * `validateNfDocumentAgainstCadastro` aprovar o PDF). Nunca no momento do BM aprovado — a NF
 * pendente é o que efetivamente bloqueia o Financeiro até aqui.
 */
export function paymentReadyTemplate(input: { fornecedorNome: string; ciclo: string; valor: number | null; appUrl: string | null }): EmailContent {
  const fornecedorNome = escapeHtml(input.fornecedorNome);
  const ciclo = escapeHtml(input.ciclo);
  const valor = formatCurrencyBRL(input.valor);
  const bodyHtml = `
    <p>O processo de <strong>${fornecedorNome}</strong> está disponível para pagamento.</p>
    <p><strong>Ciclo:</strong> ${ciclo}</p>
    <p><strong>Valor:</strong> ${valor}</p>
    <p><strong>Nota Fiscal:</strong> recebida e validada</p>
  `;
  const html = emailLayout({
    title: `Pagamento disponível — ${input.fornecedorNome} — Ciclo ${input.ciclo}`,
    bodyHtml,
    ctaLabel: "Acessar Financeiro",
    ctaUrl: input.appUrl ?? undefined,
  });
  const text = `O processo de ${input.fornecedorNome} está disponível para pagamento.\n\nCiclo: ${input.ciclo}\nValor: ${valor}\nNota Fiscal: recebida e validada${input.appUrl ? `\n\nAcesse: ${input.appUrl}` : ""}`;
  return { subject: `Pagamento disponível — ${input.fornecedorNome} — Ciclo ${input.ciclo}`, html, text };
}
