/**
 * Diagnóstico SÓ LEITURA da P1 de escopo do fornecedor (docs/brain/specs/p1-escopo-fornecedor-por-identidade.md).
 *
 * Para cada usuário COLABORADOR ativo, compara a lista de aliases atual (lib/colaborador-alias.ts)
 * com a lista que a regra nova manteria (só valores que o resolver oficial liga ao próprio
 * Profissional) e conta o que sairia. Não imprime nomes nem códigos de terceiros: só o login do
 * próprio usuário afetado e contagens.
 *
 *   DATABASE_URL=... npx tsx scripts/diagnose-escopo-fornecedor.ts
 *
 * Leitura garantida pelo banco: uma única conexão com `default_transaction_read_only` ligado;
 * o script aborta se o Postgres não confirmar.
 */

type Motivo = "OUTRO_FORNECEDOR" | "AMBIGUO" | "NAO_RESOLVIDO";

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
  const { getColaboradorCodigoAliases } = await import("../lib/colaborador-alias");
  const { resolverIdentidadeOperacional } = await import("../lib/profissional-identidade");
  return { prisma, getColaboradorCodigoAliases, resolverIdentidadeOperacional };
}

async function main() {
  const { prisma, getColaboradorCodigoAliases, resolverIdentidadeOperacional } = await carregar();
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const [{ transaction_read_only: somenteLeitura }] = await prisma.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
  if (somenteLeitura !== "on") throw new Error("Conexão não ficou somente leitura — abortando.");

  const usuarios = await prisma.usuario.findMany({
    where: { perfil: "COLABORADOR", ativo: true, excluidoAt: null },
    select: { usuario: true },
    orderBy: { usuario: "asc" },
  });

  const totais = { usuarios: usuarios.length, semIdentidade: 0, afetados: 0, valoresRemovidos: { OUTRO_FORNECEDOR: 0, AMBIGUO: 0, NAO_RESOLVIDO: 0 } };
  const afetados: unknown[] = [];

  for (const { usuario } of usuarios) {
    const identidade = await resolverIdentidadeOperacional(usuario);
    if (identidade.status !== "RESOLVIDO") totais.semIdentidade += 1;
    const atual = await getColaboradorCodigoAliases(usuario);

    const removidos: Record<Motivo, number> = { OUTRO_FORNECEDOR: 0, AMBIGUO: 0, NAO_RESOLVIDO: 0 };
    // Linhas que hoje aparecem para o usuário por causa do valor removido.
    const expostasDeOutros = { bms: 0, mapa: 0 }; // valor é de outro fornecedor: vazamento atual
    const deixamDeAparecer = { bms: 0, mapa: 0 }; // valor ambíguo/não resolvido: pode ser legado legítimo
    for (const valor of atual) {
      const r = await resolverIdentidadeOperacional(valor);
      if (identidade.status === "RESOLVIDO" && r.status === "RESOLVIDO" && r.profissionalId === identidade.profissionalId) continue;
      // Sem identidade, a regra nova mantém só o login da sessão.
      if (identidade.status !== "RESOLVIDO" && valor.trim().toUpperCase() === usuario.trim().toUpperCase()) continue;
      const motivo: Motivo = r.status === "RESOLVIDO" ? "OUTRO_FORNECEDOR" : r.status;
      removidos[motivo] += 1;
      const [bms, mapa] = await Promise.all([
        prisma.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: valor } }),
        prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: valor } }),
      ]);
      const alvo = motivo === "OUTRO_FORNECEDOR" ? expostasDeOutros : deixamDeAparecer;
      alvo.bms += bms;
      alvo.mapa += mapa;
    }

    const totalRemovido = removidos.OUTRO_FORNECEDOR + removidos.AMBIGUO + removidos.NAO_RESOLVIDO;
    if (!totalRemovido) continue;
    totais.afetados += 1;
    for (const m of Object.keys(removidos) as Motivo[]) totais.valoresRemovidos[m] += removidos[m];
    afetados.push({ usuario, identidade: identidade.status, removidos, expostasDeOutros, deixamDeAparecer });
  }

  console.log(JSON.stringify({ geradoEm: new Date().toISOString(), totais, afetados }, null, 2));
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
