import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pareceNomeDeFornecedor } from "@/lib/identidade-plausivel";
import { normalizarAlias, resolverIdentidadeOperacional } from "@/lib/profissional-identidade";

/**
 * Identidades da importação de medição por ciclo (tabela importacao_identidades, gravada pelo ETL):
 *
 *  - PENDENTE: nome plausível da planilha sem vínculo cadastral. Está no ciclo (medições com
 *    idProfissional NULL + linha do mapa com projetistaCodigo = nome da planilha), compõe os
 *    totais e NÃO pode receber BM (lib/bm-envio-elegibilidade.ts → CADASTRO_PENDENTE).
 *  - VINCULADO: um ADMIN escolheu o cadastro (`vincularIdentidade`) — alias global criado/reutilizado,
 *    medições/mapa do ciclo passam para o Profissional canônico SEM reimportar e sem mudar valor.
 *  - AUTO_VINCULADO: correspondência determinística do ETL (alias gravado na carga).
 *  - DESCARTADO: decisão humana — o item sai do ciclo (`descartarIdentidade`) e o ETL respeita a
 *    decisão em reimportações do MESMO ciclo. Nunca exclui fornecedor, cadastro ou alias.
 *  - LINHA_SEM_PROJETISTA / DESCARTADO: descarte consciente de uma linha estrutural, antes da carga.
 *
 * Nunca cria Profissional/código provisório; similaridade nunca decide (só sugere).
 */

export type AlvoFornecedor = {
  profissionalId: string;
  codigo: string;
  responsavel: string;
  razaoSocial: string | null;
};

export const LIMITE_VALORES = 500;
const LIMITE_TEXTO = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AliasImportacaoError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

type Autor = { id: string; usuario: string; nome: string };
type Tx = Prisma.TransactionClient;

function limpar(valor: unknown) {
  return typeof valor === "string" ? valor.trim().slice(0, LIMITE_TEXTO) : "";
}

export function valoresUnicos(valores: unknown): string[] {
  if (!Array.isArray(valores)) return [];
  return [...new Set(valores.map(limpar).filter(Boolean))].slice(0, LIMITE_VALORES);
}

export function isUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** Cadastros ativos com identidade canônica (Profissional com código, não excluído). */
async function fornecedoresAtivos(where: object = {}, take?: number): Promise<AlvoFornecedor[]> {
  const cadastros = await prisma.cadastroFornecedor.findMany({
    where: { ativo: true, colaboradorCodigo: { not: null }, ...where },
    select: { colaboradorCodigo: true, responsavel: true, razaoSocial: true },
    orderBy: [{ responsavel: "asc" }],
    ...(take ? { take: take * 2 } : {}),
  });
  const codigos = [...new Set(cadastros.map((c) => c.colaboradorCodigo!))];
  if (!codigos.length) return [];
  const profissionais = await prisma.profissional.findMany({
    where: { deletedAt: null, codigo: { in: codigos } },
    select: { id: true, codigo: true },
  });
  const porCodigo = new Map(profissionais.map((p) => [p.codigo!, p.id]));
  const vistos = new Set<string>();
  const alvos: AlvoFornecedor[] = [];
  for (const c of cadastros) {
    const id = porCodigo.get(c.colaboradorCodigo!);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    alvos.push({ profissionalId: id, codigo: c.colaboradorCodigo!, responsavel: c.responsavel, razaoSocial: c.razaoSocial || null });
  }
  return take ? alvos.slice(0, take) : alvos;
}

/** Rótulo de sugestão (responsável ou código do cadastro, como o ETL devolve) → fornecedor, se único. */
export async function alvosDasSugestoes(rotulos: string[]): Promise<Record<string, AlvoFornecedor | null>> {
  const mapa: Record<string, AlvoFornecedor | null> = {};
  if (!rotulos.length) return mapa;
  const ativos = await fornecedoresAtivos({
    OR: [
      { responsavel: { in: rotulos, mode: "insensitive" } },
      { colaboradorCodigo: { in: rotulos, mode: "insensitive" } },
    ],
  });
  for (const rotulo of rotulos) {
    const chave = rotulo.toLocaleUpperCase("pt-BR");
    const candidatos = ativos.filter((a) => a.responsavel.toLocaleUpperCase("pt-BR") === chave || a.codigo.toLocaleUpperCase("pt-BR") === chave);
    mapa[rotulo] = candidatos.length === 1 ? candidatos[0] : null;
  }
  return mapa;
}

