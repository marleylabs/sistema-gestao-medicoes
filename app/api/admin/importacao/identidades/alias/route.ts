import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { AliasImportacaoError, criarAliasImportacao } from "@/lib/identidade-importacao";

/**
 * Vincula um nome da planilha a um fornecedor existente (ProfissionalAlias). Decisão humana
 * explícita — nunca automática; o código/nome canônico do fornecedor não muda. Restrito a ADMIN
 * (mesma regra da resolução de identidade do Painel Administrativo). Idempotente: repetir o mesmo
 * vínculo devolve JA_EXISTE; o mesmo nome para outro fornecedor é recusado (409).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const alias = typeof body?.alias === "string" ? body.alias : "";
  const profissionalId = typeof body?.profissionalId === "string" ? body.profissionalId.trim() : "";
  if (!alias.trim() || !/^[0-9a-f-]{36}$/i.test(profissionalId)) {
    return NextResponse.json({ error: "Informe o nome da planilha (\"alias\") e o fornecedor (\"profissionalId\")." }, { status: 400 });
  }

  try {
    const resultado = await criarAliasImportacao(
      {
        alias,
        profissionalId,
        aba: typeof body?.aba === "string" ? body.aba.slice(0, 80) : null,
        ciclo: typeof body?.ciclo === "string" && /^\d{4}$/.test(body.ciclo) ? body.ciclo : null,
        linhas: Array.isArray(body?.linhas) ? (body.linhas as unknown[]).filter((n): n is number => Number.isInteger(n)) : [],
      },
      { id: auth.user.id, usuario: auth.user.usuario, nome: auth.user.nome },
    );
    return NextResponse.json(resultado, { status: resultado.status === "CRIADO" ? 201 : 200 });
  } catch (error) {
    if (error instanceof AliasImportacaoError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
