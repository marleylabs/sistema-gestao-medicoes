/**
 * Cálculo de horas do timesheet ATO (spec timesheet-ato). Tudo em minutos desde 00:00.
 * Regra da planilha "Folha de Apropriação de Horas", com duas correções: sábado que é feriado
 * conta só como HE 100%, e a HE 50% do dia útil é só o tempo trabalhado depois das 17:00.
 */

import { cicloToDates } from "@/lib/ciclo";

export type TipoDia = "UTIL" | "SABADO" | "DOMINGO_FERIADO";

export type HorariosDia = {
  entrada1: number | null;
  saida1: number | null;
  entrada2: number | null;
  saida2: number | null;
};

export type HorasDia = { hn: number; he50: number; he100: number; total: number };

const INICIO_HE_50 = 17 * 60;
const MINUTOS_NO_DIA = 24 * 60;

/** Tipo do dia: domingo ou feriado prevalece sobre sábado. `data` em "YYYY-MM-DD". */
export function tipoDoDia(data: string, feriados: ReadonlySet<string>): TipoDia {
  const diaSemana = new Date(`${data}T00:00:00Z`).getUTCDay();
  if (diaSemana === 0 || feriados.has(data)) return "DOMINGO_FERIADO";
  if (diaSemana === 6) return "SABADO";
  return "UTIL";
}

function pares(h: HorariosDia): Array<[number, number]> {
  const lista: Array<[number, number]> = [];
  if (h.entrada1 !== null && h.saida1 !== null) lista.push([h.entrada1, h.saida1]);
  if (h.entrada2 !== null && h.saida2 !== null) lista.push([h.entrada2, h.saida2]);
  return lista;
}

/** Devolve a mensagem de erro, ou null se os horários são válidos. Dia vazio é válido. */
export function validarDia(h: HorariosDia): string | null {
  const valores = [h.entrada1, h.saida1, h.entrada2, h.saida2];
  for (const v of valores) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v >= MINUTOS_NO_DIA)) return "Horário inválido.";
  }
  if ((h.entrada1 === null) !== (h.saida1 === null)) return "Preencha a entrada e a saída da manhã.";
  if ((h.entrada2 === null) !== (h.saida2 === null)) return "Preencha a entrada e a saída da tarde.";
  if (h.entrada1 !== null && h.saida1 !== null && h.entrada1 >= h.saida1) return "A saída da manhã deve ser depois da entrada.";
  if (h.entrada2 !== null && h.saida2 !== null && h.entrada2 >= h.saida2) return "A saída final deve ser depois da entrada da tarde.";
  if (h.saida1 !== null && h.entrada2 !== null && h.entrada2 < h.saida1) return "A volta do almoço deve ser depois da saída para o almoço.";
  return null;
}

/** Horas de um dia já validado por `validarDia`. */
export function calcularDia(h: HorariosDia, tipo: TipoDia): HorasDia {
  const trabalhado = pares(h).reduce((soma, [e, s]) => soma + (s - e), 0);
  if (tipo === "DOMINGO_FERIADO") return { hn: 0, he50: 0, he100: trabalhado, total: trabalhado };
  if (tipo === "SABADO") return { hn: 0, he50: trabalhado, he100: 0, total: trabalhado };
  const he50 = pares(h).reduce((soma, [e, s]) => soma + Math.max(0, s - Math.max(e, INICIO_HE_50)), 0);
  return { hn: trabalhado - he50, he50, he100: 0, total: trabalhado };
}

export function somarHoras(dias: HorasDia[]): HorasDia {
  return dias.reduce(
    (t, d) => ({ hn: t.hn + d.hn, he50: t.he50 + d.he50, he100: t.he100 + d.he100, total: t.total + d.total }),
    { hn: 0, he50: 0, he100: 0, total: 0 },
  );
}

/** Minutos → "h:mm" (horas podem passar de 24 no total do ciclo). */
export function formatarDuracao(minutos: number) {
  return `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, "0")}`;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
export function formatarData(data: string) {
  return data.split("-").reverse().join("/");
}

/** Dias do ciclo ATO (21 do mês anterior a 20 do mês do ciclo), em "YYYY-MM-DD". */
export function diasDoCiclo(ciclo: string): string[] {
  const { atoInicio, atoFim } = cicloToDates(ciclo);
  const dias: string[] = [];
  for (let d = new Date(`${atoInicio}T00:00:00Z`); isoDate(d) <= atoFim; d.setUTCDate(d.getUTCDate() + 1)) dias.push(isoDate(d));
  return dias;
}
