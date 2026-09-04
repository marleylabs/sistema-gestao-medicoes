import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { mapaPagamentoData, resolveProjetistaCodigo, serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { cadastroFornecedorOverrideForMapaItem } from "@/lib/mapa-pagamento-cadastro";
import { getParticipacaoPorFornecedorCiclo, normalizeAlias, type ContratoResumo } from "@/lib/participacao-contratos";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";
  const isGeral = ciclo === "GERAL";
  const ciclosCadastrados = await prisma.mapaPagamentoContexto.findMany({
    select: { ciclo: true },
  });
  const ciclosPermitidos = ciclosCadastrados.map((item) => item.ciclo);

  if (isGeral && ciclosPermitidos.length === 0) {
    return NextResponse.json({ contratos: [], itens: [] });
  }

  if (!isGeral && !ciclosPermitidos.includes(ciclo)) {
    return NextResponse.json({ contratos: [], itens: [] });
  }

  const itens = await prisma.mapaPagamentoItem.findMany({
    where: {
      ...(isGeral ? { ciclo: { in: ciclosPermitidos } } : { ciclo }),
    },
    orderBy: [{ ciclo: "desc" }, { ordem: "asc" }],
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

  // Participação por contrato: nunca mistura ciclos — uma agregação por ciclo distinto presente na listagem.
  const ciclosDistintos = Array.from(new Set(itens.map((item) => item.ciclo)));
  const participacaoPorCiclo = new Map<string, Awaited<ReturnType<typeof getParticipacaoPorFornecedorCiclo>>>();
  for (const cicloItem of ciclosDistintos) {
    participacaoPorCiclo.set(cicloItem, await getParticipacaoPorFornecedorCiclo(cicloItem));
  }
  const contratosPorId = new Map<string, ContratoResumo>();
  for (const participacao of participacaoPorCiclo.values()) {
    for (const c of participacao.contratos) contratosPorId.set(c.id, c);
  }
  const contratos = isGeral
    ? Array.from(contratosPorId.values())
    : (participacaoPorCiclo.get(ciclo)?.contratos ?? []);

  const itensSerializados = itens.map((item) => {
    const serializado = serializeMapaPagamentoItem(item, cadastroFornecedorOverrideForMapaItem(item, cadastros));
    const participacao = item.projetistaCodigo
      ? participacaoPorCiclo.get(item.ciclo)?.porAlias[normalizeAlias(item.projetistaCodigo)]
      : undefined;
    return {
      ...serializado,
      participacaoContratos: participacao?.participacoes ?? {},
      documentosPendentesContrato: participacao?.documentosPendentes ?? 0,
      valorTotalDocumentosContrato: participacao?.valorTotal ?? 0,
      valorNaoClassificadoContrato: participacao?.valorNaoClassificado ?? 0,
      percentualNaoClassificadoContrato: participacao?.percentualNaoClassificado ?? 0,
    };
  });

  return NextResponse.json({ contratos, itens: itensSerializados });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json();
  const ciclo = typeof payload.ciclo === "string" ? payload.ciclo.trim() : "2605";

  // CAUSA RAIZ de um bug crítico: "GERAL" é só o filtro agregador do Dashboard ("ver todos os
  // ciclos"), nunca um ciclo real — mas nada aqui impedia persistir esse literal. O GET da
  // listagem, ao agregar "GERAL", só busca `ciclo IN (ciclos realmente cadastrados)`
  // (ver GET acima) — um item criado com `ciclo: "GERAL"` nunca aparece em lugar nenhum depois,
  // mesmo tendo sido criado com sucesso (201) e existindo de verdade no banco. Rejeitar aqui é a
  // única correção correta — nunca aceitar como sucesso um cadastro que a própria listagem jamais
  // conseguiria exibir.
  if (ciclo === "GERAL") {
    return NextResponse.json(
      { error: "Selecione um ciclo específico (não \"Geral\") antes de cadastrar um pagamento manual." },
      { status: 400 },
    );
  }

  const projetista = await resolveProjetistaCodigo(payload.projetistaCodigo);
  if (projetista.error) {
    return NextResponse.json({ error: projetista.error }, { status: 400 });
  }

  const maxOrdem = await prisma.mapaPagamentoItem.aggregate({
    where: { ciclo },
    _max: { ordem: true },
  });
  const nextOrdem = (maxOrdem._max.ordem ?? 0) + 1;

  const created = await prisma.mapaPagamentoItem.create({
    data: mapaPagamentoData({ ...payload, projetistaCodigo: projetista.codigo, ciclo, ordem: nextOrdem }),
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

  return NextResponse.json(serializeMapaPagamentoItem(created, cadastroFornecedorOverrideForMapaItem(created, cadastros)), { status: 201 });
}
