/**
 * Diagnóstico SÓ LEITURA da P1 de escopo do fornecedor (docs/brain/specs/p1-escopo-fornecedor-por-identidade.md).
 *
 * Para cada usuário COLABORADOR ativo, resolve cada valor da lista de aliases atual
 * (lib/colaborador-alias.ts) pelo resolver oficial e conta para quantos Profissionais distintos a
 * lista aponta, e quantos BMs/linhas do mapa vêm de cada um. Também mostra se o próprio login
 * resolve. Não imprime nomes, ids nem códigos de terceiros: só o login do próprio usuário e contagens.
 *
 *   DATABASE_URL=... npx tsx scripts/diagnose-escopo-fornecedor.ts
 *
 * Leitura garantida pelo banco: uma única conexão com `default_transaction_read_only` ligado;
 * o script aborta se o Postgres não confirmar.
 */

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

  // Por que o login não resolve? Contagens globais da tabela de Profissionais (sem nomes).
  const [profissionais] = await prisma.$queryRaw<Array<Record<string, number>>>`
    select count(*)::int as total,
           count(*) filter (where codigo is null)::int as sem_codigo,
           count(*) filter (where codigo ~ '^P[0-9]{7}$')::int as codigo_formato_login,
           count(*) filter (where codigo is not null and codigo <> trim(codigo))::int as codigo_com_espacos,
           count(*) filter (where upper(trim(codigo)) in (select upper(usuario) from usuarios where perfil = 'COLABORADOR'))::int as codigo_igual_a_login
    from profissionais where deleted_at is null`;

  const totais = {
    usuarios: usuarios.length,
    loginResolve: 0,
    // Profissionais distintos para os quais a lista ATUAL aponta: 1 = provavelmente o próprio
    // fornecedor; 2+ = a lista mistura identidades (vazamento real).
    porQtdProfissionais: {} as Record<string, number>,
    comCadastroPeloLogin: 0,
    valores: { RESOLVIDO: 0, AMBIGUO: 0, NAO_RESOLVIDO: 0 },
  };
  const misturados: unknown[] = [];

  for (const { usuario } of usuarios) {
    const login = await resolverIdentidadeOperacional(usuario);
    if (login.status === "RESOLVIDO") totais.loginResolve += 1;
    if (await prisma.cadastroFornecedor.count({ where: { colaboradorCodigo: usuario } })) totais.comCadastroPeloLogin += 1;

    const atual = await getColaboradorCodigoAliases(usuario);
    // Linhas visíveis hoje (BMs e mapa) agrupadas pelo Profissional ao qual o valor resolve.
    const grupos = new Map<string, { valores: number; bms: number; mapa: number }>();
    for (const valor of atual) {
      const r = await resolverIdentidadeOperacional(valor);
      totais.valores[r.status] += 1;
      const chave = r.status === "RESOLVIDO" ? r.profissionalId : r.status;
      const [bms, mapa] = await Promise.all([
        prisma.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: valor } }),
        prisma.mapaPagamentoItem.count({ where: { projetistaCodigo: valor } }),
      ]);
      const g = grupos.get(chave) ?? { valores: 0, bms: 0, mapa: 0 };
      grupos.set(chave, { valores: g.valores + 1, bms: g.bms + bms, mapa: g.mapa + mapa });
    }
    const distintos = [...grupos.keys()].filter((k) => k !== "AMBIGUO" && k !== "NAO_RESOLVIDO");
    const faixa = String(Math.min(distintos.length, 3)) + (distintos.length >= 3 ? "+" : "");
    totais.porQtdProfissionais[faixa] = (totais.porQtdProfissionais[faixa] ?? 0) + 1;
    if (distintos.length >= 2 || grupos.has("AMBIGUO")) {
      misturados.push({
        usuario,
        login: login.status,
        // Um item por identidade (sem ids nem nomes), do maior para o menor em linhas visíveis.
        identidades: [...grupos.entries()]
          .map(([k, g]) => ({ tipo: k === "AMBIGUO" || k === "NAO_RESOLVIDO" ? k : "PROFISSIONAL", ...g }))
          .sort((a, b) => b.bms + b.mapa - (a.bms + a.mapa)),
      });
    }
  }

  console.log(JSON.stringify({ geradoEm: new Date().toISOString(), profissionais, totais, misturados }, null, 2));
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
