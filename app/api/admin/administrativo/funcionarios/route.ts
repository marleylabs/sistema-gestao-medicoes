import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { decryptSensitive } from "@/lib/encryption";
import { criarUsuarioInterno } from "@/lib/usuario-provisioning";

/**
 * "Funcionários" do Painel Administrativo unificado — todo `Usuario` interno (perfil diferente de
 * COLABORADOR). Fornecedor é sempre COLABORADOR (ver `lib/cadastro-fornecedor.ts`), então essa
 * distinção não precisa de heurística de nome: qualquer outro perfil é, por definição, funcionário.
 */
export async function GET() {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const usuarios = await prisma.usuario.findMany({
    where: { perfil: { not: "COLABORADOR" }, excluidoAt: null },
    select: {
      id: true, usuario: true, nome: true, perfil: true, ativo: true,
      primeiroLogin: true, senhaTemporaria: true, email: true, ultimoLoginAt: true, createdAt: true,
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
    })),
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem cadastrar funcionários." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const result = await criarUsuarioInterno({ nome: body?.nome, perfil: body?.perfil, email: body?.email });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.usuario, { status: result.status });
}
