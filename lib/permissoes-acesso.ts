import "server-only";

import { prisma } from "@/lib/prisma";
import { VALID_PERMISSOES, PERMISSOES_BASE_POR_PERFIL, isValidPermissao, type Permissao } from "@/lib/permissoes";

export async function getPermissoesExtras(usuarioId: string): Promise<Permissao[]> {
  const rows = await prisma.usuarioPermissao.findMany({ where: { usuarioId }, select: { permissao: true } });
  return rows.map((r) => r.permissao).filter(isValidPermissao);
}

/**
 * Autorização efetiva: ADMIN sempre true (item 9); depois checa o que o perfil já dá de base;
 * por último, se existe uma concessão extra gravada para este usuário específico. NUNCA modela
 * "perfil X sempre vê Y" fora dessas duas fontes explícitas (perfil base ou grant nominal) —
 * é exatamente a regra proibida no pedido (item 5).
 */
export async function hasPermissao(user: { id: string; perfil: string }, permissao: Permissao): Promise<boolean> {
  if (user.perfil === "ADMIN") return true;
  if (PERMISSOES_BASE_POR_PERFIL[user.perfil]?.includes(permissao)) return true;
  const extras = await getPermissoesExtras(user.id);
  return extras.includes(permissao);
}

/** Conjunto efetivo de permissões (base do perfil + extras concedidas) — usado pelo frontend para
 * decidir o que mostrar sem precisar reimplementar a regra em cada componente. */
export async function getEffectivePermissions(user: { id: string; perfil: string }): Promise<Permissao[]> {
  if (user.perfil === "ADMIN") return [...VALID_PERMISSOES];
  const base = PERMISSOES_BASE_POR_PERFIL[user.perfil] ?? [];
  const extras = await getPermissoesExtras(user.id);
  return Array.from(new Set([...base, ...extras]));
}
