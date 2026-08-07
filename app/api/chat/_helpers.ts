import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/session";
import { normalizeAccessUsername, toColaboradorCodigo } from "@/lib/usuario-format";
import { getColaboradorCodigoAliases } from "@/lib/colaborador-alias";

export function avatarUrlByUserId(id: string, updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?userId=${encodeURIComponent(id)}&v=${updatedAt.getTime()}` : null;
}

export function isOnline(onlineAt: Date | null | undefined) {
  return !!onlineAt && Date.now() - onlineAt.getTime() <= 2 * 60 * 1000;
}

export function canChatWith(current: AuthUser, targetPerfil: string) {
  if (current.perfil === "ADMINISTRATIVO" || targetPerfil === "ADMINISTRATIVO") return false;
  if (current.perfil === "COLABORADOR") return ["MEDICAO", "ADMIN", "FINANCEIRO"].includes(targetPerfil);
  if (["MEDICAO", "ADMIN", "FINANCEIRO"].includes(current.perfil)) return true;
  return false;
}

export function canUseChatPerfil(perfil: string) {
  return perfil !== "ADMINISTRATIVO";
}

export function isInternalPerfil(perfil: string) {
  return ["MEDICAO", "ADMIN", "FINANCEIRO"].includes(perfil);
}

export function directChatKey(a: string, b: string) {
  return ["DIRECT", ...[a, b].sort()].join(":");
}

export async function ensureChatParticipant(conversaId: string, usuarioId: string) {
  return prisma.chatParticipante.findUnique({
    where: { conversaId_usuarioId: { conversaId, usuarioId } },
  });
}

export async function joinSharedFornecedorChats(user: AuthUser) {
  if (!isInternalPerfil(user.perfil)) return;

  const conversas = await prisma.chatConversa.findMany({
    where: {
      participantes: { some: { usuario: { perfil: "COLABORADOR" } } },
      AND: [{ participantes: { some: { usuario: { perfil: { in: ["MEDICAO", "ADMIN", "FINANCEIRO"] } } } } }],
    },
    select: { id: true },
    take: 200,
  });

  for (const conversa of conversas) {
    await prisma.chatParticipante.upsert({
      where: { conversaId_usuarioId: { conversaId: conversa.id, usuarioId: user.id } },
      create: { conversaId: conversa.id, usuarioId: user.id },
      update: {},
    });
  }
}

export async function importSgcChatsForUser(user: AuthUser) {
  const chatActions = ["SOLICITAR_REVISAO", "RESPONDER_REVISAO", "RESPONDER_MEDICAO"];
  const aliases = user.perfil === "COLABORADOR" ? await getColaboradorCodigoAliases(user.usuario) : [];
  const logs = await prisma.sgcLog.findMany({
    where: {
      acao: { in: chatActions },
      observacao: { not: null },
      ...(user.perfil === "COLABORADOR" ? { colaboradorCodigo: { in: aliases } } : {}),
    },
    select: {
      id: true,
      sgcId: true,
      colaboradorCodigo: true,
      ciclo: true,
      usuarioId: true,
      usuarioNome: true,
      acao: true,
      observacao: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  if (!logs.length) return;

  const medicaoUsers = await prisma.usuario.findMany({
    where: { perfil: { in: ["MEDICAO", "ADMIN"] }, ativo: true },
    select: { id: true, nome: true },
    orderBy: [{ perfil: "asc" }, { nome: "asc" }],
    take: 1,
  });
  const defaultMedicaoUser = medicaoUsers[0] ?? (["MEDICAO", "ADMIN"].includes(user.perfil) ? { id: user.id, nome: user.nome } : null);
  if (!defaultMedicaoUser) return;

  const colaboradorCodigos = Array.from(new Set(logs.map((log) => log.colaboradorCodigo)));
  const cadastros = colaboradorCodigos.length
    ? await prisma.cadastroFornecedor.findMany({
        where: { colaboradorCodigo: { in: colaboradorCodigos } },
        select: { colaboradorCodigo: true, responsavel: true },
      })
    : [];
  const cadastroResponsaveis = Array.from(new Set(cadastros.map((cadastro) => cadastro.responsavel).filter(Boolean)));
  const fornecedores = await prisma.usuario.findMany({
    where: {
      perfil: "COLABORADOR",
      OR: [
        { usuario: { in: Array.from(new Set([...colaboradorCodigos, ...colaboradorCodigos.map(normalizeAccessUsername)])) } },
        ...(cadastroResponsaveis.length ? [{ nome: { in: cadastroResponsaveis } }] : []),
      ],
    },
    select: { id: true, usuario: true, nome: true },
  });
  const fornecedorByCodigo = new Map<string, string>();
  for (const fornecedor of fornecedores) {
    fornecedorByCodigo.set(fornecedor.usuario, fornecedor.id);
    fornecedorByCodigo.set(toColaboradorCodigo(fornecedor.usuario), fornecedor.id);
    cadastros
      .filter((cadastro) => cadastro.responsavel === fornecedor.nome)
      .forEach((cadastro) => cadastro.colaboradorCodigo && fornecedorByCodigo.set(cadastro.colaboradorCodigo, fornecedor.id));
  }

  for (const log of logs) {
    const fornecedorId = fornecedorByCodigo.get(log.colaboradorCodigo);
    if (!fornecedorId) continue;
    const medicaoAutorId = log.acao === "RESPONDER_REVISAO" ? (log.usuarioId ?? defaultMedicaoUser.id) : defaultMedicaoUser.id;
    const autorId = log.acao === "RESPONDER_REVISAO" ? medicaoAutorId : fornecedorId;
    const targetIds = [fornecedorId, medicaoAutorId];
    if (user.perfil === "COLABORADOR" && !targetIds.includes(user.id)) continue;
    if (user.perfil !== "COLABORADOR" && !isInternalPerfil(user.perfil)) continue;

    const chave = `DIRECT:${[fornecedorId, medicaoAutorId].sort().join(":")}`;
    const conversa = await prisma.chatConversa.upsert({
      where: { chave },
      create: {
        chave,
        tipo: "DIRETA",
        participantes: {
          create: [
            { usuarioId: fornecedorId },
            { usuarioId: medicaoAutorId },
          ],
        },
        updatedAt: log.createdAt,
        createdAt: log.createdAt,
      },
      update: { updatedAt: log.createdAt },
      select: { id: true },
    });

    await prisma.chatMensagem.upsert({
      where: { origem: `sgc:${log.id}` },
      create: {
        conversaId: conversa.id,
        autorId,
        texto: log.observacao?.trim() || "Mensagem",
        origem: `sgc:${log.id}`,
        createdAt: log.createdAt,
      },
      update: {},
    });
  }
}
