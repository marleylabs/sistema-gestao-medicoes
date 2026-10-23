import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { criarFiscal, listarFiscais } from "@/lib/fiscais";

export async function GET() {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  return NextResponse.json(await listarFiscais());
}

export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  const body: unknown = await request.json().catch(() => null);
  const dados = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const r = await criarFiscal({ body: dados, ator: auth.user });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.fiscal, { status: 201 });
}
