import assert from "node:assert/strict";
import test from "node:test";
import { calcularDia, somarHoras, tipoDoDia, validarDia, type HorariosDia } from "../lib/timesheet-calculo";

const hm = (texto: string) => {
  const [h, m] = texto.split(":").map(Number);
  return h * 60 + m;
};
const dia = (e1: string | null, s1: string | null, e2: string | null, s2: string | null): HorariosDia => ({
  entrada1: e1 === null ? null : hm(e1),
  saida1: s1 === null ? null : hm(s1),
  entrada2: e2 === null ? null : hm(e2),
  saida2: s2 === null ? null : hm(s2),
});
const h = (horas: number) => horas * 60;
const semFeriado = new Set<string>();

test("tipo do dia: útil, sábado, domingo e feriado", () => {
  assert.equal(tipoDoDia("2026-06-01", semFeriado), "UTIL"); // segunda
  assert.equal(tipoDoDia("2026-06-06", semFeriado), "SABADO");
  assert.equal(tipoDoDia("2026-06-07", semFeriado), "DOMINGO_FERIADO");
  assert.equal(tipoDoDia("2026-06-03", new Set(["2026-06-03"])), "DOMINGO_FERIADO");
});

test("correção 1: sábado que é feriado conta só como HE 100%", () => {
  const tipo = tipoDoDia("2026-06-06", new Set(["2026-06-06"]));
  assert.equal(tipo, "DOMINGO_FERIADO");
  assert.deepEqual(calcularDia(dia("08:00", "12:00", "13:00", "17:00"), tipo), { hn: 0, he50: 0, he100: h(8), total: h(8) });
});

test("dia útil 08–12 / 13–17 = 8h de hora normal", () => {
  assert.deepEqual(calcularDia(dia("08:00", "12:00", "13:00", "17:00"), "UTIL"), { hn: h(8), he50: 0, he100: 0, total: h(8) });
});

test("dia útil com saída às 20:00 = 8h normal + 3h HE 50% (planilha, linha 12)", () => {
  assert.deepEqual(calcularDia(dia("08:00", "12:00", "13:00", "20:00"), "UTIL"), { hn: h(8), he50: h(3), he100: 0, total: h(11) });
});

test("correção 2: tarde que começa depois das 17:00 não gera hora normal negativa", () => {
  assert.deepEqual(calcularDia(dia("08:00", "12:00", "18:00", "20:00"), "UTIL"), { hn: h(4), he50: h(2), he100: 0, total: h(6) });
});

test("período lançado só na manhã que passa das 17:00 também gera HE 50% (tempo depois das 17:00)", () => {
  assert.deepEqual(calcularDia(dia("14:00", "19:00", null, null), "UTIL"), { hn: h(3), he50: h(2), he100: 0, total: h(5) });
});

test("entrar antes das 08:00 não gera hora extra", () => {
  assert.deepEqual(calcularDia(dia("06:00", "12:00", "13:00", "17:00"), "UTIL"), { hn: h(10), he50: 0, he100: 0, total: h(10) });
});

test("sábado: o dia inteiro é HE 50%", () => {
  assert.deepEqual(calcularDia(dia("08:00", "12:00", null, null), "SABADO"), { hn: 0, he50: h(4), he100: 0, total: h(4) });
});

test("domingo: o dia inteiro é HE 100%", () => {
  assert.deepEqual(calcularDia(dia("08:00", "12:00", "13:00", "15:30"), "DOMINGO_FERIADO"), { hn: 0, he50: 0, he100: hm("06:30"), total: hm("06:30") });
});

test("dia vazio e dia só com a tarde", () => {
  assert.deepEqual(calcularDia(dia(null, null, null, null), "UTIL"), { hn: 0, he50: 0, he100: 0, total: 0 });
  assert.deepEqual(calcularDia(dia(null, null, "13:00", "18:00"), "UTIL"), { hn: h(4), he50: h(1), he100: 0, total: h(5) });
});

test("validação: dia vazio e dia completo são válidos", () => {
  assert.equal(validarDia(dia(null, null, null, null)), null);
  assert.equal(validarDia(dia("08:00", "12:00", "12:00", "17:00")), null);
});

test("validação: pares incompletos, ordem invertida e horário fora do dia", () => {
  assert.match(validarDia(dia("08:00", null, null, null)) ?? "", /manhã/);
  assert.match(validarDia(dia(null, null, null, "17:00")) ?? "", /tarde/);
  assert.match(validarDia(dia("12:00", "08:00", null, null)) ?? "", /saída da manhã/);
  assert.match(validarDia(dia("08:00", "12:00", "11:00", "17:00")) ?? "", /volta do almoço/);
  assert.match(validarDia(dia("08:00", "12:00", "13:00", "13:00")) ?? "", /saída final/);
  assert.equal(validarDia({ entrada1: 0, saida1: 1440, entrada2: null, saida2: null }), "Horário inválido.");
  assert.equal(validarDia({ entrada1: 1.5, saida1: 60, entrada2: null, saida2: null }), "Horário inválido.");
});

test("soma do ciclo", () => {
  assert.deepEqual(
    somarHoras([
      { hn: h(8), he50: h(3), he100: 0, total: h(11) },
      { hn: 0, he50: h(4), he100: 0, total: h(4) },
      { hn: 0, he50: 0, he100: h(8), total: h(8) },
    ]),
    { hn: h(8), he50: h(7), he100: h(8), total: h(23) },
  );
});
