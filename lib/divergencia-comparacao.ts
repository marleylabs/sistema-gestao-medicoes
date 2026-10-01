import { normalizeNrVale } from "@/lib/conferencia-medicao";

/**
 * Comparação de APRESENTAÇÃO das divergências da conferência (equipe × arquivo do fornecedor),
 * agrupada por documento. Não decide nada de novo:
 *  - os valores são os snapshots persistidos em DivergenciaMedicao no upload
 *    (app/api/colaborador/conferencia/upload → lib/conferencia-medicao.ts:compararDocumentos);
 *  - quais campos divergem são as flags gravadas pela própria comparação (formatoDivergente, ...);
 *  - NR VALE usa a mesma normalização do matching (normalizeNrVale).
 *
 * A conferência é unilateral (ver compararDocumentos): só existem dois tipos funcionais de
 * divergência — documento encontrado com campo diferente (CAMPOS) e documento esperado pelo
 * fornecedor não localizado na medição (SO_FORNECEDOR). Documento só da equipe nunca é divergência.
 * (AMBIGUA = NR VALE repetido no próprio arquivo do fornecedor; os campos não são comparados.)
 *
 * Semântica real das ações (app/api/admin/conferencia/[id]/incluir|descartar):
 *  - INCLUIR com documento da equipe: grava na Medicao da equipe os valores do fornecedor SÓ nos
 *    campos divergentes. Sem documento da equipe: cria a Medicao com os dados do fornecedor (preço
 *    unitário do cadastro do fornecedor pelo tipo, ou 0). Observação opcional.
 *  - DESCARTAR: nunca toca na Medicao. Observação obrigatória — é mostrada ao fornecedor no Portal
 *    em "Documentos não considerados".
 *  Ambas encerram a divergência e liberam a conferência quando não sobra nenhuma pendente.
 */

export type DivergenciaDTO = {
  id: string;
  nrVale: string;
  idMedicaoExistente: string | null;
  documentoNaoMapeado: boolean;
  comparacaoAmbigua: boolean;
  formatoDivergente: boolean;
  a1eqDivergente: boolean;
  emissaoDivergente: boolean;
  tipoDivergente: boolean;
  equipe: { nrVale?: string | null; formato: string | null; a1eqHh: number | null; percentualEmissao: number | null; tipo: string | null };
  fornecedor: { nrVale?: string | null; formato: string; a1eqHh: number; percentualEmissao: number; tipo: string };
  status: "PENDENTE" | "INCLUIDA" | "DESCARTADA" | string;
  observacao: string | null;
  resolvidoPorNome: string | null;
  resolvidoEm: string | null;
  arquivo?: { nome: string | null; carregadoEm: string | null } | null;
};

export type TipoDivergencia = "CAMPOS" | "SO_FORNECEDOR" | "AMBIGUA";
export type StatusCampo = "IGUAL" | "DIVERGENTE" | "AUSENTE_EQUIPE" | "NAO_COMPARADO";
export type ChaveCampo = "nrVale" | "formato" | "a1eqHh" | "percentualEmissao" | "tipo";

export type CampoComparado = {
  chave: ChaveCampo;
  label: string;
  equipe: string | null;
  fornecedor: string | null;
  status: StatusCampo;
};

export type AcaoDivergencia = {
  acao: "incluir" | "descartar";
  label: string;
  consequencia: string;
  exigeObservacao: boolean;
};

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const percentual = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });

export const STATUS_CAMPO_LABEL: Record<StatusCampo, string> = {
  IGUAL: "Igual",
  DIVERGENTE: "Divergente",
  AUSENTE_EQUIPE: "Não existe na equipe",
  NAO_COMPARADO: "Não comparado",
};

/** A1eq/HH legível (sem alterar o valor): 2 → "2", 1.5 → "1,5". */
export function formatarA1eq(valor: number | null | undefined) {
  return valor === null || valor === undefined ? null : numero.format(valor);
}

/** % Emissão: o banco guarda fração (1 = 100%); só a apresentação vira percentual. */
export function formatarEmissao(valor: number | null | undefined) {
  return valor === null || valor === undefined ? null : percentual.format(valor);
}

function texto(valor: string | null | undefined) {
  const t = (valor ?? "").trim();
  return t ? t : null;
}

