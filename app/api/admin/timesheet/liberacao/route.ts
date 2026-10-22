import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { definirLiberacao } from "@/lib/timesheet-medicao";

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const { ciclo, liberacao } = (body && typeof body === "object" ? body : {}) as { ciclo?: unknown; liberacao?: unknown };
  try {
    await definirLiberacao({ ciclo, liberacao, ator: auth.user });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
