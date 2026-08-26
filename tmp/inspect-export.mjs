import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("tmp/financeiro-e2e.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 8000,
  tableMaxRows: 20,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);
