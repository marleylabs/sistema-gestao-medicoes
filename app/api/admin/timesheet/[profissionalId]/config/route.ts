import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { salvarConfig } from "@/lib/timesheet-medicao";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ profissionalId: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  try {
    await salvarConfig({ profissionalId: (await params).profissionalId, valores: body as Record<string, unknown>, ator: auth.user });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
