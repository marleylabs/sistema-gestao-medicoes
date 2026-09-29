import { Prisma } from "@prisma/client";

type CleanupTransaction = Pick<Prisma.TransactionClient, "$executeRaw">;

/**
 * Remove somente Profissionais realmente órfãos após a exclusão de ciclos.
 *
 * A existência de CadastroFornecedor é um vínculo administrativo conhecido e, portanto, protege
 * a identidade canônica mesmo quando o cadastro está inativo ou ainda não possui
 * medição/pagamento. `ativo` controla participação operacional, não existência da identidade.
 * Tombstones e todas as referências históricas continuam preservados.
 */
export async function deleteOrphanProfessionalsAfterCycleRemoval(tx: CleanupTransaction) {
  return tx.$executeRaw`
    delete from profissionais p
    where p.deleted_at is null
    and not exists (
      select 1 from cadastros_fornecedores cf
      where cf.colaborador_codigo is not null
        and upper(trim(cf.colaborador_codigo)) = upper(trim(p.codigo))
    )
    and not exists (
      select 1 from medicoes m
      where m.id_profissional = p.id or m.id_coordenador = p.id
    )
    and not exists (
      select 1 from mapa_pagamento_itens mpi
      where upper(trim(mpi.projetista_codigo)) = upper(trim(p.codigo))
    )
    and not exists (
      select 1 from bm_aux_medicoes bm
      where upper(trim(bm.responsavel_codigo)) = upper(trim(p.codigo))
    )
    and not exists (
      select 1 from sgc_aprovacoes_medicao sgc
      where upper(trim(sgc.colaborador_codigo)) = upper(trim(p.codigo))
    )
    and not exists (
      select 1 from sgc_logs logs
      where upper(trim(logs.colaborador_codigo)) = upper(trim(p.codigo))
    )
    and not exists (
      select 1 from divergencias_medicao d
      where upper(trim(d.colaborador_codigo)) = upper(trim(p.codigo))
    )
  `;
}
