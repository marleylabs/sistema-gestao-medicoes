import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT ?? "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  if (!process.env.SMTP_USER) return { ok: false, error: "SMTP não configurado." };
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      ...opts,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function bmDisponivel(nome: string, meta?: { ciclo?: string; colaboradorCodigo?: string }) {
  const appUrl = process.env.APP_URL?.trim();
  return `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;">
      <h2 style="color:#1A1A1A;">Nova medição disponível para análise</h2>
      <p>Olá, <strong>${nome}</strong>!</p>
      <p>Uma nova medição foi disponibilizada para análise no Portal do Colaborador.</p>
      ${meta?.ciclo ? `<p><strong>Ciclo:</strong> ${meta.ciclo}</p>` : ""}
      ${meta?.colaboradorCodigo ? `<p><strong>Código:</strong> ${meta.colaboradorCodigo}</p>` : ""}
      <p>Acesse o portal para visualizar os dados e registrar sua conformidade.</p>
      ${appUrl ? `<p style="margin:24px 0;"><a href="${appUrl}" style="display:inline-block;background:#2563EB;color:white;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Acessar plataforma</a></p>` : ""}
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">
      <p style="font-size:12px;color:#9CA3AF;">Este é um e-mail automático. Não responda a esta mensagem.</p>
    </div>
  `;
}
