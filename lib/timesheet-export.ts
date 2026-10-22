import { createWorkbookXlsx, type CellValue } from "@/lib/xlsx";
import { formatarData, formatarDuracao } from "@/lib/timesheet-calculo";
import type { FolhaTimesheet } from "@/lib/timesheet";

/**
 * Folha de Apropriação de Horas em XLSX, no layout do modelo (cabeçalho, dias, total, assinaturas).
 * shortcut: o writer de lib/xlsx.ts não mescla células nem formata hora, então as horas saem como
 * texto "h:mm" e o cabeçalho em pares rótulo/valor; estender o writer se o gestor exigir o visual do modelo.
 */

export const CONTRATADA = "Projeta Consultoria";

export function linhasCabecalho(folha: FolhaTimesheet): Array<[string, string]> {
  const c = folha.cabecalho;
  return [
    ["Contrato N.º", c.contratoNumero ?? c.contratoNome ?? ""],
    ["Doc. N.º", c.docNumero ?? ""],
    ["Tipo de Serviço", "ATO"],
    ["Contratada", CONTRATADA],
    ["Colaborador", folha.fornecedor.nome],
    ["Função", c.funcao ?? ""],
    ["Item da PQ", c.itemPq ?? ""],
    ["Nº da SE", c.numeroSe ?? ""],
    ["Área", c.area ?? ""],
    ["Local", c.local ?? ""],
    ["Período", `${formatarData(folha.periodo.inicio)} a ${formatarData(folha.periodo.fim)}`],
  ];
}

export const COLUNAS_DIAS = [
  "DIA-MÊS", "ENTRADA (MANHÃ)", "SAÍDA (MANHÃ)", "ENTRADA (TARDE)", "SAÍDA (TARDE)",
  "HORA NORMAL", "HORA EXTRA 50%", "HORA EXTRA 100%", "TOTAL DE HORAS", "PROJETO/PEP", "DESCRIÇÃO DOS SERVIÇOS", "SOLICITANTE",
];

export function planilhaTimesheet(folha: FolhaTimesheet): Buffer {
  const vazio = (n: number) => Array.from({ length: n }, () => "");
  const rows: CellValue[][] = [
    ...linhasCabecalho(folha),
    [],
    COLUNAS_DIAS,
    ...folha.dias.map((d) => [
      new Date(`${d.data}T00:00:00Z`),
      d.entrada1 ?? "", d.saida1 ?? "", d.entrada2 ?? "", d.saida2 ?? "",
      formatarDuracao(d.horas.hn), formatarDuracao(d.horas.he50), formatarDuracao(d.horas.he100), formatarDuracao(d.horas.total),
      d.projetoPep ?? (d.feriado ? `Feriado: ${d.feriado}` : ""), d.descricao ?? "", d.solicitante ?? "",
    ]),
    ["TOTAL", ...vazio(4), formatarDuracao(folha.totais.hn), formatarDuracao(folha.totais.he50), formatarDuracao(folha.totais.he100), formatarDuracao(folha.totais.total)],
    [],
    ["Ass.:", folha.fornecedor.nome, "", "", "", "", "", "", "", `Visto fiscalização da VALE: ${folha.cabecalho.fiscal ?? ""}`],
    ["Observações:"],
  ];
  return createWorkbookXlsx([{
    name: "timesheet",
    headers: ["Folha de Apropriação de Horas", ...vazio(COLUNAS_DIAS.length - 1)],
    rows,
    columnWidths: [16, 12, 12, 12, 12, 12, 13, 14, 13, 18, 36, 18],
  }]);
}

export function nomeArquivoTimesheet(folha: FolhaTimesheet) {
  return `timesheet_${folha.ciclo}_${(folha.fornecedor.codigo ?? "fornecedor").replace(/[^\w.-]+/g, "_")}.xlsx`;
}
