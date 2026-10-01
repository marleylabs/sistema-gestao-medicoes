import { computarParticipacao } from "@/lib/contratos";

/**
 * CÁLCULO CANÔNICO DO BOLETIM DE MEDIÇÃO — fonte única de verdade, usada por Portal do Fornecedor,
 * editor Novo/Editar pagamento (que grava mapaPagamentoItem.valor), BM/PDF, drawers de Histórico e
 * Evidências e Financeiro. Módulo puro (sem React/servidor), testado em
 * tests/bm-calculo-consistencia.test.ts.
 *
 * Semântica financeira aprovada:
 *   TOTAL DA MEDIÇÃO = condição fixa + adicionais fixos + documentos medidos − descontos
 *   REV / AJUSTES    = mapaPagamentoItem.rev (separado, nunca dentro do total da medição)
 *   TOTAL A PAGAR    = total da medição + rev
 * mapaPagamentoItem.valor representa o TOTAL DA MEDIÇÃO; o Financeiro paga valor + rev.
 *
 * A regra é a que o editor de pagamento já aplicava (e o Portal exibia): condição fixa real do
 * cadastro (nunca estimada a partir do valor gravado), adicionais somados, desconto reconhecido por
 * tipo, projeto ou número do documento e abatido pelo valor absoluto. Sem composição nenhuma
 * (nem fixo/adicional, nem documento, nem desconto), o total é o valor informado no pagamento —
 * exatamente o que o editor grava nesse caso.
 */

export function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

/** "R$ 1.234,56", "1234.56", 1234.56 → 1234.56. Vazio/inválido → 0. */
export function parseCurrencyNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Mesmo arredondamento do Intl.NumberFormat que o editor usa ao gravar mapaPagamentoItem.valor
// (currencyInputValue): meio para longe do zero sobre a representação decimal do número
// (1.005 → 1.01). `toFixed` arredonda pelo binário exato (1.005 → 1.00) e divergiria em 1 centavo.
const doisDecimais = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/** Valor arredondado ao centavo exatamente como o valor gravado pelo editor. */
export function arredondarCentavos(valor: number) {
  return Number(doisDecimais.format(Number.isFinite(valor) ? valor : 0));
}

export function centavos(valor: number) {
  return Math.round(arredondarCentavos(valor) * 100);
}

/** Desconto: "DESCONTO" no tipo, no projeto (SE) ou no número do documento — regra do editor de pagamento. */
export function isDocumentoDesconto(documento: { tipo2: string | null; projetoReferente: string | null; numeroDocumento: string | null }) {
  return normalizeText(documento.tipo2) === "DESCONTO"
    || normalizeText(documento.projetoReferente) === "DESCONTO"
    || normalizeText(documento.numeroDocumento) === "DESCONTO";
}

export type DocumentoBoletim = {
  tipo2: string | null;
  projetoReferente: string | null;
  numeroDocumento: string | null;
  contrato: string | null;
  valorMedido: number;
};

export type CondicoesFixasBoletim = {
  valorFixo: string | null;
  adicionaisFixos: string | null;
  tipoContratacao?: string | null;
} | null | undefined;

export function calcularBoletim<D extends DocumentoBoletim>(entrada: {
  documentos: D[];
  condicoesFixas: CondicoesFixasBoletim;
  /** mapaPagamentoItem.valor — usado como total só quando o BM não tem composição. */
  valorInformado?: number | null;
  rev?: number | null;
}) {
  const documentosMedidos = entrada.documentos.filter((d) => !isDocumentoDesconto(d));
  const descontos = entrada.documentos.filter((d) => isDocumentoDesconto(d));
  const valorFixo = parseCurrencyNumber(entrada.condicoesFixas?.valorFixo);
  const adicionais = parseCurrencyNumber(entrada.condicoesFixas?.adicionaisFixos);
  const totalCondicoesFixas = valorFixo + adicionais;
  const totalDocumentos = documentosMedidos.reduce((s, d) => s + d.valorMedido, 0);
  const totalDescontos = descontos.reduce((s, d) => s + Math.abs(d.valorMedido), 0);
  // Mesma ordem de operações do editor: (fixo + adicionais) + documentos − descontos.
  const totalComposicaoBruto = totalCondicoesFixas + totalDocumentos - totalDescontos;
  const totalComposicao = arredondarCentavos(totalComposicaoBruto);
  // Mesmo critério do editor: só assume o valor informado quando não há nada para compor.
  const semComposicao = totalCondicoesFixas + totalDocumentos <= 0 && totalDescontos <= 0;
  const valorInformado = entrada.valorInformado == null ? null : arredondarCentavos(entrada.valorInformado);
  const totalMedicao = semComposicao && valorInformado !== null ? valorInformado : totalComposicao;
  const rev = arredondarCentavos(entrada.rev ?? 0);
  const participacao = computarParticipacao(documentosMedidos.map((d) => ({ contrato: d.contrato, valorMedido: d.valorMedido })));

  return {
    documentosMedidos,
    descontos,
    valorFixo: arredondarCentavos(valorFixo),
    adicionais: arredondarCentavos(adicionais),
    totalCondicoesFixas: arredondarCentavos(totalCondicoesFixas),
    totalDocumentos: arredondarCentavos(totalDocumentos),
    totalDescontos: arredondarCentavos(totalDescontos),
    /** fixo + adicionais + documentos − descontos (o que o editor grava quando há composição). */
    totalComposicao,
    /** Sem arredondamento — o editor formata este valor ao gravar (mesmo resultado em centavos). */
    totalComposicaoBruto,
    semComposicao,
    /** "Existem documentos medidos" (> 0) — critério da condição fixa CONDICIONAL_PRODUCAO, como no ETL. */
    temProducao: totalDocumentos > 0,
    totalMedicao,
    rev,
    totalAPagar: arredondarCentavos(totalMedicao + rev),
    /**
     * Integridade: o valor gravado não bate com a composição atual (ex.: documento alterado depois
     * de salvar o pagamento). null quando não há valor gravado para comparar.
     */
    diferencaValorGravado: valorInformado === null ? null : arredondarCentavos(totalMedicao - valorInformado),
    tipoCondicaoFixa: normalizeText(entrada.condicoesFixas?.tipoContratacao) || "FIXO PJ",
    participacao,
  };
}

export type CalculoBoletim<D extends DocumentoBoletim = DocumentoBoletim> = ReturnType<typeof calcularBoletim<D>>;
