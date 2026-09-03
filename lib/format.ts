import { Prisma } from "@prisma/client";
import { decryptSensitive } from "@/lib/encryption";

export function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

export function parseDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") return "0";
  const cleaned = String(value).replace(/\s/g, "").replace("R$", "").replace("%", "");
  if (cleaned.includes(",")) {
    return cleaned.replace(/\./g, "").replace(",", ".");
  }
  return cleaned;
}

export function parseNullableDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return parseDecimal(value);
}

export function parseDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function serializeMedicao(medicao: any) {
  return {
    ...medicao,
    quantidade: toNumber(medicao.quantidade),
    multiplicador: toNumber(medicao.multiplicador),
    equivalenteA1Horas: toNumber(medicao.equivalenteA1Horas),
    porcentagemRevisao: medicao.porcentagemRevisao === null ? null : toNumber(medicao.porcentagemRevisao),
    emissaoInicial: medicao.emissaoInicial === null ? null : toNumber(medicao.emissaoInicial),
    retornoVale: medicao.retornoVale === null ? null : toNumber(medicao.retornoVale),
    encerramento: medicao.encerramento === null ? null : toNumber(medicao.encerramento),
    arquivamento: medicao.arquivamento === null ? null : toNumber(medicao.arquivamento),
    medidoHoras: toNumber(medicao.medidoHoras),
    valorUnitario: toNumber(medicao.valorUnitario),
    valorBruto: toNumber(medicao.valorBruto),
    valorTotal: toNumber(medicao.valorTotal),
    valorReajuste: toNumber(medicao.valorReajuste),
    percentualEmissao: medicao.percentualEmissao === null ? null : toNumber(medicao.percentualEmissao),
    valorMedicao: toNumber(medicao.valorMedicao),
    coordenador: medicao.coordenador ? { ...serializeProfessional(medicao.coordenador), ...(medicao.coordenadorNomeSnapshot ? { nome: medicao.coordenadorNomeSnapshot, nomeCompleto: medicao.coordenadorNomeSnapshot } : {}) } : null,
    profissional: medicao.profissional ? { ...serializeProfessional(medicao.profissional), ...(medicao.profissionalNomeSnapshot ? { nome: medicao.profissionalNomeSnapshot, nomeCompleto: medicao.profissionalNomeSnapshot } : {}) } : null,
  };
}

export function serializeProfessional(profissional: any) {
  return {
    ...profissional,
    cpf: decryptSensitive(profissional.cpf),
    cnpj: decryptSensitive(profissional.cnpj),
    email: decryptSensitive(profissional.email),
  };
}
