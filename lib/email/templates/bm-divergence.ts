import { emailLayout, escapeHtml } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Disparado quando o fornecedor envia a máscara de conferência e o backend encontra pelo menos
 * uma divergência real (`app/api/colaborador/conferencia/upload/route.ts`, transição
 * statusConferencia → DIVERGENCIA). Destinatário lógico: Equipe de Medição. Não inclui a lista
 * detalhada de documentos nesta primeira versão — só o resumo, com CTA para acessar a medição.
 */
export function bmDivergenceTemplate(input: { fornecedorNome: string; ciclo: string; quantidade: number; appUrl: string | null }): EmailContent {
  const fornecedorNome = escapeHtml(input.fornecedorNome);
  const ciclo = escapeHtml(input.ciclo);
  const bodyHtml = `
    <p>Foi identificada divergência na conferência da medição de <strong>${fornecedorNome}</strong> referente ao ciclo <strong>${ciclo}</strong>.</p>
    <p><strong>Quantidade de divergências:</strong> ${input.quantidade}</p>
  `;
  const html = emailLayout({
    title: `Divergência encontrada — ${input.fornecedorNome} — Ciclo ${input.ciclo}`,
    bodyHtml,
    ctaLabel: "Acessar medição",
    ctaUrl: input.appUrl ?? undefined,
  });
  const text = `Foi identificada divergência na conferência da medição de ${input.fornecedorNome} referente ao ciclo ${input.ciclo}.\n\nQuantidade de divergências: ${input.quantidade}${input.appUrl ? `\n\nAcesse: ${input.appUrl}` : ""}`;
  return { subject: `Divergência encontrada — ${input.fornecedorNome} — Ciclo ${input.ciclo}`, html, text };
}
