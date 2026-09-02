import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
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

/**
 * Guarda em camadas — nunca uma variável isolada — para impedir ativação acidental em produção:
 * (1) NODE_ENV nunca pode ser "production" (docker-compose.yml da app real fixa isso
 * incondicionalmente, nunca configurável por env externa); (2) EMAIL_FAKE_PROVIDER=true precisa
 * estar explícito; (3) ALLOW_E2E_DATABASE=true precisa estar explícito — a MESMA flag que já
 * protege o guard forte de banco em lib/prisma-test.ts, nunca definida fora do webServer isolado
 * do Playwright (playwright.config.ts). As três juntas exigiriam um erro de configuração triplo
 * simultâneo em produção para disparar por engano — nenhuma delas sozinha é suficiente.
 */
function isFakeProviderAllowed() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.EMAIL_FAKE_PROVIDER === "true" &&
    process.env.ALLOW_E2E_DATABASE === "true"
  );
}

/** Mesma guarda em camadas de isFakeProviderAllowed, sem a flag de evento específica — usada só
 * para permitir a injeção de falha de lock abaixo, exclusiva de teste. */
function isTestInjectionEnvironment() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_E2E_DATABASE === "true";
}

let emailLockFailureInjected = false;

/**
 * Injeção de falha PROPOSITAL na trava de idempotência — existe só para provar, em
 * e2e/bm-email-lock-failure.spec.ts, que uma falha real de `pg_advisory_xact_lock`/transação
 * resulta em "não enviar" (política desta auditoria) e nunca em fallback sem trava. Não há como
 * derrubar de fora um advisory lock real do Postgres de forma controlada num teste E2E — este
 * toggle troca isso por um `throw` determinístico no mesmo ponto do código, sem tocar a lógica de
 * negócio real. Só pode ser ativado por app/api/admin/_test/email-lock-failure/route.ts, que por
 * sua vez só responde fora de produção com ALLOW_E2E_DATABASE=true (mesma tripla guarda de
 * isFakeProviderAllowed — nunca alcançável no container de produção real).
 */
