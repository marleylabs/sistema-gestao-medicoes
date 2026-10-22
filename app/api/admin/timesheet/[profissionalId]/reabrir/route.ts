import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { exigirUuid, reabrirFolha } from "@/lib/timesheet-medicao";

export async function POST(request: NextRequest, { params }: { params: Promise<{ profissionalId: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const ciclo = body && typeof body === "object" ? (body as { ciclo?: unknown }).ciclo : undefined;
  try {
    await reabrirFolha({ profissionalId: exigirUuid((await params).profissionalId, "Fornecedor"), ciclo, ator: auth.user });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
