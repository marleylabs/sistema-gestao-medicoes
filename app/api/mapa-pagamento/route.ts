import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { cadastroFornecedorOverrideForMapaItem } from "@/lib/mapa-pagamento-cadastro";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";
  const isGeral = ciclo === "GERAL";
  const ciclosCadastrados = await prisma.mapaPagamentoContexto.findMany({
    select: { ciclo: true },
  });
  const ciclosPermitidos = ciclosCadastrados.map((item) => item.ciclo);

  if (isGeral && ciclosPermitidos.length === 0) {
    return NextResponse.json([]);
  }

  if (!isGeral && !ciclosPermitidos.includes(ciclo)) {
    return NextResponse.json([]);
  }

  const itens = await prisma.mapaPagamentoItem.findMany({
    where: {
      ...(isGeral ? { ciclo: { in: ciclosPermitidos } } : { ciclo }),
    },
    orderBy: [{ ciclo: "desc" }, { ordem: "asc" }],
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

  return NextResponse.json(itens.map((item) => serializeMapaPagamentoItem(item, cadastroFornecedorOverrideForMapaItem(item, cadastros))));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json();
  const ciclo = typeof payload.ciclo === "string" ? payload.ciclo.trim() : "2605";

  const maxOrdem = await prisma.mapaPagamentoItem.aggregate({
    where: { ciclo },
    _max: { ordem: true },
  });
  const nextOrdem = (maxOrdem._max.ordem ?? 0) + 1;

  const created = await prisma.mapaPagamentoItem.create({
    data: mapaPagamentoData({ ...payload, ciclo, ordem: nextOrdem }),
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

  return NextResponse.json(serializeMapaPagamentoItem(created, cadastroFornecedorOverrideForMapaItem(created, cadastros)), { status: 201 });
}
