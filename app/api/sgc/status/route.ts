import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Listagem de evidências (BMs) para a tela Evidências de Medição — filtros `ciclo` e
 * `colaboradorCodigo` são INDEPENDENTES e opcionais (nunca exige os dois juntos). Retorna sempre
 * uma LISTA (nunca um objeto/Map colapsado por colaboradorCodigo): um mesmo fornecedor pode ter um
 * BM por ciclo (`(colaboradorCodigo, ciclo)` é @@unique em SgcAprovacaoMedicao — nunca mais de uma
 * linha por par), então sem filtro de ciclo o resultado inclui um item POR CICLO em que o
 * fornecedor tem BM. O bug real corrigido aqui: a versão anterior desta rota só aceitava `ciclo`
 * e devolvia um objeto `{ [colaboradorCodigo]: entry }`; o frontend então precisava chamar esta
 * rota uma vez por ciclo e MESCLAR os resultados num Map por colaboradorCodigo, o que sobrescrevia
 * ciclos mais antigos — "fornecedor sem ciclo selecionado" nunca mostrava o histórico completo.
 * Não é query N+1: uma única `findMany`, sem include/join (colaboradorNome já vem denormalizado
 * na própria tabela).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || undefined;
  const colaboradorCodigo = request.nextUrl.searchParams.get("colaboradorCodigo")?.trim() || undefined;

  const registros = await prisma.sgcAprovacaoMedicao.findMany({
    where: {
      ...(ciclo ? { ciclo } : {}),
      ...(colaboradorCodigo ? { colaboradorCodigo } : {}),
    },
    select: {
      id: true,
      colaboradorCodigo: true,
      colaboradorNome: true,
      ciclo: true,
      status: true,
      revisaoNumero: true,
      statusConferencia: true,
      aprovadoAt: true,
    },
    // Mais recente primeiro — mesmo critério de ordenação já usado no restante da aplicação para
    // ciclo (desc). Não colapsa nada: cada (colaboradorCodigo, ciclo) é uma linha independente.
    orderBy: [{ ciclo: "desc" }, { colaboradorNome: "asc" }],
  });

  return NextResponse.json(
    registros.map((r) => ({
      sgcId: r.id,
      colaboradorCodigo: r.colaboradorCodigo,
      colaboradorNome: r.colaboradorNome,
      ciclo: r.ciclo,
      status: r.status,
      revisaoNumero: r.revisaoNumero,
      statusConferencia: r.statusConferencia,
      aprovadoAt: r.aprovadoAt?.toISOString() ?? null,
    })),
  );
}
