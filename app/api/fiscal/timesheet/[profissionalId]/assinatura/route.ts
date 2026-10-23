import { NextRequest, NextResponse } from "next/server";
import { requireFiscal } from "@/lib/admin";
import { respostaTimesheetErro } from "@/lib/timesheet";
import { ipDaRequisicao, validarAssinatura } from "@/lib/timesheet-assinatura";
import { assinarComoFiscal, exigirNoEscopo, revogarAssinaturaFiscal } from "@/lib/timesheet-fiscal";

type Params = { params: Promise<{ profissionalId: string }> };

/** Body: `{ ciclo, assinatura: { imagem: "data:image/png;base64,...", metodo: "DESENHO" | "DIGITADO", senha } }`. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFiscal();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const dados = (body && typeof body === "object" ? body : {}) as { ciclo?: unknown; assinatura?: unknown };
  const { profissionalId } = await params;
  try {
    // Escopo antes da senha: fornecedor de outro contrato responde 404 em qualquer entrada.
    await exigirNoEscopo(auth.user.id, profissionalId);
    const assinatura = await validarAssinatura(dados.assinatura, auth.user.id);
    return NextResponse.json(await assinarComoFiscal({ fiscal: auth.user, profissionalId, ciclo: dados.ciclo, assinatura, ip: ipDaRequisicao(request.headers) }));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}

/** Revoga a assinatura do próprio fiscal. Query: `?ciclo=`. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireFiscal();
  if (auth.response) return auth.response;
  try {
    await revogarAssinaturaFiscal({ fiscal: auth.user, profissionalId: (await params).profissionalId, ciclo: request.nextUrl.searchParams.get("ciclo")?.trim() });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
