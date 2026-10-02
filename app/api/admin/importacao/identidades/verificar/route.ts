import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { alvosDasSugestoes, valoresUnicos, verificarIdentidades } from "@/lib/identidade-importacao";

/**
 * Estado ATUAL das identidades que bloquearam a última importação (o detalhe do ETL é da execução
 * passada): o que já resolve (alias criado, fornecedor cadastrado) sai da contagem de pendências.
 * Só leitura. Mesmo acesso da tela de importação (MEDICAO/ADMIN); `podeResolver` diz se o usuário
 * pode vincular/cadastrar (ADMIN — as rotas de escrita checam de novo).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as { valores?: unknown; sugestoes?: unknown } | null;
  const valores = valoresUnicos(body?.valores);
  if (!valores.length) return NextResponse.json({ error: "Informe os nomes (\"valores\")." }, { status: 400 });

  const [identidades, sugestoes] = await Promise.all([
    verificarIdentidades(valores),
    alvosDasSugestoes(valoresUnicos(body?.sugestoes)),
  ]);
  return NextResponse.json({ identidades, sugestoes, podeResolver: auth.user?.perfil === "ADMIN" });
}
