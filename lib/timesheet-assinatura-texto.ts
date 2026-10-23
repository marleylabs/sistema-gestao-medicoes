/**
 * Texto e limites da assinatura eletrônica da folha (spec docs/brain/specs/timesheet-assinatura.md), usados
 * no modal (cliente) e na validação (servidor). A versão do aceite vai no resumo de cada assinatura gravada.
 */

export const ACEITE_VERSAO = "2026-10-23";
export const TEXTO_ACEITE =
  "Ao assinar, declaro que conferi os lançamentos desta folha e concordo em assiná-la eletronicamente. " +
  "A assinatura registra meu usuário, a data e a hora, o endereço de acesso e o conteúdo da folha neste momento, " +
  "e tem validade entre as partes que aceitam este meio (MP 2.200-2/2001, art. 10, § 2º).";

export const MAX_ASSINATURA_BYTES = 100 * 1024;
/** Tamanho do quadro de desenho (pixels do PNG); o servidor aceita só o que cabe nestes limites. */
export const QUADRO = { largura: 600, altura: 200 } as const;
export const LIMITES_PNG = { minLargura: 100, maxLargura: 1600, minAltura: 40, maxAltura: 800 } as const;

/** "dd/mm/aaaa hh:mm" no fuso de Brasília (tela, PDF e XLSX mostram a mesma hora). */
export function dataHoraAssinatura(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso)).replace(",", "");
}

/** "YYYY-MM-DD" da assinatura no fuso de Brasília (data da célula de assinatura do XLSX). */
export function dataAssinatura(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export type MetodoAssinatura = "DESENHO" | "DIGITADO";
/** O que o modal manda: PNG em data URL, o modo e a senha do usuário. */
export type EntradaAssinatura = { imagem: string; metodo: MetodoAssinatura; senha: string };
