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
      aliases: { where: { ativo: true }, select: { alias: true }, orderBy: { alias: "asc" } },
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
          ativo: true,
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
    if (!c.ativo || !c.colaboradorCodigo || condicaoPorCodigo.has(c.colaboradorCodigo)) continue;
    condicaoPorCodigo.set(c.colaboradorCodigo, {
      valorCondicaoFixa: toNumberOrNull(c.valorCondicaoFixa),
      tipoContrato: c.tipoContrato,
      tipoCondicaoFixa: c.tipoCondicaoFixa,
      valorCondicaoFixaComProducao: toNumberOrNull(c.valorCondicaoFixaComProducao),
      valorCondicaoFixaSemProducao: toNumberOrNull(c.valorCondicaoFixaSemProducao),
    });
  }

  const codigosComCadastro = new Set(cadastros.map((c) => c.colaboradorCodigo).filter((c): c is string => !!c));
  const codigosComCadastroAtivo = new Set(cadastros.filter((c) => c.ativo).map((c) => c.colaboradorCodigo).filter((c): c is string => !!c));
  // Fornecedor explicitamente inativo sai de novas operações. Profissional legado sem nenhum
  // CadastroFornecedor continua visível para não quebrar identidades operacionais antigas.
  const profissionaisOperacionais = profissionais.filter((p) => !p.codigo || !codigosComCadastro.has(p.codigo) || codigosComCadastroAtivo.has(p.codigo));

  return NextResponse.json(
    profissionaisOperacionais.map(({ aliases, ...p }) => ({
      ...serializeProfessional(p),
      // Aliases operacionais formais: só BUSCA/apresentação — a seleção grava sempre o código canônico.
      aliases: aliases.map((a) => a.alias),
      ...(p.codigo ? condicaoPorCodigo.get(p.codigo) ?? condicaoVazia : condicaoVazia),
      // Só apresentação no seletor: identidade com CadastroFornecedor ativo (join por código,
      // nunca por nome/CNPJ). `false` = Profissional legado sem cadastro administrativo.
      cadastroAdministrativo: !!p.codigo && codigosComCadastroAtivo.has(p.codigo),
    })),
  );
}
