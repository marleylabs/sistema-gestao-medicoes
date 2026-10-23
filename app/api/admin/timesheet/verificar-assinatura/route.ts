import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { verificarAssinatura, type VerificacaoAssinatura } from "@/lib/timesheet-assinatura";

/** Query: `?codigo=TS-XXXX-XXXX`. Medição e ADMIN: qualquer folha, com o IP de quem assinou. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  try {
    const { profissionalId: _profissionalId, ...verificacao } = await verificarAssinatura(request.nextUrl.searchParams.get("codigo"));
    return NextResponse.json(verificacao satisfies VerificacaoAssinatura);
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
