import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { logBmAction } from "@/lib/bm-log";
import { liberarConferenciaSeCompleta } from "@/lib/conferencia-resolucao";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const observacao = typeof body?.observacao === "string" ? body.observacao.trim() : "";
  if (!observacao) {
    return NextResponse.json({ error: "Informe o motivo do descarte." }, { status: 400 });
  }

  const divergencia = await prisma.divergenciaMedicao.findUnique({ where: { id } });
  if (!divergencia) return NextResponse.json({ error: "Divergência não encontrada." }, { status: 404 });
  if (divergencia.status !== "PENDENTE") {
    return NextResponse.json({ error: "Esta divergência já foi resolvida." }, { status: 409 });
  }

  const now = new Date();

  // Descartar nunca toca em Medicao: nem cria, nem altera, nem apaga.
  await prisma.$transaction(async (tx) => {
    await tx.divergenciaMedicao.update({
      where: { id },
      data: {
        status: "DESCARTADA",
        observacao,
        resolvidoPorUsuarioId: admin.user?.id ?? null,
        resolvidoPorNome: admin.user?.nome ?? null,
        resolvidoEm: now,
        updatedAt: now,
      },
    });
    await liberarConferenciaSeCompleta(tx, divergencia.sgcId);
  });

  await logBmAction({
    sgcId: divergencia.sgcId,
    colaboradorCodigo: divergencia.colaboradorCodigo,
    ciclo: divergencia.ciclo,
    usuarioId: admin.user?.id,
    usuarioNome: admin.user?.nome,
    acao: "DIVERGENCIA_DESCARTAR",
    telaOrigem: "Editar pagamento",
    observacao: `NR VALE ${divergencia.nrVale} — ${observacao}`,
  });

  return NextResponse.json({ ok: true });
}
