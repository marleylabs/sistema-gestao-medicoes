import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { serializeProfessional } from "@/lib/format";

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const profissionais = await prisma.profissional.findMany({
    // Seletor operacional (Novo Pagamento/Editar Pagamento) — identidades excluídas
    // definitivamente pelo ADMIN (Profissional.deletedAt) nunca podem ser oferecidas para um
    // processo NOVO. Estado explícito e real, não uma heurística sobre campos vazios.
    where: { deletedAt: null },
    orderBy: { nome: "asc" },
    select: {
      id: true,
      nome: true,
      codigo: true,
      nomeCompleto: true,
      cpf: true,
      razaoSocial: true,
      cnpj: true,
      email: true,
      statusColaborador: true,
      funcao: true,
    },
  });

  // "Condição Fixa" (Novo Pagamento) precisa vir do cadastro administrativo real
  // (CadastroFornecedor.valorCondicaoFixa/tipoContrato, coluna "CONDICAO FIXA" da Consulta PJ),
  // nunca de uma tabela hardcoded por nome — bug real encontrado: o valor de um fornecedor
  // recriado por resolução manual de identidade (colaboradorCodigo mudou de texto) parava de bater
  // numa lista fixa de nomes no frontend, mesmo com o valor correto já salvo no banco. Uma única
  // query agregada (nunca 1 por fornecedor) — join por `colaboradorCodigo` (== `Profissional.codigo`),
  // NUNCA por CNPJ (não é identidade única — CNPJ pode ser compartilhado por mais de um fornecedor).
  const codigos = [...new Set(profissionais.filter((p) => p.codigo).map((p) => p.codigo!))];
  const cadastros = codigos.length > 0
    ? await prisma.cadastroFornecedor.findMany({
        where: { colaboradorCodigo: { in: codigos } },
        select: {
          colaboradorCodigo: true,
          valorCondicaoFixa: true,
          tipoContrato: true,
          tipoCondicaoFixa: true,
          valorCondicaoFixaComProducao: true,
          valorCondicaoFixaSemProducao: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      })
    : [];
  // Mais de um CadastroFornecedor pode compartilhar o mesmo colaboradorCodigo (ex.: duplicata
  // ainda não consolidada) — fica com o mais recente (orderBy já veio desc, primeiro encontrado
  // por código vence).
  type Condicao = {
    valorCondicaoFixa: number | null;
    tipoContrato: string | null;
    tipoCondicaoFixa: string | null;
    valorCondicaoFixaComProducao: number | null;
    valorCondicaoFixaSemProducao: number | null;
  };
  const condicaoVazia: Condicao = {
    valorCondicaoFixa: null,
    tipoContrato: null,
    tipoCondicaoFixa: null,
    valorCondicaoFixaComProducao: null,
    valorCondicaoFixaSemProducao: null,
  };
  const condicaoPorCodigo = new Map<string, Condicao>();
  for (const c of cadastros) {
    if (!c.colaboradorCodigo || condicaoPorCodigo.has(c.colaboradorCodigo)) continue;
    condicaoPorCodigo.set(c.colaboradorCodigo, {
      valorCondicaoFixa: toNumberOrNull(c.valorCondicaoFixa),
      tipoContrato: c.tipoContrato,
      tipoCondicaoFixa: c.tipoCondicaoFixa,
      valorCondicaoFixaComProducao: toNumberOrNull(c.valorCondicaoFixaComProducao),
      valorCondicaoFixaSemProducao: toNumberOrNull(c.valorCondicaoFixaSemProducao),
    });
  }

  return NextResponse.json(
    profissionais.map((p) => ({
      ...serializeProfessional(p),
      ...(p.codigo ? condicaoPorCodigo.get(p.codigo) ?? condicaoVazia : condicaoVazia),
    })),
  );
}
