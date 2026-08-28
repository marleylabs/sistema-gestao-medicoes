import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { generateTempPassword, generateUniqueInternalAccessCode, hashPassword, isInternalUserProfile, validatePasswordStrength } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyPasswordReset } from "@/lib/email";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { isValidEmail, requiresEmail, EMAIL_REQUIRED_MESSAGE } from "@/lib/usuario-email-policy";

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
    const willBeAtivo = !user.ativo;
    if (requiresEmail(user.perfil, willBeAtivo) && !decryptSensitive(user.email)) {
      return NextResponse.json({ error: EMAIL_REQUIRED_MESSAGE }, { status: 409 });
    }
    const updated = await prisma.usuario.update({
      where: { id },
      data: { ativo: willBeAtivo, updatedAt: new Date() },
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
    // A senha temporária NUNCA vai no e-mail (nem em texto, nem hash) — só um aviso de que a
    // senha foi redefinida. O admin repassa a senha temporária ao usuário pelo canal já usado
    // hoje. Falha de e-mail aqui não desfaz o reset, que já foi concluído acima. O reset em si
    // nunca é bloqueado pela ausência de e-mail — só a notificação deixa de ser enviada.
    const emailDestino = decryptSensitive(user.email);
    let emailNotificado = false;
    if (emailDestino) {
      const result = await notifyPasswordReset({ usuarioId: user.id, nome: user.nome, email: emailDestino });
      emailNotificado = result.ok;
    }
    return NextResponse.json({
      senhaTemporaria: tempPass,
      emailNotificado,
      aviso: emailDestino ? null : "Senha redefinida. O usuário não possui e-mail cadastrado e não receberá a notificação.",
    });
  }

  if (action === "set_email") {
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
    }
    if (!email && requiresEmail(user.perfil, user.ativo)) {
      return NextResponse.json({ error: EMAIL_REQUIRED_MESSAGE }, { status: 409 });
    }
    await prisma.usuario.update({
      where: { id },
      data: { email: email ? encryptSensitive(email) : null, updatedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  const VALID_PERFIS = ["ADMIN", "MEDICAO", "COLABORADOR", "FINANCEIRO", "ADMINISTRATIVO"];

  if (action === "set_perfil") {
    const perfil = typeof body?.perfil === "string" ? body.perfil : "";
    if (!VALID_PERFIS.includes(perfil)) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
    if (requiresEmail(perfil, user.ativo) && !decryptSensitive(user.email)) {
      return NextResponse.json({ error: EMAIL_REQUIRED_MESSAGE }, { status: 409 });
    }
    const data: { perfil: string; usuario?: string; updatedAt: Date } = { perfil, updatedAt: new Date() };
    if (isInternalUserProfile(perfil) && !/^P0\d{6}$/.test(user.usuario)) {
      data.usuario = await generateUniqueInternalAccessCode();
    }
    if (perfil === "COLABORADOR" && !/^P0\d{6}$/.test(user.usuario)) {
      data.usuario = await generateUniqueInternalAccessCode();
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
