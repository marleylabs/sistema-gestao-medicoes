import { NextRequest, NextResponse } from "next/server";
import { requireFiscal } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { folhaDoFiscal } from "@/lib/timesheet-fiscal";

export async function GET(request: NextRequest, { params }: { params: Promise<{ profissionalId: string }> }) {
  const auth = await requireFiscal();
  if (auth.response) return auth.response;
  try {
    const folha = await folhaDoFiscal(auth.user.id, (await params).profissionalId, request.nextUrl.searchParams.get("ciclo")?.trim());
    return NextResponse.json({ folha });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
