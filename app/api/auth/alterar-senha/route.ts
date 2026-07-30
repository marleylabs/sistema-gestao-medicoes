import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const senhaAtual = typeof body?.senhaAtual === "string" ? body.senhaAtual : "";
  const novaSenha = typeof body?.novaSenha === "string" ? body.novaSenha : "";

  const passwordError = validatePasswordStrength(novaSenha);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const dbUser = await prisma.usuario.findUnique({ where: { id: user.id } });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  if (!(dbUser as any).primeiroLogin) {
    if (!senhaAtual) return NextResponse.json({ error: "Informe a senha atual." }, { status: 400 });
    if (!(await verifyPassword(senhaAtual, dbUser.senhaHash))) {
      return NextResponse.json({ error: "Senha atual incorreta." }, { status: 400 });
    }
  }

  await prisma.usuario.update({
    where: { id: user.id },
    data: {
      senhaHash: await hashPassword(novaSenha),
      senhaTemporaria: null,
      primeiroLogin: false,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
