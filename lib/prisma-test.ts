import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma EXCLUSIVO para a suíte de integração/E2E — nunca aponta para o banco da
 * aplicação real. Import deste módulo dispara o guard abaixo imediatamente: se qualquer condição
 * não bater, o processo aborta ANTES de qualquer fixture ser criada (item 6/7 do pedido).
 *
 * O guard exige TODAS as condições simultaneamente:
 *   1) NODE_ENV === "test"
 *   2) ALLOW_E2E_DATABASE === "true" (flag explícita, nunca implícita)
 *   3) DATABASE_URL_TEST configurada (nunca cai para DATABASE_URL)
 *   4) SELECT current_database() no Postgres real conectado é EXATAMENTE E2E_DATABASE_NAME
 *
 * Isso é mais forte que checar a string de conexão: mesmo que DATABASE_URL_TEST estivesse mal
 * configurada apontando para outro host que por coincidência tenha um banco com esse nome, ainda
 * assim só prossegue se o Postgres real confirmar o nome do banco ao qual a conexão foi feita.
 */
function loadEnvTestFile() {
  // tsx/node não carregam .env.test automaticamente — carregado manualmente aqui, uma única vez,
  // só para as chaves que ainda não estão no ambiente (nunca sobrescreve variáveis já definidas).
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const envPath = path.join(process.cwd(), ".env.test");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Sem .env.test acessível — as checagens abaixo vão falhar com uma mensagem clara mesmo assim.
  }
}
loadEnvTestFile();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[prisma-test] ${name} não configurada. Preencha .env.test (ver .env.example) antes de rodar testes de integração/E2E.`,
    );
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV;
const allowE2eDatabase = process.env.ALLOW_E2E_DATABASE;
const expectedDatabaseName = requireEnv("E2E_DATABASE_NAME");
const databaseUrlTest = requireEnv("DATABASE_URL_TEST");

if (nodeEnv !== "test") {
  throw new Error(`[prisma-test] NODE_ENV precisa ser "test" para rodar testes de integração/E2E (atual: ${JSON.stringify(nodeEnv)}).`);
}
if (allowE2eDatabase !== "true") {
  throw new Error('[prisma-test] ALLOW_E2E_DATABASE precisa ser exatamente "true" — proteção explícita contra rodar por engano.');
}
if (/\bprod(uction)?\b/i.test(databaseUrlTest)) {
  throw new Error("[prisma-test] DATABASE_URL_TEST parece apontar para produção pelo nome — abortando antes de conectar.");
}

export const prismaTest = new PrismaClient({ datasources: { db: { url: databaseUrlTest } } });

let verified = false;
/**
 * Confirma no Postgres real (não só na string de conexão) que o banco conectado é exatamente o
 * banco de testes esperado. Toda suíte que usa `prismaTest` deve chamar isto uma vez antes de
 * criar qualquer fixture (ver tests/workflow-e2e.test.ts, tests/security-audit.test.ts).
 */
export async function assertConnectedToE2eDatabase(): Promise<void> {
  if (verified) return;
  const rows = await prismaTest.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const actual = rows[0]?.current_database;
  if (actual !== expectedDatabaseName) {
    await prismaTest.$disconnect();
    throw new Error(
      `[prisma-test] SELECT current_database() retornou ${JSON.stringify(actual)}, esperado ${JSON.stringify(expectedDatabaseName)}. ` +
        "Abortando ANTES de criar qualquer fixture — isto nunca pode rodar contra o banco principal, mesmo com prefixo TESTE-.",
    );
  }
  verified = true;
}
