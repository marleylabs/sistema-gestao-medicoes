import { NextRequest, NextResponse } from "next/server";
import { requireHistorico } from "@/lib/admin";
import { serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { cadastroFornecedorOverrideForMapaItem } from "@/lib/mapa-pagamento-cadastro";
import { getParticipacaoPorFornecedorCiclo, normalizeAlias, type ContratoResumo } from "@/lib/participacao-contratos";
import { prisma } from "@/lib/prisma";

/**
 * Histórico de Medições — composição SOMENTE LEITURA (só GET; nenhuma escrita, nem o auto-registro
 * de contratos que o GET de /api/mapa-pagamento faz). Um registro = BM de um fornecedor num ciclo
 * (um MapaPagamentoItem), já com o `ciclo`, o status SGC do par (colaboradorCodigo, ciclo) e a
 * participação por contrato — os mesmos helpers de /api/mapa-pagamento e /api/sgc/status, numa
 * única chamada em vez de uma por ciclo. Composição do BM, NF e pagamento continuam carregados no
 * detalhe (/api/admin/bm, /api/admin/financeiro).
 *
 * Filtro opcional `ciclo` (YYMM). A resposta já traz `total` para acomodar page/limit no futuro.
 */
export async function GET(request: NextRequest) {
  const acesso = await requireHistorico();
  if (acesso.response) return acesso.response;

  const cicloParam = request.nextUrl.searchParams.get("ciclo")?.trim() || "";
  if (cicloParam && !/^\d{4}$/.test(cicloParam)) {
    return NextResponse.json({ error: "Ciclo inválido. Use formato YYMM (ex: 2606)." }, { status: 400 });
  }

  const ciclosCadastrados = (await prisma.mapaPagamentoContexto.findMany({ select: { ciclo: true } })).map((c) => c.ciclo);
  const ciclosAlvo = cicloParam ? ciclosCadastrados.filter((c) => c === cicloParam) : ciclosCadastrados;
  if (ciclosAlvo.length === 0) return NextResponse.json({ contratos: [], registros: [], total: 0 });

  const [itens, cadastros, aprovacoes] = await Promise.all([
    prisma.mapaPagamentoItem.findMany({
      where: { ciclo: { in: ciclosAlvo } },
      orderBy: [{ ciclo: "desc" }, { ordem: "asc" }],
    }),
    prisma.cadastroFornecedor.findMany({
      select: { id: true, colaboradorCodigo: true, responsavel: true, razaoSocial: true, cnpjNormalizado: true, tipoCt: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.sgcAprovacaoMedicao.findMany({
      where: { ciclo: { in: ciclosAlvo } },
      select: { id: true, colaboradorCodigo: true, ciclo: true, status: true, revisaoNumero: true, statusConferencia: true, aprovadoAt: true },
    }),
  ]);

  // Participação por contrato: uma agregação por ciclo, nunca misturando ciclos (mesma regra do mapa).
  const participacaoPorCiclo = new Map<string, Awaited<ReturnType<typeof getParticipacaoPorFornecedorCiclo>>>();
  for (const ciclo of Array.from(new Set(itens.map((item) => item.ciclo)))) {
    participacaoPorCiclo.set(ciclo, await getParticipacaoPorFornecedorCiclo(ciclo, { somenteLeitura: true }));
  }
  const contratosPorId = new Map<string, ContratoResumo>();
  for (const participacao of participacaoPorCiclo.values()) for (const c of participacao.contratos) contratosPorId.set(c.id, c);

  const sgcPorChave = new Map(aprovacoes.map((a) => [`${a.ciclo}|${a.colaboradorCodigo}`, a]));

  const registros = itens.map((item) => {
    const serializado = serializeMapaPagamentoItem(item, cadastroFornecedorOverrideForMapaItem(item, cadastros));
    const codigo = serializado.projetistaCodigo ?? serializado.responsavel ?? serializado.id;
    const participacao = item.projetistaCodigo
      ? participacaoPorCiclo.get(item.ciclo)?.porAlias[normalizeAlias(item.projetistaCodigo)]
      : undefined;
    const sgc = sgcPorChave.get(`${item.ciclo}|${codigo}`);
    return {
      id: serializado.id,
      ciclo: item.ciclo,
      codigo,
      nome: serializado.responsavel ?? codigo,
      empresa: serializado.fornecedor?.razaoSocial ?? serializado.razaoSocial ?? null,
      cnpj: serializado.fornecedor?.cpfCnpj ?? serializado.cpfCnpj ?? null,
      valor: serializado.valor,
      participacoes: participacao?.participacoes ?? {},
      sgc: sgc
        ? {
            sgcId: sgc.id,
            colaboradorCodigo: sgc.colaboradorCodigo,
            ciclo: sgc.ciclo,
            status: sgc.status,
            revisaoNumero: sgc.revisaoNumero,
            statusConferencia: sgc.statusConferencia,
            aprovadoAt: sgc.aprovadoAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({
    contratos: Array.from(contratosPorId.values()).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    registros,
    total: registros.length,
  });
}