export async function buscarFornecedores(termo: string): Promise<AlvoFornecedor[]> {
  const q = limpar(termo);
  if (q.length < 2) return [];
  return fornecedoresAtivos({
    OR: [
      { responsavel: { contains: q, mode: "insensitive" } },
      { razaoSocial: { contains: q, mode: "insensitive" } },
      { colaboradorCodigo: { contains: q, mode: "insensitive" } },
    ],
  }, 20);
}

const ORIGENS: Record<string, "DOCUMENTOS" | "DOCUMENTOS_AUXILIARES" | "MAPA_PAGAMENTO"> = {
  "documentos auxiliares": "DOCUMENTOS_AUXILIARES",
  "mapa pagto": "MAPA_PAGAMENTO",
};

export function origemDoAlias(aba: string | null | undefined) {
  const primeira = String(aba ?? "").split(" / ")[0].trim().toLowerCase();
  return ORIGENS[primeira] ?? "DOCUMENTOS";
}

// ─── Listagem ─────────────────────────────────────────────────────────────────────────────────

export type IdentidadeDoCiclo = {
  id: string;
  ciclo: string;
  valorBruto: string;
  origem: string;
  status: "PENDENTE" | "VINCULADO" | "AUTO_VINCULADO" | "DESCARTADO";
  ocorrencias: number;
  linhas: number[];
  sugestoesCadastro: string[];
  codigoCanonico: string | null;
  /** Valor da(s) linha(s) do mapa deste nome no ciclo (o mesmo campo que compõe os totais). Descartado: snapshot. */
  valor: number;
  resolvidoPorNome: string | null;
  resolvidoAt: string | null;
  descartadoPorNome: string | null;
  descartadoAt: string | null;
};

export async function listarIdentidadesDoCiclo(ciclo: string): Promise<IdentidadeDoCiclo[]> {
  const registros = await prisma.importacaoIdentidade.findMany({
    where: { ciclo, tipo: "IDENTIDADE" },
    orderBy: [{ ocorrencias: "desc" }, { valorBruto: "asc" }],
    include: {
      profissional: { select: { codigo: true, nome: true } },
      mapaItens: { select: { valor: true } },
    },
  });
  return registros.map((r) => {
    const metadata = (r.metadata ?? {}) as { sugestoesCadastro?: unknown; snapshot?: { valorMapa?: number } };
    const valorMapa = r.mapaItens.reduce((soma, item) => soma + Number(item.valor ?? 0), 0);
    return {
      id: r.id,
      ciclo: r.ciclo,
      valorBruto: r.valorBruto,
      origem: r.origem,
      status: r.status as IdentidadeDoCiclo["status"],
      ocorrencias: r.ocorrencias,
      linhas: Array.isArray(r.linhas) ? (r.linhas as unknown[]).filter((n): n is number => typeof n === "number") : [],
      sugestoesCadastro: Array.isArray(metadata.sugestoesCadastro) ? metadata.sugestoesCadastro.filter((s): s is string => typeof s === "string") : [],
      codigoCanonico: r.profissional ? r.profissional.codigo || r.profissional.nome : null,
      valor: r.status === "DESCARTADO" ? Number(metadata.snapshot?.valorMapa ?? 0) : valorMapa,
      resolvidoPorNome: r.resolvidoPorNome,
      resolvidoAt: r.resolvidoAt?.toISOString() ?? null,
      descartadoPorNome: r.descartadoPorNome,
      descartadoAt: r.descartadoAt?.toISOString() ?? null,
    };
  });
}

// ─── Alias (mecanismo oficial ProfissionalAlias) ──────────────────────────────────────────────

/**
 * Cria/reutiliza o alias `alias` → `profissionalId` com as regras de scripts/dev-profissional-aliases.ts.
 * Roda dentro da transação do chamador, atrás de um lock por nome normalizado (duplo clique, duas
 * abas, dois admins nunca criam dois vínculos para o mesmo nome).
 */
