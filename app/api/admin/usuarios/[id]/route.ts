import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { generateTempPassword, generateUniqueInternalAccessCode, hashPassword, isInternalUserProfile, validatePasswordStrength } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyPasswordReset } from "@/lib/email";
import { rotateAndSendFirstAccess } from "@/lib/first-access";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { isValidEmail, requiresEmail, EMAIL_REQUIRED_MESSAGE } from "@/lib/usuario-email-policy";
import { isValidPerfil } from "@/lib/perfis";
import { isValidPermissao, isElegivelParaPermissaoExtra, type Permissao } from "@/lib/permissoes";
import { getPermissoesExtras } from "@/lib/permissoes-acesso";
import { jsonNoStore } from "@/lib/no-store";

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
  if (!user || user.excluidoAt) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

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
      // Só o hash é persistido: a senha em texto existe apenas nesta requisição e na resposta
      // imediata (exibição única ao ADMIN) — nunca no banco, nunca recuperável depois.
      data: { senhaHash: tempHash, senhaTemporaria: null, primeiroLogin: true, updatedAt: new Date() },
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
    return jsonNoStore({
      senhaTemporaria: tempPass,
      emailNotificado,
      aviso: emailDestino ? null : "Senha redefinida. O usuário não possui e-mail cadastrado e não receberá a notificação.",
    });
  }

  if (action === "enviar_primeiro_acesso") {
    // Regra de negócio explícita (não é permissão de rota): mesmo que alguém chame a API
    // diretamente, um alvo ADMIN nunca recebe credencial por e-mail assim — vale para P0000001 e
    // para qualquer ADMIN futuro, sem checar nome/código específico.
    if (user.perfil === "ADMIN") {
      return NextResponse.json({ error: "Não é possível enviar primeiro acesso para um administrador." }, { status: 403 });
    }
    // Primeiro acesso é só para quem ainda não definiu a própria senha (mesma regra do botão, que
    // some com primeiroLogin = false). Trocar a senha de quem já acessa é "Redefinir senha".
    // rotateAndSendFirstAccess relê isso dentro da trava (corrida com o próprio primeiro login).
    if (!user.primeiroLogin) {
      return NextResponse.json({ error: "Este usuário já definiu a própria senha. Para trocar a senha dele, use Redefinir senha." }, { status: 409 });
    }
    const emailDestino = decryptSensitive(user.email);
    if (!emailDestino) {
      return NextResponse.json({ error: "Este usuário não possui e-mail cadastrado." }, { status: 409 });
    }

    // Rotação + envio extraídos para lib/first-access.ts (testável isoladamente, sem servidor
    // HTTP — ver tests/first-access-concurrency.ts) — garante idempotência real por
    // (usuarioId, requestId) via advisory lock, não por updatedAt.getTime(). Ver o comentário
    // completo na função sobre por que isso é necessário.
    const rotation = await rotateAndSendFirstAccess({
      db: prisma,
      requestId: body?.requestId,
      usuarioId: user.id,
      usuarioNome: user.nome,
      usuarioLogin: user.usuario,
      email: emailDestino,
      adminId: admin.user!.id,
      adminUsuario: admin.user!.usuario,
      adminNome: admin.user!.nome,
    });

    if (!rotation.ok) {
      return NextResponse.json({ error: rotation.error, alreadyProcessed: rotation.alreadyProcessed }, { status: rotation.status });
    }
    return NextResponse.json({ ok: true, alreadyProcessed: rotation.alreadyProcessed });
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

  if (action === "set_perfil") {
    const perfil = typeof body?.perfil === "string" ? body.perfil : "";
    if (!isValidPerfil(perfil)) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
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

  if (action === "set_permissoes_extras") {
    // Conceder/remover permissão extra é ação de segurança — exclusiva de ADMIN literal (item 19
    // do pedido). A rota já exige perfil === "ADMIN" no topo deste handler (linha ~14), então
    // nenhuma checagem adicional é necessária aqui — só documentando a garantia.
    if (user.perfil === "ADMIN") {
      return NextResponse.json({ error: "ADMIN já tem acesso total — não recebe permissões extras." }, { status: 409 });
    }
    if (!isElegivelParaPermissaoExtra(user.perfil)) {
      // COLABORADOR (fornecedor externo) nunca pode ganhar módulo interno — princípio do menor
      // privilégio, sem fallback "se é interno, libera" (item 27).
      return NextResponse.json({ error: "Este perfil não pode receber permissões extras." }, { status: 409 });
    }
    const desejadas = Array.isArray(body?.permissoes) ? body.permissoes : null;
    if (!desejadas || !desejadas.every(isValidPermissao)) {
      return NextResponse.json({ error: "Lista de permissões inválida." }, { status: 400 });
    }

    const atuais = await getPermissoesExtras(user.id);
    const novasSet = new Set<Permissao>(desejadas);
    const atuaisSet = new Set<Permissao>(atuais);
    const paraConceder = [...novasSet].filter((p) => !atuaisSet.has(p));
    const paraRemover = [...atuaisSet].filter((p) => !novasSet.has(p));

    await prisma.$transaction(async (tx) => {
      for (const permissao of paraRemover) {
        await tx.usuarioPermissao.delete({ where: { usuarioId_permissao: { usuarioId: user.id, permissao } } });
      }
      for (const permissao of paraConceder) {
        await tx.usuarioPermissao.create({ data: { usuarioId: user.id, permissao, createdById: admin.user!.id } });
      }
      // Auditoria nunca guarda segredo — só quem/quando/qual permissão/ação (item 29).
      if (paraConceder.length || paraRemover.length) {
        await tx.adminAuditLog.createMany({
          data: [
            ...paraConceder.map((permissao) => ({
              action: "GRANT_PERMISSAO_EXTRA",
              adminId: admin.user!.id, adminUsuario: admin.user!.usuario, adminNome: admin.user!.nome,
              targetType: "Usuario", targetId: user.id, targetCodigo: user.usuario,
              metadata: { permissao },
            })),
            ...paraRemover.map((permissao) => ({
              action: "REVOKE_PERMISSAO_EXTRA",
              adminId: admin.user!.id, adminUsuario: admin.user!.usuario, adminNome: admin.user!.nome,
              targetType: "Usuario", targetId: user.id, targetCodigo: user.usuario,
              metadata: { permissao },
            })),
          ],
        });
      }
    });

    return NextResponse.json({ permissoesExtras: [...novasSet] });
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
