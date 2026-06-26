import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { generateTempPassword, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

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
      data: { senhaHash: tempHash, senhaTemporaria: tempPass, primeiroLogin: true, updatedAt: new Date() },
    });
    return NextResponse.json({ senhaTemporaria: tempPass });
  }

  const VALID_PERFIS = ["ADMIN", "MEDICAO", "COLABORADOR", "FINANCEIRO", "DEPARTAMENTO_PESSOAL"];

  if (action === "set_perfil") {
    const perfil = typeof body?.perfil === "string" ? body.perfil : "";
    if (!VALID_PERFIS.includes(perfil)) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
    await prisma.usuario.update({ where: { id }, data: { perfil, updatedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_senha") {
    const novaSenha = typeof body?.novaSenha === "string" ? body.novaSenha : "";
    if (novaSenha.length < 8) return NextResponse.json({ error: "Senha deve ter pelo menos 8 caracteres." }, { status: 400 });
    await prisma.usuario.update({
      where: { id },
      data: { senhaHash: await hashPassword(novaSenha), senhaTemporaria: null, primeiroLogin: false, updatedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
