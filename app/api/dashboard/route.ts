import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";
import { cadastroFornecedorOverrideForMapaItem } from "@/lib/mapa-pagamento-cadastro";
import { getDistribuicaoContratosCiclos } from "@/lib/participacao-contratos";

const emptyDashboard = {
  cards: {
    totalMedido: 0,
    totalHoras: 0,
    atosAtivos: 0,
    producaoAtivos: 0,
    totalRegistros: 0,
  },
  contextoMapa: null,
  porCiclo: [],
  porProjeto: [],
  tiposPrecos: [],
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const codigo = request.nextUrl.searchParams.get("codigo")?.trim();
  const contrato = request.nextUrl.searchParams.get("contrato")?.trim();
  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";
  const isGeral = ciclo === "GERAL";
  const ciclosCadastrados = await prisma.mapaPagamentoContexto.findMany({
    select: { ciclo: true },
  });
  const ciclosPermitidos = ciclosCadastrados.map((item) => item.ciclo);
  const cicloExiste = isGeral || ciclosPermitidos.includes(ciclo);

  if ((isGeral && ciclosPermitidos.length === 0) || !cicloExiste) {
    return NextResponse.json(emptyDashboard);
  }

  const mapaCicloFilter = isGeral
    ? Prisma.sql`and mpi.ciclo = ANY(${ciclosPermitidos}::text[])`
    : Prisma.sql`and mpi.ciclo = ${ciclo}`;
  const medicaoCicloFilter = isGeral
    ? Prisma.sql`and m.ciclo = ANY(${ciclosPermitidos}::text[])`
    : Prisma.sql`and m.ciclo = ${ciclo}`;
  const codigoFilter = codigo ? Prisma.sql`and pr.codigo = ${codigo}` : Prisma.empty;
  const contratoFilter = contrato
    ? Prisma.sql`and lower(coalesce(m.raw_payload->>'CONTRATO', '')) = lower(${contrato})`
    : Prisma.empty;
  const mapaCodigoFilter = codigo ? Prisma.sql`and mpi.projetista_codigo = ${codigo}` : Prisma.empty;
  const mapaContratoFilter =
    contrato === "Intr. Sossego"
      ? Prisma.sql`
          and (
            lower(coalesce(mpi.ato, '')) = lower('Intr. Sossego')
            or (
              lower(coalesce(mpi.ato, '')) in ('produção', 'producao')
              and mpi.intr_sossego > 0
            )
          )
        `
      : contrato === "Salobo"
        ? Prisma.sql`
            and (
              lower(coalesce(mpi.ato, '')) = lower('Salobo')
              or (
                lower(coalesce(mpi.ato, '')) in ('produção', 'producao')
                and mpi.salobo > 0
              )
            )
          `
        : contrato === "ACG"
          ? Prisma.sql`
              and (
                lower(coalesce(mpi.ato, '')) = lower('ACG')
                or (
                  lower(coalesce(mpi.ato, '')) in ('produção', 'producao')
                  and mpi.acg > 0
                )
              )
            `
          : contrato === "Escadas Alumar"
            ? Prisma.sql`
                and (
                  lower(coalesce(mpi.ato, '')) = lower('Escadas Alumar')
                  or (
                    lower(coalesce(mpi.ato, '')) in ('produção', 'producao')
                    and mpi.escadas_alumar > 0
                  )
                )
              `
            : contrato === "Não alocado"
              ? Prisma.sql`
                  and (
                    mpi.intr_sossego
                    + mpi.salobo
                    + mpi.acg
                    + mpi.escadas_alumar
                  ) = 0
                  and lower(coalesce(mpi.ato, '')) not in (
                    lower('Intr. Sossego'),
                    lower('Salobo'),
                    lower('ACG'),
                    lower('Escadas Alumar')
                  )
                `
            : Prisma.empty;

  const [
    totals,
    colaboradoresAtivos,
    porCiclo,
    porProjeto,
    contexto,
    tiposPrecos,
    condicoesFixasPrecos,
    cadastros,
    distribuicaoResultado,
  ] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        total_medido: unknown;
        total_horas: unknown;
        total_registros: bigint;
      }>
    >`
      with base as (
        select
          pr.codigo,
          case
            when extract(day from m.data_cadastro) >= 21
              then to_char((date_trunc('month', m.data_cadastro) + interval '1 month')::date, 'YYMM')
            else to_char(date_trunc('month', m.data_cadastro)::date, 'YYMM')
          end as ciclo,
          m.valor_medicao,
          m.equivalente_a1_horas
        from medicoes m
        left join profissionais pr on pr.id = m.id_profissional
        where 1 = 1
        ${medicaoCicloFilter}
        ${codigoFilter}
        ${contratoFilter}
      )
      select
        coalesce(sum(base.valor_medicao), 0) as total_medido,
        coalesce(sum(base.equivalente_a1_horas), 0) as total_horas,
        count(*) as total_registros
      from base
    `,
    prisma.$queryRaw<Array<{ atos_ativos: bigint; producao_ativos: bigint }>>`
      select
        count(distinct mpi.projetista_codigo) filter (
          where mpi.valor > 0
            and lower(coalesce(mpi.ato, '')) not in ('produção', 'producao')
        ) as atos_ativos,
        count(distinct mpi.projetista_codigo) filter (
          where mpi.valor > 0
            and lower(coalesce(mpi.ato, '')) in ('produção', 'producao')
        ) as producao_ativos
      from mapa_pagamento_itens mpi
      where 1 = 1
      ${mapaCicloFilter}
      ${mapaCodigoFilter}
      ${mapaContratoFilter}
    `,
    prisma.$queryRaw<
      Array<{
        ciclo: string;
        periodo_inicio: Date;
        periodo_fim: Date;
        total_medido: unknown;
        total_horas: unknown;
        total_registros: bigint;
      }>
    >`
      select
        m.ciclo,
        (to_date(m.ciclo, 'YYMM') - interval '1 month' + interval '20 days')::date as periodo_inicio,
        (to_date(m.ciclo, 'YYMM') + interval '19 days')::date as periodo_fim,
        coalesce(sum(m.valor_medicao), 0) as total_medido,
        coalesce(sum(m.equivalente_a1_horas), 0) as total_horas,
        count(*) as total_registros
      from medicoes m
      left join profissionais pr on pr.id = m.id_profissional
      where m.ciclo is not null
        and m.ciclo ~ '^[0-9]{4}$'
        ${medicaoCicloFilter}
        ${codigoFilter}
        ${contratoFilter}
      group by m.ciclo
      order by m.ciclo
    `,
    prisma.$queryRaw<
      Array<{
        id_projeto: string;
        total_medido: unknown;
        total_horas: unknown;
        total_registros: bigint;
      }>
    >`
      select
        m.id_projeto,
        sum(m.valor_medicao) as total_medido,
        sum(m.medido_horas) as total_horas,
        count(*) as total_registros
      from medicoes m
      left join profissionais pr on pr.id = m.id_profissional
      where 1 = 1
      ${medicaoCicloFilter}
      ${codigoFilter}
      ${contratoFilter}
      group by m.id_projeto
      order by total_medido desc
      limit 8
    `,
    isGeral ? Promise.resolve(null) : prisma.mapaPagamentoContexto.findUnique({
      where: { ciclo },
    }),
    prisma.$queryRaw<Array<{ nome: string; codigo: string; tipo2: string; condicao: string }>>`
      select distinct
        coalesce(m.profissional_nome_snapshot, pr.nome_completo, pr.nome, pr.codigo, 'Fornecedor sem nome') as nome,
        coalesce(pr.codigo, pr.nome_completo, pr.nome, m.id_profissional::text) as codigo,
        m.tipo2,
        m.condicao
      from medicoes m
      join profissionais pr on pr.id = m.id_profissional
      where m.tipo2 is not null and m.tipo2 != ''
        and upper(trim(m.tipo2)) <> 'DESCONTO'
        and m.condicao is not null and m.condicao != ''
        ${medicaoCicloFilter}
        ${codigoFilter}
      order by nome, m.tipo2
    `,
    prisma.$queryRaw<Array<{ nome: string; codigo: string; tipo2: string; condicao: string }>>`
      with condicoes as (
        select
          mpi.*,
          coalesce(
            nullif(
              case
                when regexp_replace(coalesce(mpi.raw_payload->'condicoesFixas'->>'valorFixo', ''), '[^0-9,.-]', '', 'g') like '%,%'
                  then replace(replace(regexp_replace(coalesce(mpi.raw_payload->'condicoesFixas'->>'valorFixo', ''), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.')
                else regexp_replace(coalesce(mpi.raw_payload->'condicoesFixas'->>'valorFixo', ''), '[^0-9.-]', '', 'g')
              end,
              ''
            )::numeric,
            0
          ) as valor_fixo,
          coalesce(
            nullif(
              case
                when regexp_replace(coalesce(mpi.raw_payload->'condicoesFixas'->>'adicionaisFixos', ''), '[^0-9,.-]', '', 'g') like '%,%'
                  then replace(replace(regexp_replace(coalesce(mpi.raw_payload->'condicoesFixas'->>'adicionaisFixos', ''), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.')
                else regexp_replace(coalesce(mpi.raw_payload->'condicoesFixas'->>'adicionaisFixos', ''), '[^0-9.-]', '', 'g')
              end,
              ''
            )::numeric,
            0
          ) as adicionais_fixos
        from mapa_pagamento_itens mpi
      )
      select
        coalesce(responsavel, projetista_codigo, 'Fornecedor sem nome') as nome,
        coalesce(projetista_codigo, responsavel, id::text) as codigo,
        'FIXO (PJ)' as tipo2,
        (valor_fixo + adicionais_fixos)::text as condicao
      from condicoes mpi
      where (valor_fixo + adicionais_fixos) > 0
        ${isGeral ? Prisma.sql`AND mpi.ciclo = ANY(${ciclosPermitidos}::text[])` : Prisma.sql`AND mpi.ciclo = ${ciclo}`}
        ${codigo ? Prisma.sql`AND mpi.projetista_codigo = ${codigo}` : Prisma.empty}
      order by nome
    `,
    prisma.cadastroFornecedor.findMany({
      select: {
        id: true,
        colaboradorCodigo: true,
        responsavel: true,
        razaoSocial: true,
        cnpjNormalizado: true,
        tipoCt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    getDistribuicaoContratosCiclos(isGeral ? ciclosPermitidos : [ciclo], codigo ? { colaboradorCodigo: codigo } : undefined),
  ]);

  // Distribuição por contrato — mesma fonte dinâmica e mesma fórmula de participação de
  // Pagamentos por Fornecedor (getParticipacaoPorFornecedorCiclo), aplicada sobre o valor de
  // pagamento (mapaPagamentoItem.valor) de cada fornecedor. Nunca hardcoded nos 4 contratos antigos.
  const distribuicaoCompleta = distribuicaoResultado.contratos.map((c) => ({
    contratoId: c.contratoId,
    contrato: c.contrato,
    valor: c.valorMedido,
  }));
  const distribuicao = contrato
    ? distribuicaoCompleta.filter((item) => item.contrato === contrato)
    : distribuicaoCompleta;
  const totalDistribuido = distribuicao.reduce((total, item) => total + item.valor, 0);
  const totalMedido = contrato ? totalDistribuido : distribuicaoResultado.valorTotalConsiderado;
  const rateio = distribuicao.map((item) => ({
    contrato: item.contrato,
    percentual: totalMedido > 0 ? item.valor / totalMedido : 0,
  }));

  const projetoIds = porProjeto.map((item) => item.id_projeto);
  const projetos = await prisma.projeto.findMany({
    where: { id: { in: projetoIds } },
    select: { id: true, codigoProjeto: true, contrato: true },
  });
  const projetoMap = new Map(projetos.map((projeto) => [projeto.id, projeto]));

  return NextResponse.json({
    cards: {
      totalMedido,
      totalHoras: toNumber(totals[0]?.total_horas as any),
      atosAtivos: Number(colaboradoresAtivos[0]?.atos_ativos ?? 0),
      producaoAtivos: Number(colaboradoresAtivos[0]?.producao_ativos ?? 0),
      totalRegistros: Number(totals[0]?.total_registros ?? 0),
    },
    contextoMapa: contexto
      ? {
          mesReferencia: contexto.mesReferencia,
          producaoLabel: contexto.producaoLabel,
          producaoInicio: contexto.producaoInicio?.toISOString().slice(0, 10) ?? null,
          producaoFim: contexto.producaoFim?.toISOString().slice(0, 10) ?? null,
          atoLabel: contexto.atoLabel,
          atoCiclo: contexto.atoCiclo,
          contratos: distribuicao,
          rateio,
          valorNaoClassificado: distribuicaoResultado.valorNaoClassificado,
          percentualNaoClassificado: distribuicaoResultado.percentualNaoClassificado,
        }
      : null,
    porCiclo: porCiclo.map((item) => ({
      ciclo: item.ciclo,
      periodoInicio: item.periodo_inicio?.toISOString().slice(0, 10),
      periodoFim: item.periodo_fim?.toISOString().slice(0, 10),
      totalMedido: toNumber(item.total_medido as any),
      totalHoras: toNumber(item.total_horas as any),
      totalRegistros: Number(item.total_registros),
    })),
    porProjeto: porProjeto.map((item) => ({
      idProjeto: item.id_projeto,
      codigoProjeto: projetoMap.get(item.id_projeto)?.codigoProjeto ?? item.id_projeto,
      contrato: projetoMap.get(item.id_projeto)?.contrato ?? null,
      totalMedido: toNumber(item.total_medido as any),
      totalHoras: toNumber(item.total_horas as any),
      totalRegistros: Number(item.total_registros),
    })),
    tiposPrecos: [...tiposPrecos, ...condicoesFixasPrecos].map((r) => {
      const cadastro = cadastroFornecedorOverrideForMapaItem(
        {
          projetistaCodigo: r.codigo,
          responsavel: r.nome,
          rawPayload: {
            projetistaCodigo: r.codigo,
            responsavel: r.nome,
          },
        },
        cadastros,
      );
      return {
        nome: cadastro?.responsavel ?? r.nome,
        codigo: r.codigo,
        tipo2: r.tipo2,
        condicao: r.condicao,
      };
    }),
  });
}
