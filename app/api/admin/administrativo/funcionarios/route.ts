import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { decryptSensitive } from "@/lib/encryption";
import { criarUsuarioInterno } from "@/lib/usuario-provisioning";
import { jsonNoStore } from "@/lib/no-store";

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
      primeiroLogin: true, email: true, ultimoLoginAt: true, createdAt: true,
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });

  // Uma única query batched (nunca N+1) para as permissões extras de todos os funcionários desta
  // listagem.
  const permissoes = await prisma.usuarioPermissao.findMany({
    where: { usuarioId: { in: usuarios.map((u) => u.id) } },
    select: { usuarioId: true, permissao: true },
  });
  const permissoesPorUsuario = new Map<string, string[]>();
  for (const p of permissoes) {
    permissoesPorUsuario.set(p.usuarioId, [...(permissoesPorUsuario.get(p.usuarioId) ?? []), p.permissao]);
  }

  return NextResponse.json(
    usuarios.map((u) => ({
      id: u.id,
      usuario: u.usuario,
      nome: u.nome,
      perfil: u.perfil,
      ativo: u.ativo,
      primeiroLogin: u.primeiroLogin,
      email: decryptSensitive(u.email),
      ultimoLoginAt: u.ultimoLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      permissoesExtras: permissoesPorUsuario.get(u.id) ?? [],
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
  // Única resposta que carrega a senha inicial (exibição única) — nunca cacheável.
  return jsonNoStore(result.usuario, { status: result.status });
}
