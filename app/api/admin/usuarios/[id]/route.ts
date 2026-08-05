import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { generateTempPassword, generateUniqueInternalAccessCode, hashPassword, isInternalUserProfile, validatePasswordStrength } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeFornecedorAccessCnpj } from "@/lib/usuario-format";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;
  if (admin.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem alterar usuários." }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action;

  const user = await prisma.usuario.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  if (action === "toggle_ativo") {
    const updated = await prisma.usuario.update({
      where: { id },
      data: { ativo: !user.ativo, updatedAt: new Date() },
    });
    return NextResponse.json({ ativo: updated.ativo });
  }

  if (action === "reset_senha") {
    const tempPass = generateTempPassword();
    const tempHash = await hashPassword(tempPass);
    await prisma.usuario.update({
      where: { id },
      data: { senhaHash: tempHash, senhaTemporaria: null, primeiroLogin: true, updatedAt: new Date() },
    });
    return NextResponse.json({ senhaTemporaria: tempPass });
  }

  const VALID_PERFIS = ["ADMIN", "MEDICAO", "COLABORADOR", "FINANCEIRO", "ADMINISTRATIVO", "DEPARTAMENTO_PESSOAL"];

  if (action === "set_perfil") {
    const perfil = typeof body?.perfil === "string" ? body.perfil : "";
    if (!VALID_PERFIS.includes(perfil)) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
    const data: { perfil: string; usuario?: string; updatedAt: Date } = { perfil, updatedAt: new Date() };
    if (isInternalUserProfile(perfil) && !/^P0\d{6}$/.test(user.usuario)) {
      data.usuario = await generateUniqueInternalAccessCode();
    }
    if (perfil === "COLABORADOR" && !normalizeFornecedorAccessCnpj(user.usuario)) {
      return NextResponse.json({ error: "Para alterar para Fornecedor, o usuário precisa estar vinculado a um CNPJ válido." }, { status: 400 });
    }
    await prisma.usuario.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_senha") {
    const novaSenha = typeof body?.novaSenha === "string" ? body.novaSenha : "";
    const passwordError = validatePasswordStrength(novaSenha);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
    await prisma.usuario.update({
      where: { id },
      data: { senhaHash: await hashPassword(novaSenha), senhaTemporaria: null, primeiroLogin: false, updatedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;
  if (admin.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem excluir usuários." }, { status: 403 });
  }

  const { id } = await params;
  if (id === admin.user.id) {
    return NextResponse.json({ error: "Você não pode excluir o próprio usuário." }, { status: 409 });
  }

  const user = await prisma.usuario.findUnique({ where: { id } });
  if (!user || user.excluidoAt) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  if (user.perfil === "ADMIN" && user.ativo) {
    const activeAdmins = await prisma.usuario.count({
      where: { perfil: "ADMIN", ativo: true, excluidoAt: null },
    });
    if (activeAdmins <= 1) {
      return NextResponse.json({ error: "Não é possível excluir o último administrador ativo." }, { status: 409 });
    }
  }

  await prisma.usuario.update({
    where: { id },
    data: {
      ativo: false,
      senhaTemporaria: null,
      primeiroLogin: false,
      onlineAt: null,
      excluidoAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
