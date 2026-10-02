import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { AliasImportacaoError, descartarIdentidade, isUuid } from "@/lib/identidade-importacao";

/**
 * Descarta uma identidade PENDENTE deste ciclo (todas as ocorrências). Não exclui fornecedor,
 * cadastro nem alias; não vale para outros ciclos. Restrito a ADMIN. Idempotente.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Identidade inválida." }, { status: 400 });

  try {
    return NextResponse.json(await descartarIdentidade(id, { id: auth.user.id, usuario: auth.user.usuario, nome: auth.user.nome }));
  } catch (error) {
    if (error instanceof AliasImportacaoError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
