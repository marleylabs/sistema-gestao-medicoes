import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { criarFeriado } from "@/lib/timesheet-medicao";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const { data, nome, abrangencia, contratoId } = (body && typeof body === "object" ? body : {}) as { data?: unknown; nome?: unknown; abrangencia?: unknown; contratoId?: unknown };
  try {
    return NextResponse.json(await criarFeriado({ data, nome, abrangencia, contratoId, ator: auth.user }), { status: 201 });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
