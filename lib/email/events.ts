import "server-only";
import { sendTransactionalEmail } from "@/lib/email/send-email";
import { getEmailCcForEvent } from "@/lib/email/cc-policy";
import { resolveFornecedorEmail, resolveMedicaoTeamEmails, resolveFinanceiroTeamEmails } from "@/lib/email/resolve-recipients";
import { passwordResetTemplate } from "@/lib/email/templates/password-reset";
import { bmAvailableTemplate } from "@/lib/email/templates/bm-available";
import { bmDivergenceTemplate } from "@/lib/email/templates/bm-divergence";
import { bmApprovedTemplate } from "@/lib/email/templates/bm-approved";
import { bmRevisionRequestedTemplate } from "@/lib/email/templates/bm-revision-requested";
import { paymentReadyTemplate } from "@/lib/email/templates/payment-ready";
import { paymentCompletedTemplate } from "@/lib/email/templates/payment-completed";
import { buildRootUrl, buildSectionUrl, buildLoginUrl } from "@/lib/email/app-url";
import { isEmailCtaEnabled } from "@/lib/email/cta-policy";

/**
 * URL de destino de cada evento — sempre montada a partir de APP_URL (nunca hardcoded/concatenada
 * ad-hoc no template). "Portal" é a raiz (perfil COLABORADOR sempre vê o Portal do Fornecedor lá);
 * "Equipe de Medição" e "Financeiro" não têm rota Next.js própria — usam o deep-link real
 * `?section=<secao>` que `components/medicoes-app.tsx` já lê da URL para abrir a aba certa.
 *
 * Os três helpers operacionais (portal/evidências/financeiro) retornam `null` quando
 * EMAIL_CTA_ENABLED != "true" — a REGRA fica só aqui, os templates apenas deixam de renderizar o
 * botão quando recebem `null` (ver `lib/email/layout.ts`, `ctaUrl` já é opcional). `loginUrl()` é
 * a única exceção: PASSWORD_RESET é segurança/autenticação e nunca perde o link, mesmo com
 * EMAIL_CTA_ENABLED desligado.
 */
function portalUrl(): string | null {
  return isEmailCtaEnabled() ? buildRootUrl(process.env.APP_URL) : null;
}
function evidenciasUrl(): string | null {
  return isEmailCtaEnabled() ? buildSectionUrl(process.env.APP_URL, "evidencias") : null;
}
function financeiroUrl(): string | null {
  return isEmailCtaEnabled() ? buildSectionUrl(process.env.APP_URL, "financeiro") : null;
}
function loginUrl(): string {
  return buildLoginUrl(process.env.APP_URL);
}

/**
 * Um `notify*` por evento, chamado DEPOIS do sucesso da operação principal (nunca antes — e-mail
 * não é fonte de verdade de status). Nunca lançam exceção: uma falha do Resend fica só registrada
 * em EmailLog, sem desfazer a transação de negócio já concluída.
 *
 * CC é sempre resolvido via `getEmailCcForEvent()` (política central por categoria — BM ou
 * Financeiro) — nunca montado aqui. PASSWORD_RESET nunca recebe CC (fora das duas categorias).
 *
 * Quando o destinatário real não está configurado (sem e-mail cadastrado): em produção o envio
 * falha com "nenhum destinatário real" (RECIPIENT_MISSING fica implícito no log); em modo de
 * teste o envio AINDA acontece para o endereço de teste (prova que o template/pipeline funciona),
 * com `recipientMissing: true` registrado em metadata para preparar produção.
 */

export async function notifyPasswordReset(input: { usuarioId: string; nome: string; email: string | null }) {
  const content = passwordResetTemplate({ nome: input.nome, appUrl: loginUrl() });
  // Não existe uma entidade persistente de "solicitação de reset" (o reset admin-iniciado não
  // gera um request id) — usa um balde de 60s por usuário como chave determinística, o
  // suficiente para não duplicar por duplo clique/retry, mas sem impedir um reset genuinamente
  // novo minutos depois.
  const bucket = Math.floor(Date.now() / 60_000);
  return sendTransactionalEmail({
    event: "PASSWORD_RESET",
    to: input.email ? [input.email] : [],
    cc: getEmailCcForEvent("PASSWORD_RESET"),
    content,
    idempotencyKey: `password-reset/${input.usuarioId}/${bucket}`,
    metadata: { usuarioId: input.usuarioId, recipientMissing: !input.email },
  });
}

export async function notifyBmAvailable(input: { sgcId: string; colaboradorCodigo: string; ciclo: string; nome: string; email: string | null; revisao: number }) {
  const content = bmAvailableTemplate({ nome: input.nome, ciclo: input.ciclo, appUrl: portalUrl() });
  return sendTransactionalEmail({
    event: "BM_AVAILABLE",
    to: input.email ? [input.email] : [],
    cc: getEmailCcForEvent("BM_AVAILABLE"),
    content,
    idempotencyKey: `bm-available/${input.sgcId}/${input.revisao}`,
    metadata: { sgcId: input.sgcId, colaboradorCodigo: input.colaboradorCodigo, ciclo: input.ciclo, recipientMissing: !input.email },
  });
}

