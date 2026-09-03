import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { deleteFornecedoresDefinitivamente } from "@/lib/cadastro-fornecedor";

const MAX_IDS_PER_REQUEST = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Exclusão DEFINITIVA de fornecedor(es) — usada tanto pela ação individual ("Excluir fornecedor
 * definitivamente") quanto pela exclusão em massa do Administrativo (o frontend chama esta MESMA
 * rota com um array de 1 ou muitos IDs). Restrito a perfil ADMIN (mais estrito que o resto do
 * módulo Administrativo, que aceita ADMINISTRATIVO também).
 *
 * Política completa (auditoria + implementação): ver `deleteFornecedoresDefinitivamente` em
 * lib/cadastro-fornecedor.ts. Resumo: `CadastroFornecedor` sempre é removido; `Usuario` sempre é
 * desativado (nunca apagado — preserva chat); `Profissional` só é reavaliado quando este é o
 * ÚLTIMO cadastro daquela identidade; permanece como tombstone explícito, com ou sem histórico.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Exclusão definitiva restrita ao perfil ADMIN." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rawIds = Array.isArray((body as { ids?: unknown } | null)?.ids) ? (body as { ids: unknown[] }).ids : null;
  if (!rawIds) {
    return NextResponse.json({ error: "Informe um array de IDs." }, { status: 400 });
  }
  // Nunca confia nos IDs vindos do frontend além do formato básico — a existência real é
  // verificada dentro de deleteFornecedoresDefinitivamente contra o banco antes de qualquer exclusão.
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id.trim())).map((id) => id.trim()))];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nenhum UUID válido informado." }, { status: 400 });
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json({ error: `No máximo ${MAX_IDS_PER_REQUEST} fornecedores por operação.` }, { status: 400 });
  }

  const resultado = await deleteFornecedoresDefinitivamente(ids, {
    id: auth.user.id,
    usuario: auth.user.usuario,
    nome: auth.user.nome,
  });

  return NextResponse.json(resultado);
}
