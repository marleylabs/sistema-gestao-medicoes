import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCicloTimesheet } from "@/lib/ciclo-ativo";
import { getColaboradorEscopo } from "@/lib/colaborador-alias";
import { carregarFolha, respostaTimesheetErro } from "@/lib/timesheet";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || (await getCicloTimesheet());
  const { profissionalId } = await getColaboradorEscopo(user.usuario);
  try {
    return NextResponse.json(await carregarFolha(profissionalId, ciclo));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
