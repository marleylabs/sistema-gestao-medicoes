import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin, requireAdministrativo } from "@/lib/admin";

const TEMPLATES = {
  medicoes: {
    filename: "Mascara_Importacao_Medicoes.xlsx",
    authorize: requireAdmin,
  },
  administrativo: {
    filename: "Mascara_Cadastros_Administrativo.xlsx",
    authorize: requireAdministrativo,
  },
} as const;

function xlsxResponse(buffer: Buffer, filename: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const template = TEMPLATES[tipo as keyof typeof TEMPLATES];
  if (!template) {
    return NextResponse.json({ error: "Máscara não encontrada." }, { status: 404 });
  }

  const auth = await template.authorize();
  if (auth.response) return auth.response;

  const filepath = path.join(process.cwd(), "app-assets", "templates", template.filename);
  const buffer = await readFile(filepath);
  return xlsxResponse(buffer, template.filename);
}
