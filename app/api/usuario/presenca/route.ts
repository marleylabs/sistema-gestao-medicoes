import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const now = new Date();
  await prisma.usuario.update({
    where: { id: user.id },
    data: { onlineAt: now, updatedAt: now },
  });

  return NextResponse.json({ ok: true, onlineAt: now.toISOString() });
}
