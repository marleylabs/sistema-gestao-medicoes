import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getColaboradorEscopo } from "@/lib/colaborador-alias";
import { respostaTimesheetErro, salvarDia, type EntradaDia } from "@/lib/timesheet";

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  const { ciclo, ...dia } = body as { ciclo?: unknown } & EntradaDia;

  // O fornecedor vem só da sessão; nenhum id do body é usado.
  const { profissionalId } = await getColaboradorEscopo(user.usuario);
  try {
    await salvarDia({ profissionalId, ciclo, dia, ator: user });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
