import "server-only";

import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  type AuthUser,
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
  verifySessionToken,
} from "@/lib/session";
import { isInternalAccessCode, normalizeAccessUsername } from "@/lib/usuario-format";

const scrypt = promisify(scryptCallback);
export { createSessionToken, SESSION_COOKIE, verifySessionToken };
export type { AuthUser };

export const INTERNAL_USER_PROFILES = ["ADMIN", "MEDICAO", "FINANCEIRO", "ADMINISTRATIVO"] as const;

export function isInternalUserProfile(perfil: string | null | undefined) {
  return !!perfil && (INTERNAL_USER_PROFILES as readonly string[]).includes(perfil);
}

export function mustUseInternalAccessCode(_perfil: string | null | undefined) {
  return true;
}

type UsuarioDelegate = {
  usuario: {
    findUnique: typeof prisma.usuario.findUnique;
  };
};

export async function generateUniqueInternalAccessCode(tx: UsuarioDelegate = prisma) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const usuario = `P0${suffix}`;
    const exists = await tx.usuario.findUnique({ where: { usuario }, select: { id: true } });
    if (!exists) return usuario;
  }
  throw new Error("Não foi possível gerar um ID interno único.");
}

export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function validatePasswordStrength(password: string) {
  if (password.length < 12) return "A senha deve ter pelo menos 12 caracteres.";
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return "A senha deve conter letras maiúsculas, minúsculas e números.";
  }
  return null;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, hashValue] = storedHash.split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;

  const salt = Buffer.from(saltValue, "base64");
  const expectedHash = Buffer.from(hashValue, "base64");
  const actualHash = (await scrypt(password, salt, expectedHash.length)) as Buffer;
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

export async function ensureBootstrapAdmin() {
  await migrateAccessUsernames();

  const totalUsers = await prisma.usuario.count();
  if (totalUsers > 0) {
    if (process.env.AUTH_CREATE_DEFAULT_MEDICAO_USERS === "true") {
      await ensureDefaultAccessUsers();
    }
    return;
  }

  const requestedUsuario = normalizeAccessUsername(process.env.AUTH_BOOTSTRAP_USERNAME);
  const usuario = requestedUsuario || await generateUniqueInternalAccessCode();
  const password = process.env.AUTH_BOOTSTRAP_PASSWORD;
  const nome = process.env.AUTH_BOOTSTRAP_NAME?.trim() || "Administrador";
  if (!usuario || !password || password.length < 12) {
    throw new Error("Configure AUTH_BOOTSTRAP_USERNAME e AUTH_BOOTSTRAP_PASSWORD com pelo menos 12 caracteres.");
  }

  await prisma.usuario.create({
    data: {
      usuario,
      nome,
      senhaHash: await hashPassword(password),
      perfil: "ADMIN",
    },
  });
  if (process.env.AUTH_CREATE_DEFAULT_MEDICAO_USERS === "true") {
    await ensureDefaultAccessUsers();
  }
}

export async function ensureDefaultAccessUsers() {
  const temporaryPassword = process.env.AUTH_TEMP_PASSWORD || "Teste@123456";
  const senhaHash = await hashPassword(temporaryPassword);
  const now = new Date();

  const medicaoUsers = [
    { nome: "Anderson Marley" },
    { nome: "Gabriel Sousa" },
  ];
  const medicaoUsernames = new Set<string>();

  for (const medicaoUser of medicaoUsers) {
    const existingByName = await prisma.usuario.findFirst({
      where: { nome: medicaoUser.nome, perfil: "MEDICAO", excluidoAt: null },
      select: { usuario: true },
    });
    const usuario = existingByName?.usuario ?? await generateUniqueInternalAccessCode();
    medicaoUsernames.add(usuario);
    await prisma.usuario.upsert({
      where: { usuario },
      create: {
        ...medicaoUser,
        usuario,
        senhaHash,
        perfil: "MEDICAO",
      },
      update: {
        nome: medicaoUser.nome,
        ativo: true,
        excluidoAt: null,
        updatedAt: now,
        // perfil is intentionally not overwritten — allow manual changes via Gestão de Usuários
      },
    });
  }

  const colaboradores = await prisma.profissional.findMany({
    where: { codigo: { not: null } },
    select: { codigo: true, nomeCompleto: true, nome: true, cnpj: true },
  });

  for (const colaborador of colaboradores) {
    const existingByName = await prisma.usuario.findFirst({
      where: {
        perfil: "COLABORADOR",
        excluidoAt: null,
        OR: [
          { nome: colaborador.nomeCompleto || colaborador.nome || "" },
          { nome: colaborador.nome || "" },
        ],
      },
      select: { usuario: true },
    });
    const usuario = existingByName?.usuario ?? await generateUniqueInternalAccessCode();
    if (medicaoUsernames.has(usuario)) continue;

    const existing = await prisma.usuario.findUnique({ where: { usuario } });
    if (existing) {
      if (existing.excluidoAt) continue;
      await prisma.usuario.update({
        where: { usuario },
        data: { nome: colaborador.nomeCompleto || colaborador.nome, perfil: "COLABORADOR", ativo: true, updatedAt: now },
      });
    } else {
      const tempPass = generateTempPassword();
      const tempHash = await hashPassword(tempPass);
      await prisma.usuario.create({
        data: {
          usuario,
          nome: colaborador.nomeCompleto || colaborador.nome || usuario,
          senhaHash: tempHash,
          senhaTemporaria: tempPass,
          primeiroLogin: true,
          perfil: "COLABORADOR",
        },
      });
    }
  }
}

async function migrateAccessUsernames() {
  const usuarios = await prisma.usuario.findMany({
    where: { excluidoAt: null },
    select: { id: true, usuario: true, nome: true, perfil: true },
  });

  for (const user of usuarios) {
    let usuario = normalizeAccessUsername(user.usuario);
    usuario = isInternalAccessCode(user.usuario) ? user.usuario : await generateUniqueInternalAccessCode();
    if (!usuario || usuario === user.usuario) continue;

    const exists = await prisma.usuario.findUnique({ where: { usuario }, select: { id: true } });
    if (exists && exists.id !== user.id) continue;

    await prisma.usuario.update({
      where: { id: user.id },
      data: { usuario, updatedAt: new Date() },
    });
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.AUTH_COOKIE_SECURE === "true",
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};
