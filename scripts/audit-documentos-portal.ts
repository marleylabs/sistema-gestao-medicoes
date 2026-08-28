/**
 * Auditoria READ-ONLY: para todo fornecedor+ciclo com itens em `mapa_pagamento_itens`, compara o
 * conjunto de Documentos Medidos que a Equipe vê (Editar Pagamento) contra o conjunto que o
 * Portal do Fornecedor resolveria para o mesmo fornecedor+ciclo, usando a mesma regra de
 * resolução por aliases (codigo/nome/nomeCompleto do Profissional) hoje compartilhada por
 * `lib/documentos-medidos.ts`.
 *
 * NUNCA escreve no banco. Uso:
 *   npx tsx scripts/audit-documentos-portal.ts
 *   npx tsx scripts/audit-documentos-portal.ts --ciclo=2608
 */
import { prisma } from "../lib/prisma";

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

type Medicao = {
  id: string;
  contrato: string | null;
  valorMedido: number;
  profissional: { codigo: string | null; nome: string; nomeCompleto: string | null } | null;
};

async function main() {
  const cicloArg = process.argv.find((a) => a.startsWith("--ciclo="))?.split("=")[1];

  const itens = await prisma.mapaPagamentoItem.findMany({
    where: cicloArg ? { ciclo: cicloArg } : undefined,
    select: { ciclo: true, projetistaCodigo: true, responsavel: true },
  });

  const ciclos = Array.from(new Set(itens.map((i) => i.ciclo))).sort();
  console.log(`Ciclos encontrados em mapa_pagamento_itens: ${ciclos.join(", ")}`);

  const cadastros = await prisma.cadastroFornecedor.findMany({
    select: { colaboradorCodigo: true, responsavel: true },
  });

  const rows: {
    ciclo: string;
    codigo: string;
    fornecedor: string;
    docsEquipe: number;
    docsPortal: number;
    diferenca: number;
    status: string;
  }[] = [];

  let totalOk = 0;
  let totalDivergente = 0;

  for (const ciclo of ciclos) {
    const medicoes = await prisma.medicao.findMany({
      where: { ciclo },
      select: {
        id: true,
        valorMedicao: true,
        equivalenteA1Horas: true,
        percentualEmissao: true,
        condicao: true,
        projeto: { select: { contrato: true } },
        profissional: { select: { codigo: true, nome: true, nomeCompleto: true } },
      },
    });

    // Índices em memória: uma passada única por ciclo (nada de 1 query por fornecedor).
    const porCodigo = new Map<string, typeof medicoes>();
    const porNome = new Map<string, typeof medicoes>();
    const porNomeCompleto = new Map<string, typeof medicoes>();
    for (const m of medicoes) {
      const p = m.profissional;
      if (!p) continue;
      const c = normalizeText(p.codigo);
      const n = normalizeText(p.nome);
      const nc = normalizeText(p.nomeCompleto);
      if (c) (porCodigo.get(c) ?? porCodigo.set(c, []).get(c)!).push(m);
      if (n) (porNome.get(n) ?? porNome.set(n, []).get(n)!).push(m);
      if (nc) (porNomeCompleto.get(nc) ?? porNomeCompleto.set(nc, []).get(nc)!).push(m);
    }
    function lookup(alias: string) {
      const key = normalizeText(alias);
      if (!key) return [];
      const set = new Map<string, (typeof medicoes)[number]>();
      for (const m of [...(porCodigo.get(key) ?? []), ...(porNome.get(key) ?? []), ...(porNomeCompleto.get(key) ?? [])]) {
        set.set(m.id, m);
      }
      return Array.from(set.values());
    }

    const itensDoCiclo = itens.filter((i) => i.ciclo === ciclo);
    for (const item of itensDoCiclo) {
      const codigo = item.projetistaCodigo?.trim();
      if (!codigo) continue;

      // "Equipe" (Editar Pagamento): OR(codigo,nome,nomeCompleto) contra o ÚNICO identificador
      // usado hoje pela tela — exatamente a mesma regra de app/api/mapa-pagamento/documentos.
      const docsEquipe = lookup(codigo);

      // "Portal": aliases expandidos (mesmo núcleo de lib/colaborador-alias.ts, entrando pelo
      // fornecedor em vez de por um login) — cadastro administrativo + profissional vinculado.
      const cadastro = cadastros.find(
        (c) => normalizeText(c.colaboradorCodigo) === normalizeText(codigo) || normalizeText(c.responsavel) === normalizeText(item.responsavel),
      );
      const aliases = new Set<string>([codigo]);
      if (item.responsavel) aliases.add(item.responsavel);
      if (cadastro?.colaboradorCodigo) aliases.add(cadastro.colaboradorCodigo);
      if (cadastro?.responsavel) aliases.add(cadastro.responsavel);
      const docsPortalMap = new Map<string, (typeof medicoes)[number]>();
      for (const alias of aliases) for (const m of lookup(alias)) docsPortalMap.set(m.id, m);
      const docsPortal = Array.from(docsPortalMap.values());

      const idsEquipe = new Set(docsEquipe.map((d) => d.id));
      const idsPortal = new Set(docsPortal.map((d) => d.id));
      const faltantes = [...idsEquipe].filter((id) => !idsPortal.has(id));
      const excedentes = [...idsPortal].filter((id) => !idsEquipe.has(id));

      let status: string;
      if (docsEquipe.length === 0 && docsPortal.length === 0) status = "OK_SEM_DOCUMENTOS";
      else if (docsEquipe.length > 0 && docsPortal.length === 0) status = "PORTAL_VAZIO";
      else if (faltantes.length > 0 && excedentes.length === 0) status = "DOCUMENTOS_FALTANTES";
      else if (excedentes.length > 0 && faltantes.length === 0) status = "DOCUMENTOS_EXCEDENTES";
      else if (faltantes.length > 0 && excedentes.length > 0) status = "DOCUMENTOS_DIFERENTES";
      else status = "OK";

      if (status === "OK" || status === "OK_SEM_DOCUMENTOS") totalOk++;
      else totalDivergente++;

      rows.push({
        ciclo,
        codigo,
        fornecedor: item.responsavel ?? codigo,
        docsEquipe: docsEquipe.length,
        docsPortal: docsPortal.length,
        diferenca: Math.abs(docsEquipe.length - docsPortal.length),
        status,
      });
    }
  }

  console.log(`\nCiclos analisados: ${ciclos.length}`);
  console.log(`Fornecedores/ciclo analisados: ${rows.length}`);
  console.log(`OK: ${totalOk}`);
  console.log(`Com divergência: ${totalDivergente}`);

  const problemas = rows.filter((r) => r.status !== "OK" && r.status !== "OK_SEM_DOCUMENTOS");
  if (problemas.length) {
    console.log(`\n=== Divergências encontradas (${problemas.length}) ===`);
    console.log("| Ciclo | Código | Fornecedor | Docs Equipe | Docs Portal | Diferença | Status |");
    for (const r of problemas) {
      console.log(`| ${r.ciclo} | ${r.codigo} | ${r.fornecedor} | ${r.docsEquipe} | ${r.docsPortal} | ${r.diferenca} | ${r.status} |`);
    }
  } else {
    console.log("\nNenhuma divergência encontrada.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
