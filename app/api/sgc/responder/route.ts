import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { logBmAction } from "@/lib/bm-log";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const colaboradorCodigo = typeof payload?.colaboradorCodigo === "string" ? payload.colaboradorCodigo.trim() : "";
  const resposta = typeof payload?.resposta === "string" ? payload.resposta.trim() : "";
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "2605";

  if (!colaboradorCodigo || !resposta) {
    return NextResponse.json({ error: "Código e resposta são obrigatórios." }, { status: 400 });
  }

  const atual = await prisma.sgcAprovacaoMedicao.findUnique({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
  });

  if (!atual) {
    return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });
  }

  const sgc = await prisma.sgcAprovacaoMedicao.update({
    where: { id: atual.id },
    data: { respostaAdmin: resposta, updatedAt: new Date() },
  });

  await logBmAction({
    sgcId: sgc.id,
    colaboradorCodigo,
    ciclo,
    usuarioId: admin.user!.id,
    usuarioNome: admin.user!.nome,
    acao: "RESPONDER_REVISAO",
    statusAnterior: atual.status,
    statusNovo: sgc.status,
    telaOrigem: "Medição",
    observacao: resposta,
  });

  return NextResponse.json({ ok: true, respostaAdmin: sgc.respostaAdmin });
}
