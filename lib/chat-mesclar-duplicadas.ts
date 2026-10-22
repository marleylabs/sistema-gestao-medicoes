import type { PrismaClient } from "@prisma/client";
import { isDisabledTeamChave } from "./chat-teams";

/**
 * Mescla as conversas duplicadas de cada fornecedor com a equipe interna (bug corrigido em
 * findFornecedorConversa). A conversa mantida é a mais recente, a mesma que findFornecedorConversa
 * escolhe; as demais têm mensagens e participantes movidos para ela e depois são apagadas.
 * Conversas de equipes desabilitadas (Financeiro) ficam de fora, como na listagem.
 */

const INTERNOS = ["MEDICAO", "ADMIN", "FINANCEIRO"];

export type GrupoDuplicado = { fornecedorId: string; login: string; manterId: string; mesclarIds: string[]; mensagens: number };

export async function planejarMesclagemChat(db: PrismaClient): Promise<GrupoDuplicado[]> {
  const conversas = await db.chatConversa.findMany({
    where: {
      participantes: { some: { usuario: { perfil: "COLABORADOR" } } },
      AND: [{ participantes: { some: { usuario: { perfil: { in: INTERNOS } } } } }],
    },
    select: {
      id: true,
      chave: true,
      participantes: { where: { usuario: { perfil: "COLABORADOR" } }, select: { usuario: { select: { id: true, usuario: true } } } },
      _count: { select: { mensagens: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const porFornecedor = new Map<string, { login: string; conversas: typeof conversas }>();
  for (const conversa of conversas) {
    // Conversa com mais de um fornecedor não tem dono único: fica como está.
    if (isDisabledTeamChave(conversa.chave) || conversa.participantes.length !== 1) continue;
    const { id, usuario } = conversa.participantes[0].usuario;
    const grupo = porFornecedor.get(id) ?? { login: usuario, conversas: [] };
    grupo.conversas.push(conversa);
    porFornecedor.set(id, grupo);
  }

  return Array.from(porFornecedor, ([fornecedorId, { login, conversas: lista }]) => ({
    fornecedorId,
    login,
    manterId: lista[0].id,
    mesclarIds: lista.slice(1).map((c) => c.id),
    mensagens: lista.slice(1).reduce((total, c) => total + c._count.mensagens, 0),
  })).filter((grupo) => grupo.mesclarIds.length > 0);
}

export async function aplicarMesclagemChat(db: PrismaClient, grupos: GrupoDuplicado[]) {
  let mensagensMovidas = 0;
  for (const { manterId, mesclarIds } of grupos) {
    await db.$transaction(async (tx) => {
      // Trava as duplicadas: uma mensagem enviada a elas durante a mesclagem espera e depois falha,
      // em vez de ser apagada em cascata junto com a conversa.
      await tx.$queryRaw`SELECT id FROM chat_conversas WHERE id = ANY(${mesclarIds}::uuid[]) FOR UPDATE`;
      const movidas = await tx.chatMensagem.updateMany({ where: { conversaId: { in: mesclarIds } }, data: { conversaId: manterId } });
      mensagensMovidas += movidas.count;

      const jaNaMantida = new Set((await tx.chatParticipante.findMany({ where: { conversaId: manterId }, select: { usuarioId: true } })).map((p) => p.usuarioId));
      const vindos = await tx.chatParticipante.findMany({
        where: { conversaId: { in: mesclarIds } },
        select: { usuarioId: true, ultimoLidoAt: true },
        orderBy: { ultimoLidoAt: { sort: "asc", nulls: "first" } },
      });
      // Quem já está na mantida conserva a marca de leitura dela (mensagens movidas mais novas aparecem
      // como não lidas, nunca o contrário). Quem só estava na duplicada leva a marca mais antiga.
      for (const { usuarioId, ultimoLidoAt } of vindos) {
        if (jaNaMantida.has(usuarioId)) continue;
        jaNaMantida.add(usuarioId);
        await tx.chatParticipante.create({ data: { conversaId: manterId, usuarioId, ultimoLidoAt } });
      }

      const maisRecente = await tx.chatConversa.aggregate({ where: { id: { in: [manterId, ...mesclarIds] } }, _max: { updatedAt: true } });
      await tx.chatConversa.update({ where: { id: manterId }, data: { updatedAt: maisRecente._max.updatedAt ?? new Date() } });
      await tx.chatConversa.deleteMany({ where: { id: { in: mesclarIds } } });
    });
  }
  return { fornecedores: grupos.length, conversasRemovidas: grupos.reduce((t, g) => t + g.mesclarIds.length, 0), mensagensMovidas };
}
