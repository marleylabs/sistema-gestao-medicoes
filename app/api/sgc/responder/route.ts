import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
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

  const sgc = await prisma.sgcAprovacaoMedicao.update({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
    data: { respostaAdmin: resposta, updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, respostaAdmin: sgc.respostaAdmin });
}
