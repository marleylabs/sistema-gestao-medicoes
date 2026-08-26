import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const codigo = request.nextUrl.searchParams.get("codigo")?.trim();
  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim();
  if (!codigo || !ciclo) {
    return NextResponse.json({ error: "codigo e ciclo são obrigatórios." }, { status: 400 });
  }

  const divergencias = await prisma.divergenciaMedicao.findMany({
    where: { colaboradorCodigo: { equals: codigo, mode: "insensitive" }, ciclo },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    divergencias.map((d) => ({
      id: d.id,
      nrVale: d.nrVale,
      idMedicaoExistente: d.idMedicaoExistente,
      documentoNaoMapeado: d.documentoNaoMapeado,
      comparacaoAmbigua: d.comparacaoAmbigua,
      formatoDivergente: d.formatoDivergente,
      a1eqDivergente: d.a1eqDivergente,
      emissaoDivergente: d.emissaoDivergente,
      tipoDivergente: d.tipoDivergente,
      equipe: {
        formato: d.equipeFormato,
        a1eqHh: d.equipeA1eqHh === null ? null : toNumber(d.equipeA1eqHh),
        percentualEmissao: d.equipePercentualEmissao === null ? null : toNumber(d.equipePercentualEmissao),
        tipo: d.equipeTipo,
      },
      fornecedor: {
        formato: d.fornecedorFormato,
        a1eqHh: toNumber(d.fornecedorA1eqHh),
        percentualEmissao: toNumber(d.fornecedorPercentualEmissao),
        tipo: d.fornecedorTipo,
      },
      status: d.status,
      observacao: d.observacao,
      resolvidoPorNome: d.resolvidoPorNome,
      resolvidoEm: d.resolvidoEm?.toISOString() ?? null,
    })),
  );
}
