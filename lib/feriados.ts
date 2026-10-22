/**
 * Feriados nacionais do Brasil, calculados (não gravados). Os estaduais e municipais vêm da
 * tabela `feriados`, cadastrada pela medição (spec timesheet-ato). Datas em "YYYY-MM-DD".
 */

function iso(ano: number, mes: number, dia: number) {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(ano, mes, dia);
}

export type FeriadoNacional = { data: string; nome: string };

/** Feriados nacionais da lei (sem pontos facultativos como Carnaval e Corpus Christi). */
export function feriadosNacionais(ano: number): FeriadoNacional[] {
  const [, mesPascoa, diaPascoa] = pascoa(ano).split("-").map(Number);
  const sextaSanta = new Date(Date.UTC(ano, mesPascoa - 1, diaPascoa - 2)).toISOString().slice(0, 10);
  const lista: FeriadoNacional[] = [
    { data: iso(ano, 1, 1), nome: "Confraternização Universal" },
    { data: sextaSanta, nome: "Sexta-feira Santa" },
    { data: iso(ano, 4, 21), nome: "Tiradentes" },
    { data: iso(ano, 5, 1), nome: "Dia do Trabalho" },
    { data: iso(ano, 9, 7), nome: "Independência do Brasil" },
    { data: iso(ano, 10, 12), nome: "Nossa Senhora Aparecida" },
    { data: iso(ano, 11, 2), nome: "Finados" },
    { data: iso(ano, 11, 15), nome: "Proclamação da República" },
    { data: iso(ano, 12, 25), nome: "Natal" },
  ];
  // Lei 14.759/2023: feriado nacional a partir de 2024.
  if (ano >= 2024) lista.push({ data: iso(ano, 11, 20), nome: "Dia Nacional de Zumbi e da Consciência Negra" });
  return lista.sort((x, y) => x.data.localeCompare(y.data));
}

/** Feriados nacionais entre `inicio` e `fim` (inclusive), em "YYYY-MM-DD". */
export function feriadosNacionaisNoPeriodo(inicio: string, fim: string): FeriadoNacional[] {
  const anoInicio = Number(inicio.slice(0, 4));
  const anoFim = Number(fim.slice(0, 4));
  const lista: FeriadoNacional[] = [];
  for (let ano = anoInicio; ano <= anoFim; ano += 1) lista.push(...feriadosNacionais(ano));
  return lista.filter((f) => f.data >= inicio && f.data <= fim);
}
