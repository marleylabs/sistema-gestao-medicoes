import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { formatCnpj, normalizeCnpjDigits, onlyDigits, serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { validateTipoCondicaoFixaForWrite } from "@/lib/condicao-fixa";
import { validateFonteMedicaoForWrite } from "@/lib/fonte-medicao";
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
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\./g, "").replace(",", ".").trim();
  if (!text) return null;
  const numeric = Number(text);
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

  // Escrita administrativa: valor desconhecido/mal digitado nunca vira "FIXA"/"DOCUMENTOS" em
  // silêncio — só NULL/undefined/"" (ausência explícita) é um default legítimo aqui. Validado
  // ANTES de qualquer prisma.update — payload inválido nunca persiste alteração parcial.
  const tipoCondicaoFixaResult = validateTipoCondicaoFixaForWrite(body.tipoCondicaoFixa);
  if (!tipoCondicaoFixaResult.ok) {
    return NextResponse.json({ error: tipoCondicaoFixaResult.error }, { status: 400 });
  }
  const tipoCondicaoFixa = tipoCondicaoFixaResult.value;
  const valorCondicaoFixaComProducao = numberValue(body.valorCondicaoFixaComProducao);
  const valorCondicaoFixaSemProducao = numberValue(body.valorCondicaoFixaSemProducao);
  if (
    tipoCondicaoFixa === "CONDICIONAL_PRODUCAO" &&
    (valorCondicaoFixaComProducao === null || valorCondicaoFixaSemProducao === null)
  ) {
    return NextResponse.json(
      { error: "Condição fixa condicional por produção exige os dois valores (com produção e sem produção)." },
      { status: 400 },
    );
  }

  const fonteMedicaoResult = validateFonteMedicaoForWrite(body.fonteMedicao);
  if (!fonteMedicaoResult.ok) {
    return NextResponse.json({ error: fonteMedicaoResult.error }, { status: 400 });
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
      valorCondicaoFixa: numberValue(body.valorCondicaoFixa),
      tipoCondicaoFixa,
      valorCondicaoFixaComProducao,
      valorCondicaoFixaSemProducao,
      fonteMedicao: fonteMedicaoResult.value,
      inicio: dateValue(body.inicio),
      final: dateValue(body.final),
      statusCadastro: text(body.statusCadastro),
      primeiroAditivo: text(body.primeiroAditivo),
      segundoAditivo: text(body.segundoAditivo),
      updatedAt: new Date(),
    },
  });

  if (updated.colaboradorCodigo) {
    const colaboradorCodigo = updated.colaboradorCodigo;
    // upsert (não updateMany) — a edição administrativa de um CadastroFornecedor é ação explícita
    // do ADMIN sobre aquele vínculo, então precisa criar ou reativar o Profissional correspondente
    // quando ele não existir (ou estiver excluído), do contrário o fornecedor fica invisível para
    // Novo Pagamento/seletores mesmo com o cadastro administrativo íntegro. Mesmo padrão já usado
    // em upsertCadastroFornecedor (lib/cadastro-fornecedor.ts) para import em massa/criação manual.
    await prisma.profissional.upsert({
      where: { codigo: colaboradorCodigo },
      create: {
        nome: colaboradorCodigo,
        codigo: colaboradorCodigo,
        nomeCompleto: responsavel,
        razaoSocial,
        cpf: encryptSensitive(formatCpf(body.cpf)),
        cnpj: encryptSensitive(formatCnpj(cnpjNormalizado)),
        email: encryptSensitive(email),
        funcao: text(body.cargo),
      },
      update: {
        nome: colaboradorCodigo,
        deletedAt: null,
        deletedById: null,
        deletedByNome: null,
        deletedReason: null,
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