async function garantirAlias(tx: Tx, input: { alias: string; profissionalId: string; origem: string; metadata: Prisma.InputJsonObject }, autor: Autor) {
  const alias = limpar(input.alias);
  const aliasNormalizado = normalizarAlias(alias);
  if (!alias || !aliasNormalizado) throw new AliasImportacaoError("Informe o nome da planilha.", 400);
  if (!pareceNomeDeFornecedor(alias)) {
    throw new AliasImportacaoError(`"${alias}" não parece um nome de fornecedor (número de documento ou descrição). Corrija a coluna PROJETISTA na planilha.`, 400);
  }
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`profissional_alias:${aliasNormalizado}`}))`;

  const alvo = await tx.profissional.findFirst({
    where: { id: input.profissionalId, deletedAt: null, codigo: { not: null } },
    select: { id: true, codigo: true },
  });
  if (!alvo?.codigo) throw new AliasImportacaoError("Fornecedor de destino não encontrado.", 404);
  const cadastro = await tx.cadastroFornecedor.findFirst({
    where: { colaboradorCodigo: alvo.codigo },
    orderBy: [{ ativo: "desc" }, { updatedAt: "desc" }],
    select: { ativo: true },
  });
  if (!cadastro) throw new AliasImportacaoError("O fornecedor de destino não tem cadastro no Painel Administrativo.", 409);
  if (!cadastro.ativo) throw new AliasImportacaoError("O cadastro do fornecedor de destino está inativo.", 409);

  const atual = await resolverIdentidadeOperacional(alias, tx);
  if (atual.status === "AMBIGUO") throw new AliasImportacaoError(`"${alias}" já corresponde a mais de um fornecedor. Resolva a ambiguidade antes de vincular.`, 409);
  if (atual.status === "RESOLVIDO" && atual.profissionalId !== alvo.id) {
    throw new AliasImportacaoError(`"${alias}" já corresponde ao fornecedor ${atual.codigoCanonico}. Um nome nunca aponta para dois fornecedores.`, 409);
  }
  const outros = await tx.profissional.findMany({ where: { deletedAt: null, NOT: { id: alvo.id } }, select: { codigo: true, nome: true } });
  const conflito = outros.find((p) => normalizarAlias(p.codigo) === aliasNormalizado || normalizarAlias(p.nome) === aliasNormalizado);
  if (conflito) {
    throw new AliasImportacaoError(`"${alias}" é o nome de outra identidade (${conflito.codigo ?? conflito.nome}). Um nome nunca aponta para dois fornecedores.`, 409);
  }
  const existentes = await tx.profissionalAlias.findMany({ where: { aliasNormalizado, ativo: true }, select: { id: true, profissionalId: true } });
  if (existentes.some((a) => a.profissionalId !== alvo.id)) {
    throw new AliasImportacaoError(`"${alias}" já é alias de outro fornecedor. Um nome nunca aponta para dois fornecedores.`, 409);
  }
  const doAlvo = existentes.find((a) => a.profissionalId === alvo.id);
  if (doAlvo) return { aliasId: doAlvo.id, criado: false, codigoCanonico: alvo.codigo, profissionalId: alvo.id };
  if (atual.status === "RESOLVIDO") return { aliasId: null, criado: false, codigoCanonico: alvo.codigo, profissionalId: alvo.id };

  const inativo = await tx.profissionalAlias.findUnique({
    where: { profissionalId_aliasNormalizado: { profissionalId: alvo.id, aliasNormalizado } },
    select: { id: true },
  });
  const registro = inativo
    ? await tx.profissionalAlias.update({
        where: { id: inativo.id },
        data: { ativo: true, alias, origem: input.origem, metadata: input.metadata, createdById: autor.id, createdByNome: autor.nome, updatedAt: new Date() },
      })
    : await tx.profissionalAlias.create({
        data: { profissionalId: alvo.id, alias, aliasNormalizado, origem: input.origem, metadata: input.metadata, createdById: autor.id, createdByNome: autor.nome },
      });
  await tx.adminAuditLog.create({
    data: {
      action: "PROFISSIONAL_ALIAS_CRIADO", adminId: autor.id, adminUsuario: autor.usuario, adminNome: autor.nome,
      targetType: "Profissional", targetId: alvo.id, targetCodigo: alvo.codigo,
      reason: "Alias vinculado na resolução de identidades da importação de medição",
      metadata: { aliasId: registro.id, alias, origem: input.origem, ...input.metadata, reativado: Boolean(inativo) },
    },
  });
  return { aliasId: registro.id, criado: true, codigoCanonico: alvo.codigo, profissionalId: alvo.id };
}

/** Trava a identidade da importação (linha) até o fim da transação: vínculo × vínculo × descarte serializados. */
async function travarIdentidade(tx: Tx, id: string) {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`importacao_identidade:${id}`}))`;
  const identidade = await tx.importacaoIdentidade.findUnique({ where: { id } });
  if (!identidade || identidade.tipo !== "IDENTIDADE") throw new AliasImportacaoError("Identidade da importação não encontrada.", 404);
  return identidade;
}

