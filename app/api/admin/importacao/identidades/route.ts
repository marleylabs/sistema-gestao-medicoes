import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { alvosDasSugestoes, listarIdentidadesDoCiclo } from "@/lib/identidade-importacao";

/**
 * Identidades da importação de um ciclo (pendentes, vinculadas, automáticas, descartadas). Só
 * leitura; mesmo acesso da tela de importação (MEDICAO/ADMIN). `podeResolver` diz se o usuário pode
 * vincular/cadastrar/descartar (ADMIN — as rotas de escrita checam de novo).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() ?? "";
  if (!/^\d{2}(0[1-9]|1[0-2])$/.test(ciclo)) return NextResponse.json({ error: "Informe o ciclo (YYMM)." }, { status: 400 });

  const identidades = await listarIdentidadesDoCiclo(ciclo);
  const rotulos = [...new Set(identidades.filter((i) => i.status === "PENDENTE").flatMap((i) => i.sugestoesCadastro))];
  return NextResponse.json({ identidades, sugestoes: await alvosDasSugestoes(rotulos), podeResolver: auth.user?.perfil === "ADMIN" });
}
