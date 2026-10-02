import "server-only";

import { prisma } from "@/lib/prisma";
import { pareceNomeDeFornecedor } from "@/lib/identidade-plausivel";
import { normalizarAlias, resolverIdentidadeOperacional, type ResolucaoIdentidade } from "@/lib/profissional-identidade";

/**
 * Resolução das identidades que bloquearam uma importação de medição (etl UnresolvedIdentityError).
 *
 * - `verificarIdentidades`: estado ATUAL de cada nome (o detalhe do ETL é da última execução) —
 *   mesma ordem do ETL (lib/profissional-identidade.ts). Só leitura.
 * - `alvosDasSugestoes`: rótulo da sugestão informativa do ETL → fornecedor ativo, quando o rótulo
 *   aponta para exatamente UMA identidade. Só leitura; nunca vincula nada.
 * - `buscarFornecedores`: busca por nome / código / razão social nos cadastros ativos.
 * - `criarAliasImportacao`: ÚNICA escrita — um ProfissionalAlias (mecanismo oficial, o mesmo de
 *   scripts/dev-profissional-aliases.ts) apontando para a identidade canônica escolhida por um
 *   humano. Nunca altera o código/nome canônico, nunca cria Profissional/cadastro, nunca usa
 *   similaridade para decidir. O ETL lê os aliases ativos na próxima importação.
 */

export type AlvoFornecedor = {
  profissionalId: string;
  codigo: string;
  responsavel: string;
  razaoSocial: string | null;
};

export type IdentidadeVerificada = {
  valor: string;
  resolucao: ResolucaoIdentidade;
  /** Fornecedor ativo cujo código tem o MESMO nome normalizado (acento/caixa/pontuação) — igualdade, nunca similaridade. */
  mesmoNomeNormalizado: AlvoFornecedor | null;
};

export const LIMITE_VALORES = 500;
const LIMITE_TEXTO = 200;

export class AliasImportacaoError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

function limpar(valor: unknown) {
  return typeof valor === "string" ? valor.trim().slice(0, LIMITE_TEXTO) : "";
}

