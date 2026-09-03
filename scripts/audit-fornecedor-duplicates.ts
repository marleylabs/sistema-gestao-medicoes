/**
 * AUDITORIA READ-ONLY de possíveis fornecedores duplicados em `cadastros_fornecedores`.
 *
 * NUNCA escreve nada — só SELECT/findMany, e NUNCA decide sozinho qual registro excluir/mesclar
 * (isso é decisão do Administrativo, feita depois de ler este relatório). Agrupa cadastros pelo
 * nome do responsável normalizado (mesma função usada pela importação real,
 * `normalizePersonName` em lib/cadastro-fornecedor.ts) e classifica cada grupo de 2+ cadastros:
 *
 *   EXACT_IDENTITY     — mesmo colaboradorCodigo canônico em 2+ linhas (identidade já idêntica;
 *                        são fisicamente registros duplicados da mesma pessoa/fornecedor).
 *   PROVAVEL_DUPLICADO — nome igual + nenhum sinal cadastral (e-mail/telefone/razão social)
 *                        contradiz entre TODOS os pares do grupo — forte evidência de mesma pessoa.
 *   AMBIGUO            — nome igual, mas os sinais são coerentes entre alguns pares e
 *                        contraditórios entre outros — não dá para decidir sem revisão humana.
 *   HOMONIMO_PROVAVEL  — nome igual, mas sinais contraditórios em TODOS os pares — provavelmente
 *                        pessoas diferentes com o mesmo nome.
 *   NAO_DUPLICADO       — nenhum outro cadastro compartilha o nome normalizado (não aparece no
 *                        relatório de grupos, só entra na contagem total).
 *
 * CNPJ participa do relatório como informação de apoio (exibido, nunca usado para decidir a
 * classificação) — mesma regra da importação real (CNPJ nunca é identidade única).
 *
 * Uso (ambiente E2E local, padrão):
 *   npx tsx scripts/audit-fornecedor-duplicates.ts
 * Uso (produção, read-only):
 *   PRODUCTION_DATABASE_URL="postgresql://medicoes_app:SENHA@127.0.0.1:15432/medicoes" npx tsx scripts/audit-fornecedor-duplicates.ts --prod
 */
import { PrismaClient } from "@prisma/client";

const useProd = process.argv.includes("--prod");
const url = useProd ? process.env.PRODUCTION_DATABASE_URL : process.env.DATABASE_URL;
if (useProd && !url) {
  console.error("[audit] --prod exige PRODUCTION_DATABASE_URL explícito.");
  process.exit(1);
}

const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();

const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function stripAccents(value: string) {
  return value.normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

function normalizePersonName(value: string | null | undefined) {
  return stripAccents(String(value ?? ""))
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function onlyDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

type Cadastro = {
  id: string;
  colaboradorCodigo: string | null;
  responsavel: string;
  razaoSocial: string;
  email: string | null;
  telefone: string | null;
  cnpjNormalizado: string;
  inicio: Date | null;
  final: Date | null;
  statusCadastro: string | null;
  updatedAt: Date;
};

function signalsContradict(a: Cadastro, b: Cadastro) {
  const emailA = (a.email ?? "").trim().toLowerCase();
  const emailB = (b.email ?? "").trim().toLowerCase();
  if (emailA && emailB && emailA !== emailB) return true;
  const telA = onlyDigits(a.telefone);
  const telB = onlyDigits(b.telefone);
  if (telA && telB && telA !== telB) return true;
  const razA = normalizePersonName(a.razaoSocial);
  const razB = normalizePersonName(b.razaoSocial);
  if (razA && razB && razA !== razB) return true;
  return false;
}

type Classificacao = "EXACT_IDENTITY" | "PROVAVEL_DUPLICADO" | "AMBIGUO" | "HOMONIMO_PROVAVEL" | "NAO_DUPLICADO";

function classifyGroup(group: Cadastro[]): Classificacao {
  if (group.length < 2) return "NAO_DUPLICADO";

  const codigos = new Set(group.map((c) => normalizePersonName(c.colaboradorCodigo ?? "")).filter(Boolean));
  const algumSemCodigo = group.some((c) => !c.colaboradorCodigo);
  if (codigos.size === 1 && !algumSemCodigo) return "EXACT_IDENTITY";

  let algumCoerente = false;
  let algumContraditorio = false;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (signalsContradict(group[i], group[j])) algumContraditorio = true;
      else algumCoerente = true;
    }
  }
  if (algumCoerente && !algumContraditorio) return "PROVAVEL_DUPLICADO";
  if (algumCoerente && algumContraditorio) return "AMBIGUO";
  return "HOMONIMO_PROVAVEL";
}

