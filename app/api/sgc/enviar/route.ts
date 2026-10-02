import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { enviarBoletimFornecedor } from "@/lib/bm-envio";

/**
 * Envio individual do BM ("Enviar BM" / "Reenviar BM" no detalhe do fornecedor). Toda a regra —
 * validação do fornecedor, status reenviáveis, transição para PENDENTE, logs e e-mail
 * BM_AVAILABLE — vive em `enviarBoletimFornecedor` (lib/bm-envio.ts), a mesma usada pelo envio
 * em lote. Esta rota só autentica, lê o payload e mantém as respostas de sempre.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const colaboradorCodigo = typeof payload?.colaboradorCodigo === "string" ? payload.colaboradorCodigo.trim() : "";
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "2605";

  if (!colaboradorCodigo) {
    return NextResponse.json({ error: "ID do fornecedor é obrigatório." }, { status: 400 });
  }

  const resultado = await enviarBoletimFornecedor({
    colaboradorCodigo,
    ciclo,
    usuario: { id: admin.user?.id, nome: admin.user?.nome },
    telaOrigem: "Medições / Admin",
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.httpStatus });
  }

  // Falha de e-mail nunca desfaz o BM já enviado: a resposta de sucesso não depende de emailNotificacao.ok.
  return NextResponse.json({
    status: resultado.status,
    colaboradorCodigo: resultado.colaboradorCodigo,
    revisaoNumero: resultado.revisaoNumero,
    emailNotificacao: resultado.emailNotificacao,
  });
}