export function valoresUnicos(valores: unknown): string[] {
  if (!Array.isArray(valores)) return [];
  return [...new Set(valores.map(limpar).filter(Boolean))].slice(0, LIMITE_VALORES);
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

export async function verificarIdentidades(valores: string[]): Promise<IdentidadeVerificada[]> {
  const ativos = await fornecedoresAtivos();
  const porNomeNormalizado = new Map<string, AlvoFornecedor[]>();
  for (const alvo of ativos) {
    const chave = normalizarAlias(alvo.codigo);
    porNomeNormalizado.set(chave, [...(porNomeNormalizado.get(chave) ?? []), alvo]);
  }
  const resultado: IdentidadeVerificada[] = [];
  for (const valor of valores) {
    const resolucao = await resolverIdentidadeOperacional(valor);
    const iguais = resolucao.status === "NAO_RESOLVIDO" ? porNomeNormalizado.get(normalizarAlias(valor)) ?? [] : [];
    resultado.push({ valor, resolucao, mesmoNomeNormalizado: iguais.length === 1 ? iguais[0] : null });
  }
  return resultado;
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
  "bm aux": "DOCUMENTOS_AUXILIARES",
  "mapa pagto": "MAPA_PAGAMENTO",
  "mapa pagamento": "MAPA_PAGAMENTO",
};

export function origemDoAlias(aba: string | null | undefined) {
  return ORIGENS[String(aba ?? "").trim().toLowerCase()] ?? "DOCUMENTOS";
}

export type CriarAliasInput = {
  alias: string;
  profissionalId: string;
  /** Aba de onde o nome veio (detalhe do ETL) — vira `origem` do alias. */
  aba?: string | null;
  ciclo?: string | null;
  linhas?: number[];
};

export type CriarAliasResultado = {
  status: "CRIADO" | "JA_EXISTE";
  aliasId: string;
  alias: string;
  codigoCanonico: string;
};

export async function criarAliasImportacao(
  input: CriarAliasInput,
  admin: { id: string; usuario: string; nome: string },
): Promise<CriarAliasResultado> {
  const alias = limpar(input.alias);
  const aliasNormalizado = normalizarAlias(alias);
  if (!alias || !aliasNormalizado) throw new AliasImportacaoError("Informe o nome da planilha.", 400);
  if (!pareceNomeDeFornecedor(alias)) {
    throw new AliasImportacaoError(`"${alias}" não parece um nome de fornecedor (número de documento ou descrição). Corrija a coluna PROJETISTA na planilha.`, 400);
  }
  const origem = origemDoAlias(input.aba);
  const linhas = Array.isArray(input.linhas) ? input.linhas.filter((n) => Number.isInteger(n)).slice(0, 10) : [];

  return prisma.$transaction(async (tx) => {
    // Serializa criações concorrentes do MESMO nome (duplo clique, duas abas, dois admins):
    // a checagem "já aponta para outro fornecedor" e o insert acontecem sob o mesmo lock.
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

    // O nome já resolve sozinho (código, alias ou legado)? Nada a gravar — ou conflito explícito.
    const atual = await resolverIdentidadeOperacional(alias, tx);
    if (atual.status === "AMBIGUO") throw new AliasImportacaoError(`"${alias}" já corresponde a mais de um fornecedor. Resolva a ambiguidade antes de vincular.`, 409);
    if (atual.status === "RESOLVIDO" && atual.profissionalId !== alvo.id) {
      throw new AliasImportacaoError(`"${alias}" já corresponde ao fornecedor ${atual.codigoCanonico}. Um nome nunca aponta para dois fornecedores.`, 409);
    }

    // Nunca o código (ou nome) de OUTRA identidade, nem com variação de acento/caixa/pontuação.
    const outros = await tx.profissional.findMany({
      where: { deletedAt: null, NOT: { id: alvo.id } },
      select: { codigo: true, nome: true },
    });
    const conflito = outros.find((p) => normalizarAlias(p.codigo) === aliasNormalizado || normalizarAlias(p.nome) === aliasNormalizado);
    if (conflito) {
      throw new AliasImportacaoError(`"${alias}" é o nome de outra identidade (${conflito.codigo ?? conflito.nome}). Um nome nunca aponta para dois fornecedores.`, 409);
    }

    const existentes = await tx.profissionalAlias.findMany({
      where: { aliasNormalizado, ativo: true },
      select: { id: true, profissionalId: true },
    });
    if (existentes.some((a) => a.profissionalId !== alvo.id)) {
      throw new AliasImportacaoError(`"${alias}" já é alias de outro fornecedor. Um nome nunca aponta para dois fornecedores.`, 409);
    }
    const doAlvo = existentes.find((a) => a.profissionalId === alvo.id);
    if (doAlvo) return { status: "JA_EXISTE", aliasId: doAlvo.id, alias, codigoCanonico: alvo.codigo };
    if (atual.status === "RESOLVIDO") {
      // Resolve pelo próprio código/nome legado do alvo — um alias seria redundante.
      return { status: "JA_EXISTE", aliasId: "", alias, codigoCanonico: alvo.codigo };
    }

    const metadata = { fluxo: "IMPORTACAO_MEDICAO", aba: input.aba ?? null, ciclo: input.ciclo ?? null, linhas };
    // Alias inativo do mesmo alvo (desativado antes) é reativado — a chave (alvo, nome) é única.
    const inativo = await tx.profissionalAlias.findUnique({
      where: { profissionalId_aliasNormalizado: { profissionalId: alvo.id, aliasNormalizado } },
      select: { id: true },
    });
    const registro = inativo
      ? await tx.profissionalAlias.update({
          where: { id: inativo.id },
          data: { ativo: true, alias, origem, metadata, createdById: admin.id, createdByNome: admin.nome, updatedAt: new Date() },
        })
      : await tx.profissionalAlias.create({
          data: { profissionalId: alvo.id, alias, aliasNormalizado, origem, metadata, createdById: admin.id, createdByNome: admin.nome },
        });
    await tx.adminAuditLog.create({
      data: {
        action: "PROFISSIONAL_ALIAS_CRIADO", adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
        targetType: "Profissional", targetId: alvo.id, targetCodigo: alvo.codigo,
        reason: "Alias vinculado na resolução de identidades da importação de medição",
        metadata: { aliasId: registro.id, alias, origem, ...metadata, reativado: Boolean(inativo) },
      },
    });
    return { status: "CRIADO", aliasId: registro.id, alias, codigoCanonico: alvo.codigo };
  });
}
