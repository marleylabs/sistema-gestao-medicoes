import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getColaboradorEscopo } from "@/lib/colaborador-alias";
import { enviarFolha, respostaTimesheetErro } from "@/lib/timesheet";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const body: unknown = await request.json().catch(() => null);
  const ciclo = body && typeof body === "object" ? (body as { ciclo?: unknown }).ciclo : undefined;
  const { profissionalId } = await getColaboradorEscopo(user.usuario);
  try {
    await enviarFolha({ profissionalId, ciclo, ator: user });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
