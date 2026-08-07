import { createHash, randomUUID } from "node:crypto";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { parseDecimal, toNumber } from "@/lib/format";

type PaymentPayload = {
  ciclo?: unknown;
  ordem?: unknown;
  ato?: unknown;
  projetistaCodigo?: unknown;
  responsavel?: unknown;
  cpfCnpj?: unknown;
  razaoSocial?: unknown;
  intrSossego?: unknown;
  salobo?: unknown;
  acg?: unknown;
  escadasAlumar?: unknown;
  horas?: unknown;
  valor?: unknown;
  rev?: unknown;
  status?: unknown;
  valorFixo?: unknown;
  tipoContratacao?: unknown;
  adicionaisFixos?: unknown;
  observacoesContrato?: unknown;
};

type CadastroOverride = {
  id?: string | null;
  responsavel?: string | null;
  cpfCnpj?: string | null;
  razaoSocial?: string | null;
};

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function manualHash(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function serializeMapaPagamentoItem(item: any, cadastro?: CadastroOverride | null) {
  const rawPayload = typeof item.rawPayload === "object" && item.rawPayload !== null ? item.rawPayload : {};
  const condicoesFixas = typeof rawPayload.condicoesFixas === "object" && rawPayload.condicoesFixas !== null
    ? rawPayload.condicoesFixas as Record<string, unknown>
    : {};

  return {
    id: item.id,
    ordem: item.ordem,
    ato: item.ato,
    projetistaCodigo: item.projetistaCodigo,
    responsavel: cadastro?.responsavel ?? item.responsavel,
    cpfCnpj: cadastro?.cpfCnpj ?? decryptSensitive(item.cpfCnpj),
    razaoSocial: cadastro?.razaoSocial ?? item.razaoSocial,
    fornecedor: cadastro
      ? {
          id: cadastro.id ?? null,
          cpfCnpj: cadastro.cpfCnpj ?? null,
          razaoSocial: cadastro.razaoSocial ?? null,
          responsavel: cadastro.responsavel ?? null,
        }
      : null,
    intrSossego: toNumber(item.intrSossego),
    salobo: toNumber(item.salobo),
    acg: toNumber(item.acg),
    escadasAlumar: toNumber(item.escadasAlumar),
    horas: toNumber(item.horas),
    valor: toNumber(item.valor),
    rev: toNumber(item.rev),
    status: item.status,
    condicoesFixas: {
      valorFixo: text(condicoesFixas.valorFixo),
      tipoContratacao: text(condicoesFixas.tipoContratacao),
      adicionaisFixos: text(condicoesFixas.adicionaisFixos),
      observacoesContrato: text(condicoesFixas.observacoesContrato),
    },
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? null),
  };
}

export function mapaPagamentoData(payload: PaymentPayload, sourceRowHash?: string) {
  const rawPayload = {
    origem: "manual",
    ato: text(payload.ato),
    projetistaCodigo: text(payload.projetistaCodigo),
    responsavel: text(payload.responsavel),
    razaoSocial: text(payload.razaoSocial),
    intrSossego: parseDecimal(payload.intrSossego),
    salobo: parseDecimal(payload.salobo),
    acg: parseDecimal(payload.acg),
    escadasAlumar: parseDecimal(payload.escadasAlumar),
    valor: parseDecimal(payload.valor),
    rev: parseDecimal(payload.rev),
    status: text(payload.status),
    condicoesFixas: {
      valorFixo: text(payload.valorFixo),
      tipoContratacao: text(payload.tipoContratacao),
      adicionaisFixos: text(payload.adicionaisFixos),
      observacoesContrato: text(payload.observacoesContrato),
    },
  };

  return {
    ciclo: text(payload.ciclo) ?? "2605",
    ordem: Number(payload.ordem ?? 0),
    ato: text(payload.ato),
    projetistaCodigo: text(payload.projetistaCodigo),
    responsavel: text(payload.responsavel),
    cpfCnpj: encryptSensitive(text(payload.cpfCnpj)),
    razaoSocial: text(payload.razaoSocial),
    intrSossego: parseDecimal(payload.intrSossego),
    salobo: parseDecimal(payload.salobo),
    acg: parseDecimal(payload.acg),
    escadasAlumar: parseDecimal(payload.escadasAlumar),
    horas: parseDecimal(payload.horas),
    valor: parseDecimal(payload.valor),
    rev: parseDecimal(payload.rev),
    status: text(payload.status),
    rawPayload,
    sourceRowHash: sourceRowHash ?? manualHash({ id: randomUUID(), rawPayload }),
  };
}
