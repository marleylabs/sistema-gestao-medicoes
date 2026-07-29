import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  const sgcId = typeof form?.get("sgcId") === "string" ? String(form.get("sgcId")).trim() : "";

  if (!sgcId || !(file instanceof File)) {
    return NextResponse.json({ error: "Chat e áudio são obrigatórios." }, { status: 400 });
  }
  if (!file.type.startsWith("audio/")) {
    return NextResponse.json({ error: "Envie um arquivo de áudio válido." }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "O áudio deve ter no máximo 8 MB." }, { status: 400 });
  }

  const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { id: sgcId } });
  if (!sgc) return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });

  const isFornecedor = user.perfil === "COLABORADOR";
  const isMedicao = ["MEDICAO", "ADMIN"].includes(user.perfil);
  if (!isFornecedor && !isMedicao) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  if (isFornecedor && sgc.colaboradorCodigo !== user.usuario) {
    return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });
  }
  if (sgc.status !== "REVISAO_SOLICITADA") {
    return NextResponse.json({ error: "Áudios só podem ser enviados enquanto a revisão estiver aberta." }, { status: 409 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  const acao = isFornecedor ? "RESPONDER_MEDICAO" : "RESPONDER_REVISAO";

  const [log] = await prisma.$transaction([
    prisma.sgcLog.create({
      data: {
        sgcId: sgc.id,
        colaboradorCodigo: sgc.colaboradorCodigo,
        ciclo: sgc.ciclo,
        usuarioId: user.id,
        usuarioNome: user.nome,
        acao,
        statusAnterior: sgc.status,
        statusNovo: sgc.status,
        telaOrigem: isFornecedor ? "Portal do Colaborador" : "Medição",
        observacao: "Áudio",
        tipoMensagem: "AUDIO",
        audioArquivo: bytes,
        audioMime: file.type || "audio/webm",
        audioNome: file.name || `audio-${now.getTime()}.webm`,
      },
    }),
    prisma.sgcAprovacaoMedicao.update({
      where: { id: sgc.id },
      data: {
        updatedAt: now,
        ...(isFornecedor ? { observacaoColaborador: "Áudio enviado" } : { respostaAdmin: "Áudio enviado" }),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, id: log.id });
}
