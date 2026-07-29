import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (body?.confirmacao !== "LIMPAR") {
    return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
  }

  const before = await prisma.$queryRaw<
    Array<{
      medicoes: bigint;
      profissionais: bigint;
      projetos: bigint;
      mapa_pagamento_itens: bigint;
      mapa_pagamento_contexto: bigint;
      sgc_aprovacoes_medicao: bigint;
      contratos: bigint;
      usuarios_colaboradores: bigint;
    }>
  >`
    select
      (select count(*) from medicoes) as medicoes,
      (select count(*) from profissionais) as profissionais,
      (select count(*) from projetos) as projetos,
      (select count(*) from mapa_pagamento_itens) as mapa_pagamento_itens,
      (select count(*) from mapa_pagamento_contexto) as mapa_pagamento_contexto,
      (select count(*) from sgc_aprovacoes_medicao) as sgc_aprovacoes_medicao,
      (select count(*) from contratos) as contratos,
      (select count(*) from usuarios where perfil = 'COLABORADOR') as usuarios_colaboradores
  `;

  await prisma.$transaction([
    prisma.$executeRaw`
      truncate table
        sgc_logs,
        sgc_aprovacoes_medicao,
        medicoes,
        mapa_pagamento_itens,
        mapa_pagamento_contexto,
        bm_aux_medicoes,
        projetos,
        profissionais,
        contratos,
        etl_execucoes
      restart identity cascade
    `,
    prisma.$executeRaw`delete from usuarios where perfil = 'COLABORADOR'`,
    prisma.$executeRaw`
      update usuarios
      set tentativas_falhas = 0,
          bloqueado_ate = null,
          updated_at = now()
      where perfil in ('ADMIN', 'MEDICAO', 'FINANCEIRO', 'DEPARTAMENTO_PESSOAL')
    `,
  ]);

  const removed = before[0];
  return NextResponse.json({
    ok: true,
    removed: {
      medicoes: Number(removed?.medicoes ?? 0),
      profissionais: Number(removed?.profissionais ?? 0),
      projetos: Number(removed?.projetos ?? 0),
      mapaPagamentoItens: Number(removed?.mapa_pagamento_itens ?? 0),
      mapaPagamentoContexto: Number(removed?.mapa_pagamento_contexto ?? 0),
      sgcAprovacoes: Number(removed?.sgc_aprovacoes_medicao ?? 0),
      contratos: Number(removed?.contratos ?? 0),
      usuariosColaboradores: Number(removed?.usuarios_colaboradores ?? 0),
    },
  });
}
