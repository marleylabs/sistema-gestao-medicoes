import { NextRequest, NextResponse } from "next/server";
import { importCadastrosFornecedores, serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { requireAdministrativo } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const MAX_SIZE = 15 * 1024 * 1024;

export async function GET() {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const cadastros = await prisma.cadastroFornecedor.findMany({
    orderBy: [{ responsavel: "asc" }],
  });

  return NextResponse.json(cadastros.map(serializeCadastroFornecedor));
}

export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Arquivo muito grande (máx. 15 MB)." }, { status: 400 });
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    return NextResponse.json({ error: "Envie uma planilha .xlsx ou .xlsm." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.readUInt16LE(0) !== 0x4b50) {
      return NextResponse.json({ error: "Arquivo Excel inválido." }, { status: 400 });
    }
    const result = await importCadastrosFornecedores(buffer);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível importar os cadastros." },
      { status: 400 },
    );
  }
}
