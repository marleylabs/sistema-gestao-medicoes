import "server-only";

import { Prisma } from "@prisma/client";
import { generateUniqueInternalAccessCode } from "@/lib/auth";

/**
 * O P0 (login do fornecedor) é o único ID do fornecedor (decisão 012): é também o
 * `Profissional.codigo`, o `CadastroFornecedor.colaboradorCodigo` e o código gravado nas tabelas de
 * dados abaixo. `admin_audit_logs` fica fora de propósito (guarda o código da época).
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
export type LinhasPorTabela = Record<TabelaCodigoFornecedor, number>;
export const TABELAS_CODIGO_FORNECEDOR = Object.keys(COLUNAS_CODIGO_FORNECEDOR) as TabelaCodigoFornecedor[];

export const chaveCodigo = (valor: string) => valor.trim().toUpperCase();
/** Filtro `upper(trim(coluna)) = código` (como lib/ciclo-cleanup.ts). Identificadores vêm da constante acima, nunca de entrada externa. */
export const ondeCodigo = (tabela: TabelaCodigoFornecedor, codigo: string) => Prisma.sql`
  upper(trim(${Prisma.raw(COLUNAS_CODIGO_FORNECEDOR[tabela])})) = ${chaveCodigo(codigo)}
  ${tabela === "mapa_pagamento_itens" ? Prisma.sql`and identidade_importacao_id is null` : Prisma.empty}`;

export const ACAO_CODIGO_P0 = "FORNECEDOR_CODIGO_P0";
export type AutorAuditoria = { id: string; usuario: string; nome: string };
type Tx = Prisma.TransactionClient;

export class ProfissionalMudouError extends Error {
  name = "PROFISSIONAL_MUDOU";
}
export class P0EmUsoError extends Error {
  name = "P0_EM_USO";
}

/** O P0 já identifica outro Profissional (código, nome legado ou alias ativo)? */
async function p0EmUso(tx: Tx, p0: string, exceto?: string) {
  const outro = exceto ? { id: { not: exceto } } : {};
  const [porCodigo, porAlias] = await Promise.all([
    tx.profissional.count({ where: { ...outro, OR: [{ codigo: { equals: p0, mode: "insensitive" } }, { codigo: null, nome: { equals: p0, mode: "insensitive" } }] } }),
    tx.profissionalAlias.count({ where: { ativo: true, aliasNormalizado: chaveCodigo(p0), ...(exceto ? { profissionalId: { not: exceto } } : {}) } }),
  ]);
  return porCodigo + porAlias > 0;
}

type ClienteUsuario = Pick<Prisma.TransactionClient, "usuario" | "profissional">;
const USUARIO_DO_FORNECEDOR = { id: true, usuario: true, nome: true, ativo: true, excluidoAt: true, perfil: true } as const;

/**
 * Usuário(s) COLABORADOR do fornecedor: o do login igual ao código (P0). Só quando nenhum login é
 * o código (identidade de antes do P0) e há `nomeLegado`, cai no nome, e nunca no usuário de outro
 * fornecedor já em P0 (login igual ao código de algum Profissional). Mais de um resultado é
 * ambiguidade real: o chamador falha fechado.
 */
export async function usuariosDoFornecedor(
  cliente: ClienteUsuario,
  { codigo, nomeLegado, incluirExcluidos = false }: { codigo: string; nomeLegado?: string | null; incluirExcluidos?: boolean },
) {
  const excluido = incluirExcluidos ? {} : { excluidoAt: null };
  const porLogin = await cliente.usuario.findMany({ where: { perfil: "COLABORADOR", usuario: chaveCodigo(codigo), ...excluido }, select: USUARIO_DO_FORNECEDOR });
  if (porLogin.length || !nomeLegado) return porLogin;
  const porNome = await cliente.usuario.findMany({ where: { perfil: "COLABORADOR", nome: { equals: nomeLegado, mode: "insensitive" }, ...excluido }, select: USUARIO_DO_FORNECEDOR });
  if (!porNome.length) return porNome;
  const emP0 = new Set((await cliente.profissional.findMany({ where: { codigo: { in: porNome.map((u) => u.usuario) } }, select: { codigo: true } })).map((p) => p.codigo));
  return porNome.filter((u) => !emP0.has(u.usuario));
}

/** P0 novo: login livre e que não é código, nome legado nem alias de nenhum Profissional. */
export async function gerarP0Livre(tx: Tx) {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    const p0 = await generateUniqueInternalAccessCode(tx);
    if (!(await p0EmUso(tx, p0))) return p0;
  }
  throw new Error("Não foi possível gerar um P0 livre.");
}

/**
 * Troca o código do fornecedor pelo P0 do login, dentro da transação do chamador: o código antigo
 * vira alias (origem MIGRACAO_P0) para a planilha continuar resolvendo, e todas as tabelas de
 * COLUNAS_CODIGO_FORNECEDOR passam para o P0. Com `admin`, registra a auditoria que permite reverter.
 * `aliasNormalizado` é o código antigo normalizado pelo chamador (normalizarAlias).
 */
export async function trocarCodigoParaP0(
  tx: Tx,
  { profissionalId, codigoAnterior, aliasNormalizado, login, admin }: { profissionalId: string; codigoAnterior: string; aliasNormalizado: string; login: string; admin: AutorAuditoria | null },
) {
  const [atual] = await tx.$queryRaw<Array<{ codigo: string | null; nome: string }>>`
    select codigo, nome from profissionais where id = ${profissionalId}::uuid for update`;
  if (!atual || (atual.codigo || atual.nome) !== codigoAnterior) throw new ProfissionalMudouError();
  if (await p0EmUso(tx, login, profissionalId)) throw new P0EmUsoError();

  const existente = await tx.profissionalAlias.findUnique({
    where: { profissionalId_aliasNormalizado: { profissionalId, aliasNormalizado } },
    select: { id: true, ativo: true },
  });
  let aliasCriadoId: string | null = null;
  let aliasReativadoId: string | null = null;
  if (!existente) {
    aliasCriadoId = (await tx.profissionalAlias.create({
      data: { profissionalId, alias: codigoAnterior, aliasNormalizado, origem: "MIGRACAO_P0", createdById: admin?.id ?? null, createdByNome: admin?.nome ?? null },
      select: { id: true },
    })).id;
  } else if (!existente.ativo) {
    await tx.profissionalAlias.update({ where: { id: existente.id }, data: { ativo: true, updatedAt: new Date() } });
    aliasReativadoId = existente.id;
  }

  await tx.profissional.update({ where: { id: profissionalId }, data: { codigo: login, updatedAt: new Date() } });
  const linhas = {} as LinhasPorTabela;
  for (const tabela of TABELAS_CODIGO_FORNECEDOR) {
    linhas[tabela] = await tx.$executeRaw`
      update ${Prisma.raw(tabela)} set ${Prisma.raw(COLUNAS_CODIGO_FORNECEDOR[tabela])} = ${login}
      where ${ondeCodigo(tabela, codigoAnterior)}`;
  }
  if (admin) {
    await tx.adminAuditLog.create({
      data: {
        action: ACAO_CODIGO_P0, adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
        targetType: "Profissional", targetId: profissionalId, targetCodigo: login,
        reason: "P0 como único ID do fornecedor (decisão 012)",
        metadata: { codigoAnterior, codigoEraNulo: atual.codigo === null, codigoNovo: login, linhas, aliasCriadoId, aliasReativadoId },
      },
    });
  }
  return linhas;
}