// ─── Vincular ─────────────────────────────────────────────────────────────────────────────────

export type VinculoResultado = { status: "VINCULADO" | "JA_VINCULADO"; codigoCanonico: string; medicoes: number; linhasMapa: number; aliasCriado: boolean };

/**
 * Vincula uma identidade PENDENTE a um cadastro existente: alias global + medições e linhas do mapa
 * DESTE ciclo passam para o Profissional/código canônico. Valores intocados (só identidade/vínculo);
 * o BM passa a seguir a elegibilidade normal sem reimportar. Idempotente para o mesmo alvo.
 */
export async function vincularIdentidade(
  input: { identidadeId: string; profissionalId?: string | null; codigoCanonico?: string | null },
  autor: Autor,
): Promise<VinculoResultado> {
  return prisma.$transaction(async (tx) => {
    const identidade = await travarIdentidade(tx, input.identidadeId);
    let profissionalId = input.profissionalId ?? null;
    if (!profissionalId && input.codigoCanonico) {
      const porCodigo = await tx.profissional.findMany({ where: { codigo: input.codigoCanonico.trim(), deletedAt: null }, select: { id: true } });
      profissionalId = porCodigo.length === 1 ? porCodigo[0].id : null;
    }
    if (!profissionalId || !isUuid(profissionalId)) throw new AliasImportacaoError("Fornecedor de destino não encontrado.", 404);

    if (identidade.status === "VINCULADO" || identidade.status === "AUTO_VINCULADO") {
      if (identidade.profissionalId === profissionalId) {
        const alvo = await tx.profissional.findUniqueOrThrow({ where: { id: profissionalId }, select: { codigo: true, nome: true } });
        return { status: "JA_VINCULADO", codigoCanonico: alvo.codigo || alvo.nome, medicoes: 0, linhasMapa: 0, aliasCriado: false };
      }
      throw new AliasImportacaoError(`"${identidade.valorBruto}" já foi vinculado a outro fornecedor neste ciclo.`, 409);
    }
    if (identidade.status === "DESCARTADO") throw new AliasImportacaoError(`"${identidade.valorBruto}" foi descartado deste ciclo e não pode ser vinculado.`, 409);
    if (!pareceNomeDeFornecedor(identidade.valorBruto)) {
      throw new AliasImportacaoError(`"${identidade.valorBruto}" não parece um nome de fornecedor (número de documento ou descrição). Corrija a coluna PROJETISTA na planilha.`, 400);
    }

    // BM do fornecedor de destino já com ele neste ciclo: juntar novas linhas mudaria em silêncio um
    // boletim já enviado/aprovado. Só vincula enquanto o BM ainda não saiu (ou voltou/foi cancelado).
    const destino = await tx.profissional.findFirst({ where: { id: profissionalId, deletedAt: null }, select: { codigo: true } });
    if (destino?.codigo) {
      const bm = await tx.sgcAprovacaoMedicao.findUnique({
        where: { colaboradorCodigo_ciclo: { colaboradorCodigo: destino.codigo, ciclo: identidade.ciclo } },
        select: { status: true },
      });
      if (bm && !["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA", "CANCELADO"].includes(bm.status)) {
        throw new AliasImportacaoError(`O BM de ${destino.codigo} neste ciclo já foi enviado. Retorne o BM antes de vincular "${identidade.valorBruto}" a ele.`, 409);
      }
    }

    const alias = await garantirAlias(tx, {
      alias: identidade.valorBruto,
      profissionalId,
      origem: origemDoAlias(identidade.origem),
      metadata: { fluxo: "IMPORTACAO_MEDICAO", ciclo: identidade.ciclo, identidadeImportacaoId: identidade.id },
    }, autor);

    const medicoes = await tx.medicao.updateMany({
      where: { ciclo: identidade.ciclo, identidadeImportacaoId: identidade.id, idProfissional: null },
      data: { idProfissional: alias.profissionalId },
    });
    const linhasMapa = await tx.mapaPagamentoItem.updateMany({
      where: { ciclo: identidade.ciclo, identidadeImportacaoId: identidade.id },
      data: { projetistaCodigo: alias.codigoCanonico, updatedAt: new Date() },
    });
    await tx.importacaoIdentidade.update({
      where: { id: identidade.id },
      data: { status: "VINCULADO", profissionalId: alias.profissionalId, resolvidoPorId: autor.id, resolvidoPorNome: autor.nome, resolvidoAt: new Date(), updatedAt: new Date() },
    });
    await tx.adminAuditLog.create({
      data: {
        action: "IDENTIDADE_IMPORTACAO_VINCULADA", adminId: autor.id, adminUsuario: autor.usuario, adminNome: autor.nome,
        targetType: "Profissional", targetId: alias.profissionalId, targetCodigo: alias.codigoCanonico,
        reason: "Identidade pendente da importação vinculada a um cadastro",
        metadata: { identidadeImportacaoId: identidade.id, valorBruto: identidade.valorBruto, ciclo: identidade.ciclo, medicoes: medicoes.count, linhasMapa: linhasMapa.count, aliasId: alias.aliasId },
      },
    });
    return { status: "VINCULADO", codigoCanonico: alias.codigoCanonico, medicoes: medicoes.count, linhasMapa: linhasMapa.count, aliasCriado: alias.criado };
  });
}

