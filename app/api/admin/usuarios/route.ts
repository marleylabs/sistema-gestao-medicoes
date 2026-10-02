import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { decryptSensitive } from "@/lib/encryption";
import { criarUsuarioInterno } from "@/lib/usuario-provisioning";
import { jsonNoStore } from "@/lib/no-store";

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;
  if (admin.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem gerenciar usuários." }, { status: 403 });
  }

  const usuarios = await prisma.usuario.findMany({
    where: { excluidoAt: null },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      ativo: true,
      primeiroLogin: true,
      email: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });

  return NextResponse.json(
    usuarios.map((u) => ({
      id: u.id,
      usuario: u.usuario,
      nome: u.nome,
      perfil: u.perfil,
      ativo: u.ativo,
      primeiroLogin: u.primeiroLogin,
      email: decryptSensitive(u.email),
      ultimoLoginAt: u.ultimoLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }))
  );
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;
  if (admin.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem criar usuários." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const result = await criarUsuarioInterno({ nome: body?.nome, perfil: body?.perfil, email: body?.email });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  // Única resposta que carrega a senha inicial (exibição única) — nunca cacheável.
  return jsonNoStore(result.usuario, { status: result.status });
}
