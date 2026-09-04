import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { getCandidateCodigosForRow, getIdentityCandidateSummaries } from "@/lib/cadastro-fornecedor";

/**
 * Passo 1 do fluxo "Resolver identidade" (modal do Painel Administrativo): dado o nome de uma
 * linha que ficou em CONFLICT/REQUIRES_REVIEW na importação, recalcula os candidatos REAIS no
 * servidor (nunca aceita uma lista de candidatos vinda do cliente) e devolve os detalhes
 * necessários para o ADMIN decidir com segurança. Restrito a ADMIN — mesma regra de
 * `bulk-delete` (mais estrito que o resto do módulo Administrativo).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const responsavel = typeof (body as { responsavel?: unknown } | null)?.responsavel === "string" ? (body as { responsavel: string }).responsavel.trim() : "";
  if (!responsavel) {
    return NextResponse.json({ error: "Informe o nome (responsavel) da linha." }, { status: 400 });
  }

  const { kind, candidateCodigos, motivo } = await getCandidateCodigosForRow(responsavel);
  if (kind !== "CONFLICT" && kind !== "REQUIRES_REVIEW") {
    return NextResponse.json({ error: `"${responsavel}" não está mais em conflito/revisão — reimporte esta linha normalmente.` }, { status: 409 });
  }

  const candidatos = await getIdentityCandidateSummaries(candidateCodigos);
  return NextResponse.json({ kind, candidatos, motivo: motivo ?? null });
}
