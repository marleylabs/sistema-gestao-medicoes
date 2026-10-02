import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { AliasImportacaoError, descartarLinhasEstruturais, type LinhaEstrutural } from "@/lib/identidade-importacao";

/**
 * Descarte consciente das linhas com dados e sem PROJETISTA que bloquearam a importação (as chaves
 * vêm do detalhe do bloqueio do ETL). Grava só a decisão do ciclo; a reimportação ignora essas
 * linhas. Restrito a ADMIN.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { ciclo?: unknown; origem?: unknown; linhas?: unknown } | null;
  const linhas: LinhaEstrutural[] = Array.isArray(body?.linhas)
    ? (body.linhas as Array<Record<string, unknown>>)
        .filter((l) => l && typeof l.chave === "string")
        .map((l) => ({
          chave: String(l.chave),
          linha: typeof l.linha === "number" && Number.isInteger(l.linha) ? l.linha : null,
          numeroDocumento: typeof l.numeroDocumento === "string" ? l.numeroDocumento : null,
          evidencia: typeof l.evidencia === "string" ? l.evidencia : null,
        }))
    : [];
  try {
    const resultado = await descartarLinhasEstruturais(
      { ciclo: typeof body?.ciclo === "string" ? body.ciclo : "", origem: typeof body?.origem === "string" ? body.origem : "Documentos", linhas },
      { id: auth.user.id, usuario: auth.user.usuario, nome: auth.user.nome },
    );
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof AliasImportacaoError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
