import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const nome        = body?.nome        != null ? String(body.nome).trim()   : undefined;
  const codigo      = body?.codigo      != null ? body.codigo      || null    : undefined;
  const descricao   = body?.descricao   != null ? body.descricao   || null    : undefined;
  const gestor      = body?.gestor      != null ? body.gestor      || null    : undefined;
  const fiscal      = body?.fiscal      != null ? body.fiscal      || null    : undefined;
  const data_inicio = body?.data_inicio != null ? body.data_inicio || null    : undefined;
  const data_fim    = body?.data_fim    != null ? body.data_fim    || null    : undefined;
  const valor_total = body?.valor_total != null ? (body.valor_total ? Number(body.valor_total) : null) : undefined;
  const ativo       = body?.ativo       != null ? Boolean(body.ativo)         : undefined;

  if (nome !== undefined && !nome) return NextResponse.json({ error: "Nome não pode ser vazio." }, { status: 400 });

  try {
    const rows = await prisma.$queryRaw<object[]>`
      UPDATE contratos SET
        nome        = CASE WHEN ${nome        !== undefined} THEN ${nome        ?? null}::text    ELSE nome        END,
        codigo      = CASE WHEN ${codigo      !== undefined} THEN ${codigo      ?? null}::text    ELSE codigo      END,
        descricao   = CASE WHEN ${descricao   !== undefined} THEN ${descricao   ?? null}::text    ELSE descricao   END,
        gestor      = CASE WHEN ${gestor      !== undefined} THEN ${gestor      ?? null}::text    ELSE gestor      END,
        fiscal      = CASE WHEN ${fiscal      !== undefined} THEN ${fiscal      ?? null}::text    ELSE fiscal      END,
        data_inicio = CASE WHEN ${data_inicio !== undefined} THEN ${data_inicio ?? null}::date    ELSE data_inicio END,
        data_fim    = CASE WHEN ${data_fim    !== undefined} THEN ${data_fim    ?? null}::date    ELSE data_fim    END,
        valor_total = CASE WHEN ${valor_total !== undefined} THEN ${valor_total ?? null}::numeric ELSE valor_total END,
        ativo       = CASE WHEN ${ativo       !== undefined} THEN ${ativo       ?? null}::boolean ELSE ativo       END,
        updated_at  = now()
      WHERE id = ${id}::uuid
      RETURNING id, nome, codigo, descricao, gestor, fiscal,
                data_inicio, data_fim, valor_total, ativo, created_at, updated_at
    `;
    if (!rows.length) return NextResponse.json({ error: "Contrato não encontrado." }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch {
    return NextResponse.json({ error: "Já existe um contrato com esse nome." }, { status: 409 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const { id } = await params;
  await prisma.$executeRaw`DELETE FROM contratos WHERE id = ${id}::uuid`;
  return NextResponse.json({ ok: true });
}
