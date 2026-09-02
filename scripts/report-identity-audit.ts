/**
 * Relatório READ-ONLY — compara a identidade (colaboradorCodigo/projetistaCodigo) usada pelo
 * workflow de pagamento/BM contra as fontes canônicas (CadastroFornecedor, Profissional), para
 * descobrir quantos registros JÁ EXISTENTES em produção podem estar com a mesma divergência que
 * causava o BM_AVAILABLE não enviado (ver lib/mapa-pagamento.ts:resolveProjetistaCodigo).
 *
 * NUNCA escreve nada — só SELECT/findMany. Exige PRODUCTION_DATABASE_URL explícito (nunca cai de
 * volta pra DATABASE_URL ambiente, pra nunca rodar contra o banco errado por engano).
 *
 * Uso:
 *   PRODUCTION_DATABASE_URL="postgresql://medicoes_app:SENHA@127.0.0.1:15432/medicoes" npx tsx scripts/report-identity-audit.ts
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.PRODUCTION_DATABASE_URL;
if (!url) {
  console.error("[report] Defina PRODUCTION_DATABASE_URL explicitamente antes de rodar este script.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

type Categoria = "OK" | "CASE_DIFFERENCE" | "IDENTITY_MISMATCH" | "AMBIGUOUS" | "NOT_FOUND";

function normalize(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase();
}

async function main() {
  const dbInfo = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.log(`[report] Conectado a: ${dbInfo[0].current_database} (confirme que é "medicoes", nunca "medicoes_e2e")`);
  if (dbInfo[0].current_database !== "medicoes") {
    console.error(`[report] ABORTANDO: esperava o banco "medicoes", encontrado "${dbInfo[0].current_database}".`);
    process.exit(1);
  }

  const [itensMapa, sgcs, cadastros, profissionais] = await Promise.all([
    prisma.mapaPagamentoItem.findMany({
      where: { projetistaCodigo: { not: null } },
      select: { id: true, ciclo: true, projetistaCodigo: true, responsavel: true },
    }),
    prisma.sgcAprovacaoMedicao.findMany({
      select: { colaboradorCodigo: true, ciclo: true, status: true },
    }),
    prisma.cadastroFornecedor.findMany({
      select: { colaboradorCodigo: true, responsavel: true, email: true },
    }),
    prisma.profissional.findMany({
      select: { codigo: true, nome: true, nomeCompleto: true, email: true },
    }),
  ]);

  const profissionalByCodigoExato = new Map(profissionais.filter((p) => p.codigo).map((p) => [p.codigo as string, p]));
  // Mesma regra de resolveProjetistaCodigo() real (lib/mapa-pagamento.ts): também busca por
  // nome/nomeCompleto, não só codigo — um MapaPagamentoItem legado pode ter sido gravado com o
  // NOME do fornecedor em vez do código sequencial (mesma causa do bug original). Reportar
  // NOT_FOUND só por não bater com `codigo` seria um falso positivo se o nome bate.
  const profissionaisPorTextoNormalizado = new Map<string, typeof profissionais>();
  for (const p of profissionais) {
    for (const campo of [p.codigo, p.nome, p.nomeCompleto]) {
      if (!campo) continue;
      const key = normalize(campo);
      const atual = profissionaisPorTextoNormalizado.get(key) ?? [];
      if (!atual.includes(p)) profissionaisPorTextoNormalizado.set(key, [...atual, p]);
    }
  }
  const cadastroByCodigoExato = new Map(cadastros.filter((c) => c.colaboradorCodigo).map((c) => [c.colaboradorCodigo as string, c]));

  // Universo de identidades a checar: toda combinação (projetistaCodigo, ciclo) de MapaPagamentoItem
  // + todo colaboradorCodigo de SgcAprovacaoMedicao que não apareça já coberto por um item de mapa.
  const chaves = new Map<string, { codigo: string; ciclo: string; responsavel: string | null; origem: string; status?: string }>();
  for (const item of itensMapa) {
    chaves.set(`${item.projetistaCodigo}::${item.ciclo}`, { codigo: item.projetistaCodigo!, ciclo: item.ciclo, responsavel: item.responsavel, origem: "MapaPagamentoItem" });
  }
  for (const sgc of sgcs) {
    const k = `${sgc.colaboradorCodigo}::${sgc.ciclo}`;
    if (!chaves.has(k)) chaves.set(k, { codigo: sgc.colaboradorCodigo, ciclo: sgc.ciclo, responsavel: null, origem: "SgcAprovacaoMedicao", status: sgc.status });
  }

  const contagem: Record<Categoria, number> = { OK: 0, CASE_DIFFERENCE: 0, IDENTITY_MISMATCH: 0, AMBIGUOUS: 0, NOT_FOUND: 0 };
  const linhas: { codigo: string; ciclo: string; categoria: Categoria; emailResolvivel: boolean; origem: string; status?: string }[] = [];

  for (const { codigo, ciclo, origem, status } of chaves.values()) {
    let categoria: Categoria;
    let canonico: string | undefined;

    const exato = profissionalByCodigoExato.get(codigo);
    if (exato) {
      categoria = "OK";
      canonico = exato.codigo!;
    } else {
      const candidatos = profissionaisPorTextoNormalizado.get(normalize(codigo)) ?? [];
      // Mesma regra de resolveProjetistaCodigo() real: cai para `nome` quando `codigo` é NULL —
      // muitos Profissional legados de produção nunca tiveram essa coluna preenchida, e `nome` já
      // é a identidade de fato usada nesses casos (ver comentário lá).
      const distintos = Array.from(new Set(candidatos.map((c) => c.codigo ?? c.nome).filter((c): c is string => !!c)));
      if (distintos.length === 0) {
        categoria = "NOT_FOUND";
      } else if (distintos.length > 1) {
        categoria = "AMBIGUOUS";
      } else {
        categoria = "CASE_DIFFERENCE";
        canonico = distintos[0]!;
      }
    }

    // Além da grafia bater com Profissional, precisa bater com CadastroFornecedor.colaboradorCodigo
    // (fonte usada por resolveFornecedorEmail) usando a MESMA comparação exata que o código real usa.
    if (categoria === "OK" && canonico && !cadastroByCodigoExato.has(canonico)) {
      categoria = "IDENTITY_MISMATCH";
    }

    const emailResolvivel =
      (canonico && cadastroByCodigoExato.get(canonico)?.email != null) ||
      (canonico && profissionalByCodigoExato.get(canonico)?.email != null) ||
      false;

    contagem[categoria] += 1;
    linhas.push({ codigo, ciclo, categoria, emailResolvivel: !!emailResolvivel, origem, status });
  }

  console.log("\n[report] === RESUMO ===");
  console.table(contagem);

  const problemas = linhas.filter((l) => l.categoria !== "OK");
  console.log(`\n[report] === REGISTROS COM DIVERGÊNCIA (${problemas.length}) ===`);
  console.table(
    problemas.map((l) => ({
      codigo: l.codigo,
      ciclo: l.ciclo,
      categoria: l.categoria,
      emailResolvivel: l.emailResolvivel,
      origem: l.origem,
      status: l.status ?? "-",
    })),
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[report] Falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
