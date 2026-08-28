import { emailLayout, escapeHtml } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Disparado quando o fornecedor solicita revisão no Portal (`app/api/colaborador/sgc/route.ts`,
 * ação SOLICITAR_REVISAO, transição PENDENTE → REVISAO_SOLICITADA). Destinatário lógico: Equipe
 * de Medição.
 */
export function bmRevisionRequestedTemplate(input: { fornecedorNome: string; ciclo: string; motivo: string | null; appUrl: string | null }): EmailContent {
  const fornecedorNome = escapeHtml(input.fornecedorNome);
  const ciclo = escapeHtml(input.ciclo);
  const motivoHtml = input.motivo
    ? `<p><strong>Motivo:</strong> ${escapeHtml(input.motivo)}</p>`
    : "";
  const bodyHtml = `
    <p>O fornecedor <strong>${fornecedorNome}</strong> solicitou revisão da medição do ciclo <strong>${ciclo}</strong>.</p>
    ${motivoHtml}
  `;
  const html = emailLayout({
    title: `Revisão solicitada — ${input.fornecedorNome} — Ciclo ${input.ciclo}`,
    bodyHtml,
    ctaLabel: "Acessar medição",
    ctaUrl: input.appUrl ?? undefined,
  });
  const text = `O fornecedor ${input.fornecedorNome} solicitou revisão da medição do ciclo ${input.ciclo}.\n${input.motivo ? `\nMotivo: ${input.motivo}\n` : ""}${input.appUrl ? `\nAcesse: ${input.appUrl}` : ""}`;
  return { subject: `Revisão solicitada — ${input.fornecedorNome} — Ciclo ${input.ciclo}`, html, text };
}
