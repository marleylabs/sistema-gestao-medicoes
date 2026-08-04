import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { formatCnpj, onlyDigits } from "@/lib/cadastro-fornecedor";
import { decryptSensitive } from "@/lib/encryption";

type CadastroResumo = {
  colaboradorCodigo: string | null;
  responsavel: string;
  razaoSocial: string;
  cnpjNormalizado: string;
};

type CadastroMatch = {
  cadastro: CadastroResumo;
  match: "codigo" | "responsavel" | "cnpj";
};

function normalizeMatch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function cadastroOverride(result: CadastroMatch | undefined) {
  if (!result) return null;
  const { cadastro, match } = result;
  return {
    responsavel: match === "cnpj" ? null : cadastro.responsavel,
    cpfCnpj: formatCnpj(cadastro.cnpjNormalizado),
    razaoSocial: cadastro.razaoSocial,
  };
}

function cadastroByItem(item: any, cadastros: CadastroResumo[]): CadastroMatch | undefined {
  const codigo = normalizeMatch(item.projetistaCodigo);
  const responsavel = normalizeMatch(item.responsavel);
  const cpfCnpj = onlyDigits(decryptSensitive(item.cpfCnpj));

  const byCodigo = cadastros.find((cadastro) => normalizeMatch(cadastro.colaboradorCodigo) === codigo);
  if (byCodigo) return { cadastro: byCodigo, match: "codigo" };

  const byResponsavel = cadastros.find((cadastro) => normalizeMatch(cadastro.responsavel) === responsavel);
  if (byResponsavel) return { cadastro: byResponsavel, match: "responsavel" };

  const byCnpj = cadastros.find((cadastro) => cadastro.cnpjNormalizado && cadastro.cnpjNormalizado === cpfCnpj);
  if (byCnpj) return { cadastro: byCnpj, match: "cnpj" };

  return undefined;
}

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
      valor: { gt: 0 },
    },
    orderBy: [{ ciclo: "desc" }, { ordem: "asc" }],
  });
  const cadastros = await prisma.cadastroFornecedor.findMany({
    select: {
      colaboradorCodigo: true,
      responsavel: true,
      razaoSocial: true,
      cnpjNormalizado: true,
    },
  });

  return NextResponse.json(itens.map((item) => serializeMapaPagamentoItem(item, cadastroOverride(cadastroByItem(item, cadastros)))));
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

  return NextResponse.json(serializeMapaPagamentoItem(created), { status: 201 });
}
