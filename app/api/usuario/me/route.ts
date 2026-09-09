import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { resolveNomeUpdate } from "@/lib/usuario-nome";
import { prisma } from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/permissoes-acesso";

function avatarUrl(updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?v=${updatedAt.getTime()}` : null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const dbUser = await prisma.usuario.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      usuario: true,
      nome: true,
      perfil: true,
      avatarAtualizadoAt: true,
      ultimoLoginAt: true,
      createdAt: true,
    },
  });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const dadosCadastrais = dbUser.perfil === "COLABORADOR"
    ? await prisma.cadastroFornecedor.findFirst({
        where: {
          OR: [
            { responsavel: { equals: dbUser.nome, mode: "insensitive" } },
            { colaboradorCodigo: dbUser.nome },
          ],
        },
      })
    : null;

  // Permissões efetivas (perfil base + extras concedidas individualmente) — nunca substitui
  // `perfil`, só informa ao frontend o que este usuário específico pode acessar além do perfil.
  const permissoes = await getEffectivePermissions(dbUser);

  return NextResponse.json({
    ...dbUser,
    permissoes,
    avatarUrl: avatarUrl(dbUser.avatarAtualizadoAt),
    dadosCadastrais: dadosCadastrais ? serializeCadastroFornecedor(dadosCadastrais) : null,
  });
}

/**
 * Conta própria: o único campo editável aqui é `nome` (identidade da própria sessão autenticada
 * — nunca um userId vindo do corpo da requisição). Qualquer outro dado do perfil (ID de acesso,
 * perfil/role, dados cadastrais do CadastroFornecedor) continua gerenciado pelo Administrativo em
 * Gestão de Usuários (app/api/admin/usuarios/[id]/route.ts), um fluxo separado e mais permissivo
 * que não deve ser reaproveitado aqui.
 */
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = resolveNomeUpdate(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const updated = await prisma.usuario.update({
    where: { id: user.id },
    data: { nome: result.nome },
    select: { nome: true },
  });

  return NextResponse.json({ success: true, user: { nome: updated.nome } });
}
