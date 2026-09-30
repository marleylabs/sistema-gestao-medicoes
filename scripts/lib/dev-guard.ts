/**
 * Guardas para utilitários que ESCREVEM no banco de desenvolvimento (seed de aliases, reset dos
 * dados operacionais de teste). Recusa qualquer coisa que não seja, comprovadamente, o Postgres
 * local de desenvolvimento — nunca produção, nunca a VM, nunca o banco E2E.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type DevDatabase = { host: string; port: string; database: string };

export function parseDatabaseUrl(raw: string | undefined): DevDatabase {
  if (!raw) throw new Error("DATABASE_URL ausente.");
  const url = new URL(raw);
  return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") };
}

/**
 * Exige: NODE_ENV != production; host local; nome do banco exatamente o de desenvolvimento
 * (DEV_DATABASE_NAME, padrão "medicoes"); nunca um banco E2E/produção pelo nome; e a flag
 * explícita `allowFlag=true` no ambiente.
 */
export function assertDevDatabaseForWrite(allowFlag: string, raw = process.env.DATABASE_URL): DevDatabase {
  if (process.env.NODE_ENV === "production") throw new Error("Recusado: NODE_ENV=production.");
  const db = parseDatabaseUrl(raw);
  if (!LOCAL_HOSTS.has(db.host)) throw new Error(`Recusado: host "${db.host}" não é o Postgres local de desenvolvimento.`);
  const expected = process.env.DEV_DATABASE_NAME || "medicoes";
  if (db.database !== expected) throw new Error(`Recusado: banco "${db.database}" não é o banco de desenvolvimento "${expected}".`);
  if (/(prod|e2e|test)/i.test(db.database)) throw new Error(`Recusado: banco "${db.database}" parece produção/teste.`);
  if (process.env[allowFlag] !== "true") throw new Error(`Recusado: defina ${allowFlag}=true para permitir escrita no banco de desenvolvimento.`);
  return db;
}

/** Leitura (dry-run) também nunca fora de host local. */
export function assertLocalDatabase(raw = process.env.DATABASE_URL): DevDatabase {
  const db = parseDatabaseUrl(raw);
  if (!LOCAL_HOSTS.has(db.host)) throw new Error(`Recusado: host "${db.host}" não é local.`);
  return db;
}

export function argValue(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
