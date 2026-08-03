declare module "pdf-parse/lib/pdf-parse.js" {
  export default function pdfParse(buffer: Buffer): Promise<{ text?: string }>;
}
