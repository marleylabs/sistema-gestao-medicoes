import { NextRequest, NextResponse } from "next/server";
import { requireFiscal } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { decidirDias } from "@/lib/timesheet-fiscal";

/** Body: `{ ciclo, datas: ["YYYY-MM-DD", ...], decisao: "APROVADO" | "REPROVADO", motivo? }`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ profissionalId: string }> }) {
  const auth = await requireFiscal();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const dados = (body && typeof body === "object" ? body : {}) as { ciclo?: unknown; datas?: unknown; decisao?: unknown; motivo?: unknown };
  try {
    return NextResponse.json(await decidirDias({ fiscal: auth.user, profissionalId: (await params).profissionalId, ...dados }));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
