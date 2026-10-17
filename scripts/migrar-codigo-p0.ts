/**
 * Migração para o P0 como único ID do fornecedor (docs/brain/specs/p2-vinculo-login-profissional.md).
 * Imprime só contagens e logins (P0) — nenhum nome nem código antigo.
 *
 *   DATABASE_URL=... npx tsx scripts/migrar-codigo-p0.ts                 # dry-run (só leitura)
 *   DATABASE_URL=... npx tsx scripts/migrar-codigo-p0.ts --medir         # confere os migrados (só leitura)
 *   DATABASE_URL=... MIGRACAO_P0_ADMIN=P0xxxxxx npx tsx scripts/migrar-codigo-p0.ts --aplicar
 *   DATABASE_URL=... MIGRACAO_P0_ADMIN=P0xxxxxx npx tsx scripts/migrar-codigo-p0.ts --reverter
 *
 * `--login=P0xxxxxx` (repetível) limita a esses fornecedores. Aplicar e reverter exigem backup antes
 * e janela sem importação; o ADMIN informado fica na auditoria. Dry-run e medição abrem uma única
 * conexão com `default_transaction_read_only` ligado e abortam se o Postgres não confirmar.
 */
export {}; // módulo próprio: sem isso, as funções colidem com as de scripts/diagnose-escopo-fornecedor.ts no tsc

function urlSomenteUmaConexao(raw: string | undefined): string {
  if (!raw) throw new Error("DATABASE_URL não configurada.");
  const url = new URL(raw);
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}

async function carregar() {
  // Módulos do app declaram "server-only" — neutralizado como nos demais scripts.
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  process.env.DATABASE_URL = urlSomenteUmaConexao(process.env.DATABASE_URL);
  const { prisma } = await import("../lib/prisma");
  const migracao = await import("../lib/migracao-codigo-p0");
  return { prisma, ...migracao };
}

async function main() {
  const args = process.argv.slice(2);
  const modos = ["--aplicar", "--medir", "--reverter"].filter((m) => args.includes(m));
  if (modos.length > 1) throw new Error("Use um modo por vez.");
  const modo = modos[0] ?? "--dry-run";
  const logins = args.filter((a) => a.startsWith("--login=")).map((a) => a.slice("--login=".length).trim().toUpperCase());
  const filtro = logins.length ? logins : undefined;

  const { prisma, planejarMigracaoP0, aplicarMigracaoP0, medirMigracaoP0, reverterMigracaoP0 } = await carregar();
  const escreve = modo === "--aplicar" || modo === "--reverter";
  if (!escreve) {
    await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const [{ transaction_read_only: somenteLeitura }] = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
    if (somenteLeitura !== "on") throw new Error("Conexão não ficou somente leitura — abortando.");
  }
  const adminLogin = process.env.MIGRACAO_P0_ADMIN ?? "";
  const geradoEm = new Date().toISOString();

  if (modo === "--aplicar") {
    console.log(JSON.stringify({ geradoEm, modo: "APLICAR", ...(await aplicarMigracaoP0({ adminLogin, logins: filtro })) }, null, 2));
  } else if (modo === "--reverter") {
    console.log(JSON.stringify({ geradoEm, modo: "REVERTER", ...(await reverterMigracaoP0({ adminLogin, logins: filtro })) }, null, 2));
  } else if (modo === "--medir") {
    const medicao = await medirMigracaoP0({ logins: filtro });
    const comProblema = medicao.filter((m) => !m.ok);
    console.log(JSON.stringify({ geradoEm, modo: "MEDIR", migrados: medicao.length, ok: medicao.length - comProblema.length, comProblema }, null, 2));
  } else {
    const { usuarios, profissionaisSemLogin } = await planejarMigracaoP0();
    const porClasse: Record<string, number> = {};
    const conflitosPorMotivo: Record<string, number> = {};
    const linhasAReescrever: Record<string, number> = {};
    const loginsParaRevisar: Record<string, string[]> = {};
    for (const u of usuarios.filter((x) => !filtro || filtro.includes(x.login))) {
      porClasse[u.classe] = (porClasse[u.classe] ?? 0) + 1;
      if (u.motivo) conflitosPorMotivo[u.motivo] = (conflitosPorMotivo[u.motivo] ?? 0) + 1;
      if (u.classe === "MIGRAVEL") {
        for (const [tabela, n] of Object.entries(u.linhas)) linhasAReescrever[tabela] = (linhasAReescrever[tabela] ?? 0) + n;
      } else if (u.classe !== "JA_E_P0") {
        (loginsParaRevisar[u.motivo ?? u.classe] ??= []).push(u.login);
      }
    }
    console.log(JSON.stringify({ geradoEm, modo: "DRY_RUN", usuarios: usuarios.length, porClasse, conflitosPorMotivo, linhasAReescrever, profissionaisSemLogin, loginsParaRevisar }, null, 2));
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
