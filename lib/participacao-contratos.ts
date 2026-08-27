import "server-only";

import { prisma } from "@/lib/prisma";
import { calcularValorMedido } from "@/lib/mapa-pagamento";
import {
  computarParticipacao,
  consolidarDistribuicaoContratos,
  contratoKey,
  isContratoElegivel,
  normalizeContratoNome,
  type FornecedorDistribuicao,
} from "@/lib/contratos";

export type ContratoResumo = { id: string; nome: string };

type MedicaoParaParticipacao = {
  contrato: string | null;
  valorMedido: number;
};

type MedicaoComAliases = MedicaoParaParticipacao & { aliases: string[] };

/**
 * Normaliza um identificador de fornecedor (código real ou nome, como vem em
 * `mapaPagamentoItem.projetistaCodigo` e em `profissional.codigo/nome/nomeCompleto`) para
 * comparação: minúsculas, sem espaços nas pontas, espaços internos colapsados. Mesmo critério
 * (case-insensitive) já usado no OR de `/api/mapa-pagamento/documentos`.
 */
export function normalizeAlias(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function aliasesDoProfissional(p: { codigo: string | null; nome: string | null; nomeCompleto: string | null }): string[] {
  const aliases = new Set<string>();
  for (const raw of [p.codigo, p.nome, p.nomeCompleto]) {
    const alias = normalizeAlias(raw);
    if (alias) aliases.add(alias);
  }
  return Array.from(aliases);
}

/**
 * Documentos Medidos do ciclo, com valorMedido já calculado (mesma fórmula de
 * `/api/mapa-pagamento/documentos`) e os apelidos (codigo/nome/nomeCompleto) do profissional
 * vinculado. `profissional.codigo` está vazio na maior parte dos registros importados pelo ETL —
 * por isso a resolução do fornecedor usa os 3 campos, exatamente como o OR de
 * `/api/mapa-pagamento/documentos` já faz, para nunca divergir do que a Equipe vê em Documentos
 * Medidos. Exclui linhas de DESCONTO, mesmo critério já aplicado antes do rateio no Boletim de
 * Medição (`documentosProdutivos`) e no Portal do Fornecedor (`elegiveis`).
 */
async function carregarMedicoesDoCiclo(ciclo: string): Promise<MedicaoComAliases[]> {
  const medicoes = await prisma.medicao.findMany({
    where: { ciclo },
    select: {
      tipo2: true,
      equivalenteA1Horas: true,
      percentualEmissao: true,
      condicao: true,
      projeto: { select: { contrato: true } },
      profissional: { select: { codigo: true, nome: true, nomeCompleto: true } },
    },
    orderBy: [{ dataCadastro: "asc" }, { createdAt: "asc" }],
  });

  return medicoes
    .filter((m) => (m.tipo2 ?? "").toUpperCase().trim() !== "DESCONTO")
    .map((m) => ({
      contrato: m.projeto?.contrato ?? null,
      valorMedido: calcularValorMedido(m).valorMedido,
      aliases: m.profissional ? aliasesDoProfissional(m.profissional) : [],
    }));
}

/** Garante que cada nome de contrato elegível encontrado já exista em `contratos` (auto-registro, mesmo padrão de ensureContratosPadrao), e devolve o registro canônico id→nome na ordem de primeira aparição. */
async function resolverContratosCanonicos(nomesEmOrdem: string[]): Promise<Map<string, ContratoResumo>> {
  const existentes = await prisma.contrato.findMany({ select: { id: true, nome: true } });
  const porChave = new Map<string, ContratoResumo>();
  for (const c of existentes) porChave.set(contratoKey(c.nome), { id: c.id, nome: c.nome });

  const porChaveOrdenado = new Map<string, ContratoResumo>();
  for (const nomeBruto of nomesEmOrdem) {
    const key = contratoKey(nomeBruto);
    if (porChaveOrdenado.has(key)) continue;
    let resumo = porChave.get(key);
    if (!resumo) {
      const nome = normalizeContratoNome(nomeBruto);
      const criado = await prisma.contrato.upsert({
        where: { nome },
        create: { nome, ativo: true },
        update: {},
        select: { id: true, nome: true },
      });
      resumo = { id: criado.id, nome: criado.nome };
      porChave.set(key, resumo);
    }
    porChaveOrdenado.set(key, resumo);
  }
  return porChaveOrdenado;
}

export type ParticipacaoFornecedor = {
  participacoes: Record<string, number>;
  documentosPendentes: number;
  valorTotal: number;
  valorClassificado: number;
  valorNaoClassificado: number;
  percentualNaoClassificado: number;
};

export type ParticipacaoPorFornecedor = {
  contratos: ContratoResumo[];
  /** Chaveado por `normalizeAlias(...)` — comparar sempre com `normalizeAlias(item.projetistaCodigo)`. */
  porAlias: Record<string, ParticipacaoFornecedor>;
};

/**
 * Uma única consulta agregada: contratos do ciclo + participação de todos os fornecedores, sem N+1.
 * Cada Medicao é agrupada sob TODOS os apelidos do profissional vinculado (codigo, nome, nomeCompleto
 * normalizados) — o mesmo documento pode aparecer sob mais de uma chave, mas isso é inofensivo: o
 * chamador sempre consulta por uma única chave (`normalizeAlias(item.projetistaCodigo)`), então só a
 * entrada correspondente é lida.
 */
export async function getParticipacaoPorFornecedorCiclo(ciclo: string): Promise<ParticipacaoPorFornecedor> {
  const medicoes = await carregarMedicoesDoCiclo(ciclo);

  const nomesEmOrdem = medicoes.filter((m) => isContratoElegivel(m.contrato)).map((m) => m.contrato as string);
  const contratosCanonicos = await resolverContratosCanonicos(nomesEmOrdem);
  const contratos = Array.from(contratosCanonicos.values());

  const porAliasDocs = new Map<string, MedicaoParaParticipacao[]>();
  for (const m of medicoes) {
    for (const alias of m.aliases) {
      const lista = porAliasDocs.get(alias) ?? [];
      lista.push({ contrato: m.contrato, valorMedido: m.valorMedido });
      porAliasDocs.set(alias, lista);
    }
  }

  const porAlias: ParticipacaoPorFornecedor["porAlias"] = {};
  for (const [alias, docs] of porAliasDocs) {
    const resultado = computarParticipacao(docs);
    const participacoes: Record<string, number> = {};
    for (const p of resultado.participacoes) {
      const resumo = contratosCanonicos.get(p.key);
      if (resumo) participacoes[resumo.id] = p.percentual;
    }
    porAlias[alias] = {
      participacoes,
      documentosPendentes: resultado.documentosPendentes,
      valorTotal: resultado.valorTotal,
      valorClassificado: resultado.valorClassificado,
      valorNaoClassificado: resultado.valorNaoClassificado,
      percentualNaoClassificado: resultado.percentualNaoClassificado,
    };
  }

  return { contratos, porAlias };
}

export type DistribuicaoContrato = {
  contratoId: string;
  contrato: string;
  valorMedido: number;
  /** Participação global 0–100, sobre o valorTotalConsiderado (nunca sobre a soma dos próprios contratos). */
  participacao: number;
};

export type DistribuicaoContratosResultado = {
  contratos: DistribuicaoContrato[];
  valorTotalConsiderado: number;
  valorClassificado: number;
  valorNaoClassificado: number;
  percentualNaoClassificado: number;
};

/**
 * "Distribuição por contrato" (Dashboard) — MESMA fonte de verdade de Pagamentos por Fornecedor:
 * usa `getParticipacaoPorFornecedorCiclo` (participação por fornecedor, calculada a partir de
 * Documentos Medidos) e aplica cada percentual sobre `mapaPagamentoItem.valor` — o mesmo campo que
 * a tabela de Pagamentos por Fornecedor exibe como "Pagamento" para aquele fornecedor no ciclo.
 * Nunca mistura ciclos: cada ciclo é resolvido com sua própria `getParticipacaoPorFornecedorCiclo`,
 * os valores resultantes são somados por contrato (mesmo id) só depois de calculados isoladamente.
 */
export async function getDistribuicaoContratosCiclos(
  ciclos: string[],
  opts?: { colaboradorCodigo?: string },
): Promise<DistribuicaoContratosResultado> {
  const contratosVistos = new Map<string, ContratoResumo>();
  const fornecedores: FornecedorDistribuicao[] = [];

  for (const ciclo of ciclos) {
    const participacao = await getParticipacaoPorFornecedorCiclo(ciclo);
    for (const c of participacao.contratos) {
      if (!contratosVistos.has(c.id)) contratosVistos.set(c.id, c);
    }

    const itens = await prisma.mapaPagamentoItem.findMany({
      where: {
        ciclo,
        valor: { gt: 0 },
        ...(opts?.colaboradorCodigo ? { projetistaCodigo: opts.colaboradorCodigo } : {}),
      },
      select: { projetistaCodigo: true, valor: true },
    });

    for (const item of itens) {
      const alias = normalizeAlias(item.projetistaCodigo);
      const p = participacao.porAlias[alias];
      fornecedores.push({
        valorBase: Number(item.valor ?? 0),
        // sem Documentos Medidos vinculados neste ciclo (p ausente) → participações vazio, cai
        // integralmente em "não classificado" dentro de consolidarDistribuicaoContratos.
        participacoes: p?.participacoes ?? {},
      });
    }
  }

  const consolidado = consolidarDistribuicaoContratos(fornecedores);
  const contratos: DistribuicaoContrato[] = Array.from(contratosVistos.values()).map((c) => {
    const valorMedido = consolidado.valorPorContratoId[c.id] ?? 0;
    return {
      contratoId: c.id,
      contrato: c.nome,
      valorMedido,
      participacao: consolidado.valorTotalConsiderado > 0 ? (valorMedido / consolidado.valorTotalConsiderado) * 100 : 0,
    };
  });

  return {
    contratos,
    valorTotalConsiderado: consolidado.valorTotalConsiderado,
    valorClassificado: consolidado.valorClassificado,
    valorNaoClassificado: consolidado.valorNaoClassificado,
    percentualNaoClassificado: consolidado.percentualNaoClassificado,
  };
}
