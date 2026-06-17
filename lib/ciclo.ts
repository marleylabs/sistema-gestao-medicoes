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
export function cicloToDates(ciclo: string) {
  const year  = 2000 + parseInt(ciclo.slice(0, 2), 10);
  const month = parseInt(ciclo.slice(2, 4), 10); // 1-12

  // JS Date: month index é 0-based
  const atoInicio      = new Date(year, month - 2, 21); // dia 21 do mês anterior
  const atoFim         = new Date(year, month - 1, 20); // dia 20 do mês atual
  const producaoInicio = new Date(year, month - 3, 21); // dia 21 de dois meses atrás
  const producaoFim    = new Date(year, month - 2, 20); // dia 20 do mês anterior

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

export function cicloToMesReferencia(ciclo: string): string {
  const year  = 2000 + parseInt(ciclo.slice(0, 2), 10);
  const month = parseInt(ciclo.slice(2, 4), 10);
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${meses[month - 1]} de ${year}`;
}
