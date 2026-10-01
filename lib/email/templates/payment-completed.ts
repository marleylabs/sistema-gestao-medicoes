import { emailLayout, escapeHtml, formatDatePtBR, paymentTotalsBlock } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Disparado quando o Financeiro registra o pagamento (`app/api/admin/financeiro/route.ts` PATCH,
 * transição APROVADO → PAGO). Destinatário lógico: o próprio fornecedor. Não anexa o comprovante
 * nesta primeira versão — o fornecedor acessa o Portal para visualizá-lo.
 */
export function paymentCompletedTemplate(input: { fornecedorNome: string; ciclo: string; valor: number | null; rev?: number | null; pagoAt: Date; appUrl: string | null }): EmailContent {
  const fornecedorNome = escapeHtml(input.fornecedorNome);
  const ciclo = escapeHtml(input.ciclo);
  const totais = paymentTotalsBlock({ valor: input.valor, rev: input.rev });
  const data = formatDatePtBR(input.pagoAt);
  const bodyHtml = `
    <p>Olá, <strong>${fornecedorNome}</strong>.</p>
    <p>O pagamento referente ao ciclo <strong>${ciclo}</strong> foi concluído.</p>
    ${totais.html}
    <p><strong>Data do pagamento:</strong> ${data}</p>
    <p>O comprovante está disponível no Portal do Fornecedor.</p>
  `;
  const html = emailLayout({
    title: `Pagamento concluído — Ciclo ${input.ciclo}`,
    bodyHtml,
    ctaLabel: "Acessar Portal",
    ctaUrl: input.appUrl ?? undefined,
  });
  const text = `Olá, ${input.fornecedorNome}.\n\nO pagamento referente ao ciclo ${input.ciclo} foi concluído.\n\n${totais.text}\nData do pagamento: ${data}\n\nO comprovante está disponível no Portal do Fornecedor.${input.appUrl ? `\n\nAcesse: ${input.appUrl}` : ""}`;
  return { subject: `Pagamento concluído — Ciclo ${input.ciclo}`, html, text };
}