async function main() {
  if (useProd) {
    const dbInfo = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    console.log(`[audit] Conectado a: ${dbInfo[0].current_database} (confirme que é "medicoes")`);
    if (dbInfo[0].current_database !== "medicoes") {
      console.error(`[audit] ABORTANDO: esperava o banco "medicoes", encontrado "${dbInfo[0].current_database}".`);
      process.exit(1);
    }
  }

  const cadastrosRaw = await prisma.cadastroFornecedor.findMany({
    select: {
      id: true, colaboradorCodigo: true, responsavel: true, razaoSocial: true,
      email: true, telefone: true, cnpjNormalizado: true, inicio: true, final: true,
      statusCadastro: true, updatedAt: true,
    },
  });

  // email/telefone vêm criptografados no banco real — este script roda fora do runtime da app
  // (sem "server-only"/DATA_ENCRYPTION_KEY necessariamente disponível da mesma forma), então
  // compara os valores como estão: se vierem cifrados, sinais de e-mail/telefone simplesmente não
  // colidem entre registros diferentes (nunca geram falso-positivo) — na pior hipótese o script
  // fica mais conservador (menos PROVAVEL_DUPLICADO, mais AMBIGUO), nunca decide errado sozinho.
  const cadastros: Cadastro[] = cadastrosRaw;

  const grupos = new Map<string, Cadastro[]>();
  for (const c of cadastros) {
    const key = normalizePersonName(c.responsavel);
    if (!key) continue;
    const list = grupos.get(key) ?? [];
    list.push(c);
    grupos.set(key, list);
  }

  const codigosRelevantes = [...new Set(cadastros.map((c) => c.colaboradorCodigo).filter((c): c is string => !!c))];
  const relacionamentosPorCodigo = new Map<string, number>();
  if (codigosRelevantes.length > 0) {
    const orCodigo = codigosRelevantes.map((c) => ({ colaboradorCodigo: { equals: c, mode: "insensitive" as const } }));
    const orProjetista = codigosRelevantes.map((c) => ({ projetistaCodigo: { equals: c, mode: "insensitive" as const } }));
    const [sgc, mapa, div, logs] = await Promise.all([
      prisma.sgcAprovacaoMedicao.groupBy({ by: ["colaboradorCodigo"], where: { OR: orCodigo }, _count: { _all: true } }),
      prisma.mapaPagamentoItem.groupBy({ by: ["projetistaCodigo"], where: { OR: orProjetista }, _count: { _all: true } }),
      prisma.divergenciaMedicao.groupBy({ by: ["colaboradorCodigo"], where: { OR: orCodigo }, _count: { _all: true } }),
      prisma.sgcLog.groupBy({ by: ["colaboradorCodigo"], where: { OR: orCodigo }, _count: { _all: true } }),
    ]);
    const bump = (codigo: string | null, n: number) => {
      if (!codigo) return;
      const key = normalizePersonName(codigo);
      relacionamentosPorCodigo.set(key, (relacionamentosPorCodigo.get(key) ?? 0) + n);
    };
    for (const row of sgc) bump(row.colaboradorCodigo, row._count._all);
    for (const row of mapa) bump(row.projetistaCodigo, row._count._all);
    for (const row of div) bump(row.colaboradorCodigo, row._count._all);
    for (const row of logs) bump(row.colaboradorCodigo, row._count._all);
  }

  const resultados: { grupo: string; classificacao: Classificacao; membros: Cadastro[] }[] = [];
  const contagem: Record<Classificacao, number> = {
    EXACT_IDENTITY: 0, PROVAVEL_DUPLICADO: 0, AMBIGUO: 0, HOMONIMO_PROVAVEL: 0, NAO_DUPLICADO: 0,
  };

  for (const [nome, membros] of grupos) {
    const classificacao = classifyGroup(membros);
    contagem[classificacao] += membros.length === 1 ? 1 : 1; // grupos, não linhas — ver resumo final para total de linhas
    if (classificacao !== "NAO_DUPLICADO") resultados.push({ grupo: nome, classificacao, membros });
  }

  console.log("\n[audit] === GRUPOS COM POSSÍVEL DUPLICIDADE ===\n");
  let grupoNum = 0;
  for (const { grupo, classificacao, membros } of resultados) {
    grupoNum += 1;
    const maisRecente = [...membros].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    console.log(`Grupo ${grupoNum} — "${grupo}" — Classificação: ${classificacao}`);
    for (const m of membros) {
      const rel = relacionamentosPorCodigo.get(normalizePersonName(m.colaboradorCodigo ?? "")) ?? 0;
      const vigencia = `${m.inicio ? m.inicio.toISOString().slice(0, 10) : "?"} a ${m.final ? m.final.toISOString().slice(0, 10) : "?"}`;
      console.log(
        `  - id=${m.id}${m.id === maisRecente.id ? " (mais recente)" : ""} | colaboradorCodigo=${m.colaboradorCodigo ?? "(nenhum)"} | ` +
        `CNPJ=${m.cnpjNormalizado} | e-mail=${m.email ?? "-"} | tel=${m.telefone ?? "-"} | vigência=${vigencia} | ` +
        `status=${m.statusCadastro ?? "-"} | relacionamentos=${rel} | updatedAt=${m.updatedAt.toISOString()}`,
      );
    }
    console.log("");
  }

  const totalLinhasEmGrupos = resultados.reduce((acc, r) => acc + r.membros.length, 0);
  console.log("[audit] === RESUMO ===");
  console.log(`Total de fornecedores (linhas em cadastros_fornecedores): ${cadastros.length}`);
  console.log(`Grupos analisados (nomes com 2+ cadastros): ${resultados.length}`);
  console.log(`  EXACT_IDENTITY: ${resultados.filter((r) => r.classificacao === "EXACT_IDENTITY").length} grupo(s)`);
  console.log(`  PROVAVEL_DUPLICADO: ${resultados.filter((r) => r.classificacao === "PROVAVEL_DUPLICADO").length} grupo(s)`);
  console.log(`  AMBIGUO: ${resultados.filter((r) => r.classificacao === "AMBIGUO").length} grupo(s)`);
  console.log(`  HOMONIMO_PROVAVEL: ${resultados.filter((r) => r.classificacao === "HOMONIMO_PROVAVEL").length} grupo(s)`);
  console.log(`Linhas envolvidas em algum grupo de possível duplicidade: ${totalLinhasEmGrupos}`);
  console.log("\n[audit] Nenhum dado foi alterado. Nenhuma exclusão/mesclagem foi executada.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[audit] Falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