// ─── Descartar ────────────────────────────────────────────────────────────────────────────────

export type DescarteResultado = { status: "DESCARTADO" | "JA_DESCARTADO"; ocorrencias: number; valor: number };

/**
 * Descarta uma identidade PENDENTE deste ciclo: as medições/linhas do mapa (derivadas da planilha,
 * sem Profissional e sem BM) saem do ciclo — todos os consumidores (totais, BM, exportações,
 * e-mail) deixam de vê-las de uma vez, sem filtro paralelo. A decisão fica auditável (quem, quando,
 * ocorrências, valor e documentos) e o ETL a respeita em reimportações do mesmo ciclo. Outros
 * ciclos não são afetados; nenhum fornecedor, cadastro ou alias é tocado.
 */
export async function descartarIdentidade(identidadeId: string, autor: Autor): Promise<DescarteResultado> {
  return prisma.$transaction(async (tx) => {
    const identidade = await travarIdentidade(tx, identidadeId);
    const snapshotAnterior = (identidade.metadata as { snapshot?: { valorMapa?: number } } | null)?.snapshot;
    if (identidade.status === "DESCARTADO") {
      return { status: "JA_DESCARTADO", ocorrencias: identidade.ocorrencias, valor: Number(snapshotAnterior?.valorMapa ?? 0) };
    }
    if (identidade.status !== "PENDENTE") throw new AliasImportacaoError(`"${identidade.valorBruto}" já foi vinculado a um cadastro e não pode ser descartado aqui.`, 409);

    const medicoes = await tx.medicao.findMany({
      where: { ciclo: identidade.ciclo, identidadeImportacaoId: identidade.id, idProfissional: null },
      select: { id: true, numeroDocumento: true, valorMedicao: true },
    });
    const mapa = await tx.mapaPagamentoItem.findMany({ where: { ciclo: identidade.ciclo, identidadeImportacaoId: identidade.id }, select: { id: true, valor: true } });
    const valorMapa = mapa.reduce((soma, item) => soma + Number(item.valor ?? 0), 0);
    const snapshot = {
      medicoes: medicoes.length,
      valorMedicoes: medicoes.reduce((soma, m) => soma + Number(m.valorMedicao ?? 0), 0),
      valorMapa,
      documentos: medicoes.map((m) => m.numeroDocumento).filter(Boolean).slice(0, 50),
    };
    await tx.medicao.deleteMany({ where: { id: { in: medicoes.map((m) => m.id) } } });
    await tx.mapaPagamentoItem.deleteMany({ where: { id: { in: mapa.map((m) => m.id) } } });
    await tx.importacaoIdentidade.update({
      where: { id: identidade.id },
      data: {
        status: "DESCARTADO", descartadoPorId: autor.id, descartadoPorNome: autor.nome, descartadoAt: new Date(), updatedAt: new Date(),
        metadata: { ...((identidade.metadata ?? {}) as Prisma.JsonObject), snapshot },
      },
    });
    await tx.adminAuditLog.create({
      data: {
        action: "IDENTIDADE_IMPORTACAO_DESCARTADA", adminId: autor.id, adminUsuario: autor.usuario, adminNome: autor.nome,
        targetType: "ImportacaoIdentidade", targetId: identidade.id, targetCodigo: identidade.valorBruto,
        reason: "Identidade da importação descartada do ciclo",
        metadata: { ciclo: identidade.ciclo, valorBruto: identidade.valorBruto, ocorrencias: identidade.ocorrencias, ...snapshot },
      },
    });
    return { status: "DESCARTADO", ocorrencias: identidade.ocorrencias, valor: valorMapa };
  });
}

