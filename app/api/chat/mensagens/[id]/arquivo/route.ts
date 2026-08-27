import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeDownloadName } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const forceDownload = request.nextUrl.searchParams.get("download") === "1";
  const { id } = await params;
  const mensagem = await prisma.chatMensagem.findUnique({
    where: { id },
    select: {
      arquivo: true,
      arquivoNome: true,
      arquivoMime: true,
      conversa: {
        select: {
          participantes: {
            where: { usuarioId: user.id },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!mensagem?.conversa.participantes.length) {
    return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  }
  if (!mensagem.arquivo || !mensagem.arquivoMime) {
    return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  }

  const isInlineMime = mensagem.arquivoMime.startsWith("image/") || mensagem.arquivoMime.startsWith("audio/") || mensagem.arquivoMime.startsWith("video/");
  const disposition = isInlineMime && !forceDownload ? "inline" : "attachment";

  return new NextResponse(mensagem.arquivo, {
    headers: {
      "Content-Type": mensagem.arquivoMime,
      "Content-Disposition": `${disposition}; filename="${safeDownloadName(mensagem.arquivoNome, "anexo")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
