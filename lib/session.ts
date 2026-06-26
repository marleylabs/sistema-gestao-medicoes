import { jwtVerify, SignJWT } from "jose";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "medicoes_session";
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;

export type AuthUser = {
  id: string;
  usuario: string;
  nome: string;
  perfil: string;
};

function sessionSecret() {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SESSION_SECRET deve possuir pelo menos 32 caracteres.");
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(user: AuthUser) {
  return new SignJWT({
    usuario: user.usuario,
    nome: user.nome,
    perfil: user.perfil,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(sessionSecret());
}

export async function verifySessionToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.usuario !== "string" || typeof payload.nome !== "string" || typeof payload.perfil !== "string") {
      return null;
    }
    // Refresh perfil from DB so changes take effect without re-login
    const dbUser = await prisma.usuario.findUnique({ where: { id: payload.sub }, select: { perfil: true, ativo: true } });
    if (!dbUser || !dbUser.ativo) return null;
    return {
      id: payload.sub,
      usuario: payload.usuario,
      nome: payload.nome,
      perfil: dbUser.perfil,
    };
  } catch {
    return null;
  }
}
