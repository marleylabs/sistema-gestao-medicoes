import { emailLayout, escapeHtml } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Disparado no momento em que o fornecedor ganha uma ação real disponível na plataforma: hoje
 * isso é o início da conferência documental (upload da máscara), não a aprovação final — ver
 * `app/api/sgc/enviar/route.ts` (ENVIAR_BM/REENVIAR_BM), que já era o único ponto do sistema que
 * mandava esse aviso (antes via SMTP ad-hoc, agora centralizado aqui).
 */
export function bmAvailableTemplate(input: { nome: string; ciclo: string; appUrl: string | null }): EmailContent {
  const nome = escapeHtml(input.nome);
  const ciclo = escapeHtml(input.ciclo);
  const bodyHtml = `
    <p>Olá, <strong>${nome}</strong>.</p>
    <p>A medição do ciclo <strong>${ciclo}</strong> está disponível para conferência.</p>
    <p>Acesse o Portal do Fornecedor para baixar a máscara e enviar os documentos correspondentes ao ciclo.</p>
  `;
  const html = emailLayout({
    title: `Medição disponível para conferência — Ciclo ${input.ciclo}`,
    bodyHtml,
    ctaLabel: "Acessar Portal",
    ctaUrl: input.appUrl ?? undefined,
  });
  const text = `Olá, ${input.nome}.\n\nA medição do ciclo ${input.ciclo} está disponível para conferência.\n\nAcesse o Portal do Fornecedor para baixar a máscara e enviar os documentos correspondentes ao ciclo.${input.appUrl ? `\n\nAcesse: ${input.appUrl}` : ""}`;
  return { subject: `Medição disponível para conferência — Ciclo ${input.ciclo}`, html, text };
}
