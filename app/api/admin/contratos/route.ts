import { NextRequest, NextResponse } from "next/server";
import { requireContratos } from "@/lib/admin";
import { criarContrato, listarContratos, respostaContratoErro } from "@/lib/contratos-cadastro";
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
  const auth = await requireContratos();
  if (auth.response) return auth.response;
  await ensureContratosPadrao();
  return NextResponse.json(await listarContratos());
}

export async function POST(request: NextRequest) {
  const auth = await requireContratos();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  try {
    return NextResponse.json(await criarContrato({ body, ator: auth.user }), { status: 201 });
  } catch (e) {
    return respostaContratoErro(e);
  }
}
