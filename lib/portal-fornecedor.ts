/**
 * Regras de APRESENTAÇÃO do Portal do Fornecedor (components/colaborador-app.tsx), extraídas sem
 * alteração para poderem ser reutilizadas e testadas. Nada aqui muda workflow, status de banco ou
 * valores: os rótulos são os mesmos que o portal sempre mostrou ao fornecedor, e a composição é a
 * mesma fórmula da tabela "Documentos da Medição do Ciclo".
 *
 * Os rótulos do fornecedor são propositalmente diferentes dos internos (lib/sgc-display-status.ts):
 * o fornecedor nunca vê "Divergência" nem "Aguardando fornecedor".
 */

export type PortalStatusBadge = "brand" | "success" | "warning" | "neutral";

export type PortalStatusMeta = { label: string; badge: PortalStatusBadge };

export function getPortalStatusMeta(status: string): PortalStatusMeta {
  if (status === "PAGO")               return { label: "Medição concluída",      badge: "success" };
  if (status === "APROVADO")           return { label: "Aguardando pagamento",   badge: "brand" };
  if (status === "AGUARDANDO_NF")      return { label: "Aguardando envio da NF", badge: "warning" };
  if (status === "REVISAO_SOLICITADA") return { label: "Revisão solicitada",     badge: "warning" };
  if (status === "AGUARDANDO_ENVIO")   return { label: "Aguardando envio do BM", badge: "neutral" };
  if (status === "CANCELADO")          return { label: "BM cancelado",           badge: "neutral" };
  return                                      { label: "Pendente de validação",  badge: "neutral" };
}

/** APROVADO/PAGO: o acompanhamento segue em "Minhas Medições" (composição e documentos ficam ocultos no portal). */
export function isFinancialFollowUpStatus(status: string) {
  return status === "APROVADO" || status === "PAGO";
}

export function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

export function parseCurrencyNumber(value: string | null | undefined) {
  const cleaned = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type PortalDocumento = {
  id: string;
  projetoReferente: string;
  numeroDocumento: string | null;
  contrato: string | null;
  formato: string | null;
  equivalenteA1Horas: number;
  percentualEmissao: number;
  tipo2: string | null;
  condicao: string | null;
  precoUnitario: number;
  valorMedido: number;
  obs: string | null;
};

export type PortalCondicoesFixas = {
  valorFixo: string | null;
  tipoContratacao: string | null;
  adicionaisFixos: string | null;
  observacoesContrato: string | null;
};

export function isDocumentoDesconto(documento: Pick<PortalDocumento, "tipo2" | "projetoReferente" | "numeroDocumento">) {
  return normalizeText(documento.tipo2) === "DESCONTO" || normalizeText(documento.projetoReferente) === "DESCONTO" || normalizeText(documento.numeroDocumento) === "DESCONTO";
}

export function valorDocumentoPortal(documento: PortalDocumento) {
  return documento.valorMedido ?? (documento.equivalenteA1Horas * (parseFloat(documento.condicao ?? "0") || 0) * documento.percentualEmissao);
}

/** Composição do BM exibida ao fornecedor — mesma fórmula que o portal já usava, sem nenhuma regra nova. */
export function composicaoPortal<D extends PortalDocumento>(documentos: D[], condicoesFixas: PortalCondicoesFixas | null | undefined) {
  const documentosMedidos = documentos.filter((documento) => !isDocumentoDesconto(documento));
  const descontos = documentos.filter((documento) => isDocumentoDesconto(documento));
  const valorFixo = parseCurrencyNumber(condicoesFixas?.valorFixo);
  const adicionaisFixos = parseCurrencyNumber(condicoesFixas?.adicionaisFixos);
  const totalCondicoesFixas = valorFixo + adicionaisFixos;
  const totalDocumentos = documentosMedidos.reduce((sum, documento) => sum + valorDocumentoPortal(documento), 0);
  const totalDescontos = descontos.reduce((sum, documento) => sum + Math.abs(valorDocumentoPortal(documento)), 0);
  return {
    documentosMedidos,
    descontos,
    totalCondicoesFixas,
    totalDocumentos,
    totalDescontos,
    totalLiquido: totalCondicoesFixas + totalDocumentos - totalDescontos,
    hasFinancialAdjustments: totalCondicoesFixas > 0 || totalDescontos > 0,
    tipoCondicaoFixa: normalizeText(condicoesFixas?.tipoContratacao) || "FIXO PJ",
    hasObs: documentosMedidos.some((d) => d.obs) || descontos.some((d) => d.obs),
  };
}
