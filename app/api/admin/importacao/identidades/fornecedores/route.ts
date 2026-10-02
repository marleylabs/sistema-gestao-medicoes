import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { buscarFornecedores } from "@/lib/identidade-importacao";

/** Busca de fornecedor ativo (nome, código ou razão social) para vincular um nome da planilha. Restrito a ADMIN. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ fornecedores: await buscarFornecedores(q) });
}
