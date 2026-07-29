import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const payload = await request.json().catch(() => null);
  const sgcId = typeof payload?.sgcId === "string" ? payload.sgcId.trim() : "";
  if (!sgcId) return NextResponse.json({ error: "Chat inválido." }, { status: 400 });

  const sgc = await prisma.sgcAprovacaoMedicao.findUnique({
    where: { id: sgcId },
    select: { id: true, colaboradorCodigo: true },
  });

  if (!sgc) return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });

  if (user.perfil === "COLABORADOR" && sgc.colaboradorCodigo !== user.usuario) {
    return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });
  }

  if (!["COLABORADOR", "MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const acoesParaMarcar =
    user.perfil === "COLABORADOR"
      ? ["RESPONDER_REVISAO"]
      : ["SOLICITAR_REVISAO", "RESPONDER_MEDICAO"];

  const result = await prisma.sgcLog.updateMany({
    where: {
      sgcId,
      acao: { in: acoesParaMarcar },
      lidoAt: null,
    },
    data: { lidoAt: new Date() },
  });

  return NextResponse.json({ ok: true, count: result.count });
}
