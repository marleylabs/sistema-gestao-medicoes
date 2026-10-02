import { NextRequest, NextResponse } from "next/server";
import { findColaboradorUsuarios, importCadastrosFornecedores, normalizePersonName, serializeCadastroFornecedor } from "@/lib/cadastro-fornecedor";
import { requireAdministrativo } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { jsonNoStore } from "@/lib/no-store";

const MAX_SIZE = 15 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const cadastros = await prisma.cadastroFornecedor.findMany({
    where: request.nextUrl.searchParams.get("includeInactive") === "true" ? undefined : { ativo: true },
    orderBy: [{ responsavel: "asc" }],
  });

  // Vínculo fornecedor↔acesso é por nome (não há FK real) — resolvido em lote para não fazer N+1.
  const acessos = await findColaboradorUsuarios(cadastros.map((c) => c.responsavel));

  return NextResponse.json(
    cadastros.map((cadastro) => ({
      ...serializeCadastroFornecedor(cadastro),
      acesso: acessos.get(normalizePersonName(cadastro.responsavel)) ?? null,
    })),
  );
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
    const result = await importCadastrosFornecedores(buffer, {
      id: auth.user!.id,
      usuario: auth.user!.usuario,
      nome: auth.user!.nome,
    });
    // `senhasTemporarias` (usuários novos/reativados) só existem nesta resposta — nunca cacheável.
    return jsonNoStore(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível importar os cadastros." },
      { status: 400 },
    );
  }
}
