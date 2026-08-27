const DESPESA_PREFIXES = [
  "DESPESA ALIMENTACAO",
  "DESPESA HOSPEDAGEM",
  "DESPESA TRANSPORTE",
  "DESMOBILIZACAO",
];

// Lista extensível: valores de erro do Excel (padrão em qualquer idioma/regional) + variantes textuais comuns.
const INVALID_VALUES = new Set([
  "#N/D", "#N/A", "#CALC!", "#REF!", "#VALOR!", "#VALUE!", "#NULL!", "#NUM!", "#DIV/0!", "#NOME?", "#NAME?",
  "N/D", "N/A", "NA", "-", "--",
]);

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Nome canônico para exibição: trim + colapso de espaços, preserva acentuação/caixa original. */
export function normalizeContratoNome(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Chave de comparação: maiúsculas, sem acento — para agrupar "Salobo"/"SALOBO"/" salobo " como o mesmo contrato. */
export function contratoKey(raw: string | null | undefined): string {
  return stripAccents(normalizeContratoNome(raw)).toUpperCase();
}

export function isContratoInvalido(raw: string | null | undefined): boolean {
  const nome = normalizeContratoNome(raw);
  if (!nome) return true;
  return INVALID_VALUES.has(stripAccents(nome).toUpperCase());
}

export function isDespesaOuMobilizacao(raw: string | null | undefined): boolean {
  const key = contratoKey(raw);
  if (!key) return false;
  return DESPESA_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Elegível = participa da descoberta de contratos e do cálculo de participação. */
export function isContratoElegivel(raw: string | null | undefined): boolean {
  return !isContratoInvalido(raw) && !isDespesaOuMobilizacao(raw);
}

export type DocumentoParaParticipacao = {
  contrato: string | null | undefined;
  valorMedido: number;
};

export type ParticipacaoContrato = {
  key: string;
  nome: string;
  valor: number;
  percentual: number;
};

export type ResultadoParticipacao = {
  participacoes: ParticipacaoContrato[];
  /** Soma de TODOS os documentos recebidos (elegíveis + despesa + CTO inválido) — o mesmo total que já aparece como "Total Medido" no BM/Portal. */
  valorTotal: number;
  /** Soma apenas dos documentos que puderam ser atribuídos a um contrato (exclui despesa e CTO inválido). */
  valorClassificado: number;
  /** valorTotal - valorClassificado: inclui CTO inválido/vazio e despesas — nunca é distribuído entre os contratos. */
  valorNaoClassificado: number;
  percentualNaoClassificado: number;
  /** Quantidade de linhas com CTO inválido/vazio (não-despesa) — usado só para o indicador de alerta, não entra no valor. */
  documentosPendentes: number;
};

/**
 * Agrupa documentos medidos por contrato (CTO) e calcula a participação percentual de cada um,
 * usando o Valor Medido (não a quantidade de linhas). O denominador é SEMPRE o valor total de
 * documentos recebidos (não apenas os classificados) — assim uma linha com CTO inválido não infla
 * artificialmente o percentual das linhas válidas para 100%. Despesas/mobilização são excluídas do
 * numerador de qualquer contrato e não contam como pendência; CTO vazio/inválido em linha não-despesa
 * conta como pendência (indicador de alerta) mas continua fazendo parte do valorTotal.
 */
export function computarParticipacao(documentos: DocumentoParaParticipacao[]): ResultadoParticipacao {
  const somaPorChave = new Map<string, { nome: string; valor: number }>();
  let documentosPendentes = 0;
  let valorTotal = 0;

  for (const doc of documentos) {
    valorTotal += doc.valorMedido;
    if (isDespesaOuMobilizacao(doc.contrato)) continue;
    if (isContratoInvalido(doc.contrato)) {
      documentosPendentes += 1;
      continue;
    }
    const key = contratoKey(doc.contrato);
    const entry = somaPorChave.get(key) ?? { nome: normalizeContratoNome(doc.contrato), valor: 0 };
    entry.valor += doc.valorMedido;
    somaPorChave.set(key, entry);
  }

  const valorClassificado = Array.from(somaPorChave.values()).reduce((s, e) => s + e.valor, 0);
  const valorNaoClassificado = Math.max(0, valorTotal - valorClassificado);
  const participacoes: ParticipacaoContrato[] = Array.from(somaPorChave.entries()).map(([key, entry]) => ({
    key,
    nome: entry.nome,
    valor: entry.valor,
    percentual: valorTotal > 0 ? (entry.valor / valorTotal) * 100 : 0,
  }));

  return {
    participacoes,
    valorTotal,
    valorClassificado,
    valorNaoClassificado,
    percentualNaoClassificado: valorTotal > 0 ? (valorNaoClassificado / valorTotal) * 100 : 0,
    documentosPendentes,
  };
}

export type FornecedorDistribuicao = {
  /** Mesmo campo usado como "Pagamento" em Pagamentos por Fornecedor (mapaPagamentoItem.valor). */
  valorBase: number;
  /** Percentuais 0–100 por contratoId — saída de computarParticipacao(...).participacoes, já resolvidos para id canônico. */
  participacoes: Record<string, number>;
};

export type DistribuicaoConsolidada = {
  valorPorContratoId: Record<string, number>;
  valorTotalConsiderado: number;
  valorClassificado: number;
  valorNaoClassificado: number;
  percentualNaoClassificado: number;
};

/**
 * Consolida a "Distribuição por contrato" (Dashboard) a partir de vários fornecedores: para cada
 * um, aplica os MESMOS percentuais de participação já exibidos em Pagamentos por Fornecedor sobre
 * o MESMO valor base ("Pagamento") daquela tabela, e soma por contrato. Nunca normaliza para 100%:
 * um fornecedor sem participação registrada (`participacoes` vazio — sem Documentos Medidos, ou
 * 100% pendente) contribui integralmente para `valorNaoClassificado`.
 */
export function consolidarDistribuicaoContratos(fornecedores: FornecedorDistribuicao[]): DistribuicaoConsolidada {
  const valorPorContratoId: Record<string, number> = {};
  let valorTotalConsiderado = 0;
  let valorClassificado = 0;

  for (const f of fornecedores) {
    valorTotalConsiderado += f.valorBase;
    for (const [contratoId, percentual] of Object.entries(f.participacoes)) {
      const valorAtribuido = f.valorBase * (percentual / 100);
      valorPorContratoId[contratoId] = (valorPorContratoId[contratoId] ?? 0) + valorAtribuido;
      valorClassificado += valorAtribuido;
    }
  }

  const valorNaoClassificado = Math.max(0, valorTotalConsiderado - valorClassificado);
  return {
    valorPorContratoId,
    valorTotalConsiderado,
    valorClassificado,
    valorNaoClassificado,
    percentualNaoClassificado: valorTotalConsiderado > 0 ? (valorNaoClassificado / valorTotalConsiderado) * 100 : 0,
  };
}
