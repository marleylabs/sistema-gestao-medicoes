import "server-only";
import { prisma } from "@/lib/prisma";
import { getResendClient } from "@/lib/email/resend-client";
import { resolveActualRecipients } from "@/lib/email/recipient-policy";
import { escapeHtml, TEST_BANNER_ANCHOR } from "@/lib/email/layout";
import { isProductionSafeAppUrl, isResendDevSender } from "@/lib/email/app-url";
import type { SendTransactionalEmailInput, SendTransactionalEmailResult } from "@/lib/email/types";

function isTestMode() {
  // Fail-safe: qualquer coisa diferente do literal "false" mantém o modo de teste ligado —
  // nunca queremos que uma env var ausente/mal escrita libere envio real por acidente.
  return process.env.EMAIL_TEST_MODE !== "false";
}

function isEmailEnabled() {
  return process.env.EMAIL_ENABLED === "true";
}

function formatAddressList(list: string[]) {
  return list.length ? escapeHtml(list.join(", ")) : "Não cadastrado";
}

function injectTestBanner(html: string, event: string, intendedTo: string[], intendedCc: string[]) {
  const ccLine = intendedCc.length ? `<br/>CC original: ${formatAddressList(intendedCc)}` : "";
  const banner = `<div style="background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;line-height:1.5;">
    <strong>AMBIENTE DE TESTE</strong><br/>
    Destinatário original: ${formatAddressList(intendedTo)}${ccLine}<br/>
    Evento: ${escapeHtml(event)}
  </div>`;
  return html.replace(TEST_BANNER_ANCHOR, banner);
}

function stripTestBannerAnchor(html: string) {
  return html.replace(TEST_BANNER_ANCHOR, "");
}

function prependTestBannerText(text: string, event: string, intendedTo: string[], intendedCc: string[]) {
  const to = intendedTo.length ? intendedTo.join(", ") : "Não cadastrado";
  const ccLine = intendedCc.length ? `\nCC original: ${intendedCc.join(", ")}` : "";
  return `AMBIENTE DE TESTE\nDestinatário original: ${to}${ccLine}\nEvento: ${event}\n\n${text}`;
}

/** Nunca deixar vazar valores que pareçam a chave do Resend (re_...) para logs/auditoria. */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error ?? {});
  return raw.replace(/re_[A-Za-z0-9_-]+/g, "re_***").slice(0, 500);
}

async function persistLog(entry: {
  event: string;
  entityType?: string;
  entityId?: string;
  intendedRecipients: string[];
  intendedCc: string[];
  intendedBcc: string[];
  actualRecipients: string[];
  actualCc: string[];
  actualBcc: string[];
  testMode: boolean;
  subject: string;
  providerMessageId?: string;
  status: "SENT" | "ERROR" | "DISABLED" | "CONFIG_ERROR";
  errorMessage?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.emailLog.create({
      data: {
        event: entry.event,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        intendedRecipients: entry.intendedRecipients,
        actualRecipients: entry.actualRecipients,
        testMode: entry.testMode,
        subject: entry.subject,
        provider: "resend",
        providerMessageId: entry.providerMessageId ?? null,
        status: entry.status,
        errorMessage: entry.errorMessage ?? null,
        idempotencyKey: entry.idempotencyKey,
        // email_logs ainda não tem colunas dedicadas para CC/BCC — guardado em metadata em vez de
        // criar migration só para isso (avaliado e descartado: o volume/uso não justifica ainda).
        metadata: {
          ...(entry.metadata ?? {}),
          intendedCc: entry.intendedCc,
          intendedBcc: entry.intendedBcc,
          actualCc: entry.actualCc,
          actualBcc: entry.actualBcc,
        } as any,
      },
    });
  } catch {
    // Auditoria nunca pode derrubar o fluxo de negócio que já concluiu.
  }
}

/**
 * ÚNICO ponto de contato com o Resend em todo o projeto. Nenhum módulo de negócio deve chamar
 * `resend.emails.send()` diretamente nem montar/neutralizar TO/CC/BCC por conta própria.
 * Responsável por: checar EMAIL_ENABLED, aplicar a política de destinatário de teste (TO/CC/BCC),
 * definir remetente, deduplicar por idempotencyKey, chamar o Resend, tratar erro sem derrubar a
 * operação de negócio que já foi concluída, e registrar tudo em EmailLog. Retorna
 * providerMessageId quando efetivamente enviado.
 */
