import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { prisma } from "@/lib/prisma";
import { toColaboradorCodigo } from "@/lib/usuario-format";

function avatarUrl(updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?v=${updatedAt.getTime()}` : null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const dbUser = await prisma.usuario.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      avatarAtualizadoAt: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
  });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const dadosCadastrais = dbUser.perfil === "COLABORADOR"
    ? await prisma.cadastroFornecedor.findFirst({
        where: { colaboradorCodigo: toColaboradorCodigo(dbUser.usuario) },
      })
    : null;

  return NextResponse.json({
    ...dbUser,
    avatarUrl: avatarUrl(dbUser.avatarAtualizadoAt),
    dadosCadastrais: dadosCadastrais ? serializeCadastroFornecedor(dadosCadastrais) : null,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  return NextResponse.json(
    { error: "Os dados cadastrais são gerenciados pelo Administrativo e não podem ser alterados manualmente." },
    { status: 403 },
  );
}