export function tipoDivergencia(d: Pick<DivergenciaDTO, "comparacaoAmbigua" | "documentoNaoMapeado">): TipoDivergencia {
  if (d.comparacaoAmbigua) return "AMBIGUA";
  if (d.documentoNaoMapeado) return "SO_FORNECEDOR";
  return "CAMPOS";
}

export function compararDivergencia(d: DivergenciaDTO) {
  const tipo = tipoDivergencia(d);
  const temEquipe = tipo !== "SO_FORNECEDOR" && (d.idMedicaoExistente !== null || d.equipe.formato !== null || d.equipe.a1eqHh !== null);
  const nrValeEquipe = temEquipe ? texto(d.equipe.nrVale) : null;
  const nrValeFornecedor = texto(d.fornecedor.nrVale) ?? d.nrVale;

  function status(divergente: boolean): StatusCampo {
    if (!temEquipe) return "AUSENTE_EQUIPE";
    if (tipo === "AMBIGUA") return "NAO_COMPARADO";
    return divergente ? "DIVERGENTE" : "IGUAL";
  }

  const campos: CampoComparado[] = [
    {
      chave: "nrVale",
      label: "NR VALE",
      equipe: nrValeEquipe,
      fornecedor: nrValeFornecedor,
      // É a chave do matching: quando há documento da equipe, os dois NR VALE são iguais por definição.
      status: !temEquipe ? "AUSENTE_EQUIPE" : nrValeEquipe === null || normalizeNrVale(nrValeEquipe) === normalizeNrVale(nrValeFornecedor) ? "IGUAL" : "DIVERGENTE",
    },
    { chave: "formato", label: "Formato", equipe: temEquipe ? texto(d.equipe.formato) : null, fornecedor: texto(d.fornecedor.formato), status: status(d.formatoDivergente) },
    { chave: "a1eqHh", label: "A1eq/HH", equipe: temEquipe ? formatarA1eq(d.equipe.a1eqHh) : null, fornecedor: formatarA1eq(d.fornecedor.a1eqHh), status: status(d.a1eqDivergente) },
    { chave: "percentualEmissao", label: "% Emissão", equipe: temEquipe ? formatarEmissao(d.equipe.percentualEmissao) : null, fornecedor: formatarEmissao(d.fornecedor.percentualEmissao), status: status(d.emissaoDivergente) },
    { chave: "tipo", label: "Tipo", equipe: temEquipe ? texto(d.equipe.tipo) : null, fornecedor: texto(d.fornecedor.tipo), status: status(d.tipoDivergente) },
  ];
  const divergentes = campos.filter((c) => c.status === "DIVERGENTE");
  return { tipo, temEquipe, campos, divergentes, resumo: resumoDivergencia(tipo, divergentes), acoes: acoesDivergencia(d, tipo, divergentes) };
}

