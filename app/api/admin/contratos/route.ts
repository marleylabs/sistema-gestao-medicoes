import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const CONTRATOS_PADRAO = [
  { nome: "Intr. Sossego", colunaMapa: "intr_sossego" },
  { nome: "Salobo", colunaMapa: "salobo" },
  { nome: "ACG", colunaMapa: "acg" },
  { nome: "Escadas Alumar", colunaMapa: "escadas_alumar" },
];

async function ensureContratosPadrao() {
  const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM contratos`;
  if (Number(count) > 0) return;

  for (const contrato of CONTRATOS_PADRAO) {
    await prisma.$executeRaw`
      INSERT INTO contratos (nome, coluna_mapa, ativo)
      VALUES (${contrato.nome}, ${contrato.colunaMapa}, true)
      ON CONFLICT (nome) DO NOTHING
    `;
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  await ensureContratosPadrao();

  const contratos = await prisma.$queryRaw<object[]>`
    SELECT id, nome, codigo, descricao, gestor, fiscal,
           data_inicio, data_fim, valor_total, coluna_mapa, ativo, created_at, updated_at
    FROM contratos ORDER BY nome ASC
  `;
  return NextResponse.json(contratos);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  if (!nome) return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });

  const codigo      = body?.codigo      || null;
  const descricao   = body?.descricao   || null;
  const gestor      = body?.gestor      || null;
  const fiscal      = body?.fiscal      || null;
  const data_inicio = body?.data_inicio || null;
  const data_fim    = body?.data_fim    || null;
  const valor_total = body?.valor_total ? Number(body.valor_total) : null;

  try {
    const [row] = await prisma.$queryRaw<object[]>`
      INSERT INTO contratos (nome, codigo, descricao, gestor, fiscal, data_inicio, data_fim, valor_total)
      VALUES (${nome}, ${codigo}, ${descricao}, ${gestor}, ${fiscal},
              ${data_inicio}::date, ${data_fim}::date, ${valor_total})
      RETURNING id, nome, codigo, descricao, gestor, fiscal,
                data_inicio, data_fim, valor_total, coluna_mapa, ativo, created_at, updated_at
    `;
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Já existe um contrato com esse nome." }, { status: 409 });
  }
}
