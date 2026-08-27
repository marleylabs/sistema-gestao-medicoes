import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { calcularValorMedido } from "@/lib/mapa-pagamento";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { se, contrato, numeroDocumento, formato, equivalenteA1Horas, percentualEmissao, tipo2, condicao, obs } = body ?? {};

  const existing = await prisma.medicao.findUnique({
    where: { id },
    select: { idProjeto: true, projeto: { select: { codigoProjeto: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

  if (se !== undefined && se !== existing.projeto.codigoProjeto) {
    const codigoProjeto = (se as string).trim();
    const projeto = await prisma.projeto.upsert({
      where: { codigoProjeto },
      create: { codigoProjeto, contrato: (contrato as string | undefined) ?? null },
      update: { contrato: (contrato as string | undefined) ?? null },
    });
    await prisma.medicao.update({ where: { id }, data: { idProjeto: projeto.id } });
  } else if (contrato !== undefined) {
    await prisma.projeto.update({
      where: { id: existing.idProjeto },
      data: { contrato: contrato ?? null },
    });
  }

  const updated = await prisma.medicao.update({
    where: { id },
    data: {
      ...(numeroDocumento !== undefined ? { numeroDocumento: numeroDocumento ?? null } : {}),
      ...(formato !== undefined ? { formato: formato ?? null } : {}),
      ...(equivalenteA1Horas !== undefined ? { equivalenteA1Horas } : {}),
      ...(percentualEmissao !== undefined ? { percentualEmissao } : {}),
      ...(tipo2 !== undefined ? { tipo2: tipo2 ?? null } : {}),
      ...(condicao !== undefined ? { condicao: String(condicao ?? "0") } : {}),
      ...(obs !== undefined ? { obs: obs || null } : {}),
    },
    select: {
      id: true, numeroDocumento: true, formato: true, obs: true,
      equivalenteA1Horas: true, percentualEmissao: true, tipo2: true, condicao: true,
      projeto: { select: { codigoProjeto: true, contrato: true } },
    },
  });

  const { a1eq, pct, preco, valorMedido } = calcularValorMedido(updated);

  return NextResponse.json({
    id: updated.id,
    se: updated.projeto.codigoProjeto,
    contrato: updated.projeto.contrato,
    numeroDocumento: updated.numeroDocumento,
    formato: updated.formato,
    equivalenteA1Horas: a1eq,
    percentualEmissao: pct,
    tipo2: updated.tipo2,
    condicao: updated.condicao,
    obs: updated.obs,
    precoUnitario: preco,
    valorMedido,
  });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await params;
  await prisma.medicao.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
