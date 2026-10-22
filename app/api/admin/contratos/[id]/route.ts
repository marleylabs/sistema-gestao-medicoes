import { NextRequest, NextResponse } from "next/server";
import { requireContratos } from "@/lib/admin";
import { atualizarContrato, respostaContratoErro } from "@/lib/contratos-cadastro";
import { isUuid } from "@/lib/file-security";

// Sem DELETE: o contrato sai de uso por inativação (excluir apagaria os feriados do timesheet dele).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireContratos();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Contrato inválido." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);
  try {
    return NextResponse.json(await atualizarContrato({ id, body, ator: auth.user }));
  } catch (e) {
    return respostaContratoErro(e);
  }
}
