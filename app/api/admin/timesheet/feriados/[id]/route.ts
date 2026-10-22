import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { excluirFeriado } from "@/lib/timesheet-medicao";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    await excluirFeriado({ id, ator: auth.user });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
