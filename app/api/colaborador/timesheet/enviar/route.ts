import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getColaboradorEscopo } from "@/lib/colaborador-alias";
import { exigirEnvioPermitido, respostaTimesheetErro } from "@/lib/timesheet";
import { enviarFolha, ipDaRequisicao, validarAssinatura } from "@/lib/timesheet-assinatura";

/** Body: `{ ciclo, assinatura: { imagem: "data:image/png;base64,...", metodo: "DESENHO" | "DIGITADO", senha } }`. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const body: unknown = await request.json().catch(() => null);
  const dados = (body && typeof body === "object" ? body : {}) as { ciclo?: unknown; assinatura?: unknown };
  const { profissionalId } = await getColaboradorEscopo(user.usuario);
  try {
    // Habilitação e ciclo antes da senha: quem não tem timesheet recebe 404 em qualquer entrada.
    await exigirEnvioPermitido(profissionalId, dados.ciclo);
    const assinatura = await validarAssinatura(dados.assinatura, user.id);
    return NextResponse.json(await enviarFolha({ profissionalId, ciclo: dados.ciclo, ator: user, assinatura, ip: ipDaRequisicao(request.headers) }));
  } catch (e) {
    return respostaTimesheetErro(e);
  }
}
