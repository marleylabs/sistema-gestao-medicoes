import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { isValidEmail } from "@/lib/usuario-email-policy";
import { normalizeCnpjDigits, serializeCadastroFornecedor, upsertCadastroFornecedor, type CadastroRow } from "@/lib/cadastro-fornecedor";

function text(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  // Whitelist explícita — nunca `data: body` direto (mass assignment). Só os campos abaixo chegam
  // ao serviço compartilhado com a importação; qualquer outra chave no payload é ignorada.
  const responsavel = text((body as Record<string, unknown>).responsavel);
  const cnpjNormalizado = normalizeCnpjDigits((body as Record<string, unknown>).cnpj as string | undefined);

  if (!responsavel) {
    return NextResponse.json({ error: "Informe o nome/responsável do fornecedor." }, { status: 400 });
  }
  // Mesma regra da importação por planilha (lib/cadastro-fornecedor.ts:parseCadastroFornecedorWorkbook)
  // — só o formato (14 dígitos) é exigido, nunca dígito verificador; e CNPJ nunca é chave única.
  if (cnpjNormalizado.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido — informe os 14 dígitos." }, { status: 400 });
  }
  const email = text((body as Record<string, unknown>).email)?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const row: CadastroRow = {
    responsavel,
    cnpj: text(b.cnpj) ?? cnpjNormalizado,
    cnpjNormalizado,
    razaoSocial: text(b.razaoSocial) ?? responsavel,
    statusContrato: text(b.statusContrato),
    objetoContrato: text(b.objetoContrato),
    cargo: text(b.cargo),
    cpf: text(b.cpf),
    email,
    telefone: text(b.telefone),
    tipoCt: text(b.tipoCt),
    tipoContrato: text(b.tipoContrato),
    valorHora: numberOrNull(b.valorHora),
    valorA1Equivalente: numberOrNull(b.valorA1Equivalente),
    valorDocumento: numberOrNull(b.valorDocumento),
    valorCondicaoFixa: numberOrNull(b.valorCondicaoFixa),
    inicio: dateOrNull(b.inicio),
    final: dateOrNull(b.final),
    // Sem status por padrão — a importação também não força um valor quando a planilha não traz
    // a coluna STATUS; cadastro manual segue a mesma regra (item 27 do pedido).
    statusCadastro: text(b.statusCadastro),
    primeiroAditivo: text(b.primeiroAditivo),
    segundoAditivo: text(b.segundoAditivo),
    rawPayload: { origem: "manual" },
  };

  const resultado = await upsertCadastroFornecedor(row);
  const cadastro = await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: resultado.cadastroId } });

  return NextResponse.json(
    {
      cadastro: serializeCadastroFornecedor(cadastro),
      criado: resultado.created,
      usuarioCriado: resultado.usuarioCriado,
    },
    { status: resultado.created ? 201 : 200 },
  );
}
