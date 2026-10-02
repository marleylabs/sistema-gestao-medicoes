import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { AliasImportacaoError, isUuid, vincularIdentidade } from "@/lib/identidade-importacao";

/**
 * Vincula uma identidade PENDENTE do ciclo a um cadastro existente (alias global + medições e mapa
 * do ciclo passam ao fornecedor canônico, sem reimportar e sem mudar valor). Restrito a ADMIN.
 * Aceita `profissionalId` (busca/sugestão) ou `codigoCanonico` (cadastro recém-criado pelo fluxo
 * oficial do Administrativo). Idempotente para o mesmo alvo; outro alvo ou descartado → 409.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Identidade inválida." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const profissionalId = isUuid(body?.profissionalId) ? body.profissionalId : null;
  const codigoCanonico = typeof body?.codigoCanonico === "string" && body.codigoCanonico.trim() ? body.codigoCanonico.trim().slice(0, 200) : null;
  if (!profissionalId && !codigoCanonico) {
    return NextResponse.json({ error: "Informe o fornecedor (\"profissionalId\" ou \"codigoCanonico\")." }, { status: 400 });
  }

  try {
    const resultado = await vincularIdentidade(
      { identidadeId: id, profissionalId, codigoCanonico },
      { id: auth.user.id, usuario: auth.user.usuario, nome: auth.user.nome },
    );
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof AliasImportacaoError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
