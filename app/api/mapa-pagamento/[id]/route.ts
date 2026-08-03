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

function normalizeMatch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function cadastroOverride(cadastro: CadastroResumo | undefined) {
  if (!cadastro) return null;
  return {
    responsavel: cadastro.responsavel,
    cpfCnpj: formatCnpj(cadastro.cnpjNormalizado),
    razaoSocial: cadastro.razaoSocial,
  };
}

function cadastroByItem(item: any, cadastros: CadastroResumo[]) {
  const codigo = normalizeMatch(item.projetistaCodigo);
  const responsavel = normalizeMatch(item.responsavel);
  const cpfCnpj = onlyDigits(decryptSensitive(item.cpfCnpj));

  return cadastros.find((cadastro) => normalizeMatch(cadastro.colaboradorCodigo) === codigo)
    ?? cadastros.find((cadastro) => normalizeMatch(cadastro.responsavel) === responsavel)
    ?? cadastros.find((cadastro) => cadastro.cnpjNormalizado && cadastro.cnpjNormalizado === cpfCnpj);
}

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
      colaboradorCodigo: true,
      responsavel: true,
      razaoSocial: true,
      cnpjNormalizado: true,
    },
  });

  return NextResponse.json(serializeMapaPagamentoItem(updated, cadastroOverride(cadastroByItem(updated, cadastros))));
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await context.params;
  await prisma.mapaPagamentoItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
