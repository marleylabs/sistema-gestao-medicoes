import "server-only";
import { Resend } from "resend";

let client: Resend | null = null;

/**
 * Instância única do Resend, criada sob demanda e só no servidor. NUNCA importar este módulo (ou
 * qualquer coisa de lib/email) de um componente client-side — a chave nunca deve alcançar o
 * bundle do navegador. Nenhum módulo de negócio deve chamar `resend.emails.send()` diretamente;
 * use `sendTransactionalEmail()` em `lib/email/send-email.ts`.
 */
export function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY não configurada.");
  if (!client) client = new Resend(apiKey);
  return client;
}
