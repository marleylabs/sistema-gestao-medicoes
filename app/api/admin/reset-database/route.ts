import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem limpar dados." }, { status: 403 });
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DATABASE_RESET !== "true") {
    return NextResponse.json({ error: "Reset de banco desabilitado em produção." }, { status: 403 });
  }

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
      sgc_logs: bigint;
      bm_aux_medicoes: bigint;
      chat_conversas: bigint;
      cadastros_fornecedores: bigint;
      contratos: bigint;
      usuarios_removidos: bigint;
    }>
  >`
    select
      (select count(*) from medicoes) as medicoes,
      (select count(*) from profissionais) as profissionais,
      (select count(*) from projetos) as projetos,
      (select count(*) from mapa_pagamento_itens) as mapa_pagamento_itens,
      (select count(*) from mapa_pagamento_contexto) as mapa_pagamento_contexto,
      (select count(*) from sgc_aprovacoes_medicao) as sgc_aprovacoes_medicao,
      (select count(*) from sgc_logs) as sgc_logs,
      (select count(*) from bm_aux_medicoes) as bm_aux_medicoes,
      (select count(*) from chat_conversas) as chat_conversas,
      (select count(*) from cadastros_fornecedores) as cadastros_fornecedores,
      (select count(*) from contratos) as contratos,
      (select count(*) from usuarios where id <> ${auth.user.id}::uuid) as usuarios_removidos
  `;

  await prisma.$transaction([
    prisma.$executeRaw`
      truncate table
        chat_mensagens,
        chat_participantes,
        chat_conversas,
        sgc_logs,
        sgc_aprovacoes_medicao,
        medicoes,
        mapa_pagamento_itens,
        mapa_pagamento_contexto,
        bm_aux_medicoes,
        cadastros_fornecedores,
        projetos,
        profissionais,
        contratos,
        etl_execucoes
      restart identity cascade
    `,
    prisma.$executeRaw`
      delete from usuarios
      where id <> ${auth.user.id}::uuid
    `,
    prisma.$executeRaw`
      update usuarios
      set tentativas_falhas = 0,
          bloqueado_ate = null,
          primeiro_login = false,
          senha_temporaria = null,
          perfil = 'ADMIN',
          ativo = true,
          excluido_at = null,
          updated_at = now()
      where id = ${auth.user.id}::uuid
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
      sgcLogs: Number(removed?.sgc_logs ?? 0),
      bmAuxMedicoes: Number(removed?.bm_aux_medicoes ?? 0),
      chatConversas: Number(removed?.chat_conversas ?? 0),
      cadastrosFornecedores: Number(removed?.cadastros_fornecedores ?? 0),
      contratos: Number(removed?.contratos ?? 0),
      usuariosRemovidos: Number(removed?.usuarios_removidos ?? 0),
    },
  });
}
