import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { findColaboradorUsuarios, normalizePersonName } from "@/lib/cadastro-fornecedor";
import { decryptSensitive } from "@/lib/encryption";
import { isUuid } from "@/lib/file-security";
import { rotateAndSendFirstAccess } from "@/lib/first-access";
import { prisma } from "@/lib/prisma";
import { normalizarIdsPrimeiroAcessoLote, processarPrimeiroAcessoEmLote, type CadastroPrimeiroAcesso } from "@/lib/primeiro-acesso-lote";

/**
 * "Enviar primeiro acesso" em lote (Administrativo → Fornecedores, seleção). Mesma autorização do
 * envio individual (PATCH /api/admin/usuarios/[id], action enviar_primeiro_acesso): ADMIN literal,
 * validado ANTES de ler IDs ou enviar qualquer coisa. Mesma rotação+e-mail (`rotateAndSendFirstAccess`)
 * e mesma elegibilidade, reavaliada aqui sobre o estado atual do banco.
 *
 * `requestId` (UUID gerado pelo frontend UMA vez por confirmação) é passado a cada envio: a chave
 * de idempotência já existente é (usuarioId, requestId), então repetir a MESMA requisição (duplo
 * clique, retry, timeout) nunca rotaciona nem envia de novo — devolve "já enviado nesta operação".
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;
  if (admin.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem enviar primeiro acesso." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { ids?: unknown; requestId?: unknown } | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!isUuid(requestId)) return NextResponse.json({ error: "requestId inválido." }, { status: 400 });
  const normalizados = normalizarIdsPrimeiroAcessoLote(body?.ids);
  if (!normalizados.ok) return NextResponse.json({ error: normalizados.error }, { status: 400 });

  const autor = admin.user;
  const resumo = await processarPrimeiroAcessoEmLote({
    ids: normalizados.ids,
    carregar: async (ids) => {
      const cadastros = await prisma.cadastroFornecedor.findMany({ where: { id: { in: ids } }, select: { id: true, responsavel: true, email: true } });
      // Mesmo vínculo fornecedor↔acesso da listagem (por nome normalizado; só COLABORADOR não excluído).
      const acessos = await findColaboradorUsuarios(cadastros.map((c) => c.responsavel));
      const usuarioIds = [...acessos.values()].map((a) => a.id);
      const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
      return new Map(
        cadastros.map((c): [string, CadastroPrimeiroAcesso] => {
          const acesso = acessos.get(normalizePersonName(c.responsavel));
          return [c.id, {
            id: c.id,
            nome: c.responsavel,
            emailCadastral: decryptSensitive(c.email),
            acesso: acesso ? { id: acesso.id, nome: nomes.get(acesso.id) ?? c.responsavel, usuario: acesso.usuario, perfil: acesso.perfil, primeiroLogin: acesso.primeiroLogin, email: acesso.email } : null,
          }];
        }),
      );
    },
    enviar: (envio) =>
      rotateAndSendFirstAccess({
        db: prisma,
        requestId,
        usuarioId: envio.usuarioId,
        usuarioNome: envio.usuarioNome,
        usuarioLogin: envio.usuarioLogin,
        email: envio.email,
        adminId: autor.id,
        adminUsuario: autor.usuario,
        adminNome: autor.nome,
      }),
  });

  return NextResponse.json(resumo);
}
