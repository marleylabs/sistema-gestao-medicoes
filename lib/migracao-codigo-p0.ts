import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getColaboradorEscopo } from "@/lib/colaborador-alias";
import { normalizarAlias, resolverIdentidadeOperacional } from "@/lib/profissional-identidade";

/**
 * Migração para o P0 como único ID do fornecedor (docs/brain/specs/p2-vinculo-login-profissional.md,
 * decisão 012). `planejarMigracaoP0` só LÊ: classifica cada usuário COLABORADOR ativo e conta as
 * linhas que a migração reescreveria. `aplicarMigracaoP0` troca o código antigo pelo P0 (uma transação
 * por fornecedor, com alias do código antigo e auditoria); `medirMigracaoP0` confere o resultado e
 * `reverterMigracaoP0` desfaz pela auditoria. `admin_audit_logs` fica fora de propósito (guarda o
 * código da época).
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
const TABELAS = Object.keys(COLUNAS_CODIGO_FORNECEDOR) as TabelaCodigoFornecedor[];

export type ClasseMigracaoP0 = "MIGRAVEL" | "JA_E_P0" | "SEM_IDENTIDADE" | "CONFLITO";
export type MotivoConflitoP0 = "LOGIN_EM_USO" | "PROFISSIONAL_COM_VARIOS_LOGINS" | "CADASTRO_MULTIPLO" | "ALIAS_EM_USO";
export type UsuarioMigracaoP0 = {
  login: string;
  classe: ClasseMigracaoP0;
  motivo: MotivoConflitoP0 | null;
  profissionalId: string | null;
  /** Código gravado hoje (`codigo || nome`, mesma convenção do resolver). Nunca impresso. */
  codigoAtual: string | null;
  linhas: Record<TabelaCodigoFornecedor, number>;
};
type Linhas = Record<TabelaCodigoFornecedor, number>;

const ACAO = "FORNECEDOR_CODIGO_P0";
const ACAO_REVERTIDO = "FORNECEDOR_CODIGO_P0_REVERTIDO";
const chave = (valor: string) => valor.trim().toUpperCase();
// Identificadores vêm de COLUNAS_CODIGO_FORNECEDOR, nunca de entrada externa; os valores são parâmetros.
const onde = (tabela: TabelaCodigoFornecedor, codigo: string) => Prisma.sql`
  upper(trim(${Prisma.raw(COLUNAS_CODIGO_FORNECEDOR[tabela])})) = ${chave(codigo)}
  ${tabela === "mapa_pagamento_itens" ? Prisma.sql`and identidade_importacao_id is null` : Prisma.empty}`;

/** Linhas por código (comparação `upper(trim())`, como lib/ciclo-cleanup.ts), por tabela. */
async function contarLinhas(codigos: string[]) {
  const porTabela = {} as Record<TabelaCodigoFornecedor, Map<string, number>>;
  for (const tabela of TABELAS) {
    const coluna = Prisma.raw(COLUNAS_CODIGO_FORNECEDOR[tabela]);
    const rows = codigos.length
      ? await prisma.$queryRaw<Array<{ codigo: string; n: number }>>`
          select upper(trim(${coluna})) as codigo, count(*)::int as n
          from ${Prisma.raw(tabela)}
          where upper(trim(${coluna})) = any(${codigos})
          ${tabela === "mapa_pagamento_itens" ? Prisma.sql`and identidade_importacao_id is null` : Prisma.empty}
          group by 1`
      : [];
    porTabela[tabela] = new Map(rows.map((r) => [r.codigo, r.n]));
  }
  return porTabela;
}