export function __setEmailLockFailureInjectionForTests(enabled: boolean) {
  if (!isTestInjectionEnvironment()) return;
  emailLockFailureInjected = enabled;
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

type Db = PrismaClient | Prisma.TransactionClient;

async function persistLog(
  entry: {
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
  },
  db: Db = prisma,
) {
  try {
    await db.emailLog.create({
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

  /**
   * Idempotência local (além do header idempotency-key do Resend): se este evento já foi
   * efetivamente enviado com esta chave, não reenviar — evita duplo clique, retry, timeout, rota
   * executada duas vezes ou duas chamadas GENUINAMENTE SIMULTÂNEAS (duas requisições concorrentes
   * chegando quase no mesmo instante). A versão anterior fazia um `findFirst` e, só depois, um
   * `create` — sem nenhuma trava entre as duas operações. Sob concorrência real (comprovado via
   * teste de duas chamadas simultâneas a POST /api/sgc/enviar), as duas requisições passavam pelo
   * `findFirst` ANTES de qualquer uma ter persistido seu `emailLog`, então as duas concluíam que
   * "ainda não foi enviado" e as duas enviavam — gerando dois `email_logs` SENT com a MESMA
   * idempotencyKey e dois envios reais ao provedor (bug real, não hipotético).
   *
   * Correção: `pg_advisory_xact_lock(hashtext(idempotencyKey))` dentro de uma transação Prisma —
   * serializa qualquer par de chamadas com a MESMA chave (chaves diferentes nunca se bloqueiam
   * entre si, o hash é só um namespace de lock). A trava é automaticamente liberada no fim da
   * transação (commit ou rollback), nunca precisa de unlock manual. `emailLog.idempotencyKey` não
   * tem `@@unique` no schema (só `@@index`) — a trava é o mecanismo real de exclusão mútua aqui,
   * não uma constraint de banco.
   *
   * Uma falha na própria trava/transação (ex.: instabilidade momentânea do banco) NUNCA pode
   * derrubar a operação de negócio que já chamou esta função (ver bloco abaixo) — mas também NUNCA
   * pode cair de volta para um envio SEM trava: o caminho sem trava é exatamente o que foi provado
   * vulnerável a duplicação sob concorrência real (ver auditoria). Sem garantia de exclusão mútua,
   * a política passa a ser "não enviar" em vez de "enviar sem proteção" — perder uma notificação
   * pontualmente é aceitável; duplicar um e-mail para o fornecedor não é.
   */
  async function checkAndSend(db: Db): Promise<SendTransactionalEmailResult> {
    const alreadySent = await db.emailLog.findFirst({
      where: { idempotencyKey: input.idempotencyKey, status: "SENT" },
      orderBy: { createdAt: "desc" },
      select: { providerMessageId: true },
    });
    if (alreadySent?.providerMessageId) {
      return { ok: true, providerMessageId: alreadySent.providerMessageId, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
    }

    try {
      // Provider fake, exclusivo do webServer isolado do Playwright (playwright.config.ts) —
      // guarda em 3 camadas (isFakeProviderAllowed, acima) para nunca ativar em produção por
      // acidente. Sem isso, a suíte precisaria de uma RESEND_API_KEY real e faria chamadas de rede
      // reais ao Resend a cada teste de e-mail; com isso, toda a lógica real (resolução de
      // destinatário, idempotência, email_logs) continua rodando de ponta a ponta, só a chamada
      // HTTP ao provedor é substituída por uma resposta determinística em memória.
      const { data, error } = isFakeProviderAllowed()
        ? { data: { id: `fake-${input.idempotencyKey}-${Date.now()}` }, error: null }
        : await getResendClient().emails.send(
            {
              from: from!,
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
        await persistLog(
          {
            event: input.event, intendedRecipients: input.to, intendedCc, intendedBcc,
            actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode,
            subject, status: "ERROR", errorMessage: message,
            idempotencyKey: input.idempotencyKey, metadata: input.metadata,
          },
          db,
        );
        return { ok: false, error: message, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
      }

      await persistLog(
        {
          event: input.event, intendedRecipients: input.to, intendedCc, intendedBcc,
          actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode,
          subject, providerMessageId: data.id, status: "SENT",
          idempotencyKey: input.idempotencyKey, metadata: input.metadata,
        },
        db,
      );
      return { ok: true, providerMessageId: data.id, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
    } catch (e) {
      const message = sanitizeErrorMessage(e);
      console.error(`[email] ${input.event} failed`, { idempotencyKey: input.idempotencyKey, provider: "resend", errorMessage: message });
      await persistLog(
        {
          event: input.event, intendedRecipients: input.to, intendedCc, intendedBcc,
          actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode,
          subject, status: "ERROR", errorMessage: message,
          idempotencyKey: input.idempotencyKey, metadata: input.metadata,
        },
        db,
      );
      return { ok: false, error: message, actualRecipients: actual.to, actualCc: actual.cc, actualBcc: actual.bcc, testMode };
    }
  }

  try {
    if (isTestInjectionEnvironment() && emailLockFailureInjected) {
      throw new Error("[E2E] Falha de advisory lock injetada propositalmente (__setEmailLockFailureInjectionForTests).");
    }
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`;
        return checkAndSend(tx);
      },
      // O envio ao provedor (rede real) roda DENTRO da transação — precisa de folga acima do
      // timeout padrão do Prisma (5s) para não abortar a trava no meio de uma chamada HTTP lenta.
      // Registrado como melhoria futura: seria mais saudável não segurar uma conexão de banco
      // presa durante uma chamada HTTP externa — não alterado agora porque a suíte está estável e
      // o requisito imediato é fechar a janela de duplicação, não redesenhar a arquitetura.
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (e) {
    // FALHA NA PRÓPRIA INFRAESTRUTURA DE IDEMPOTÊNCIA (abrir a transação, adquirir o advisory
    // lock, ou o `findFirst` de checagem dentro dela) — NUNCA um erro de negócio do envio em si
    // (esses já são tratados e persistidos dentro de checkAndSend, sem lançar). Distinção real:
    // isto aqui é "não consigo GARANTIR exclusão mútua", não "o Resend recusou o envio"
    // (RESEND_SEND_FAILED, tratado dentro de checkAndSend com sua própria mensagem/status ERROR).
    //
    // Política (correção desta auditoria — substitui o fail-open anterior): SEM a trava, o mesmo
    // bug de duplicação sob concorrência comprovado nesta sessão (2 email_logs SENT com a mesma
    // idempotencyKey) volta a ser possível. Portanto: NUNCA chamar o provedor sem a garantia da
    // trava. Perder a notificação pontualmente (o fornecedor não recebe o e-mail desta tentativa)
    // é aceitável e recuperável (retry manual/futuro); duplicar o envio não é.
    const reason = "EMAIL_IDEMPOTENCY_LOCK_FAILED";
    const errorMessage = sanitizeErrorMessage(e);
    console.error(`[email] ${input.event} idempotency lock/transaction failed — envio BLOQUEADO (nunca enviado sem trava)`, {
      event: input.event,
      idempotencyKey: input.idempotencyKey,
      emailDelivery: "blocked",
      reason,
      errorMessage,
    });
    // Melhor esforço para registrar a tentativa bloqueada — usa o cliente Prisma normal (fora da
    // transação que falhou), sem lock, mas isso é seguro aqui porque NENHUM envio real acontece
    // neste caminho: não há risco de duplicar um envio que nunca foi feito. `persistLog` já
    // engole sua própria falha internamente (nunca lança) — se até o registro falhar, não existe
    // um segundo caminho "inseguro" para tentar de novo (item 7 da auditoria): só o log técnico
    // acima e o retorno controlado abaixo.
    await persistLog({
      event: input.event,
      intendedRecipients: input.to,
      intendedCc,
      intendedBcc,
      actualRecipients: [],
      actualCc: [],
      actualBcc: [],
      testMode,
      subject,
      status: "ERROR",
      errorMessage: `${reason}: ${errorMessage}`,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return { ok: false, error: `${reason}: falha ao garantir idempotência — e-mail NÃO enviado (nunca sem proteção contra duplicação).`, actualRecipients: [], actualCc: [], actualBcc: [], testMode };
  }
}
