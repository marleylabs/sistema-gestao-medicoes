import { emailLayout, escapeHtml } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * A aplicação ainda não possui um fluxo de redefinição por link/token de uso único (auditado
 * antes de implementar este evento) — só existe reset ADMIN-iniciado, que gera uma senha
 * temporária exibida ao admin na tela para ele repassar ao usuário por um canal já confiado.
 * Por isso este e-mail NUNCA inclui a senha temporária, hash ou qualquer segredo — é só um aviso
 * de que a senha foi redefinida, com CTA para a tela de login (rota real já existente). Quando um
 * fluxo de link/token existir, trocar `ctaUrl` para a rota de redefinição e nada mais precisa mudar.
 */
export function passwordResetTemplate(input: { nome: string; appUrl: string }): EmailContent {
  const nome = escapeHtml(input.nome);
  const bodyHtml = `
    <p>Olá, <strong>${nome}</strong>.</p>
    <p>Sua senha na plataforma En Passant foi redefinida por um administrador.</p>
    <p>Use a senha temporária informada a você pelo administrador para acessar — no primeiro acesso, o sistema pedirá que você defina uma nova senha pessoal.</p>
    <p>Se você não esperava esta mensagem, entre em contato com o administrador da plataforma.</p>
  `;
  const html = emailLayout({
    title: "Redefinição de senha — En Passant",
    bodyHtml,
    ctaLabel: "Acessar plataforma",
    ctaUrl: input.appUrl,
  });
  const text = `Olá, ${input.nome}.\n\nSua senha na plataforma En Passant foi redefinida por um administrador. Use a senha temporária informada a você para acessar — no primeiro acesso será necessário definir uma nova senha pessoal.\n\nSe você não esperava esta mensagem, entre em contato com o administrador da plataforma.\n\nAcesse: ${input.appUrl}`;
  return { subject: "Redefinição de senha — En Passant", html, text };
}
