/**
 * Deriva as datas de um ciclo a partir do identificador YYMM.
 *
 * Padrão:
 *   ATO    — 21 do mês anterior  a 20 do mês da medição
 *   Produção — 21 dois meses antes a 20 do mês anterior
 *
 * Exemplo ciclo 2605 (ano 2026, mês 05):
 *   ATO:      21/04/2026 – 20/05/2026
 *   Produção: 21/03/2026 – 20/04/2026
 */
function parseCiclo(ciclo: string): { year: number; month: number } {
  if (!/^\d{4}$/.test(ciclo)) {
    throw new RangeError(`Ciclo inválido: ${JSON.stringify(ciclo)}. Use o formato YYMM.`);
  }

  const year = 2000 + Number(ciclo.slice(0, 2));
  const month = Number(ciclo.slice(2, 4));
  if (month < 1 || month > 12) {
    throw new RangeError(`Ciclo inválido: ${JSON.stringify(ciclo)}. O mês deve estar entre 01 e 12.`);
  }

  return { year, month };
}

/**
 * Ciclo real de medição (YYMM com mês 01–12) — a mesma regra de `parseCiclo`. "GERAL" (visão de
 * todos os ciclos), vazio ou malformado nunca são ciclo. Usado onde uma operação precisa de UMA
 * competência específica (ex.: envio de BM individual e em lote).
 */
export function isCicloValido(ciclo: unknown): ciclo is string {
  if (typeof ciclo !== "string") return false;
  try {
    parseCiclo(ciclo);
    return true;
  } catch {
    return false;
  }
}

export function cicloToDates(ciclo: string) {
  const { year, month } = parseCiclo(ciclo);

  // JS Date: month index é 0-based
  const atoInicio      = new Date(Date.UTC(year, month - 2, 21)); // dia 21 do mês anterior
  const atoFim         = new Date(Date.UTC(year, month - 1, 20)); // dia 20 do mês atual
  const producaoInicio = new Date(Date.UTC(year, month - 3, 21)); // dia 21 de dois meses atrás
  const producaoFim    = new Date(Date.UTC(year, month - 2, 20)); // dia 20 do mês anterior

  function fmt(d: Date) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  return {
    atoInicio:      fmt(atoInicio),
    atoFim:         fmt(atoFim),
    producaoInicio: fmt(producaoInicio),
    producaoFim:    fmt(producaoFim),
  };
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function cicloToMesReferencia(ciclo: string): string {
  const { year, month } = parseCiclo(ciclo);
  return `${MESES[month - 1]} de ${year}`;
}

/** Rótulo visual curto de um ciclo YYMM, com o ano sempre visível: "2608" → "Ago/2026". */
export function formatCicloLabel(ciclo: string): string {
  const { year, month } = parseCiclo(ciclo);
  return `${MESES[month - 1].slice(0, 3)}/${year}`;
}
