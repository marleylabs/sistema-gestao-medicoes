import { NextRequest, NextResponse } from "next/server";
import { requireFiscal } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { listarFolhasDoFiscal } from "@/lib/timesheet-fiscal";

export async function GET(request: NextRequest) {
  const auth = await requireFiscal();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await listarFolhasDoFiscal(auth.user.id, request.nextUrl.searchParams.get("ciclo")?.trim()));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