export async function notifyBmDivergence(input: { sgcId: string; ciclo: string; fornecedorNome: string; quantidade: number; conferenciaCarregadoAt: Date }) {
  const { emails, missingCount } = await resolveMedicaoTeamEmails();
  const content = bmDivergenceTemplate({ fornecedorNome: input.fornecedorNome, ciclo: input.ciclo, quantidade: input.quantidade, appUrl: evidenciasUrl() });
  return sendTransactionalEmail({
    event: "BM_DIVERGENCE",
    to: emails,
    cc: getEmailCcForEvent("BM_DIVERGENCE"),
    content,
    // Uma disponibilização de conferência pode gerar no máximo um alerta de divergência por
    // upload — usa o instante do upload (gravado no banco) como parte da chave, então um upload
    // repetido do mesmo arquivo (duplo clique) não duplica o e-mail, mas um novo upload
    // legítimo depois de resolver as divergências anteriores gera um novo alerta.
    idempotencyKey: `bm-divergence/${input.sgcId}/${input.conferenciaCarregadoAt.getTime()}`,
    metadata: { sgcId: input.sgcId, ciclo: input.ciclo, quantidade: input.quantidade, medicaoRecipientsMissing: missingCount },
  });
}

export async function notifyBmApproved(input: { sgcId: string; ciclo: string; fornecedorNome: string; valor: number | null; aprovadoAt: Date; revisao: number }) {
  const { emails, missingCount } = await resolveMedicaoTeamEmails();
  const content = bmApprovedTemplate({ fornecedorNome: input.fornecedorNome, ciclo: input.ciclo, valor: input.valor, aprovadoAt: input.aprovadoAt, appUrl: evidenciasUrl() });
  return sendTransactionalEmail({
    event: "BM_APPROVED",
    to: emails,
    cc: getEmailCcForEvent("BM_APPROVED"),
    content,
    idempotencyKey: `bm-approved/${input.sgcId}/${input.revisao}`,
    metadata: { sgcId: input.sgcId, ciclo: input.ciclo, medicaoRecipientsMissing: missingCount },
  });
}

export async function notifyBmRevisionRequested(input: { sgcId: string; ciclo: string; fornecedorNome: string; motivo: string | null; revisaoSolicitadaAt: Date; revisao: number }) {
  const { emails, missingCount } = await resolveMedicaoTeamEmails();
  const content = bmRevisionRequestedTemplate({ fornecedorNome: input.fornecedorNome, ciclo: input.ciclo, motivo: input.motivo, appUrl: evidenciasUrl() });
  return sendTransactionalEmail({
    event: "BM_REVISION_REQUESTED",
    to: emails,
    cc: getEmailCcForEvent("BM_REVISION_REQUESTED"),
    content,
    idempotencyKey: `bm-revision-requested/${input.sgcId}/${input.revisao}`,
    metadata: { sgcId: input.sgcId, ciclo: input.ciclo, medicaoRecipientsMissing: missingCount },
  });
}

export async function notifyPaymentReady(input: { sgcId: string; ciclo: string; fornecedorNome: string; valor: number | null }) {
  const { emails, missingCount } = await resolveFinanceiroTeamEmails();
  const content = paymentReadyTemplate({ fornecedorNome: input.fornecedorNome, ciclo: input.ciclo, valor: input.valor, appUrl: financeiroUrl() });
  return sendTransactionalEmail({
    event: "PAYMENT_READY",
    to: emails,
    cc: getEmailCcForEvent("PAYMENT_READY"),
    content,
    idempotencyKey: `payment-ready/${input.sgcId}`,
    metadata: { sgcId: input.sgcId, ciclo: input.ciclo, financeiroRecipientsMissing: missingCount },
  });
}

export async function notifyPaymentCompleted(input: { sgcId: string; colaboradorCodigo: string; ciclo: string; fornecedorNome: string; valor: number | null; pagoAt: Date }) {
  const recipient = await resolveFornecedorEmail(input.colaboradorCodigo, input.fornecedorNome);
  const content = paymentCompletedTemplate({ fornecedorNome: recipient.nome, ciclo: input.ciclo, valor: input.valor, pagoAt: input.pagoAt, appUrl: portalUrl() });
  return sendTransactionalEmail({
    event: "PAYMENT_COMPLETED",
    to: recipient.email ? [recipient.email] : [],
    cc: getEmailCcForEvent("PAYMENT_COMPLETED"),
    content,
    idempotencyKey: `payment-completed/${input.sgcId}`,
    metadata: { sgcId: input.sgcId, colaboradorCodigo: input.colaboradorCodigo, ciclo: input.ciclo, recipientMissing: recipient.missing },
  });
}
