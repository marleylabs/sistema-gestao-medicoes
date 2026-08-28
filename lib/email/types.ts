/**
 * Tipos de evento transacional suportados pela camada central de e-mail. Lista fechada e
 * explícita de propósito — evita strings soltas espalhadas pelo projeto (ex.: "bm enviado",
 * "BM_SEND", "send_bm"). Adicionar um evento novo exige adicioná-lo aqui primeiro.
 */
export type EmailEvent =
  | "PASSWORD_RESET"
  | "BM_AVAILABLE"
  | "BM_DIVERGENCE"
  | "BM_APPROVED"
  | "BM_REVISION_REQUESTED"
  | "PAYMENT_READY"
  | "PAYMENT_COMPLETED";

export type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

export type SendTransactionalEmailInput = {
  event: EmailEvent;
  /** Destinatário(s) REAIS pretendidos pela regra de negócio — a política de teste decide se de fato vão para lá. */
  to: string[];
  /** Cópia pretendida (ex.: EMAIL_BM_CC/EMAIL_FINANCE_CC via getEmailCcForEvent) — nunca usada em modo de teste. */
  cc?: string[];
  bcc?: string[];
  content: EmailContent;
  /** Chave determinística para idempotência no Resend — nunca Date.now(). */
  idempotencyKey: string;
  /** Dados livres de auditoria (nunca segredo/senha/token) — persistidos em EmailLog.metadata. */
  metadata?: Record<string, unknown>;
};

export type SendTransactionalEmailResult =
  | { ok: true; providerMessageId: string; actualRecipients: string[]; actualCc: string[]; actualBcc: string[]; testMode: boolean }
  | { ok: false; error: string; actualRecipients: string[]; actualCc: string[]; actualBcc: string[]; testMode: boolean };
