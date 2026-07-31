import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";

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

  const [totals, colaboradoresAtivos, porCiclo, porProjeto, contexto, mapaFinanceiro, tiposPrecos] = await Promise.all([
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
    prisma.$queryRaw<
      Array<{
        total_pagamentos: unknown;
        total_horas: unknown;
        intr_sossego: unknown;
        salobo: unknown;
        acg: unknown;
        escadas_alumar: unknown;
        nao_alocado: unknown;
      }>
    >`
      with pagamentos as (
        select
          mpi.valor,
          mpi.horas,
          mpi.intr_sossego,
          mpi.salobo,
          mpi.acg,
          mpi.escadas_alumar,
          mpi.ato,
          (
            mpi.intr_sossego
            + mpi.salobo
            + mpi.acg
            + mpi.escadas_alumar
          ) as total_participacao
        from mapa_pagamento_itens mpi
        where mpi.valor > 0
        ${mapaCicloFilter}
        ${mapaCodigoFilter}
      )
      select
        coalesce(sum(valor), 0) as total_pagamentos,
        coalesce(sum(
          valor * intr_sossego
        ), 0) as intr_sossego,
        coalesce(sum(
          valor * salobo
        ), 0) as salobo,
        coalesce(sum(
          valor * acg
        ), 0) as acg,
        coalesce(sum(
          valor * escadas_alumar
        ), 0) as escadas_alumar,
        coalesce(sum(horas), 0) as total_horas,
        coalesce(sum(valor) filter (
          where total_participacao = 0
            and lower(coalesce(ato, '')) not in (
              lower('Intr. Sossego'),
              lower('Salobo'),
              lower('ACG'),
              lower('Escadas Alumar')
            )
        ), 0) as nao_alocado
      from pagamentos
    `,
    prisma.$queryRaw<Array<{ nome: string; codigo: string; tipo2: string; condicao: string }>>`
      select distinct
        coalesce(pr.nome_completo, pr.nome) as nome,
        pr.codigo,
        m.tipo2,
        m.condicao
      from medicoes m
      join profissionais pr on pr.id = m.id_profissional
      where m.tipo2 is not null and m.tipo2 != ''
        and m.condicao is not null and m.condicao != ''
        ${medicaoCicloFilter}
        ${codigoFilter}
      order by nome, m.tipo2
    `,
  ]);

  const mapa = mapaFinanceiro[0];

  // Ler contratos ativos do banco
  let contratosAtivos = await prisma.$queryRaw<Array<{ nome: string; coluna_mapa: string | null }>>`
    SELECT nome, coluna_mapa FROM contratos WHERE ativo = true ORDER BY nome ASC
  `;
  if (contratosAtivos.length === 0) {
    contratosAtivos = [
      { nome: "Intr. Sossego", coluna_mapa: "intr_sossego" },
      { nome: "Salobo", coluna_mapa: "salobo" },
      { nome: "ACG", coluna_mapa: "acg" },
      { nome: "Escadas Alumar", coluna_mapa: "escadas_alumar" },
    ];
  }

  // Para contratos sem coluna_mapa, somar por ato direto
  const colunasConhecidas = new Set(["intr_sossego", "salobo", "acg", "escadas_alumar"]);
  const contratosSemColuna = contratosAtivos.filter((c) => !c.coluna_mapa || !colunasConhecidas.has(c.coluna_mapa));

  const valorPorAto: Record<string, number> = {};
  if (contratosSemColuna.length > 0) {
    const nomes = contratosSemColuna.map((c) => c.nome);
    const rows = await prisma.$queryRaw<Array<{ ato: string; total: unknown }>>`
      SELECT ato, COALESCE(SUM(valor), 0) as total
      FROM mapa_pagamento_itens
      WHERE valor > 0
        AND ato = ANY(${nomes}::text[])
        ${isGeral ? Prisma.sql`AND ciclo = ANY(${ciclosPermitidos}::text[])` : Prisma.sql`AND ciclo = ${ciclo}`}
      GROUP BY ato
    `;
    for (const r of rows) valorPorAto[r.ato] = toNumber(r.total as any);
  }

  const colunaParaValor: Record<string, number> = {
    intr_sossego:   toNumber(mapa?.intr_sossego as any),
    salobo:         toNumber(mapa?.salobo as any),
    acg:            toNumber(mapa?.acg as any),
    escadas_alumar: toNumber(mapa?.escadas_alumar as any),
  };

  const distribuicaoCompleta = contratosAtivos.map((c) => ({
    contrato: c.nome,
    valor: c.coluna_mapa && colunasConhecidas.has(c.coluna_mapa)
      ? colunaParaValor[c.coluna_mapa] ?? 0
      : valorPorAto[c.nome] ?? 0,
  }));
  const distribuicao = contrato
    ? distribuicaoCompleta.filter((item) => item.contrato === contrato)
    : distribuicaoCompleta;
  const totalMedido = contrato
    ? distribuicao.reduce((total, item) => total + item.valor, 0)
    : distribuicao.reduce((total, item) => total + item.valor, 0);
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
    tiposPrecos: tiposPrecos.map((r) => ({
      nome: r.nome,
      codigo: r.codigo,
      tipo2: r.tipo2,
      condicao: r.condicao,
    })),
  });
}
