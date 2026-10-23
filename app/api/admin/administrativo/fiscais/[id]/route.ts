import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { isUuid } from "@/lib/file-security";
import { atualizarFiscal, definirFiscalAtivo, enviarPrimeiroAcessoFiscal } from "@/lib/fiscais";

/** `{ ativo }` ativa/inativa; `{ action: "enviar_primeiro_acesso", requestId }` envia o acesso; `{ action: "editar", ...dados }` edita. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Fiscal inválido." }, { status: 400 });
  const body: unknown = await request.json().catch(() => null);
  const dados = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const r = dados.action === "enviar_primeiro_acesso"
    ? await enviarPrimeiroAcessoFiscal({ id, requestId: dados.requestId, ator: auth.user })
    : dados.action === "editar"
      ? await atualizarFiscal({ id, body: dados, ator: auth.user })
      : await definirFiscalAtivo({ id, ativo: dados.ativo, ator: auth.user });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