async function contarLinhasDe(codigo: string): Promise<Linhas> {
  const mapas = await contarLinhas([chave(codigo)]);
  return Object.fromEntries(TABELAS.map((t) => [t, mapas[t].get(chave(codigo)) ?? 0])) as Linhas;
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
    // O código antigo vira alias: se já é alias de outro, a planilha ficaria ambígua depois da troca.
    const aliasDeOutro = await prisma.profissionalAlias.count({
      where: { ativo: true, aliasNormalizado: normalizarAlias(codigoAtual), profissionalId: { not: profissionalId }, profissional: { deletedAt: null } },
    });
    const motivo: MotivoConflitoP0 | null = !loginLivre ? "LOGIN_EM_USO" : aliasDeOutro ? "ALIAS_EM_USO" : null;
    base.push({ login, classe: motivo ? "CONFLITO" : "MIGRAVEL", motivo, profissionalId, codigoAtual });
  }

  const loginsPorProfissional = new Map<string, number>();
  for (const u of base) if (u.profissionalId) loginsPorProfissional.set(u.profissionalId, (loginsPorProfissional.get(u.profissionalId) ?? 0) + 1);

  const linhas = await contarLinhas([...new Set(base.flatMap((u) => (u.codigoAtual ? [chave(u.codigoAtual)] : [])))]);
  const resultado: UsuarioMigracaoP0[] = base.map((u) => {
    const k = u.codigoAtual ? chave(u.codigoAtual) : null;
    const contagem = Object.fromEntries(TABELAS.map((t) => [t, k ? linhas[t].get(k) ?? 0 : 0])) as Linhas;
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

async function adminAtivo(adminLogin: string) {
  const admin = await prisma.usuario.findUnique({ where: { usuario: adminLogin.trim().toUpperCase() }, select: { id: true, usuario: true, nome: true, perfil: true, ativo: true, excluidoAt: true } });
  if (!admin || admin.perfil !== "ADMIN" || !admin.ativo || admin.excluidoAt) throw new Error("Informe o login de um ADMIN ativo para registrar a auditoria.");
  return admin;
}

type Falha = { login: string; erro: string };
// Só o código do erro: a mensagem do Postgres pode trazer valores de outro fornecedor.
const codigoDoErro = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof Error ? error.name : "ERRO";

class ProfissionalMudouError extends Error {
  name = "PROFISSIONAL_MUDOU";
}

/** Troca o código antigo pelo P0 nos fornecedores MIGRAVEL (todos, ou só os `logins` informados). */
export async function aplicarMigracaoP0({ adminLogin, logins }: { adminLogin: string; logins?: string[] }) {
  const admin = await adminAtivo(adminLogin);
  const { usuarios } = await planejarMigracaoP0();
  const alvo = usuarios.filter((u) => u.classe === "MIGRAVEL" && (!logins || logins.includes(u.login)));
  const migrados: string[] = [];
  const falhas: Falha[] = [];

  for (const u of alvo) {
    const profissionalId = u.profissionalId!;
    const codigoAnterior = u.codigoAtual!;
    try {
      await prisma.$transaction(async (tx) => {
        const [atual] = await tx.$queryRaw<Array<{ codigo: string | null; nome: string }>>`
          select codigo, nome from profissionais where id = ${profissionalId}::uuid for update`;
        if (!atual || (atual.codigo || atual.nome) !== codigoAnterior) throw new ProfissionalMudouError();

        const aliasNormalizado = normalizarAlias(codigoAnterior);
        const existente = await tx.profissionalAlias.findUnique({
          where: { profissionalId_aliasNormalizado: { profissionalId, aliasNormalizado } },
          select: { id: true, ativo: true },
        });
        let aliasCriadoId: string | null = null;
        let aliasReativadoId: string | null = null;
        if (!existente) {
          aliasCriadoId = (await tx.profissionalAlias.create({
            data: { profissionalId, alias: codigoAnterior, aliasNormalizado, origem: "MIGRACAO_P0", createdById: admin.id, createdByNome: admin.nome },
            select: { id: true },
          })).id;
        } else if (!existente.ativo) {
          await tx.profissionalAlias.update({ where: { id: existente.id }, data: { ativo: true, updatedAt: new Date() } });
          aliasReativadoId = existente.id;
        }

        await tx.profissional.update({ where: { id: profissionalId }, data: { codigo: u.login, updatedAt: new Date() } });
        const linhas = {} as Linhas;
        for (const tabela of TABELAS) {
          linhas[tabela] = await tx.$executeRaw`
            update ${Prisma.raw(tabela)} set ${Prisma.raw(COLUNAS_CODIGO_FORNECEDOR[tabela])} = ${u.login}
            where ${onde(tabela, codigoAnterior)}`;
        }
        await tx.adminAuditLog.create({
          data: {
            action: ACAO, adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
            targetType: "Profissional", targetId: profissionalId, targetCodigo: u.login,
            reason: "P0 como único ID do fornecedor (decisão 012)",
            metadata: { codigoAnterior, codigoEraNulo: atual.codigo === null, codigoNovo: u.login, linhas, aliasCriadoId, aliasReativadoId },
          },
        });
      }, { timeout: 60_000 });
      migrados.push(u.login);
    } catch (error) {
      falhas.push({ login: u.login, erro: codigoDoErro(error) });
    }
  }
  return { migrados, falhas };
}

type RegistroMigracao = { auditId: string; profissionalId: string; login: string; codigoAnterior: string; codigoEraNulo: boolean; linhas: Linhas; aliasCriadoId: string | null; aliasReativadoId: string | null };

/** Migrações ainda em vigor: auditoria FORNECEDOR_CODIGO_P0 cujo Profissional continua com o P0. */
async function migracoesEmVigor(logins?: string[]): Promise<RegistroMigracao[]> {
  const registros = await prisma.adminAuditLog.findMany({
    where: { action: ACAO, ...(logins ? { targetCodigo: { in: logins } } : {}) },
    select: { id: true, targetId: true, targetCodigo: true, metadata: true },
    orderBy: { createdAt: "desc" },
  });
  const vistos = new Set<string>();
  const emVigor: RegistroMigracao[] = [];
  for (const r of registros) {
    if (!r.targetId || !r.targetCodigo || vistos.has(r.targetId)) continue;
    vistos.add(r.targetId);
    const p = await prisma.profissional.findUnique({ where: { id: r.targetId }, select: { codigo: true } });
    if (p?.codigo !== r.targetCodigo) continue;
    const meta = (r.metadata ?? {}) as { codigoAnterior?: unknown; codigoEraNulo?: unknown; linhas?: unknown; aliasCriadoId?: unknown; aliasReativadoId?: unknown };
    if (typeof meta.codigoAnterior !== "string") continue;
    emVigor.push({
      auditId: r.id, profissionalId: r.targetId, login: r.targetCodigo, codigoAnterior: meta.codigoAnterior, codigoEraNulo: meta.codigoEraNulo === true,
      linhas: (meta.linhas ?? {}) as Linhas,
      aliasCriadoId: typeof meta.aliasCriadoId === "string" ? meta.aliasCriadoId : null,
      aliasReativadoId: typeof meta.aliasReativadoId === "string" ? meta.aliasReativadoId : null,
    });
  }
  return emVigor;
}

/** Confere cada fornecedor migrado: login resolve pelo código, escopo e cadastro únicos, linhas iguais às migradas e nenhuma sobra do código antigo. */
export async function medirMigracaoP0({ logins }: { logins?: string[] } = {}) {
  const resultado: Array<{ login: string; ok: boolean; problemas: string[] }> = [];
  for (const r of await migracoesEmVigor(logins)) {
    const problemas: string[] = [];
    const doLogin = await resolverIdentidadeOperacional(r.login);
    if (doLogin.status !== "RESOLVIDO" || doLogin.via !== "CODIGO" || doLogin.profissionalId !== r.profissionalId) problemas.push("LOGIN_NAO_RESOLVE");
    const escopo = await getColaboradorEscopo(r.login);
    if (escopo.profissionalId !== r.profissionalId || !escopo.cadastroId) problemas.push("ESCOPO_DIVERGENTE");
    const [agora, sobra] = await Promise.all([contarLinhasDe(r.login), contarLinhasDe(r.codigoAnterior)]);
    if (agora.cadastros_fornecedores !== 1) problemas.push("CADASTRO_NAO_UNICO");
    for (const t of TABELAS) {
      if (agora[t] !== (r.linhas[t] ?? 0)) problemas.push(`LINHAS_${t}`);
      if (sobra[t]) problemas.push(`SOBRA_CODIGO_ANTIGO_${t}`);
    }
    resultado.push({ login: r.login, ok: problemas.length === 0, problemas });
  }
  return resultado;
}

/**
 * Desfaz a migração pela auditoria. Use só antes da primeira importação depois da migração: linhas
 * gravadas com o P0 depois dela também voltam para o código antigo (o que o app antigo espera).
 */
export async function reverterMigracaoP0({ adminLogin, logins }: { adminLogin: string; logins?: string[] }) {
  const admin = await adminAtivo(adminLogin);
  const revertidos: string[] = [];
  const falhas: Falha[] = [];
  for (const r of await migracoesEmVigor(logins)) {
    try {
      await prisma.$transaction(async (tx) => {
        const [atual] = await tx.$queryRaw<Array<{ codigo: string | null }>>`select codigo from profissionais where id = ${r.profissionalId}::uuid for update`;
        if (atual?.codigo !== r.login) throw new ProfissionalMudouError();
        const linhas = {} as Linhas;
        for (const tabela of TABELAS) {
          linhas[tabela] = await tx.$executeRaw`
            update ${Prisma.raw(tabela)} set ${Prisma.raw(COLUNAS_CODIGO_FORNECEDOR[tabela])} = ${r.codigoAnterior}
            where ${onde(tabela, r.login)}`;
        }
        // Profissional legado (sem código) resolvia pelo nome: volta ao mesmo estado.
        await tx.profissional.update({ where: { id: r.profissionalId }, data: { codigo: r.codigoEraNulo ? null : r.codigoAnterior, updatedAt: new Date() } });
        if (r.aliasCriadoId) await tx.profissionalAlias.deleteMany({ where: { id: r.aliasCriadoId } });
        if (r.aliasReativadoId) await tx.profissionalAlias.updateMany({ where: { id: r.aliasReativadoId }, data: { ativo: false, updatedAt: new Date() } });
        await tx.adminAuditLog.create({
          data: {
            action: ACAO_REVERTIDO, adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
            targetType: "Profissional", targetId: r.profissionalId, targetCodigo: r.codigoAnterior,
            reason: "Reversão da migração para o P0", metadata: { auditMigracaoId: r.auditId, linhas },
          },
        });
      }, { timeout: 60_000 });
      revertidos.push(r.login);
    } catch (error) {
      falhas.push({ login: r.login, erro: codigoDoErro(error) });
    }
  }
  return { revertidos, falhas };
}
