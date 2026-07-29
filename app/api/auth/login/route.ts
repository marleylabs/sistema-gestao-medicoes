import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  ensureBootstrapAdmin,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export async function POST(request: NextRequest) {
  await ensureBootstrapAdmin();

  const body = await request.json().catch(() => null);
  const usuario = typeof body?.usuario === "string" ? body.usuario.trim() : "";
  const password = typeof body?.senha === "string" ? body.senha : "";
  if (!usuario || !password) {
    return NextResponse.json({ message: "Informe usuário e senha." }, { status: 400 });
  }

  const user = await prisma.usuario.findUnique({ where: { usuario } });
  const now = new Date();
  if (!user || user.excluidoAt || !user.ativo || (user.bloqueadoAte && user.bloqueadoAte > now)) {
    return NextResponse.json({ message: "Credenciais inválidas ou acesso temporariamente bloqueado." }, { status: 401 });
  }

  if (!(await verifyPassword(password, user.senhaHash))) {
    const failures = user.tentativasFalhas + 1;
    await prisma.usuario.update({
      where: { id: user.id },
      data: {
        tentativasFalhas: failures >= MAX_FAILURES ? 0 : failures,
        bloqueadoAte: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
        updatedAt: now,
      },
    });
    return NextResponse.json({ message: "Credenciais inválidas." }, { status: 401 });
  }

  await prisma.usuario.update({
    where: { id: user.id },
    data: { tentativasFalhas: 0, bloqueadoAte: null, ultimoLoginAt: now, onlineAt: now, updatedAt: now },
  });

  const token = await createSessionToken({
    id: user.id,
    usuario: user.usuario,
    nome: user.nome,
    perfil: user.perfil,
  });
  const response = NextResponse.json({
    user: { usuario: user.usuario, nome: user.nome, perfil: user.perfil },
    requirePasswordChange: (user as any).primeiroLogin === true,
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
