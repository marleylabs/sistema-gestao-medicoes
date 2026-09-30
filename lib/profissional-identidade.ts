import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePersonName } from "@/lib/cadastro-fornecedor";

/**
 * Resolução CENTRAL de uma identidade operacional escrita em fonte externa (máscara de medição,
 * mapa, BM AUX, texto digitado) → Profissional canônico. Mesma ordem do ETL
 * (etl/ingest_medicoes.py::resolve_operational_identity):
 *
 *   1. CÓDIGO canônico   — Profissional.codigo igual (case-insensitive, espaços nas pontas ignorados).
 *   2. ALIAS             — ProfissionalAlias ativo com aliasNormalizado = normalizePersonName(valor).
 *                          1 Profissional distinto → resolvido; 2+ → AMBÍGUO (nunca escolhe).
 *   3. NOME de legado    — Profissional SEM código com nome igual (compatibilidade com identidades
 *                          operacionais antigas; nunca cria nada).
 *   4. Nada casou        — NAO_RESOLVIDO. Nunca cria Profissional, nunca usa CNPJ/razão social,
 *                          nunca compara nomes "parecidos".
 *
 * Profissionais excluídos definitivamente (deletedAt) nunca resolvem.
 */
export type IdentidadeResolvida = {
  status: "RESOLVIDO";
  via: "CODIGO" | "ALIAS" | "NOME_LEGADO";
  profissionalId: string;
  /** Identidade operacional canônica — `codigo || nome` (mesma convenção de lib/cadastro-fornecedor.ts). */
  codigoCanonico: string;
};

export type ResolucaoIdentidade =
  | IdentidadeResolvida
  | { status: "NAO_RESOLVIDO"; valor: string }
  | { status: "AMBIGUO"; valor: string; candidatos: Array<{ profissionalId: string; codigoCanonico: string }> };

type Cliente = Pick<PrismaClient, "profissional" | "profissionalAlias"> | Pick<Prisma.TransactionClient, "profissional" | "profissionalAlias">;

/** Normalização única de alias (documentada): normalizePersonName — sem acento, pontuação vira espaço, espaços colapsados, maiúsculas. */
export function normalizarAlias(valor: string | null | undefined) {
  return normalizePersonName(valor).trim();
}

export async function resolverIdentidadeOperacional(valorBruto: string | null | undefined, cliente: Cliente = prisma): Promise<ResolucaoIdentidade> {
  const valor = String(valorBruto ?? "").trim();
  if (!valor) return { status: "NAO_RESOLVIDO", valor };

  const porCodigo = await cliente.profissional.findMany({
    where: { deletedAt: null, codigo: { equals: valor, mode: "insensitive" } },
    select: { id: true, codigo: true, nome: true },
  });
  if (porCodigo.length === 1) {
    return { status: "RESOLVIDO", via: "CODIGO", profissionalId: porCodigo[0].id, codigoCanonico: porCodigo[0].codigo || porCodigo[0].nome };
  }
  if (porCodigo.length > 1) {
    return { status: "AMBIGUO", valor, candidatos: porCodigo.map((p) => ({ profissionalId: p.id, codigoCanonico: p.codigo || p.nome })) };
  }

  const chave = normalizarAlias(valor);
  if (chave) {
    const aliases = await cliente.profissionalAlias.findMany({
      where: { ativo: true, aliasNormalizado: chave, profissional: { deletedAt: null } },
      select: { profissional: { select: { id: true, codigo: true, nome: true } } },
    });
    const distintos = new Map(aliases.map((a) => [a.profissional.id, a.profissional]));
    if (distintos.size === 1) {
      const [p] = distintos.values();
      return { status: "RESOLVIDO", via: "ALIAS", profissionalId: p.id, codigoCanonico: p.codigo || p.nome };
    }
    if (distintos.size > 1) {
      return { status: "AMBIGUO", valor, candidatos: [...distintos.values()].map((p) => ({ profissionalId: p.id, codigoCanonico: p.codigo || p.nome })) };
    }
  }

  const legados = await cliente.profissional.findMany({
    where: { deletedAt: null, codigo: null, nome: { equals: valor, mode: "insensitive" } },
    select: { id: true, nome: true },
  });
  if (legados.length === 1) {
    return { status: "RESOLVIDO", via: "NOME_LEGADO", profissionalId: legados[0].id, codigoCanonico: legados[0].nome };
  }
  if (legados.length > 1) {
    return { status: "AMBIGUO", valor, candidatos: legados.map((p) => ({ profissionalId: p.id, codigoCanonico: p.nome })) };
  }
  return { status: "NAO_RESOLVIDO", valor };
}

/** Aliases ativos de uma identidade (para busca/apresentação e para a ponte do portal). */
export async function aliasesDaIdentidade(profissionalId: string, cliente: Cliente = prisma) {
  const aliases = await cliente.profissionalAlias.findMany({
    where: { profissionalId, ativo: true },
    select: { alias: true },
    orderBy: { alias: "asc" },
  });
  return aliases.map((a) => a.alias);
}
