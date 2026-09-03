import { NextRequest, NextResponse } from "next/server";
import { isDeletedFornecedorIdentityName } from "@/lib/cadastro-fornecedor";
import { requireAdmin } from "@/lib/admin";
import { generateUniqueInternalAccessCode, hashPassword, validatePasswordStrength } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { isValidEmail, requiresEmail, EMAIL_REQUIRED_MESSAGE } from "@/lib/usuario-email-policy";

const VALID_PERFIS = ["ADMIN", "MEDICAO", "COLABORADOR", "FINANCEIRO", "ADMINISTRATIVO"];

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
      senhaTemporaria: u.primeiroLogin ? u.senhaTemporaria : null,
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
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const perfil = typeof body?.perfil === "string" ? body.perfil : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
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
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }
  // Novos usuários sempre nascem ativos (ver `ativo: true` abaixo) — para MEDICAO/FINANCEIRO,
  // a regra de e-mail obrigatório já vale desde a criação.
  if (requiresEmail(perfil, true) && !email) {
    return NextResponse.json({ error: EMAIL_REQUIRED_MESSAGE }, { status: 400 });
  }

  const exists = await prisma.usuario.findUnique({ where: { usuario } });
  if ((perfil === "COLABORADOR" && await isDeletedFornecedorIdentityName(nome)) || (exists?.excluidoAt && await prisma.adminAuditLog.findFirst({
    where: { action: "FORNECEDOR_EXCLUSAO_DEFINITIVA", metadata: { path: ["usuarioId"], equals: exists.id } }, select: { id: true },
  }))) {
    return NextResponse.json({ error: "Fornecedor excluído definitivamente não pode ser reativado." }, { status: 409 });
  }
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
          email: email ? encryptSensitive(email) : null,
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
          email: true,
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
        email: decryptSensitive(restored.email),
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
      email: email ? encryptSensitive(email) : null,
    },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      ativo: true,
      primeiroLogin: true,
      senhaTemporaria: true,
      email: true,
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
      email: decryptSensitive(created.email),
      ultimoLoginAt: created.ultimoLoginAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
