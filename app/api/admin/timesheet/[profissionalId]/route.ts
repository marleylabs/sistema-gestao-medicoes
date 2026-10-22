import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { carregarFolha, respostaTimesheetErro } from "@/lib/timesheet";
import { exigirUuid, getConfig, historicoDaFolha } from "@/lib/timesheet-medicao";

export async function GET(request: NextRequest, { params }: { params: Promise<{ profissionalId: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim();
  try {
    const profissionalId = exigirUuid((await params).profissionalId, "Fornecedor");
    const [folha, historico, config] = await Promise.all([
      carregarFolha(profissionalId, ciclo, undefined, { paraMedicao: true }),
      historicoDaFolha(profissionalId, ciclo),
      getConfig(profissionalId),
    ]);
    return NextResponse.json({ folha, historico, config });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
