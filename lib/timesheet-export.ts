import { readFileSync } from "node:fs";
import path from "node:path";
import { createZip, readZipEntries } from "@/lib/xlsx";
import { formatarData } from "@/lib/timesheet-calculo";
import type { FolhaTimesheet } from "@/lib/timesheet";

/**
 * Folha de Apropriação de Horas em XLSX: preenche o modelo oficial (app-assets/templates/Timesheet_ATO.xlsx,
 * a planilha da VALE limpa: só a aba "timesheet", sem fórmulas, links externos nem dados de exemplo).
 * Logos, mesclagens, bordas, fontes e impressão vêm do modelo; aqui só entram os valores, nas mesmas células.
 */

export const CONTRATADA = "Projeta Consultoria";

const MODELO = path.join(process.cwd(), "app-assets", "templates", "Timesheet_ATO.xlsx");
const PLANILHA = "xl/worksheets/sheet1.xml";
const PRIMEIRA_LINHA = 12; // dias nas linhas 12–42 do modelo (até 31 dias)
const MAX_DIAS = 31;

type Valor = string | number | null;

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const serialData = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000 + 25_569;
const fracaoDia = (minutos: number) => minutos / 1440;
const hora = (hhmm: string | null) => (hhmm ? fracaoDia(Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) : null);

/** Troca o conteúdo de uma célula do modelo mantendo o estilo (s="…"). A célula precisa existir no modelo. */
function definir(xml: string, ref: string, valor: Valor | { rico: string }) {
  const re = new RegExp(`<c r="${ref}"( s="\\d+")?[^>]*?(?:/>|>.*?</c>)`);
  const achado = xml.match(re);
  if (!achado) throw new Error(`Modelo do timesheet sem a célula ${ref}.`);
  const estilo = achado[1] ?? "";
  const celula = valor === null || valor === ""
    ? `<c r="${ref}"${estilo}/>`
    : typeof valor === "number"
      ? `<c r="${ref}"${estilo}><v>${valor}</v></c>`
      : typeof valor === "string"
        ? `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`
        : `<c r="${ref}"${estilo} t="inlineStr"><is>${valor.rico}</is></c>`;
  return xml.replace(re, celula);
}

/** Rótulo em negrito + valor normal, como "Tipo de Serviço: ATO" no modelo. */
function rotuloValor(rotulo: string, valor: string) {
  const fonte = `<sz val="11"/><color theme="1"/><rFont val="Arial"/><family val="2"/>`;
  return { rico: `<r><rPr><b/>${fonte}</rPr><t xml:space="preserve">${escapar(rotulo)}</t></r><r><rPr>${fonte}</rPr><t xml:space="preserve">${escapar(valor)}</t></r>` };
}

/** Linhas cinza (sábado, domingo e feriado), no lugar da regra do modelo que dependia da aba oculta "dias". */
function linhasCinza(xml: string, linhas: number[]) {
  const bloco = /<conditionalFormatting sqref="[^"]*">([\s\S]*?)<\/conditionalFormatting>/;
  if (!linhas.length) return xml.replace(bloco, "");
  const sqref = linhas.map((l) => `A${l}:N${l}`).join(" ");
  return xml.replace(bloco, (_, regra: string) => `<conditionalFormatting sqref="${sqref}">${regra.replace(/<formula>[\s\S]*?<\/formula>/, "<formula>TRUE</formula>")}</conditionalFormatting>`);
}

/** `hoje` (YYYY-MM-DD, Brasília): a data da exportação vai em "Data:" e nas duas assinaturas. */
export function planilhaTimesheet(folha: FolhaTimesheet, hoje: string): Buffer {
  if (folha.dias.length > MAX_DIAS) throw new Error(`O modelo comporta ${MAX_DIAS} dias; o ciclo tem ${folha.dias.length}.`);
  const entradas = readZipEntries(readFileSync(MODELO));
  const original = entradas.get(PLANILHA);
  if (!original) throw new Error("Modelo do timesheet sem a planilha.");
  const c = folha.cabecalho;
  let xml = original.toString("utf8");

  const cabecalho: Array<[string, Valor | { rico: string }]> = [
    ["M2", serialData(hoje)],
    ["K4", c.contratoNumero ?? c.contratoNome ?? null],
    ["M3", `Doc. N.º: ${c.docNumero ?? ""}`],
    ["M5", `Local: ${c.local ?? ""}`],
    ["J6", rotuloValor("Nº da SE:", c.numeroSe ? ` ${c.numeroSe}` : "")],
    ["A7", folha.fornecedor.nome], // o formato da célula já escreve "Funcionário: "
    ["J7", `Função: ${c.funcao ?? ""}`],
    ["M7", `${formatarData(folha.periodo.inicio)} a ${formatarData(folha.periodo.fim)}`],
    ["M8", `Item da PQ:  ${c.itemPq ?? ""}`],
    ["A9", c.area ?? null],
    ["B46", folha.fornecedor.nome],
    ["K46", `Visto fiscalização da VALE:  ${c.fiscal ?? ""}`],
    ["J48", serialData(hoje)],
    ["N48", serialData(hoje)],
  ];
  for (const [ref, valor] of cabecalho) xml = definir(xml, ref, valor);

  const cinza: number[] = [];
  folha.dias.forEach((d, i) => {
    const l = PRIMEIRA_LINHA + i;
    if (d.tipo !== "UTIL") cinza.push(l);
    const valores: Array<[string, Valor]> = [
      ["A", serialData(d.data)],
      ["B", hora(d.entrada1)], ["C", hora(d.saida1)], ["D", hora(d.entrada2)], ["E", hora(d.saida2)],
      ["F", fracaoDia(d.horas.hn)], ["G", fracaoDia(d.horas.he50)], ["H", fracaoDia(d.horas.he100)], ["I", fracaoDia(d.horas.total)],
      ["J", d.projetoPep ?? (d.feriado ? `Feriado: ${d.feriado}` : null)],
      ["K", d.descricao ?? null],
      ["N", d.solicitante ?? null],
    ];
    for (const [col, valor] of valores) xml = definir(xml, `${col}${l}`, valor);
  });
  const t = folha.totais;
  for (const [col, min] of [["F", t.hn], ["G", t.he50], ["H", t.he100], ["I", t.total]] as const) xml = definir(xml, `${col}43`, fracaoDia(min));
  xml = linhasCinza(xml, cinza);

  entradas.set(PLANILHA, Buffer.from(xml, "utf8"));
  return createZip([...entradas].map(([name, data]) => ({ name, data })));
}

export function nomeArquivoTimesheet(folha: FolhaTimesheet) {
  return `timesheet_${folha.ciclo}_${(folha.fornecedor.codigo ?? "fornecedor").replace(/[^\w.-]+/g, "_")}.xlsx`;
}
