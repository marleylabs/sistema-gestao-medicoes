import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { carregarFolha, respostaTimesheetErro } from "@/lib/timesheet";
import { nomeArquivoTimesheet, planilhaTimesheet } from "@/lib/timesheet-export";
import { exigirUuid, registrarExportacao } from "@/lib/timesheet-medicao";

export async function GET(request: NextRequest, { params }: { params: Promise<{ profissionalId: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  try {
    const profissionalId = exigirUuid((await params).profissionalId, "Fornecedor");
    const folha = await carregarFolha(profissionalId, request.nextUrl.searchParams.get("ciclo")?.trim(), undefined, { paraMedicao: true });
    const arquivo = planilhaTimesheet(folha);
    await registrarExportacao({ profissionalId, ciclo: folha.ciclo, formato: "XLSX", ator: auth.user });
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nomeArquivoTimesheet(folha)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
