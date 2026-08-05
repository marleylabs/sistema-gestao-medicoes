import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { formatCnpj, normalizeCnpjDigits, onlyDigits, serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { encryptSensitive } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function formatCpf(value: unknown) {
  const digits = onlyDigits(String(value ?? "")).slice(0, 11);
  if (!digits) return null;
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

function formatPhone(value: unknown) {
  const digits = onlyDigits(String(value ?? "")).slice(0, 11);
  if (!digits) return null;
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  return String(value ?? "").trim() || null;
}

function normalizeEmail(value: unknown) {
  const email = text(value)?.toLowerCase() ?? null;
  if (!email) return null;
  return email;
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

  const cnpjNormalizado = normalizeCnpjDigits(body.cnpj);
  if (cnpjNormalizado.length !== 14) {
    return NextResponse.json({ error: "Informe um CNPJ válido." }, { status: 400 });
  }

  const cpfNormalizado = onlyDigits(body.cpf);
  if (cpfNormalizado && cpfNormalizado.length !== 11) {
    return NextResponse.json({ error: "Informe um CPF válido ou deixe o campo vazio." }, { status: 400 });
  }

  const telefoneNormalizado = onlyDigits(body.telefone);
  if (telefoneNormalizado && ![10, 11].includes(telefoneNormalizado.length)) {
    return NextResponse.json({ error: "Informe um telefone válido com DDD ou deixe o campo vazio." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Informe um e-mail válido ou deixe o campo vazio." }, { status: 400 });
  }

  const responsavel = text(body.responsavel);
  const razaoSocial = text(body.razaoSocial);
  if (!responsavel || !razaoSocial) {
    return NextResponse.json({ error: "Responsável e razão social são obrigatórios." }, { status: 400 });
  }

  const duplicate = await prisma.cadastroFornecedor.findFirst({
    where: { cnpjNormalizado, id: { not: id } },
    select: { responsavel: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: `CNPJ já vinculado ao cadastro de ${duplicate.responsavel}.` }, { status: 409 });
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
      cpf: encryptSensitive(formatCpf(body.cpf)),
      cnpj: encryptSensitive(formatCnpj(cnpjNormalizado)),
      email: encryptSensitive(email),
      telefone: encryptSensitive(formatPhone(body.telefone)),
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
        cpf: encryptSensitive(formatCpf(body.cpf)),
        cnpj: encryptSensitive(formatCnpj(cnpjNormalizado)),
        email: encryptSensitive(email),
        funcao: text(body.cargo),
        updatedAt: new Date(),
      },
    });
  }

  return NextResponse.json(serializeCadastroFornecedor(updated));
}
