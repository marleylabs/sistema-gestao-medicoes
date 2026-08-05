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

function samePersonMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeMatch(left);
  const b = normalizeMatch(right);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
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

  const byCodigo = cadastros.find((cadastro) => samePersonMatch(cadastro.colaboradorCodigo, item.projetistaCodigo));
  if (byCodigo) return { cadastro: byCodigo, match: "codigo" };

  const byResponsavel = cadastros.find((cadastro) => samePersonMatch(cadastro.responsavel, item.responsavel));
  if (byResponsavel) return { cadastro: byResponsavel, match: "responsavel" };

  const byCnpj = cadastros.filter((cadastro) => cadastro.cnpjNormalizado && cadastro.cnpjNormalizado === cpfCnpj);
  if (byCnpj.length === 1) return { cadastro: byCnpj[0], match: "cnpj" };

  return undefined;
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
