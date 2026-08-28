import { emailLayout, escapeHtml, formatCurrencyBRL, formatDatePtBR } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Disparado quando o fornecedor conclui a aprovação (ação "Enviar" após "Salvar" no Portal —
 * `app/api/colaborador/sgc/route.ts`, transição PENDENTE → AGUARDANDO_NF). Destinatário lógico:
 * Equipe de Medição.
 */
export function bmApprovedTemplate(input: {
  fornecedorNome: string;
  ciclo: string;
  valor: number | null;
  aprovadoAt: Date;
  appUrl: string | null;
}): EmailContent {
  const fornecedorNome = escapeHtml(input.fornecedorNome);
  const ciclo = escapeHtml(input.ciclo);
  const valor = formatCurrencyBRL(input.valor);
  const data = formatDatePtBR(input.aprovadoAt);
  const bodyHtml = `
    <p>O fornecedor <strong>${fornecedorNome}</strong> aprovou o Boletim de Medição do ciclo <strong>${ciclo}</strong>.</p>
    <p><strong>Valor:</strong> ${valor}</p>
    <p><strong>Data da aprovação:</strong> ${data}</p>
  `;
  const html = emailLayout({
    title: `BM aprovado — ${input.fornecedorNome} — Ciclo ${input.ciclo}`,
    bodyHtml,
    ctaLabel: "Acessar medição",
    ctaUrl: input.appUrl ?? undefined,
  });
  const text = `O fornecedor ${input.fornecedorNome} aprovou o Boletim de Medição do ciclo ${input.ciclo}.\n\nValor: ${valor}\nData da aprovação: ${data}${input.appUrl ? `\n\nAcesse: ${input.appUrl}` : ""}`;
  return { subject: `BM aprovado — ${input.fornecedorNome} — Ciclo ${input.ciclo}`, html, text };
}
