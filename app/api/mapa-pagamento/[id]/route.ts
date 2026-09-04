import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, resolveProjetistaCodigo, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { cadastroFornecedorOverrideForMapaItem } from "@/lib/mapa-pagamento-cadastro";
import { isDeletedFornecedorIdentityName } from "@/lib/cadastro-fornecedor";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await context.params;
  const current = await prisma.mapaPagamentoItem.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Pagamento não encontrado." }, { status: 404 });

  if (current.projetistaCodigo) {
    const deleted = await prisma.profissional.findFirst({
      where: { codigo: current.projetistaCodigo, deletedAt: { not: null } }, select: { id: true },
    });
    if (deleted || await isDeletedFornecedorIdentityName(current.projetistaCodigo)) {
      return NextResponse.json({ error: "Fornecedor excluído definitivamente: pagamento disponível somente para consulta histórica." }, { status: 400 });
    }
  }

  const payload = await request.json();

  // Só revalida a identidade quando o campo realmente MUDOU nesta edição — item já existente com
  // um projetistaCodigo legado (ex.: dado antigo de importação) continua salvável normalmente
  // (ex.: o "Reenviar BM" após revisão salva o mesmo item de novo só para atualizar updatedAt).
  if (typeof payload.projetistaCodigo === "string" && payload.projetistaCodigo.trim() !== (current.projetistaCodigo ?? "")) {
    const projetista = await resolveProjetistaCodigo(payload.projetistaCodigo);
    if (projetista.error) {
      return NextResponse.json({ error: projetista.error }, { status: 400 });
    }
    payload.projetistaCodigo = projetista.codigo;
  }

  // CAUSA RAIZ do mesmo bug crítico do POST (ver comentário lá): o frontend sempre manda no body
  // o ciclo que o Dashboard está VISUALIZANDO no momento (inclusive o literal "GERAL", que é só o
  // filtro agregador "ver todos os ciclos", nunca um ciclo real) — nunca uma escolha deliberada
  // do usuário sobre ESTE item (não existe seletor de ciclo no modal). Editar qualquer pagamento
  // com o Dashboard em "Geral" sobrescrevia silenciosamente `ciclo` do item para "GERAL",
  // corrompendo um registro válido e fazendo-o desaparecer da listagem para sempre. O ciclo de um
  // item já existente nunca é alterado por uma edição — sempre preserva `current.ciclo`.
  const updated = await prisma.mapaPagamentoItem.update({
    where: { id },
    data: {
      ...mapaPagamentoData({ ...payload, ciclo: current.ciclo }, current.sourceRowHash),
      updatedAt: new Date(),
    },
  });
  const cadastros = await prisma.cadastroFornecedor.findMany({
    select: {
      id: true,
      colaboradorCodigo: true,
      responsavel: true,
      razaoSocial: true,
      cnpjNormalizado: true,
      tipoCt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(serializeMapaPagamentoItem(updated, cadastroFornecedorOverrideForMapaItem(updated, cadastros)));
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await context.params;
  await prisma.mapaPagamentoItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
