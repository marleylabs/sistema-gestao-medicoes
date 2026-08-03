import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { formatCnpj, onlyDigits, serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { encryptSensitive } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function dateValue(value: unknown) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return null;
  const date = new Date(`${cleaned}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const cnpjNormalizado = onlyDigits(body.cnpj);
  if (cnpjNormalizado.length !== 14) {
    return NextResponse.json({ error: "Informe um CNPJ válido." }, { status: 400 });
  }

  const responsavel = text(body.responsavel);
  const razaoSocial = text(body.razaoSocial);
  if (!responsavel || !razaoSocial) {
    return NextResponse.json({ error: "Responsável e razão social são obrigatórios." }, { status: 400 });
  }

  const duplicate = await prisma.cadastroFornecedor.findFirst({
    where: { cnpjNormalizado, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: "Já existe um cadastro com este CNPJ." }, { status: 409 });
  }

  const updated = await prisma.cadastroFornecedor.update({
    where: { id },
    data: {
      cnpjNormalizado,
      responsavel,
      razaoSocial,
      statusContrato: text(body.statusContrato),
      objetoContrato: text(body.objetoContrato),
      cargo: text(body.cargo),
      cpf: encryptSensitive(text(body.cpf)),
      cnpj: encryptSensitive(formatCnpj(cnpjNormalizado)),
      email: encryptSensitive(text(body.email)),
      telefone: encryptSensitive(text(body.telefone)),
      tipoCt: text(body.tipoCt),
      tipoContrato: text(body.tipoContrato),
      valorHora: numberValue(body.valorHora),
      valorA1Equivalente: numberValue(body.valorA1Equivalente),
      valorDocumento: numberValue(body.valorDocumento),
      inicio: dateValue(body.inicio),
      final: dateValue(body.final),
      statusCadastro: text(body.statusCadastro),
      primeiroAditivo: text(body.primeiroAditivo),
      segundoAditivo: text(body.segundoAditivo),
      updatedAt: new Date(),
    },
  });

  if (updated.colaboradorCodigo) {
    await prisma.profissional.updateMany({
      where: { codigo: updated.colaboradorCodigo },
      data: {
        nomeCompleto: responsavel,
        razaoSocial,
        cpf: encryptSensitive(text(body.cpf)),
        cnpj: encryptSensitive(formatCnpj(cnpjNormalizado)),
        email: encryptSensitive(text(body.email)),
        funcao: text(body.cargo),
        updatedAt: new Date(),
      },
    });
  }

  return NextResponse.json(serializeCadastroFornecedor(updated));
}
