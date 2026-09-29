import { NextRequest, NextResponse } from "next/server";

import { requireAdministrativo } from "@/lib/admin";
import { FornecedorInativacaoError, setFornecedoresAtivos } from "@/lib/cadastro-fornecedor";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "A alteração de situação do fornecedor é restrita ao perfil ADMIN." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { ids?: unknown; ativo?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)))]
    : [];
  if (!ids.length || ids.length > 100 || typeof body?.ativo !== "boolean") {
    return NextResponse.json({ error: "Informe até 100 IDs válidos e o estado ativo desejado." }, { status: 400 });
  }
  try {
    const result = await setFornecedoresAtivos(ids, body.ativo, {
      id: auth.user.id,
      usuario: auth.user.usuario,
      nome: auth.user.nome,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FornecedorInativacaoError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
