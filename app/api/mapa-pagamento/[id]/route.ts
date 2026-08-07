import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { cadastroFornecedorOverrideForMapaItem } from "@/lib/mapa-pagamento-cadastro";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await context.params;
  const current = await prisma.mapaPagamentoItem.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Pagamento não encontrado." }, { status: 404 });

  const payload = await request.json();
  const updated = await prisma.mapaPagamentoItem.update({
    where: { id },
    data: {
      ...mapaPagamentoData(payload, current.sourceRowHash),
      updatedAt: new Date(),
    },
  });
  const cadastros = await prisma.cadastroFornecedor.findMany({
    select: {
      id: true,
      colaboradorCodigo: true,
      responsavel: true,
      razaoSocial: true,
      cnpjNormalizado: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(serializeMapaPagamentoItem(updated, cadastroFornecedorOverrideForMapaItem(updated, cadastros)));
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await context.params;
  await prisma.mapaPagamentoItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
