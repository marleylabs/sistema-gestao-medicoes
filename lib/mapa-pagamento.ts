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

export function serializeMapaPagamentoItem(item: any) {
  return {
    id: item.id,
    ordem: item.ordem,
    ato: item.ato,
    projetistaCodigo: item.projetistaCodigo,
    responsavel: item.responsavel,
    cpfCnpj: decryptSensitive(item.cpfCnpj),
    razaoSocial: item.razaoSocial,
    intrSossego: toNumber(item.intrSossego),
    salobo: toNumber(item.salobo),
    acg: toNumber(item.acg),
    escadasAlumar: toNumber(item.escadasAlumar),
    horas: toNumber(item.horas),
    valor: toNumber(item.valor),
    rev: toNumber(item.rev),
    status: item.status,
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
