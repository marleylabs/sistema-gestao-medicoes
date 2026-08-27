import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeDownloadName } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";
import { avatarUrlByUserId, canUseChatPerfil, ensureChatParticipant, isDisabledTeamChave } from "@/app/api/chat/_helpers";

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
]);

function messageTypeFromMime(mime: string | null | undefined) {
  if (mime?.startsWith("audio/")) return "AUDIO";
  if (mime?.startsWith("image/")) return "IMAGEM";
  if (mime?.startsWith("video/")) return "VIDEO";
  return "ARQUIVO";
}

function isAllowedAttachmentMime(mime: string) {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    normalized.startsWith("image/") ||
    normalized.startsWith("video/") ||
    normalized.startsWith("audio/") ||
    ALLOWED_ATTACHMENT_MIMES.has(normalized)
  );
}

function serializeMensagem(mensagem: {
  id: string;
  autorId: string;
  texto: string;
  tipoMensagem: string;
  arquivoNome: string | null;
  arquivoMime: string | null;
  arquivoTamanho: number | null;
  createdAt: Date;
  autor: { nome: string; avatarAtualizadoAt: Date | null };
}, currentUserId: string) {
  const hasArquivo = !!mensagem.arquivoNome && !!mensagem.arquivoMime;
  return {
    id: mensagem.id,
    autorId: mensagem.autorId,
    autorNome: mensagem.autor.nome,
    autorAvatarUrl: avatarUrlByUserId(mensagem.autorId, mensagem.autor.avatarAtualizadoAt),
    texto: mensagem.texto,
    tipoMensagem: mensagem.tipoMensagem,
    arquivoNome: mensagem.arquivoNome,
    arquivoMime: mensagem.arquivoMime,
    arquivoTamanho: mensagem.arquivoTamanho,
    arquivoUrl: hasArquivo ? `/api/chat/mensagens/${mensagem.id}/arquivo` : null,
    criadoAt: mensagem.createdAt.toISOString(),
    meu: mensagem.autorId === currentUserId,
  };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json({ error: "O Administrativo não utiliza o chat da aplicação." }, { status: 403 });
  const { id } = await params;

  const participante = await ensureChatParticipant(id, user.id);
  if (!participante) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const mensagens = await prisma.chatMensagem.findMany({
    where: { conversaId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { autor: { select: { id: true, nome: true, avatarAtualizadoAt: true } } },
  });

  return NextResponse.json(mensagens.map((mensagem) => serializeMensagem(mensagem, user.id)));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!canUseChatPerfil(user.perfil)) return NextResponse.json({ error: "O Administrativo não utiliza o chat da aplicação." }, { status: 403 });
  const { id } = await params;

  const participante = await ensureChatParticipant(id, user.id);
  if (!participante) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const conversaAtual = await prisma.chatConversa.findUnique({ where: { id }, select: { chave: true } });
  if (conversaAtual && isDisabledTeamChave(conversaAtual.chave)) {
    return NextResponse.json({ error: "Esta conversa foi desabilitada e não aceita novas mensagens." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let texto = "";
  let arquivo: Uint8Array<ArrayBuffer> | null = null;
  let arquivoNome: string | null = null;
  let arquivoMime: string | null = null;
  let arquivoTamanho: number | null = null;
  let tipoMensagem = "TEXTO";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    texto = typeof form?.get("texto") === "string" ? String(form.get("texto")).trim() : "";
    const file = form?.get("arquivo");
    if (file instanceof File) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "O anexo deve ter no máximo 50 MB." }, { status: 400 });
      }
      if (!isAllowedAttachmentMime(file.type)) {
        return NextResponse.json({ error: "Tipo de arquivo não permitido no chat." }, { status: 400 });
      }
      arquivo = new Uint8Array(await file.arrayBuffer());
      arquivoNome = safeDownloadName(file.name, "anexo");
      arquivoMime = file.type;
      arquivoTamanho = file.size;
      tipoMensagem = messageTypeFromMime(file.type);
    }
  } else {
    const body = await request.json().catch(() => null);
    texto = typeof body?.texto === "string" ? body.texto.trim() : "";
  }

  if (texto.length < 1 && !arquivo) return NextResponse.json({ error: "Digite uma mensagem ou envie um anexo." }, { status: 400 });
  if (texto.length > 2000) return NextResponse.json({ error: "Mensagem muito longa." }, { status: 400 });

  const now = new Date();
  const mensagem = await prisma.chatMensagem.create({
    data: {
      conversaId: id,
      autorId: user.id,
      texto: texto || (tipoMensagem === "AUDIO" ? "Áudio" : tipoMensagem === "IMAGEM" ? "Imagem" : tipoMensagem === "VIDEO" ? "Vídeo" : "Arquivo"),
      tipoMensagem,
      arquivo,
      arquivoNome,
      arquivoMime,
      arquivoTamanho,
    },
    select: {
      id: true,
      autorId: true,
      texto: true,
      tipoMensagem: true,
      arquivoNome: true,
      arquivoMime: true,
      arquivoTamanho: true,
      createdAt: true,
      autor: { select: { nome: true, avatarAtualizadoAt: true } },
    },
  });
  await prisma.chatConversa.update({ where: { id }, data: { updatedAt: now } });
  await prisma.chatParticipante.update({
    where: { conversaId_usuarioId: { conversaId: id, usuarioId: user.id } },
    data: { ultimoLidoAt: now },
  });

  return NextResponse.json(serializeMensagem(mensagem, user.id));
}
