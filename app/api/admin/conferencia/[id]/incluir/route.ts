import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { logBmAction } from "@/lib/bm-log";
import { liberarConferenciaSeCompleta } from "@/lib/conferencia-resolucao";

const PRECO_POR_TIPO: Record<string, "valorHora" | "valorDocumento" | "valorA1Equivalente"> = {
  HH: "valorHora",
  DOC: "valorDocumento",
  DG: "valorA1Equivalente",
};

async function localizarPreco(colaboradorCodigo: string, tipo: string | null) {
  const campo = tipo ? PRECO_POR_TIPO[tipo.trim().toUpperCase()] : undefined;
  if (!campo) return null;
  const cadastro = await prisma.cadastroFornecedor.findFirst({
    where: { OR: [{ colaboradorCodigo }, { responsavel: colaboradorCodigo }] },
    select: { valorHora: true, valorDocumento: true, valorA1Equivalente: true },
    orderBy: { updatedAt: "desc" },
  });
  const valor = cadastro?.[campo];
  return valor ? Number(valor) : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const observacao = typeof body?.observacao === "string" ? body.observacao.trim() : "";

  const divergencia = await prisma.divergenciaMedicao.findUnique({ where: { id } });
  if (!divergencia) return NextResponse.json({ error: "Divergência não encontrada." }, { status: 404 });
  if (divergencia.status !== "PENDENTE") {
    return NextResponse.json({ error: "Esta divergência já foi resolvida." }, { status: 409 });
  }

  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      if (divergencia.idMedicaoExistente) {
        // Documento já existe: atualiza somente os campos que vieram divergentes, nunca cria linha duplicada.
        const data: Record<string, unknown> = {};
        if (divergencia.formatoDivergente) data.formato = divergencia.fornecedorFormato;
        if (divergencia.a1eqDivergente) data.equivalenteA1Horas = divergencia.fornecedorA1eqHh;
        if (divergencia.emissaoDivergente) data.percentualEmissao = divergencia.fornecedorPercentualEmissao;
        if (divergencia.tipoDivergente) data.tipo2 = divergencia.fornecedorTipo;
        if (Object.keys(data).length > 0) {
          await tx.medicao.update({ where: { id: divergencia.idMedicaoExistente }, data: { ...data, updatedAt: now } });
        }
      } else {
        // Documento não mapeado: cria seguindo exatamente a mesma regra de POST /api/mapa-pagamento/documentos.
        const profissional = await tx.profissional.findFirst({
          where: {
            deletedAt: null,
            OR: [
              { codigo: { equals: divergencia.colaboradorCodigo, mode: "insensitive" } },
              { nome: { equals: divergencia.colaboradorCodigo, mode: "insensitive" } },
              { nomeCompleto: { equals: divergencia.colaboradorCodigo, mode: "insensitive" } },
            ],
          },
        });
        if (!profissional) throw new Error("FORNECEDOR_NAO_ENCONTRADO");

        const codigoProjeto = `MANUAL-${divergencia.ciclo}-${Date.now()}`;
        const projeto = await tx.projeto.upsert({
          where: { codigoProjeto },
          create: { codigoProjeto },
          update: {},
        });

        const preco = await localizarPreco(divergencia.colaboradorCodigo, divergencia.fornecedorTipo);
        const hash = crypto.randomUUID();
        await tx.medicao.create({
          data: {
            numeroMedicao: `BM-${hash.slice(0, 8)}`,
            idProjeto: projeto.id,
            idProfissional: profissional.id,
            ciclo: divergencia.ciclo,
            numeroDocumento: divergencia.nrVale,
            formato: divergencia.fornecedorFormato,
            equivalenteA1Horas: divergencia.fornecedorA1eqHh,
            percentualEmissao: divergencia.fornecedorPercentualEmissao,
            tipo2: divergencia.fornecedorTipo,
            condicao: String(preco ?? "0"),
            sourceRowHash: hash,
            rawPayload: { source: "conferencia_fornecedor", divergenciaId: divergencia.id },
          },
        });
      }

      await tx.divergenciaMedicao.update({
        where: { id },
        data: {
          status: "INCLUIDA",
          observacao: observacao || divergencia.observacao,
          resolvidoPorUsuarioId: admin.user?.id ?? null,
          resolvidoPorNome: admin.user?.nome ?? null,
          resolvidoEm: now,
          updatedAt: now,
        },
      });

      await liberarConferenciaSeCompleta(tx, divergencia.sgcId);
    });
  } catch (err) {
    if (err instanceof Error && err.message === "FORNECEDOR_NAO_ENCONTRADO") {
      return NextResponse.json({ error: "Fornecedor não encontrado para incluir este documento." }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível incluir o documento. Tente novamente." }, { status: 500 });
  }

  await logBmAction({
    sgcId: divergencia.sgcId,
    colaboradorCodigo: divergencia.colaboradorCodigo,
    ciclo: divergencia.ciclo,
    usuarioId: admin.user?.id,
    usuarioNome: admin.user?.nome,
    acao: "DIVERGENCIA_INCLUIR",
    telaOrigem: "Editar pagamento",
    observacao: `NR VALE ${divergencia.nrVale}${observacao ? ` — ${observacao}` : ""}`,
  });

  return NextResponse.json({ ok: true });
}
