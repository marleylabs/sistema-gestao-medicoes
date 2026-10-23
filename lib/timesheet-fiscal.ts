import "server-only";

import { prisma } from "@/lib/prisma";
import { cicloToDates, isCicloValido } from "@/lib/ciclo";
import { getCicloTimesheet } from "@/lib/ciclo-ativo";
import { diasDoCiclo } from "@/lib/timesheet-calculo";
import { TimesheetError, auditoria, carregarFolha, exigirCiclo, type Ator } from "@/lib/timesheet";
import { exigirUuid, listarFolhasDoCiclo } from "@/lib/timesheet-medicao";
import { assinaturaDuplicada, gravarAssinatura, verificarAssinatura, type AssinaturaValidada, type VerificacaoAssinatura } from "@/lib/timesheet-assinatura";

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

export async function exigirNoEscopo(fiscalId: string, profissionalIdParam: unknown) {
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

/**
 * O fiscal assina a folha (spec timesheet-assinatura, regra 3): a qualquer momento, aberta ou enviada, com dias
 * pendentes; só precisa de um dia lançado. Vale o ciclo todo; para assinar de novo, revoga antes.
 */
export async function assinarComoFiscal(input: { fiscal: Ator; profissionalId: unknown; ciclo?: unknown; assinatura: AssinaturaValidada; ip: string | null }) {
  const conteudo = await folhaDoFiscal(input.fiscal.id, input.profissionalId, input.ciclo);
  if (!conteudo.dias.some((d) => d.lancado)) throw new TimesheetError("Nenhum dia lançado nesta folha.", 409);
  const profissionalId = exigirUuid(input.profissionalId, "Fornecedor");
  try {
    return await prisma.$transaction(async (tx) => {
      const folha = await tx.timesheetFolha.findUnique({
        where: { profissionalId_ciclo: { profissionalId, ciclo: conteudo.ciclo } },
        select: { id: true, profissional: { select: { codigo: true } } },
      });
      if (!folha) throw new TimesheetError("Nenhum dia lançado nesta folha.", 409);
      const { codigo, hash } = await gravarAssinatura(tx, { folhaId: folha.id, papel: "FISCAL", ator: input.fiscal, ip: input.ip, assinatura: input.assinatura, conteudo });
      await tx.adminAuditLog.create({
        data: auditoria(input.fiscal, "TIMESHEET_ASSINADA", folha.id, folha.profissional.codigo, { ciclo: conteudo.ciclo, papel: "FISCAL", codigo, metodo: input.assinatura.metodo, hash }),
      });
      return { codigo };
    });
  } catch (e) {
    if (assinaturaDuplicada(e)) throw new TimesheetError("Esta folha já tem a sua assinatura. Revogue para assinar de novo.", 409);
    throw e;
  }
}

/** Revoga a assinatura ativa do fiscal na folha. Só quem assinou revoga (outro fiscal do contrato não). */
export async function revogarAssinaturaFiscal(input: { fiscal: Ator; profissionalId: unknown; ciclo?: unknown }) {
  const profissionalId = await exigirNoEscopo(input.fiscal.id, input.profissionalId);
  const ciclo = exigirCiclo(input.ciclo);
  await prisma.$transaction(async (tx) => {
    const ativa = await tx.timesheetAssinatura.findFirst({
      where: { papel: "FISCAL", encerradaEm: null, folha: { profissionalId, ciclo } },
      select: { id: true, usuarioId: true, codigo: true, folhaId: true, folha: { select: { profissional: { select: { codigo: true } } } } },
    });
    if (!ativa) throw new TimesheetError("Esta folha não tem assinatura do fiscal.", 404);
    if (ativa.usuarioId !== input.fiscal.id) throw new TimesheetError("Só quem assinou pode revogar a assinatura.", 403);
    // Compare-and-swap: duas revogações simultâneas não gravam duas vezes.
    const revogada = await tx.timesheetAssinatura.updateMany({
      where: { id: ativa.id, encerradaEm: null },
      data: { encerradaEm: new Date(), encerradaPorId: input.fiscal.id, encerramento: "REVOGADA" },
    });
    if (revogada.count === 0) throw new TimesheetError("A assinatura já foi revogada.", 409);
    await tx.adminAuditLog.create({
      data: auditoria(input.fiscal, "TIMESHEET_ASSINATURA_REVOGADA", ativa.folhaId, ativa.folha.profissional.codigo, { ciclo, papel: "FISCAL", codigo: ativa.codigo }),
    });
  });
}

/** Verificação pelo fiscal: só códigos de folhas do escopo dele (os outros respondem como inexistentes) e sem o IP. */
export async function verificarAssinaturaDoFiscal(fiscalId: string, codigo: unknown): Promise<VerificacaoAssinatura> {
  const { profissionalId, ip: _ip, ...resto } = await verificarAssinatura(codigo);
  if (!(await escopoDoFiscal(fiscalId)).has(profissionalId)) throw new TimesheetError("Código não encontrado.", 404);
  return resto;
}
