import { Prisma } from "@prisma/client";

type CleanupTransaction = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

export type CandidatosLimpezaCiclo = {
  /** Profissionais referenciados pelos dados dos ciclos que serão excluídos. */
  profissionalIds: string[];
  /** Projetos com medições nos ciclos que serão excluídos. */
  projetoIds: string[];
};

/**
 * Coleta — ANTES de apagar os dados do ciclo — quais Profissionais e Projetos pertencem aos ciclos
 * excluídos. A limpeza de órfãos depois da exclusão só pode considerar ESTES candidatos: excluir um
 * ciclo nunca faz coleta de lixo global (antes, qualquer Profissional/Projeto sem vínculo no banco
 * inteiro era apagado, inclusive entidades sem nenhuma relação com o ciclo excluído).
 */
export async function coletarCandidatosLimpezaCiclo(tx: CleanupTransaction, ciclos: string[]): Promise<CandidatosLimpezaCiclo> {
  if (ciclos.length === 0) return { profissionalIds: [], projetoIds: [] };
  const profissionais = await tx.$queryRaw<{ id: string }[]>`
    select distinct p.id::text as id
    from profissionais p
    where p.id in (
      select m.id_profissional from medicoes m where m.ciclo = any(${ciclos}) and m.id_profissional is not null
      union
      select m.id_coordenador from medicoes m where m.ciclo = any(${ciclos}) and m.id_coordenador is not null
    )
    or (p.codigo is not null and upper(trim(p.codigo)) in (
      select upper(trim(mpi.projetista_codigo)) from mapa_pagamento_itens mpi where mpi.ciclo = any(${ciclos}) and mpi.projetista_codigo is not null
      union
      select upper(trim(bm.responsavel_codigo)) from bm_aux_medicoes bm where bm.ciclo = any(${ciclos})
      union
      select upper(trim(sgc.colaborador_codigo)) from sgc_aprovacoes_medicao sgc where sgc.ciclo = any(${ciclos})
    ))
  `;
  const projetos = await tx.$queryRaw<{ id: string }[]>`
    select distinct m.id_projeto::text as id from medicoes m where m.ciclo = any(${ciclos})
  `;
  return { profissionalIds: profissionais.map((p) => p.id), projetoIds: projetos.map((p) => p.id) };
}

/**
 * Remove, entre os candidatos do ciclo excluído, somente os Profissionais realmente órfãos.
 *
 * A existência de CadastroFornecedor é um vínculo administrativo conhecido e, portanto, protege
 * a identidade canônica mesmo quando o cadastro está inativo ou ainda não possui
 * medição/pagamento. `ativo` controla participação operacional, não existência da identidade.
 * Aliases (identidade curada — a FK é ON DELETE CASCADE) e um Usuario com o mesmo código também
 * protegem. Tombstones e todas as referências históricas continuam preservados.
 */
export async function deleteOrphanProfessionalsAfterCycleRemoval(tx: CleanupTransaction, candidatos: string[]) {
  if (candidatos.length === 0) return 0;
  return tx.$executeRaw`
    delete from profissionais p
    where p.id = any(${candidatos}::uuid[])
    and p.deleted_at is null
    and not exists (
      select 1 from cadastros_fornecedores cf
      where cf.colaborador_codigo is not null
        and upper(trim(cf.colaborador_codigo)) = upper(trim(p.codigo))
    )
    and not exists (
      select 1 from profissional_aliases pa
      where pa.profissional_id = p.id
    )
    and not exists (
      select 1 from usuarios u
      where p.codigo is not null
        and upper(trim(u.usuario)) = upper(trim(p.codigo))
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

/** Remove, entre os projetos que tinham medições no ciclo excluído, os que ficaram sem nenhuma medição. */
export async function deleteOrphanProjectsAfterCycleRemoval(tx: CleanupTransaction, candidatos: string[]) {
  if (candidatos.length === 0) return 0;
  return tx.$executeRaw`
    delete from projetos p
    where p.id = any(${candidatos}::uuid[])
    and not exists (
      select 1 from medicoes m
      where m.id_projeto = p.id
    )
  `;
}
