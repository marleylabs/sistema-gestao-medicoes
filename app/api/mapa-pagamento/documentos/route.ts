import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { calcularValorMedido } from "@/lib/mapa-pagamento";
import { prisma } from "@/lib/prisma";
import { getDocumentosMedidos } from "@/lib/documentos-medidos";

function serialize(d: {
  id: string; numeroDocumento: string | null; formato: string | null; obs: string | null;
  equivalenteA1Horas: Prisma.Decimal | null; percentualEmissao: Prisma.Decimal | null; tipo2: string | null;
  condicao: string | null; projeto: { codigoProjeto: string; contrato: string | null };
}) {
  const { a1eq, pct, preco, valorMedido } = calcularValorMedido(d);
  return {
    id: d.id,
    se: d.projeto.codigoProjeto,
    contrato: d.projeto.contrato,
    numeroDocumento: d.numeroDocumento,
    formato: d.formato,
    equivalenteA1Horas: a1eq,
    percentualEmissao: pct,
    tipo2: d.tipo2,
    condicao: d.condicao,
    obs: d.obs,
    precoUnitario: preco,
    valorMedido,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const codigo = request.nextUrl.searchParams.get("codigo")?.trim();
  const ciclo  = request.nextUrl.searchParams.get("ciclo")?.trim();
  if (!codigo || !ciclo) {
    return NextResponse.json({ error: "codigo e ciclo são obrigatórios." }, { status: 400 });
  }

  const docs = await getDocumentosMedidos({ aliases: [codigo], ciclo });

  return NextResponse.json(docs.map(serialize));
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const body = await request.json().catch(() => null);
  const { codigo, ciclo, se, contrato, numeroDocumento, formato, equivalenteA1Horas, percentualEmissao, tipo2, condicao, obs } = body ?? {};

  if (!codigo || !ciclo) {
    return NextResponse.json({ error: "codigo e ciclo são obrigatórios." }, { status: 400 });
  }

  const profissional = await prisma.profissional.findFirst({
    where: {
      OR: [
        { codigo: { equals: codigo, mode: "insensitive" } },
        { nome: { equals: codigo, mode: "insensitive" } },
        { nomeCompleto: { equals: codigo, mode: "insensitive" } },
      ],
    },
  });
  if (!profissional) {
    return NextResponse.json({ error: "Fornecedor não encontrado." }, { status: 404 });
  }

  const codigoProjeto = (se as string | undefined)?.trim() || `MANUAL-${ciclo}-${Date.now()}`;
  const projeto = await prisma.projeto.upsert({
    where: { codigoProjeto },
    create: { codigoProjeto, contrato: (contrato as string | undefined) ?? null },
    update: { contrato: (contrato as string | undefined) ?? null },
  });

  const hash = crypto.randomUUID();
  const doc = await prisma.medicao.create({
    data: {
      numeroMedicao: (numeroDocumento as string | undefined) || `BM-${hash.slice(0, 8)}`,
      idProjeto: projeto.id,
      idProfissional: profissional.id,
      ciclo,
      numeroDocumento: (numeroDocumento as string | undefined) ?? null,
      formato: (formato as string | undefined) ?? null,
      equivalenteA1Horas: equivalenteA1Horas ?? 0,
      percentualEmissao: percentualEmissao ?? 0,
      tipo2: (tipo2 as string | undefined) ?? null,
      condicao: String(condicao ?? "0"),
      obs: (obs as string | undefined) || null,
      sourceRowHash: hash,
      rawPayload: {},
    },
    select: {
      id: true, numeroDocumento: true, formato: true, obs: true,
      equivalenteA1Horas: true, percentualEmissao: true, tipo2: true, condicao: true,
      projeto: { select: { codigoProjeto: true, contrato: true } },
    },
  });

  return NextResponse.json(serialize(doc), { status: 201 });
}