export async function sendTransactionalEmail(input: SendTransactionalEmailInput): Promise<SendTransactionalEmailResult> {
  const testMode = isTestMode();
  const intendedCc = input.cc ?? [];
  const intendedBcc = input.bcc ?? [];

  if (!isEmailEnabled()) {
    await persistLog({
      event: input.event,
      intendedRecipients: input.to,
      intendedCc,
      intendedBcc,
      actualRecipients: [],
      actualCc: [],
      actualBcc: [],
      testMode,
      subject: input.content.subject,
      status: "DISABLED",
      errorMessage: "EMAIL_ENABLED não está definido como true.",
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return { ok: false, error: "Envio de e-mail desabilitado (EMAIL_ENABLED != true).", actualRecipients: [], actualCc: [], actualBcc: [], testMode };
  }

  // Guardas de produção: só se aplicam quando EMAIL_TEST_MODE=false (envio real). Em modo de
  // teste, APP_URL local e RESEND_FROM_EMAIL de sandbox são aceitáveis (nada sai para fora).
  // Bloqueiam o envio (nunca a operação de negócio que já chamou este envio) e registram
  // CONFIG_ERROR — nunca falham silenciosamente nem caem para um valor padrão inseguro.
  if (!testMode) {
    if (!isProductionSafeAppUrl(process.env.APP_URL)) {
      const message = "APP_URL inválida para produção (precisa ser HTTPS e não pode ser localhost/127.0.0.1/0.0.0.0).";
      await persistLog({
        event: input.event, intendedRecipients: input.to, intendedCc, intendedBcc,
        actualRecipients: [], actualCc: [], actualBcc: [], testMode,
        subject: input.content.subject, status: "CONFIG_ERROR", errorMessage: message,
        idempotencyKey: input.idempotencyKey, metadata: input.metadata,
      });
      return { ok: false, error: message, actualRecipients: [], actualCc: [], actualBcc: [], testMode };
    }
    if (isResendDevSender(process.env.RESEND_FROM_EMAIL)) {
      const message = "RESEND_FROM_EMAIL não pode usar o domínio sandbox @resend.dev em produção.";
      await persistLog({
        event: input.event, intendedRecipients: input.to, intendedCc, intendedBcc,
        actualRecipients: [], actualCc: [], actualBcc: [], testMode,
        subject: input.content.subject, status: "CONFIG_ERROR", errorMessage: message,
        idempotencyKey: input.idempotencyKey, metadata: input.metadata,
      });
      return { ok: false, error: message, actualRecipients: [], actualCc: [], actualBcc: [], testMode };
    }
  }

  const policy = resolveActualRecipients(
    { to: input.to, cc: intendedCc, bcc: intendedBcc },
    { testMode, testRecipient: process.env.EMAIL_TEST_RECIPIENT },
  );
  if (!policy.ok) {
    await persistLog({
      event: input.event,
      intendedRecipients: input.to,
      intendedCc,
      intendedBcc,
      actualRecipients: [],
      actualCc: [],
      actualBcc: [],
      testMode,
      subject: input.content.subject,
      status: "CONFIG_ERROR",
      errorMessage: policy.error,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return { ok: false, error: policy.error, actualRecipients: [], actualCc: [], actualBcc: [], testMode };
  }

  const actual = policy.actual;

  // Idempotência local (além do header idempotency-key do Resend): se este evento já foi
  // efetivamente enviado com esta chave, não reenviar — evita duplo clique, retry, timeout,
  // rota executada duas vezes ou duas chamadas simultâneas. Uma falha nesta checagem (ex.:
  // instabilidade momentânea do banco) nunca pode derrubar o disparo do e-mail nem, pior, a
  // operação de negócio que já chamou este envio — trata como "ainda não enviado" e segue.
  try {
    const alreadySent = await prisma.emailLog.findFirst({
      where: { idempotencyKey: input.idempotencyKey, status: "SENT" },
      orderBy: { createdAt: "desc" },
      select: { providerMessageId: true },
    });
    if (alreadySent?.providerMessageId) {
      return { ok: true, providerMessageId: alreadySent.providerMessageId, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
    }
  } catch (e) {
    console.error(`[email] ${input.event} idempotency check failed, proceeding as new send`, { idempotencyKey: input.idempotencyKey, errorMessage: sanitizeErrorMessage(e) });
  }

  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    await persistLog({
      event: input.event,
      intendedRecipients: input.to,
      intendedCc,
      intendedBcc,
      actualRecipients: actual.to,
      actualCc: actual.cc,
      actualBcc: actual.bcc,
      testMode,
      subject: input.content.subject,
      status: "CONFIG_ERROR",
      errorMessage: "RESEND_FROM_EMAIL não configurado.",
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return { ok: false, error: "RESEND_FROM_EMAIL não configurado.", actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
  }

  const subject = testMode ? `[TESTE] ${input.content.subject}` : input.content.subject;
  const html = testMode
    ? injectTestBanner(input.content.html, input.event, input.to, intendedCc)
    : stripTestBannerAnchor(input.content.html);
  const text = testMode
    ? prependTestBannerText(input.content.text, input.event, input.to, intendedCc)
    : input.content.text;

  const replyTo = process.env.RESEND_REPLY_TO?.trim() || undefined;

  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send(
      {
        from,
        to: actual.to,
        ...(actual.cc.length ? { cc: actual.cc } : {}),
        ...(actual.bcc.length ? { bcc: actual.bcc } : {}),
        ...(replyTo ? { replyTo } : {}),
        subject,
        html,
        text,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (error || !data?.id) {
      const message = sanitizeErrorMessage(error ?? "Resend não retornou um id de mensagem.");
      console.error(`[email] ${input.event} failed`, { idempotencyKey: input.idempotencyKey, provider: "resend", errorMessage: message });
      await persistLog({
        event: input.event,
        intendedRecipients: input.to,
        intendedCc,
        intendedBcc,
        actualRecipients: actual.to,
        actualCc: actual.cc,
        actualBcc: actual.bcc,
        testMode,
        subject,
        status: "ERROR",
        errorMessage: message,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });
      return { ok: false, error: message, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
    }

    await persistLog({
      event: input.event,
      intendedRecipients: input.to,
      intendedCc,
      intendedBcc,
      actualRecipients: actual.to,
      actualCc: actual.cc,
      actualBcc: actual.bcc,
      testMode,
      subject,
      providerMessageId: data.id,
      status: "SENT",
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return { ok: true, providerMessageId: data.id, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
  } catch (e) {
    const message = sanitizeErrorMessage(e);
    console.error(`[email] ${input.event} failed`, { idempotencyKey: input.idempotencyKey, provider: "resend", errorMessage: message });
    await persistLog({
      event: input.event,
      intendedRecipients: input.to,
      intendedCc,
      intendedBcc,
      actualRecipients: actual.to,
      actualCc: actual.cc,
      actualBcc: actual.bcc,
      testMode,
      subject,
      status: "ERROR",
      errorMessage: message,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return { ok: false, error: message, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
  }
}
