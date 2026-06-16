import crypto from "node:crypto";
import { parseDate, parseDecimal, parseNullableDecimal } from "@/lib/format";

export function buildMedicaoData(body: any) {
  return {
    numeroMedicao: String(body.numeroMedicao ?? "").trim(),
    idProjeto: body.idProjeto,
    idCoordenador: body.idCoordenador || null,
    idProfissional: body.idProfissional || null,
    dataCadastro: parseDate(body.dataCadastro),
    formato: body.formato || null,
    quantidade: parseDecimal(body.quantidade),
    multiplicador: parseDecimal(body.multiplicador),
    equivalenteA1Horas: parseDecimal(body.equivalenteA1Horas),
    porcentagemRevisao: parseNullableDecimal(body.porcentagemRevisao),
    emissaoInicial: parseNullableDecimal(body.emissaoInicial),
    retornoVale: parseNullableDecimal(body.retornoVale),
    encerramento: parseNullableDecimal(body.encerramento),
    arquivamento: parseNullableDecimal(body.arquivamento),
    medidoHoras: parseDecimal(body.medidoHoras),
    itemQqp: body.itemQqp || null,
    valorUnitario: parseDecimal(body.valorUnitario),
    valorBruto: parseDecimal(body.valorBruto),
    valorTotal: parseDecimal(body.valorTotal),
    valorReajuste: parseDecimal(body.valorReajuste),
    ciclo: body.ciclo || null,
    referencia: body.referencia || null,
    percentualEmissao: parseNullableDecimal(body.percentualEmissao),
    tipo2: body.tipo2 || null,
    condicao: body.condicao || null,
    valorMedicao: parseDecimal(body.valorMedicao),
    obs: body.obs || null,
  };
}

export function buildCreateMedicaoData(body: any) {
  const data = buildMedicaoData(body);
  return {
    ...data,
    sourceRowHash: `manual:${crypto.randomUUID()}`,
    rawPayload: { source: "manual", createdFrom: "web-crud" },
  };
}
