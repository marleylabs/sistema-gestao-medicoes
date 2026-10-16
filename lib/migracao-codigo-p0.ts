import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getColaboradorEscopo } from "@/lib/colaborador-alias";
import { resolverIdentidadeOperacional } from "@/lib/profissional-identidade";

/**
 * Migração para o P0 como único ID do fornecedor (docs/brain/specs/p2-vinculo-login-profissional.md,
 * decisão 012). Este módulo só LÊ: classifica cada usuário COLABORADOR ativo e conta as linhas que a
 * migração reescreveria. `admin_audit_logs` fica fora de propósito (guarda o código da época).
 */
export const COLUNAS_CODIGO_FORNECEDOR = {
  cadastros_fornecedores: "colaborador_codigo",
  sgc_aprovacoes_medicao: "colaborador_codigo",
  divergencias_medicao: "colaborador_codigo",
  // Linha com identidade pendente guarda o nome da planilha, não um código: não migra.
  mapa_pagamento_itens: "projetista_codigo",
  bm_aux_medicoes: "responsavel_codigo",
  sgc_logs: "colaborador_codigo",
} as const;
export type TabelaCodigoFornecedor = keyof typeof COLUNAS_CODIGO_FORNECEDOR;

export type ClasseMigracaoP0 = "MIGRAVEL" | "JA_E_P0" | "SEM_IDENTIDADE" | "CONFLITO";
export type MotivoConflitoP0 = "LOGIN_EM_USO" | "PROFISSIONAL_COM_VARIOS_LOGINS" | "CADASTRO_MULTIPLO";
export type UsuarioMigracaoP0 = {
  login: string;
  classe: ClasseMigracaoP0;
  motivo: MotivoConflitoP0 | null;
  profissionalId: string | null;
  /** Código gravado hoje (`codigo || nome`, mesma convenção do resolver). Nunca impresso. */
  codigoAtual: string | null;
  linhas: Record<TabelaCodigoFornecedor, number>;
};

const chave = (valor: string) => valor.trim().toUpperCase();

/** Linhas por código (comparação `upper(trim())`, como lib/ciclo-cleanup.ts), por tabela. */
async function contarLinhas(codigos: string[]) {
  const porTabela = {} as Record<TabelaCodigoFornecedor, Map<string, number>>;
  for (const [tabela, coluna] of Object.entries(COLUNAS_CODIGO_FORNECEDOR) as Array<[TabelaCodigoFornecedor, string]>) {
    // Identificadores vêm da constante acima, nunca de entrada externa; os valores são parâmetros.
    const rows = codigos.length
      ? await prisma.$queryRaw<Array<{ codigo: string; n: number }>>`
          select upper(trim(${Prisma.raw(coluna)})) as codigo, count(*)::int as n
          from ${Prisma.raw(tabela)}
          where upper(trim(${Prisma.raw(coluna)})) = any(${codigos})
          ${tabela === "mapa_pagamento_itens" ? Prisma.sql`and identidade_importacao_id is null` : Prisma.empty}
          group by 1`
      : [];
    porTabela[tabela] = new Map(rows.map((r) => [r.codigo, r.n]));
  }
  return porTabela;
}

export async function planejarMigracaoP0() {
  const usuarios = await prisma.usuario.findMany({
    where: { perfil: "COLABORADOR", ativo: true, excluidoAt: null },
    select: { usuario: true },
    orderBy: { usuario: "asc" },
  });

  const base: Array<Omit<UsuarioMigracaoP0, "linhas">> = [];
  for (const { usuario: login } of usuarios) {
    const { profissionalId } = await getColaboradorEscopo(login);
    if (!profissionalId) {
      base.push({ login, classe: "SEM_IDENTIDADE", motivo: null, profissionalId: null, codigoAtual: null });
      continue;
    }
    const profissional = await prisma.profissional.findUniqueOrThrow({ where: { id: profissionalId }, select: { codigo: true, nome: true } });
    const codigoAtual = profissional.codigo || profissional.nome;
    if (chave(codigoAtual) === chave(login)) {
      base.push({ login, classe: "JA_E_P0", motivo: null, profissionalId, codigoAtual });
      continue;
    }
    const doLogin = await resolverIdentidadeOperacional(login);
    const loginLivre = doLogin.status === "NAO_RESOLVIDO" || (doLogin.status === "RESOLVIDO" && doLogin.profissionalId === profissionalId);
    base.push({ login, classe: loginLivre ? "MIGRAVEL" : "CONFLITO", motivo: loginLivre ? null : "LOGIN_EM_USO", profissionalId, codigoAtual });
  }

  const loginsPorProfissional = new Map<string, number>();
  for (const u of base) if (u.profissionalId) loginsPorProfissional.set(u.profissionalId, (loginsPorProfissional.get(u.profissionalId) ?? 0) + 1);

  const linhas = await contarLinhas([...new Set(base.flatMap((u) => (u.codigoAtual ? [chave(u.codigoAtual)] : [])))]);
  const resultado: UsuarioMigracaoP0[] = base.map((u) => {
    const k = u.codigoAtual ? chave(u.codigoAtual) : null;
    const contagem = Object.fromEntries(
      (Object.keys(COLUNAS_CODIGO_FORNECEDOR) as TabelaCodigoFornecedor[]).map((t) => [t, k ? linhas[t].get(k) ?? 0 : 0]),
    ) as Record<TabelaCodigoFornecedor, number>;
    if (u.classe === "MIGRAVEL" || u.classe === "CONFLITO") {
      // Um Profissional só pode receber um P0, e o cadastro precisa continuar único depois da troca.
      if (u.profissionalId && (loginsPorProfissional.get(u.profissionalId) ?? 0) > 1) return { ...u, classe: "CONFLITO", motivo: "PROFISSIONAL_COM_VARIOS_LOGINS", linhas: contagem };
      if (u.classe === "MIGRAVEL" && contagem.cadastros_fornecedores > 1) return { ...u, classe: "CONFLITO", motivo: "CADASTRO_MULTIPLO", linhas: contagem };
    }
    return { ...u, linhas: contagem };
  });

  const comLogin = [...loginsPorProfissional.keys()];
  const [total, semCodigo] = await Promise.all([
    prisma.profissional.count({ where: { deletedAt: null, id: { notIn: comLogin } } }),
    prisma.profissional.count({ where: { deletedAt: null, codigo: null, id: { notIn: comLogin } } }),
  ]);
  return { usuarios: resultado, profissionaisSemLogin: { total, semCodigo } };
}
