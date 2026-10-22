/**
 * Mescla as conversas duplicadas de cada fornecedor no chat (lib/chat-mesclar-duplicadas.ts).
 * Imprime só contagens, ids de conversa e logins (P0), sem nomes nem texto de mensagens.
 *
 *   DATABASE_URL=... npx tsx scripts/mesclar-chat-duplicado.ts            # dry-run (só leitura)
 *   DATABASE_URL=... npx tsx scripts/mesclar-chat-duplicado.ts --aplicar  # faça backup antes
 *
 * O dry-run abre uma única conexão com `default_transaction_read_only` ligado e aborta se o Postgres
 * não confirmar.
 */
export {}; // módulo próprio, como em scripts/migrar-codigo-p0.ts

async function main() {
  const aplicar = process.argv.slice(2).includes("--aplicar");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("connection_limit", "1");
  process.env.DATABASE_URL = url.toString();

  const { PrismaClient } = await import("@prisma/client");
  const { planejarMesclagemChat, aplicarMesclagemChat } = await import("../lib/chat-mesclar-duplicadas");
  const prisma = new PrismaClient();
  try {
    if (!aplicar) {
      await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      const [{ transaction_read_only: somenteLeitura }] = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
      if (somenteLeitura !== "on") throw new Error("Conexão não ficou somente leitura — abortando.");
    }
    const grupos = await planejarMesclagemChat(prisma);
    const geradoEm = new Date().toISOString();
    if (!aplicar) {
      console.log(JSON.stringify({ geradoEm, modo: "DRY_RUN", fornecedoresComDuplicata: grupos.length, grupos }, null, 2));
      return;
    }
    console.log(JSON.stringify({ geradoEm, modo: "APLICAR", ...(await aplicarMesclagemChat(prisma, grupos)) }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
