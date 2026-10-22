import "server-only";

import { prisma } from "@/lib/prisma";
import { cicloToDates, isCicloValido } from "@/lib/ciclo";
import { getCicloTimesheet } from "@/lib/ciclo-ativo";
import { diasDoCiclo } from "@/lib/timesheet-calculo";
import { TimesheetError, auditoria, carregarFolha, exigirCiclo, type Ator } from "@/lib/timesheet";
import { exigirUuid, listarFolhasDoCiclo } from "@/lib/timesheet-medicao";

/**
 * Lado do fiscal do contrato (spec docs/brain/specs/timesheet-aprovacao-fiscal.md): ele vê só os
 * fornecedores cujo contrato (configuração do timesheet) o tem como fiscal e decide as horas de cada dia
 * lançado. As rotas chamam isto depois de `requireFiscal`; o fiscal vem sempre da sessão.
 */

const MAX_MOTIVO = 500;

/** Ids dos Profissionais do escopo do fiscal (contrato da configuração do timesheet aponta para ele). */
async function escopoDoFiscal(fiscalId: string) {
  const ps = await prisma.profissional.findMany({
    where: { deletedAt: null, timesheetConfig: { is: { contrato: { is: { fiscalId } } } } },
    select: { id: true },
  });
  return new Set(ps.map((p) => p.id));
}

async function exigirNoEscopo(fiscalId: string, profissionalIdParam: unknown) {
  const profissionalId = exigirUuid(profissionalIdParam, "Fornecedor");
  // Fora do escopo responde igual a inexistente: não revela fornecedores de outros contratos.
  if (!(await escopoDoFiscal(fiscalId)).has(profissionalId)) throw new TimesheetError("Fornecedor não encontrado.", 404);
  return profissionalId;
}

/** Lista do ciclo só com os fornecedores do fiscal. Sem ciclo pedido, o ciclo publicado do timesheet. */
export async function listarFolhasDoFiscal(fiscalId: string, cicloParam: unknown) {
  const ciclo = isCicloValido(cicloParam) ? cicloParam : await getCicloTimesheet();
  const [lista, escopo] = await Promise.all([listarFolhasDoCiclo(ciclo), escopoDoFiscal(fiscalId)]);
  return { ciclo: lista.ciclo, periodo: lista.periodo, folhas: lista.folhas.filter((f) => escopo.has(f.profissionalId)) };
}
export type AcompanhamentoFiscal = Awaited<ReturnType<typeof listarFolhasDoFiscal>>;

export async function folhaDoFiscal(fiscalId: string, profissionalIdParam: unknown, cicloParam: unknown) {
  const profissionalId = await exigirNoEscopo(fiscalId, profissionalIdParam);
  return carregarFolha(profissionalId, cicloParam, undefined, { paraMedicao: true });
}

/**
 * Aprova ou reprova vários dias de uma vez. Só dias lançados (com horário); reprovar exige motivo.
 * A decisão e a auditoria vão na mesma transação.
 */
export async function decidirDias(input: { fiscal: Ator; profissionalId: unknown; ciclo?: unknown; datas?: unknown; decisao?: unknown; motivo?: unknown }) {
  const profissionalId = await exigirNoEscopo(input.fiscal.id, input.profissionalId);
  const ciclo = exigirCiclo(input.ciclo);
  if (input.decisao !== "APROVADO" && input.decisao !== "REPROVADO") throw new TimesheetError("Decisão inválida.", 400);
  const decisao = input.decisao;
  const motivo = typeof input.motivo === "string" ? input.motivo.trim() : "";
  if (decisao === "REPROVADO" && !motivo) throw new TimesheetError("Informe o motivo da reprovação.", 400);
  if (motivo.length > MAX_MOTIVO) throw new TimesheetError(`Motivo: até ${MAX_MOTIVO} caracteres.`, 400);

  const doCiclo = new Set(diasDoCiclo(ciclo));
  const datas = Array.isArray(input.datas) ? [...new Set(input.datas)] : [];
  if (!datas.length || datas.some((d) => typeof d !== "string" || !doCiclo.has(d))) throw new TimesheetError("Selecione dias do ciclo.", 400);
  const datasDb = (datas as string[]).map((d) => new Date(`${d}T00:00:00Z`));
  const { atoInicio } = cicloToDates(ciclo);

  return prisma.$transaction(async (tx) => {
    const folha = await tx.timesheetFolha.findUnique({
      where: { profissionalId_ciclo: { profissionalId, ciclo } },
      select: { id: true, profissional: { select: { codigo: true } } },
    });
    if (!folha) throw new TimesheetError("Nenhum dia lançado nesta folha.", 409);
    const lancados = await tx.timesheetDia.count({
      where: { folhaId: folha.id, data: { in: datasDb }, OR: [{ entrada1: { not: null } }, { entrada2: { not: null } }] },
    });
    if (lancados !== datas.length) throw new TimesheetError("Só dias com horas lançadas podem ser aprovados ou reprovados.", 409);

    await tx.timesheetDia.updateMany({
      where: { folhaId: folha.id, data: { in: datasDb } },
      data: {
        aprovacao: decisao, aprovacaoMotivo: decisao === "REPROVADO" ? motivo : motivo || null,
        aprovacaoPorId: input.fiscal.id, aprovacaoPorNome: input.fiscal.nome, aprovacaoEm: new Date(),
      },
    });
    await tx.adminAuditLog.create({
      data: auditoria(input.fiscal, decisao === "APROVADO" ? "TIMESHEET_DIAS_APROVADOS" : "TIMESHEET_DIAS_REPROVADOS", folha.id, folha.profissional.codigo, {
        ciclo, inicio: atoInicio, datas: [...(datas as string[])].sort(), motivo: motivo || null,
      }),
    });
    return { decididos: datas.length };
  });
}
