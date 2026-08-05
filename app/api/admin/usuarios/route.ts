import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { generateUniqueInternalAccessCode, hashPassword, validatePasswordStrength } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_PERFIS = ["ADMIN", "MEDICAO", "COLABORADOR", "FINANCEIRO", "ADMINISTRATIVO", "DEPARTAMENTO_PESSOAL"];

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
      senhaTemporaria: true,
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
      senhaTemporaria: u.primeiroLogin ? u.senhaTemporaria : null,
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
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const perfil = typeof body?.perfil === "string" ? body.perfil : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";
  const usuario = await generateUniqueInternalAccessCode();

  if (nome.length < 3) {
    return NextResponse.json({ error: "Informe um nome com pelo menos 3 caracteres." }, { status: 400 });
  }
  if (!VALID_PERFIS.includes(perfil)) {
    return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  }
  const passwordError = validatePasswordStrength(senha);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const exists = await prisma.usuario.findUnique({ where: { usuario } });
  if (exists) {
    if (exists.excluidoAt) {
      const restored = await prisma.usuario.update({
        where: { id: exists.id },
        data: {
          nome,
          perfil,
          ativo: true,
          primeiroLogin: true,
          senhaTemporaria: senha,
          senhaHash: await hashPassword(senha),
          excluidoAt: null,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          usuario: true,
          nome: true,
          perfil: true,
          ativo: true,
          primeiroLogin: true,
          senhaTemporaria: true,
          ultimoLoginAt: true,
          createdAt: true,
        },
      });
      return NextResponse.json({
        id: restored.id,
        usuario: restored.usuario,
        nome: restored.nome,
        perfil: restored.perfil,
        ativo: restored.ativo,
        primeiroLogin: restored.primeiroLogin,
        senhaTemporaria: senha,
        ultimoLoginAt: restored.ultimoLoginAt?.toISOString() ?? null,
        createdAt: restored.createdAt.toISOString(),
      }, { status: 201 });
    }
    return NextResponse.json({ error: "Já existe um usuário com esse login." }, { status: 409 });
  }

  const created = await prisma.usuario.create({
    data: {
      usuario,
      nome,
      perfil,
      ativo: true,
      primeiroLogin: true,
      senhaTemporaria: senha,
      senhaHash: await hashPassword(senha),
    },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      ativo: true,
      primeiroLogin: true,
      senhaTemporaria: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      id: created.id,
      usuario: created.usuario,
      nome: created.nome,
      perfil: created.perfil,
      ativo: created.ativo,
      primeiroLogin: created.primeiroLogin,
      senhaTemporaria: senha,
      ultimoLoginAt: created.ultimoLoginAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
