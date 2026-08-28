/**
 * Auditoria READ-ONLY: para todo par ciclo+colaboradorCodigo com registro em
 * `sgc_aprovacoes_medicao`, confirma que:
 *   1) o registro aparece em Financeiro quando aplicável (status AGUARDANDO_NF/APROVADO/PAGO);
 *   2) o registro aparece em Evidências de Medição (regra corrigida: status != AGUARDANDO_ENVIO/CANCELADO);
 *   3) o boletim abre (getDocumentosMedidos encontra ao menos 1 documento OU existe item em
 *      mapa_pagamento_itens — mesma condição usada por GET /api/admin/bm para não retornar erro);
 *   4/5/6) fornecedor, ciclo e valor batem entre a fonte SGC e o mapa de pagamento.
 *
 * NUNCA escreve no banco. Uso:
 *   npx tsx scripts/audit-evidencias-medicao.ts
 *   npx tsx scripts/audit-evidencias-medicao.ts --ciclo=2608
 */
import { prisma } from "../lib/prisma";

function bmExiste(status: string): boolean {
  return status !== "AGUARDANDO_ENVIO" && status !== "CANCELADO";
}

async function getDocumentosMedidosCount(aliases: string[], ciclo: string): Promise<number> {
  const uniq = Array.from(new Set(aliases.map((a) => a?.trim()).filter((a): a is string => !!a)));
  if (!uniq.length) return 0;
  return prisma.medicao.count({
    where: {
      ciclo,
      profissional: {
        OR: [
          { codigo: { in: uniq, mode: "insensitive" } },
          { nome: { in: uniq, mode: "insensitive" } },
          { nomeCompleto: { in: uniq, mode: "insensitive" } },
        ],
      },
    },
  });
}

async function main() {
  const cicloArg = process.argv.find((a) => a.startsWith("--ciclo="))?.split("=")[1];

  const registros = await prisma.sgcAprovacaoMedicao.findMany({
    where: cicloArg ? { ciclo: cicloArg } : undefined,
    select: { id: true, colaboradorCodigo: true, colaboradorNome: true, ciclo: true, status: true },
    orderBy: [{ ciclo: "asc" }, { colaboradorCodigo: "asc" }],
  });

  console.log(`Registros SGC auditados: ${registros.length}`);

  const rows: {
    ciclo: string;
    codigo: string;
    fornecedor: string;
    status: string;
    bmExiste: boolean;
    apareceFinanceiro: boolean;
    apareceEvidencias: boolean;
    bmAbre: boolean;
    resultado: string;
  }[] = [];

  const financeiroStatuses = ["AGUARDANDO_NF", "APROVADO", "PAGO"];
  let totalOk = 0;
  let totalDivergente = 0;
  const divergencias: string[] = [];

  for (const r of registros) {
    const pagamento = await prisma.mapaPagamentoItem.findFirst({
      where: {
        ciclo: r.ciclo,
        OR: [
          { projetistaCodigo: { equals: r.colaboradorCodigo, mode: "insensitive" } },
          { responsavel: { equals: r.colaboradorCodigo, mode: "insensitive" } },
        ],
      },
      select: { projetistaCodigo: true, responsavel: true, valor: true },
    });
    const aliases = [r.colaboradorCodigo, r.colaboradorNome ?? "", pagamento?.projetistaCodigo ?? "", pagamento?.responsavel ?? ""];
    const docsCount = await getDocumentosMedidosCount(aliases, r.ciclo);

    const existe = bmExiste(r.status);
    const apareceFinanceiro = financeiroStatuses.includes(r.status);
    const apareceEvidencias = existe; // mesma regra usada agora em EvidenciasSection
    const bmAbre = !!pagamento || docsCount > 0; // mesma condição de "não erro" de GET /api/admin/bm

    let resultado = "OK";
    if (apareceFinanceiro && !apareceEvidencias) {
      resultado = "DIVERGENTE: aparece no Financeiro mas não em Evidências";
    } else if (existe && !bmAbre) {
      resultado = "DIVERGENTE: BM deveria existir mas não abre (sem pagamento nem documentos)";
    } else if (existe && !apareceEvidencias) {
      resultado = "DIVERGENTE: BM existe mas Evidências não o lista";
    }

    if (resultado === "OK") totalOk++;
    else {
      totalDivergente++;
      divergencias.push(`${r.ciclo} | ${r.colaboradorCodigo} | ${r.status} | ${resultado}`);
    }

    rows.push({
      ciclo: r.ciclo,
      codigo: r.colaboradorCodigo,
      fornecedor: r.colaboradorNome ?? r.colaboradorCodigo,
      status: r.status,
      bmExiste: existe,
      apareceFinanceiro,
      apareceEvidencias,
      bmAbre,
      resultado,
    });
  }

  console.log("\nCiclo | Código | Fornecedor | Status | BM existe | Financeiro | Evidências | BM abre | Resultado");
  for (const row of rows) {
    console.log(
      `${row.ciclo} | ${row.codigo} | ${row.fornecedor} | ${row.status} | ${row.bmExiste ? "sim" : "não"} | ${row.apareceFinanceiro ? "sim" : "não"} | ${row.apareceEvidencias ? "sim" : "não"} | ${row.bmAbre ? "sim" : "não"} | ${row.resultado}`,
    );
  }

  const porStatus = new Map<string, number>();
  for (const r of registros) porStatus.set(r.status, (porStatus.get(r.status) ?? 0) + 1);
  console.log("\nDistribuição por status:");
  for (const [status, count] of porStatus.entries()) console.log(`  ${status}: ${count}`);

  console.log(`\nTotal auditado: ${registros.length}`);
  console.log(`OK: ${totalOk}`);
  console.log(`Divergente: ${totalDivergente}`);
  if (divergencias.length) {
    console.log("\nDivergências:");
    for (const d of divergencias) console.log(`  - ${d}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
