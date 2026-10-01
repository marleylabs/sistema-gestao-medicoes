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
    include: { sgc: { select: { conferenciaArquivoNome: true, conferenciaCarregadoAt: true } } },
  });
  // Extensão retrocompatível do DTO (campos novos, nenhum removido): NR VALE como está no documento
  // da equipe (o matching usa o NR VALE normalizado) e o arquivo da conferência já gravado no BM.
  const idsMedicao = divergencias.map((d) => d.idMedicaoExistente).filter((id): id is string => !!id);
  const medicoes = idsMedicao.length
    ? await prisma.medicao.findMany({ where: { id: { in: idsMedicao } }, select: { id: true, numeroDocumento: true } })
    : [];
  const nrValeEquipe = new Map(medicoes.map((m) => [m.id, m.numeroDocumento]));

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
        nrVale: d.idMedicaoExistente ? nrValeEquipe.get(d.idMedicaoExistente) ?? null : null,
        formato: d.equipeFormato,
        a1eqHh: d.equipeA1eqHh === null ? null : toNumber(d.equipeA1eqHh),
        percentualEmissao: d.equipePercentualEmissao === null ? null : toNumber(d.equipePercentualEmissao),
        tipo: d.equipeTipo,
      },
      fornecedor: {
        nrVale: d.nrVale,
        formato: d.fornecedorFormato,
        a1eqHh: toNumber(d.fornecedorA1eqHh),
        percentualEmissao: toNumber(d.fornecedorPercentualEmissao),
        tipo: d.fornecedorTipo,
      },
      status: d.status,
      observacao: d.observacao,
      resolvidoPorNome: d.resolvidoPorNome,
      resolvidoEm: d.resolvidoEm?.toISOString() ?? null,
      arquivo: {
        nome: d.sgc.conferenciaArquivoNome,
        carregadoEm: d.sgc.conferenciaCarregadoAt?.toISOString() ?? null,
      },
    })),
  );
}
