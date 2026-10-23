import { NextRequest, NextResponse } from "next/server";
import { requireFiscal } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { verificarAssinaturaDoFiscal } from "@/lib/timesheet-fiscal";

/** Query: `?codigo=TS-XXXX-XXXX`. Só folhas do escopo do fiscal; sem o IP. */
export async function GET(request: NextRequest) {
  const auth = await requireFiscal();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await verificarAssinaturaDoFiscal(auth.user.id, request.nextUrl.searchParams.get("codigo")));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