export type LinhaEstrutural = { chave: string; linha?: number | null; numeroDocumento?: string | null; evidencia?: string | null };

/**
 * Descarte consciente de linhas com dados e sem PROJETISTA (bloqueio estrutural), ANTES da carga:
 * grava a decisão por linha (chave = hash do conteúdo da linha + ciclo, calculado pelo ETL). Na
 * próxima importação do mesmo ciclo essas linhas são ignoradas. Nenhum alias é criado.
 */
export async function descartarLinhasEstruturais(input: { ciclo: string; origem: string; linhas: LinhaEstrutural[] }, autor: Autor) {
  const linhas = input.linhas.filter((l) => /^[0-9a-f]{64}$/.test(l.chave)).slice(0, 500);
  if (!/^\d{2}(0[1-9]|1[0-2])$/.test(input.ciclo)) throw new AliasImportacaoError("Ciclo inválido.", 400);
  if (!linhas.length) throw new AliasImportacaoError("Nenhuma linha válida para descartar.", 400);
  return prisma.$transaction(async (tx) => {
    let novas = 0;
    for (const l of linhas) {
      const existente = await tx.importacaoIdentidade.findUnique({ where: { ciclo_tipo_chave: { ciclo: input.ciclo, tipo: "LINHA_SEM_PROJETISTA", chave: l.chave } }, select: { id: true } });
      if (existente) continue;
      await tx.importacaoIdentidade.create({
        data: {
          ciclo: input.ciclo, tipo: "LINHA_SEM_PROJETISTA", chave: l.chave, valorBruto: "", origem: limpar(input.origem) || "Documentos",
          status: "DESCARTADO", ocorrencias: 1, linhas: typeof l.linha === "number" ? [l.linha] : [],
          metadata: { numeroDocumento: limpar(l.numeroDocumento) || null, evidencia: limpar(l.evidencia) || null },
          descartadoPorId: autor.id, descartadoPorNome: autor.nome, descartadoAt: new Date(),
        },
      });
      novas += 1;
    }
    await tx.adminAuditLog.create({
      data: {
        action: "IDENTIDADE_IMPORTACAO_DESCARTADA", adminId: autor.id, adminUsuario: autor.usuario, adminNome: autor.nome,
        targetType: "ImportacaoLinha", targetCodigo: "SEM_PROJETISTA",
        reason: "Linhas sem PROJETISTA descartadas conscientemente antes da importação",
        metadata: { ciclo: input.ciclo, origem: input.origem, linhas: linhas.length, novas },
      },
    });
    return { descartadas: linhas.length, novas };
  });
}

/** Quantos cadastros pendentes de vínculo existem no ciclo (contador da tela Fornecedores). */
export async function contarPendentes(ciclo: string) {
  return prisma.importacaoIdentidade.count({ where: { ciclo, tipo: "IDENTIDADE", status: "PENDENTE" } });
}
