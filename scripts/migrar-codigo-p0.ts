/**
 * Migração para o P0 como único ID do fornecedor (docs/brain/specs/p2-vinculo-login-profissional.md).
 * Por enquanto só o DRY-RUN (T1): classifica cada usuário COLABORADOR ativo e conta as linhas que
 * seriam reescritas. Imprime só contagens e o login do próprio usuário — nenhum nome nem código antigo.
 *
 *   DATABASE_URL=... npx tsx scripts/migrar-codigo-p0.ts
 *
 * Leitura garantida pelo banco: uma única conexão com `default_transaction_read_only` ligado;
 * o script aborta se o Postgres não confirmar.
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
  const { planejarMigracaoP0 } = await import("../lib/migracao-codigo-p0");
  return { prisma, planejarMigracaoP0 };
}

async function main() {
  if (process.argv.includes("--aplicar")) throw new Error("--aplicar ainda não existe (T2 do plano). Nada foi feito.");
  const { prisma, planejarMigracaoP0 } = await carregar();
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const [{ transaction_read_only: somenteLeitura }] = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
  if (somenteLeitura !== "on") throw new Error("Conexão não ficou somente leitura — abortando.");

  const { usuarios, profissionaisSemLogin } = await planejarMigracaoP0();
  const porClasse: Record<string, number> = {};
  const conflitosPorMotivo: Record<string, number> = {};
  const linhasAReescrever: Record<string, number> = {};
  const loginsParaRevisar: Record<string, string[]> = {};
  for (const u of usuarios) {
    porClasse[u.classe] = (porClasse[u.classe] ?? 0) + 1;
    if (u.motivo) conflitosPorMotivo[u.motivo] = (conflitosPorMotivo[u.motivo] ?? 0) + 1;
    if (u.classe === "MIGRAVEL") {
      for (const [tabela, n] of Object.entries(u.linhas)) linhasAReescrever[tabela] = (linhasAReescrever[tabela] ?? 0) + n;
    } else if (u.classe !== "JA_E_P0") {
      (loginsParaRevisar[u.motivo ?? u.classe] ??= []).push(u.login);
    }
  }

  console.log(JSON.stringify({
    geradoEm: new Date().toISOString(),
    modo: "DRY_RUN",
    usuarios: usuarios.length,
    porClasse,
    conflitosPorMotivo,
    linhasAReescrever,
    profissionaisSemLogin,
    loginsParaRevisar,
  }, null, 2));
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
