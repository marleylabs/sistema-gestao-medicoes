import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const usuario = request.nextUrl.searchParams.get("usuario")?.trim();
  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  const dbUser = await prisma.usuario.findUnique({
    where: userId ? { id: userId } : usuario ? { usuario } : { id: user.id },
    select: { avatarArquivo: true, avatarMime: true },
  });
  if (!dbUser?.avatarArquivo || !dbUser.avatarMime) {
    return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  }

  return new NextResponse(Buffer.from(dbUser.avatarArquivo), {
    headers: {
      "Content-Type": dbUser.avatarMime,
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie uma imagem de perfil." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Use uma imagem JPG, PNG, WebP ou GIF." }, { status: 400 });
  }
  if (file.size > MAX_AVATAR_SIZE) {
    return NextResponse.json({ error: "A imagem deve ter no máximo 2 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const avatarAtualizadoAt = new Date();
  await prisma.usuario.update({
    where: { id: user.id },
    data: {
      avatarArquivo: buffer,
      avatarMime: file.type,
      avatarAtualizadoAt,
      updatedAt: avatarAtualizadoAt,
    },
  });

  return NextResponse.json({
    ok: true,
    avatarUrl: `/api/usuario/avatar?v=${avatarAtualizadoAt.getTime()}`,
  });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  await prisma.usuario.update({
    where: { id: user.id },
    data: {
      avatarArquivo: null,
      avatarMime: null,
      avatarAtualizadoAt: null,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
