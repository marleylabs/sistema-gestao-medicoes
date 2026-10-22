import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { listarFolhasDoCiclo } from "@/lib/timesheet-medicao";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || (await getCicloAtivoMedicao());
  try {
    return NextResponse.json(await listarFolhasDoCiclo(ciclo));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
