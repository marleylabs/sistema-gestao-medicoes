import type { PrismaClient } from "@prisma/client";

/**
 * Equipes fixas desabilitadas: a conversa (e qualquer histórico associado) permanece no banco,
 * mas não aceita novas mensagens nem é exibida como ativa. Hoje só "Financeiro".
 */
const DISABLED_TEAM_PROFILES = new Set(["FINANCEIRO"]);

export function teamPerfilFromChave(chave: string) {
  const parts = chave.split(":");
  return parts[0] === "TEAM" ? parts[1] ?? null : null;
}

export function isDisabledTeamChave(chave: string) {
  const perfil = teamPerfilFromChave(chave);
  return !!perfil && DISABLED_TEAM_PROFILES.has(perfil);
}

/**
 * Conversa única do fornecedor com a equipe interna (onde todos os internos entram, via
 * joinSharedFornecedorChats). Todo caminho que cria conversa com fornecedor reusa esta, senão o
 * chat duplica (ex.: DIRECT criada pela equipe + TEAM:MEDICAO:<id> criada pelo fornecedor).
 */
export function findFornecedorConversa(db: Pick<PrismaClient, "chatConversa">, fornecedorId: string) {
  return db.chatConversa.findFirst({
    where: {
      participantes: { some: { usuarioId: fornecedorId } },
      AND: [{ participantes: { some: { usuario: { perfil: { in: ["MEDICAO", "ADMIN", "FINANCEIRO"] } } } } }],
      NOT: Array.from(DISABLED_TEAM_PROFILES).map((perfil) => ({ chave: { startsWith: `TEAM:${perfil}:` } })),
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
}
