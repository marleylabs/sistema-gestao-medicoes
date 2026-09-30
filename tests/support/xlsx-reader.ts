import { inflateRawSync } from "node:zlib";

/**
 * Leitor XLSX mínimo, só para testes (sem dependência nova): abre o ZIP, resolve as abas pelo
 * workbook.xml + rels e devolve as células com valor (strings compartilhadas, inline e números).
 * Suficiente para inspecionar máscaras/templates — não é um parser completo de OOXML.
 */
export type XlsxSheet = {
  name: string;
  /** "A1" → valor textual da célula (apenas células com valor). */
  cells: Map<string, string>;
  /** XML bruto da aba (para checar freeze pane, colunas etc.). */
  xml: string;
};

export type XlsxWorkbook = { sheets: XlsxSheet[]; entries: Map<string, Buffer> };

function unzip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("XLSX inválido: fim do diretório ZIP não encontrado.");
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("XLSX inválido: diretório ZIP corrompido.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(start, start + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decode(xml: string) {
  return xml.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function textOf(fragment: string) {
  return decode(Array.from(fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) => m[1]).join(""));
}

export function readXlsx(buffer: Buffer): XlsxWorkbook {
  const entries = unzip(buffer);
  const read = (name: string) => entries.get(name)?.toString("utf8") ?? "";
  const shared = Array.from(read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => textOf(m[1]));
  const rels = new Map(Array.from(read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)).map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? "";
    return [id, target.replace(/^\/?xl\//, "").replace(/^\//, "")];
  }));
  const sheets = Array.from(read("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)).map((m) => {
    const name = decode(/name="([^"]+)"/.exec(m[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const xml = read(`xl/${rels.get(rid)}`);
    const cells = new Map<string, string>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value: string | null = null;
      if (type === "inlineStr") value = textOf(body);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? "" : decode(v);
      }
      if (value !== null && value !== "") cells.set(ref, value);
    }
    return { name, cells, xml };
  });
  return { sheets, entries };
}

/** Número da linha de uma referência "AB12" → 12. */
export function rowOf(ref: string) {
  return Number(/\d+$/.exec(ref)?.[0] ?? 0);
}

/** Valores da linha 1 (cabeçalho), na ordem das colunas. */
export function headerOf(sheet: XlsxSheet) {
  return Array.from(sheet.cells.entries())
    .filter(([ref]) => rowOf(ref) === 1)
    .sort(([a], [b]) => colIndex(a) - colIndex(b))
    .map(([, v]) => v);
}

function colIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return letters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}
