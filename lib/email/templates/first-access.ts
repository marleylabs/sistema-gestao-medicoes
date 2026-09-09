import { emailLayout, escapeHtml } from "@/lib/email/layout";
import type { EmailContent } from "@/lib/email/types";

/**
 * Único e-mail transacional que carrega uma senha temporária em texto — diferente de
 * PASSWORD_RESET (nunca inclui a senha, só avisa que foi redefinida). Aqui a entrega é
 * explicitamente por e-mail (ação "Enviar primeiro acesso" no Painel Administrativo), então o
 * conteúdo precisa da credencial completa para o usuário conseguir logar. A senha nunca vai na
 * URL/query string do CTA — só no corpo do e-mail, em destaque.
 */
export function firstAccessTemplate(input: { nome: string; usuario: string; senhaTemporaria: string; appUrl: string }): EmailContent {
  const nome = escapeHtml(input.nome);
  const usuario = escapeHtml(input.usuario);
  const senha = escapeHtml(input.senhaTemporaria);
  const bodyHtml = `
    <p>Olá, <strong>${nome}</strong>.</p>
    <p>Seu acesso à plataforma En Passant foi criado.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="margin:0 0 4px;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">Usuário</p>
          <p style="margin:0 0 12px;color:#0A0A0A;font-size:16px;font-weight:700;font-family:monospace;">${usuario}</p>
          <p style="margin:0 0 4px;color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">Senha temporária</p>
          <p style="margin:0;color:#0A0A0A;font-size:16px;font-weight:700;font-family:monospace;">${senha}</p>
        </td>
      </tr>
    </table>
    <p>Por segurança, altere sua senha no primeiro acesso — a plataforma vai pedir isso automaticamente.</p>
    <p>Não compartilhe suas credenciais com ninguém.</p>
  `;
  const html = emailLayout({
    title: "Primeiro acesso — En Passant",
    bodyHtml,
    ctaLabel: "Acessar plataforma",
    ctaUrl: input.appUrl,
  });
  const text = `Olá, ${input.nome}.\n\nSeu acesso à plataforma En Passant foi criado.\n\nUsuário: ${input.usuario}\nSenha temporária: ${input.senhaTemporaria}\n\nAcesse: ${input.appUrl}\n\nPor segurança, altere sua senha no primeiro acesso. Não compartilhe suas credenciais com ninguém.\n\nEquipe Projeta\nEn Passant — Gestão de Medições`;
  return { subject: "Primeiro acesso — En Passant", html, text };
}
