import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// tsx/next-dev não carregam .env* sozinhos — mesmo carregador manual usado em lib/prisma-test.ts.
// Carrega .env primeiro (segredos de app: AUTH_SESSION_SECRET, DATA_ENCRYPTION_KEY — o valor em
// si não é sensível aqui, só precisa ter o formato certo; nenhum dado real é decifrado com ele no
// banco E2E) e depois .env.test (nunca sobrescreve o que já foi definido).
function loadEnvFile(filename: string) {
  const envPath = path.join(__dirname, filename);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(".env");
loadEnvFile(".env.test");

const OFFICIAL_PRODUCTION_URL = "smfprojeta.boingaestrutural.com";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3011";

// Guarda explícita (item 52 do pedido): a suíte é mutável (login, uploads, aprovações, pagamento)
// — nunca pode rodar contra a URL oficial de produção, mesmo que alguém troque PLAYWRIGHT_BASE_URL
// por engano. Aborta ANTES de qualquer teste rodar.
if (baseURL.includes(OFFICIAL_PRODUCTION_URL)) {
  throw new Error(
    `[playwright.config] PLAYWRIGHT_BASE_URL aponta para a URL oficial de produção (${OFFICIAL_PRODUCTION_URL}) — a suíte E2E é mutável e nunca pode rodar ali. Abortando.`,
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // os specs compartilham o mesmo seed/ciclo E2E — evita corrida entre eles.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Sobe a app apontando para o Postgres E2E isolado — nunca o banco/porta da aplicação real.
    command: "npm run dev -- -p 3011",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: "development",
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
      APP_URL: baseURL,
      AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET ?? "e2e-session-secret-com-pelo-menos-32-caracteres",
      AUTH_COOKIE_SECURE: "false",
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? "",
      // EMAIL_ENABLED=true + EMAIL_FAKE_PROVIDER=true: a suíte precisa poder auditar o pipeline
      // real de e-mail (resolução de destinatário, idempotência, email_logs — investigação do
      // BM_AVAILABLE não enviado para fornecedor manual) sem nunca tocar a rede real nem exigir
      // uma RESEND_API_KEY — EMAIL_FAKE_PROVIDER faz lib/email/send-email.ts responder de forma
      // determinística em memória em vez de chamar o SDK do Resend (ver comentário lá).
      EMAIL_ENABLED: "true",
      EMAIL_TEST_MODE: "true",
      EMAIL_TEST_RECIPIENT: "e2e-test-recipient@example.test",
      EMAIL_FAKE_PROVIDER: "true",
      // Mesmos endereços de produção (.env) — seguro aqui porque EMAIL_TEST_MODE=true faz
      // resolveActualRecipients() zerar CC/BCC reais sempre (lib/email/recipient-policy.ts);
      // o CC pretendido só fica auditável em email_logs.metadata.intendedCc, nunca é
      // efetivamente enviado a ninguém. Existe aqui para a suíte poder provar a política de CC
      // (getEmailCcForEvent) de ponta a ponta contra o pipeline real de e-mail.
      EMAIL_BM_CC: "gabriel.sousa@projetacs.com,anderson.marley@projetacs.com,planejamentoprojetacs@gmail.com",
      EMAIL_FINANCE_CC: "financeiro@projetacs.com,ximenes.silva@projetacs.com,finanprojetacs@gmail.com",
      // Explícito aqui (não só herdado do processo pai) — isFakeProviderAllowed() em
      // lib/email/send-email.ts exige as três: NODE_ENV != production, EMAIL_FAKE_PROVIDER=true
      // E esta flag juntas. A mesma flag já protege o guard forte de banco em lib/prisma-test.ts.
      ALLOW_E2E_DATABASE: "true",
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "En Passant <e2e@example.test>",
      // A suíte completa loga com as MESMAS contas de teste dezenas de vezes (cada spec de
      // workflow faz múltiplos login/logout) — o rate limit real de /api/auth/login (8 tentativas
      // /15min por IP+usuário) é correto em produção mas dispara 429 nesse volume de reuso. Só
      // desliga aqui, nunca em produção (nada fora deste webServer define esta variável).
      AUTH_RATE_LIMIT_DISABLED: "true",
      ETL_SERVER_URL: process.env.ETL_SERVER_URL ?? "http://127.0.0.1:4000",
    },
  },
});