function listaHumana(itens: string[]) {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Frase objetiva gerada da comparação — não indica qual lado está certo. */
export function resumoDivergencia(tipo: TipoDivergencia, divergentes: CampoComparado[]) {
  if (tipo === "SO_FORNECEDOR") return "Documento esperado pelo fornecedor não localizado na medição.";
  if (tipo === "AMBIGUA") return "O NR VALE aparece mais de uma vez no arquivo do fornecedor, por isso os campos não foram comparados. Os valores do fornecedor exibidos são os da primeira ocorrência.";
  if (divergentes.length === 1) {
    const c = divergentes[0];
    return `${c.label} diverge: a equipe possui ${c.equipe ?? "—"} e o fornecedor informou ${c.fornecedor ?? "—"}.`;
  }
  return `${divergentes.length} campos divergem neste documento: ${listaHumana(divergentes.map((c) => c.label))}.`;
}

/** Rótulo curto do documento na lista (contagem de campos ou tipo da divergência). */
export function rotuloContagem(tipo: TipoDivergencia, divergentes: number) {
  if (tipo === "SO_FORNECEDOR") return "Documento novo do fornecedor";
  if (tipo === "AMBIGUA") return "NR VALE repetido no arquivo";
  return divergentes === 1 ? "1 campo divergente" : `${divergentes} campos divergentes`;
}

const AVISO_FORNECEDOR = "O motivo informado aparece para o fornecedor em \"Documentos não considerados\".";

/** Ações com nomes e consequências EXATAMENTE como o backend age hoje (ver cabeçalho do módulo). */
export function acoesDivergencia(d: DivergenciaDTO, tipo: TipoDivergencia, divergentes: CampoComparado[]): { equipe: AcaoDivergencia; fornecedor: AcaoDivergencia } {
  if (tipo === "SO_FORNECEDOR" || (tipo === "AMBIGUA" && !d.idMedicaoExistente)) {
    const origem = tipo === "AMBIGUA" ? " (primeira ocorrência do arquivo)" : "";
    return {
      equipe: { acao: "descartar", label: "Não incluir documento", exigeObservacao: true, consequencia: `A medição da equipe não é alterada e a divergência é encerrada. ${AVISO_FORNECEDOR}` },
      fornecedor: {
        acao: "incluir",
        label: "Incluir documento na medição",
        exigeObservacao: false,
        consequencia: `Cria ${d.nrVale} na medição da equipe com os dados do fornecedor${origem} (${[d.fornecedor.tipo, d.fornecedor.formato].filter(Boolean).join(" · ")}). O preço unitário vem do cadastro do fornecedor para o tipo ${d.fornecedor.tipo || "informado"}, ou zero se não houver. Encerra a divergência.`,
      },
    };
  }
  if (tipo === "AMBIGUA") {
    return {
      equipe: { acao: "descartar", label: "Não considerar documento", exigeObservacao: true, consequencia: `A medição da equipe não é alterada e a divergência é encerrada. ${AVISO_FORNECEDOR}` },
      fornecedor: { acao: "incluir", label: "Encerrar mantendo a medição", exigeObservacao: false, consequencia: "Nenhum campo da medição é alterado (os campos não foram comparados) e a divergência é encerrada." },
    };
  }
  const mantem = divergentes.map((c) => `${c.label} = ${c.equipe ?? "—"}`).join("; ");
  const altera = divergentes.map((c) => `${c.label} de ${c.equipe ?? "—"} para ${c.fornecedor ?? "—"}`).join("; ");
  return {
    equipe: { acao: "descartar", label: "Manter dados da equipe", exigeObservacao: true, consequencia: `A medição da equipe não é alterada (${mantem}) e a divergência é encerrada. ${AVISO_FORNECEDOR}` },
    fornecedor: { acao: "incluir", label: "Aceitar dados do fornecedor", exigeObservacao: false, consequencia: `Atualiza na medição da equipe: ${altera}. Os demais campos não mudam. Encerra a divergência.` },
  };
}

/** Decisão registrada, descrita pelo que a ação de fato fez. */
export function decisaoRegistrada(d: DivergenciaDTO) {
  if (d.status === "PENDENTE") return null;
  const { acoes } = compararDivergencia(d);
  const acao = d.status === "INCLUIDA" ? acoes.fornecedor : acoes.equipe;
  return { acao: acao.acao, label: acao.label };
}

/**
 * Uma DivergenciaMedicao já é UM documento inteiro (todos os campos juntos; única por BM + NR VALE,
 * agrupada no upload pelo NR VALE normalizado). Nada é descartado aqui — só ordena: pendentes
 * primeiro, mantendo a ordem original dentro de cada grupo.
 */
export function agruparPorDocumento(divergencias: DivergenciaDTO[]) {
  const documentos = divergencias
    .map((d, i) => ({ d, i }))
    .sort((a, b) => Number(b.d.status === "PENDENTE") - Number(a.d.status === "PENDENTE") || a.i - b.i)
    .map(({ d }) => d);
  const pendentes = documentos.filter((d) => d.status === "PENDENTE").length;
  return { documentos, total: documentos.length, pendentes, resolvidos: documentos.length - pendentes };
}

export function filtrarDocumentos(documentos: DivergenciaDTO[], filtro: "todos" | "pendentes" | "resolvidos", busca: string) {
  const termo = normalizeNrVale(busca);
  return documentos.filter((d) => {
    if (filtro === "pendentes" && d.status !== "PENDENTE") return false;
    if (filtro === "resolvidos" && d.status === "PENDENTE") return false;
    return !termo || normalizeNrVale(d.nrVale).includes(termo);
  });
}
