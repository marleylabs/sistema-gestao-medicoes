import { NextResponse } from "next/server";
import { getCurrentUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await prisma.usuario.update({
      where: { id: user.id },
      data: { onlineAt: null, updatedAt: new Date() },
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
