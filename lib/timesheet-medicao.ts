import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cicloToDates } from "@/lib/ciclo";
import { feriadosNacionais } from "@/lib/feriados";
import { isUuid } from "@/lib/file-security";
import { calcularDia, formatarData, isoDate, somarHoras, tipoDoDia } from "@/lib/timesheet-calculo";
import {
  TimesheetError, auditoria, exigirCiclo, feriadosDoContrato, feriadosDoPeriodo, getLiberacao, texto, timesheetHabilitado, type Ator, type Liberacao,
} from "@/lib/timesheet";

/**
 * Lado da medição do Timesheet ATO (spec docs/brain/specs/timesheet-ato.md, T5–T7): acompanhamento
 * do ciclo, liberação, reabertura, feriados manuais e configuração por fornecedor. As rotas chamam
 * isto depois de `requireAdmin` (MEDICAO/ADMIN).
 */

export function exigirUuid(valor: unknown, campo = "Identificador"): string {
  if (typeof valor !== "string" || !isUuid(valor)) throw new TimesheetError(`${campo} inválido.`, 400);
  return valor;
}

export type StatusAcompanhamento = "NAO_INICIADA" | "EM_PREENCHIMENTO" | "ENVIADA";

/**
 * Fornecedores do ciclo: todo habilitado (status ATO ou sobrescrita da medição) e quem já tem folha
 * no ciclo, mesmo desabilitado depois. Totais calculados na leitura, como no portal.
 */
export async function listarFolhasDoCiclo(cicloParam: unknown) {
  const ciclo = exigirCiclo(cicloParam);
  const { atoInicio, atoFim } = cicloToDates(ciclo);
  const [profissionais, folhas, feriados, liberacao] = await Promise.all([
    prisma.profissional.findMany({
      where: {
        deletedAt: null,
        OR: [
          { statusColaborador: "ATO", NOT: { timesheetConfig: { is: { habilitado: false } } } },
          { timesheetConfig: { is: { habilitado: true } } },
          { timesheetFolhas: { some: { ciclo } } },
        ],
      },
      select: { id: true, codigo: true, nome: true, nomeCompleto: true, statusColaborador: true, timesheetConfig: { select: { habilitado: true, contratoId: true } } },
    }),
    prisma.timesheetFolha.findMany({
      where: { ciclo },
      select: {
        profissionalId: true, status: true, enviadaAt: true,
        dias: { select: { data: true, entrada1: true, saida1: true, entrada2: true, saida2: true, updatedAt: true, aprovacao: true } },
      },
    }),
    feriadosDoPeriodo(atoInicio, atoFim),
    getLiberacao(ciclo),
  ]);

  const folhaPorProfissional = new Map(folhas.map((f) => [f.profissionalId, f]));

  const itens = profissionais.map((p) => {
    const folha = folhaPorProfissional.get(p.id);
    const feriadosDaFolha = feriadosDoContrato(feriados, p.timesheetConfig?.contratoId);
    const datasFeriado = new Set(feriadosDaFolha.map((f) => f.data));
    const dias = (folha?.dias ?? []).filter((d) => d.entrada1 !== null || d.entrada2 !== null);
    const ultimo = (folha?.dias ?? []).reduce<Date | null>((max, d) => (!max || d.updatedAt > max ? d.updatedAt : max), null);
    const status: StatusAcompanhamento = folha?.status === "ENVIADA" ? "ENVIADA" : dias.length ? "EM_PREENCHIMENTO" : "NAO_INICIADA";
    const enviadaAt = folha?.status === "ENVIADA" ? folha.enviadaAt : null;
    return {
      profissionalId: p.id,
      codigo: p.codigo,
      nome: p.nomeCompleto ?? p.nome,
      habilitado: timesheetHabilitado(p),
      status,
      diasPreenchidos: dias.length,
      ultimoPreenchimento: ultimo?.toISOString() ?? null,
      enviadaEm: enviadaAt?.toISOString() ?? null,
      // Decisão 2 da spec: recalcula sempre e avisa quando um feriado novo caiu depois do envio.
      feriadoAposEnvio: !!enviadaAt && feriadosDaFolha.some((f) => f.criadoEm !== null && new Date(f.criadoEm) > enviadaAt),
      totais: somarHoras(dias.filter((d) => d.aprovacao !== "REPROVADO").map((d) => calcularDia(d, tipoDoDia(isoDate(d.data), datasFeriado)))),
      // Decisões do fiscal nos dias lançados (spec timesheet-aprovacao-fiscal).
      aprovacoes: {
        aprovados: dias.filter((d) => d.aprovacao === "APROVADO").length,
        reprovados: dias.filter((d) => d.aprovacao === "REPROVADO").length,
        pendentes: dias.filter((d) => !d.aprovacao).length,
      },
    };
  });
  itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { ciclo, periodo: { inicio: atoInicio, fim: atoFim }, liberacao, feriados, folhas: itens };
}

export type AcompanhamentoCiclo = Awaited<ReturnType<typeof listarFolhasDoCiclo>>;

/** Histórico de auditoria da folha (mais recente primeiro). */
export async function historicoDaFolha(profissionalId: string, cicloParam: unknown) {
  const ciclo = exigirCiclo(cicloParam);
  const folha = await prisma.timesheetFolha.findUnique({ where: { profissionalId_ciclo: { profissionalId, ciclo } }, select: { id: true } });
  if (!folha) return [];
  const logs = await prisma.adminAuditLog.findMany({
    where: { targetType: "TIMESHEET_FOLHA", targetId: folha.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, action: true, adminNome: true, createdAt: true, metadata: true },
  });
  return logs.map((l) => {
    const meta = (l.metadata ?? {}) as { data?: unknown };
    return { id: l.id, acao: l.action, por: l.adminNome, em: l.createdAt.toISOString(), data: typeof meta.data === "string" ? meta.data : null };
  });
}

export async function reabrirFolha(input: { profissionalId: string; ciclo: unknown; ator: Ator }) {
  const ciclo = exigirCiclo(input.ciclo);
  await prisma.$transaction(async (tx) => {
    const folha = await tx.timesheetFolha.findUnique({
      where: { profissionalId_ciclo: { profissionalId: input.profissionalId, ciclo } },
      select: { id: true, profissional: { select: { codigo: true } } },
    });
    if (!folha) throw new TimesheetError("Folha não encontrada.", 404);
    const reaberta = await tx.timesheetFolha.updateMany({
      where: { id: folha.id, status: "ENVIADA" },
      data: { status: "ABERTA", reabertaAt: new Date(), reabertaPorId: input.ator.id },
    });
    if (reaberta.count === 0) throw new TimesheetError("A folha não está enviada.", 409);
    // A assinatura do colaborador valia para aquele envio; o próximo pede outra. A do fiscal continua (spec timesheet-assinatura).
    const encerradas = await tx.timesheetAssinatura.updateMany({
      where: { folhaId: folha.id, papel: "COLABORADOR", encerradaEm: null },
      data: { encerradaEm: new Date(), encerradaPorId: input.ator.id, encerramento: "REABERTURA" },
    });
    await tx.adminAuditLog.create({
      data: auditoria(input.ator, "TIMESHEET_REABERTA", folha.id, folha.profissional.codigo, { ciclo, assinaturaColaboradorEncerrada: encerradas.count > 0 }),
    });
  });
}

export async function definirLiberacao(input: { ciclo: unknown; liberacao: unknown; ator: Ator }) {
  const ciclo = exigirCiclo(input.ciclo);
  if (input.liberacao !== "DIA_A_DIA" && input.liberacao !== "CICLO") throw new TimesheetError("Liberação inválida.", 400);
  const liberacao: Liberacao = input.liberacao;
  await prisma.$transaction(async (tx) => {
    const antes = await tx.timesheetCiclo.findUnique({ where: { ciclo }, select: { liberacao: true } });
    await tx.timesheetCiclo.upsert({
      where: { ciclo },
      create: { ciclo, liberacao, updatedById: input.ator.id, updatedByNome: input.ator.nome },
      update: { liberacao, updatedById: input.ator.id, updatedByNome: input.ator.nome },
    });
    await tx.adminAuditLog.create({
      data: auditoria(input.ator, "TIMESHEET_LIBERACAO", null, null, { ciclo, antes: antes?.liberacao ?? "DIA_A_DIA", depois: liberacao }, "TIMESHEET_CICLO"),
    });
  });
}

/** Publica o ciclo que o fornecedor preenche no timesheet (spec timesheet-ciclo-publicado). Só ciclos cadastrados. */
export async function publicarCicloTimesheet(input: { ciclo: unknown; ator: Ator }) {
  const ciclo = exigirCiclo(input.ciclo);
  await prisma.$transaction(async (tx) => {
    if (!(await tx.mapaPagamentoContexto.findUnique({ where: { ciclo }, select: { ciclo: true } }))) throw new TimesheetError("Ciclo não encontrado.", 404);
    const antes = await tx.mapaPagamentoContexto.findFirst({ where: { ativoTimesheet: true }, select: { ciclo: true } });
    await tx.mapaPagamentoContexto.updateMany({ where: { ativoTimesheet: true }, data: { ativoTimesheet: false } });
    await tx.mapaPagamentoContexto.update({ where: { ciclo }, data: { ativoTimesheet: true } });
    await tx.adminAuditLog.create({
      data: auditoria(input.ator, "TIMESHEET_CICLO_PUBLICADO", null, null, { antes: antes?.ciclo ?? null, depois: ciclo }, "TIMESHEET_CICLO"),
    });
  });
}

// ─── Feriados manuais ────────────────────────────────────────────────────────

/** `contratoId` vazio = vale para todos os contratos. Uma data não pode ter dois feriados que alcancem o mesmo fornecedor. */
export async function criarFeriado(input: { data: unknown; nome: unknown; abrangencia: unknown; contratoId?: unknown; ator: Ator }) {
  const data = typeof input.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.data) ? input.data : null;
  const dataDb = data ? new Date(`${data}T00:00:00Z`) : null;
  if (!data || !dataDb || Number.isNaN(dataDb.getTime()) || isoDate(dataDb) !== data) throw new TimesheetError("Data inválida.", 400);
  const nome = texto(input.nome, "Nome");
  if (!nome || nome.length > 100) throw new TimesheetError("Informe o nome do feriado (até 100 caracteres).", 400);
  if (input.abrangencia !== "ESTADUAL" && input.abrangencia !== "MUNICIPAL") throw new TimesheetError("Abrangência inválida.", 400);
  const nacional = feriadosNacionais(Number(data.slice(0, 4))).find((f) => f.data === data);
  if (nacional) throw new TimesheetError(`${formatarData(data)} já é feriado nacional (${nacional.nome}).`, 409);
  const contratoId = input.contratoId === null || input.contratoId === "" || input.contratoId === undefined ? null : exigirUuid(input.contratoId, "Contrato");
  const contrato = contratoId ? await prisma.contrato.findUnique({ where: { id: contratoId }, select: { nome: true } }) : null;
  if (contratoId && !contrato) throw new TimesheetError("Contrato não encontrado.", 400);

  try {
    return await prisma.$transaction(async (tx) => {
      // shortcut: geral × contrato na mesma data só é checado aqui (os índices pegam só geral × geral e contrato × mesmo contrato); basta para o cadastro manual da medição.
      const ocupado = await tx.feriado.findFirst({
        where: { data: dataDb, ...(contratoId ? { OR: [{ contratoId: null }, { contratoId }] } : {}) },
        select: { nome: true, contrato: { select: { nome: true } } },
      });
      if (ocupado) {
        throw new TimesheetError(`Já existe um feriado nesta data (${ocupado.nome}, ${ocupado.contrato ? `contrato ${ocupado.contrato.nome}` : "todos os contratos"}).`, 409);
      }
      const feriado = await tx.feriado.create({
        data: { data: dataDb, nome, abrangencia: input.abrangencia as string, contratoId, createdById: input.ator.id, createdByNome: input.ator.nome },
        select: { id: true },
      });
      await tx.adminAuditLog.create({
        data: auditoria(input.ator, "FERIADO_CRIADO", feriado.id, null, { data, nome, abrangencia: input.abrangencia, contratoId, contrato: contrato?.nome ?? null }, "FERIADO"),
      });
      return feriado;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new TimesheetError("Já existe um feriado nesta data.", 409);
    throw e;
  }
}

export async function excluirFeriado(input: { id: unknown; ator: Ator }) {
  const id = exigirUuid(input.id, "Feriado");
  await prisma.$transaction(async (tx) => {
    const feriado = await tx.feriado.findUnique({ where: { id }, select: { data: true, nome: true, abrangencia: true, contratoId: true, contrato: { select: { nome: true } } } });
    if (!feriado) throw new TimesheetError("Feriado não encontrado.", 404);
    await tx.feriado.delete({ where: { id } });
    await tx.adminAuditLog.create({
      data: auditoria(input.ator, "FERIADO_EXCLUIDO", id, null, {
        data: isoDate(feriado.data), nome: feriado.nome, abrangencia: feriado.abrangencia, contratoId: feriado.contratoId, contrato: feriado.contrato?.nome ?? null,
      }, "FERIADO"),
    });
  });
}

// ─── Configuração por fornecedor ─────────────────────────────────────────────

const CAMPOS_CABECALHO = ["funcao", "itemPq", "local", "area", "numeroSe", "docNumero"] as const;
type CampoCabecalho = (typeof CAMPOS_CABECALHO)[number];
const ROTULOS: Record<CampoCabecalho, string> = {
  funcao: "Função", itemPq: "Item da PQ", local: "Local", area: "Área", numeroSe: "Nº da SE", docNumero: "Doc. Nº",
};

export async function getConfig(profissionalId: string) {
  const [p, config] = await Promise.all([
    prisma.profissional.findFirst({ where: { id: profissionalId, deletedAt: null }, select: { statusColaborador: true } }),
    prisma.timesheetConfig.findUnique({
      where: { profissionalId },
      select: { habilitado: true, contratoId: true, funcao: true, itemPq: true, local: true, area: true, numeroSe: true, docNumero: true, updatedAt: true, updatedByNome: true },
    }),
  ]);
  if (!p) throw new TimesheetError("Fornecedor não encontrado.", 404);
  return {
    statusColaborador: p.statusColaborador,
    habilitadoEfetivo: timesheetHabilitado({ statusColaborador: p.statusColaborador, timesheetConfig: config }),
    habilitado: config?.habilitado ?? null,
    contratoId: config?.contratoId ?? null,
    funcao: config?.funcao ?? null, itemPq: config?.itemPq ?? null, local: config?.local ?? null,
    area: config?.area ?? null, numeroSe: config?.numeroSe ?? null, docNumero: config?.docNumero ?? null,
    atualizadoEm: config?.updatedAt.toISOString() ?? null,
    atualizadoPor: config?.updatedByNome ?? null,
  };
}

/** Grava a sobrescrita da habilitação e o cabeçalho. `habilitado` null = volta a seguir o status ATO. */
export async function salvarConfig(input: { profissionalId: unknown; valores: Record<string, unknown>; ator: Ator }) {
  const profissionalId = exigirUuid(input.profissionalId, "Fornecedor");
  const { habilitado } = input.valores;
  if (habilitado !== null && typeof habilitado !== "boolean") throw new TimesheetError("Habilitação inválida.", 400);
  const contratoId = input.valores.contratoId === null || input.valores.contratoId === "" || input.valores.contratoId === undefined
    ? null
    : exigirUuid(input.valores.contratoId, "Contrato");
  const cabecalho = Object.fromEntries(CAMPOS_CABECALHO.map((c) => [c, texto(input.valores[c], ROTULOS[c])])) as Record<CampoCabecalho, string | null>;

  const p = await prisma.profissional.findFirst({ where: { id: profissionalId, deletedAt: null }, select: { codigo: true } });
  if (!p) throw new TimesheetError("Fornecedor não encontrado.", 404);
  if (contratoId && !(await prisma.contrato.findUnique({ where: { id: contratoId }, select: { id: true } }))) throw new TimesheetError("Contrato não encontrado.", 400);

  const valores = { habilitado, contratoId, ...cabecalho, updatedById: input.ator.id, updatedByNome: input.ator.nome };
  await prisma.$transaction(async (tx) => {
    const antes = await tx.timesheetConfig.findUnique({
      where: { profissionalId },
      select: { habilitado: true, contratoId: true, funcao: true, itemPq: true, local: true, area: true, numeroSe: true, docNumero: true },
    });
    await tx.timesheetConfig.upsert({ where: { profissionalId }, create: { profissionalId, ...valores }, update: valores });
    await tx.adminAuditLog.create({
      data: auditoria(input.ator, "TIMESHEET_CONFIG", profissionalId, p.codigo, { antes, depois: { habilitado, contratoId, ...cabecalho } }, "PROFISSIONAL"),
    });
  });
}

/** Registra na auditoria da folha que ela foi exportada (XLSX ou PDF). Sem folha, não há o que registrar. */
export async function registrarExportacao(input: { profissionalId: string; ciclo: string; formato: "XLSX" | "PDF"; ator: Ator }) {
  const folha = await prisma.timesheetFolha.findUnique({
    where: { profissionalId_ciclo: { profissionalId: input.profissionalId, ciclo: input.ciclo } },
    select: { id: true, profissional: { select: { codigo: true } } },
  });
  if (!folha) return;
  await prisma.adminAuditLog.create({
    data: auditoria(input.ator, "TIMESHEET_EXPORTADA", folha.id, folha.profissional.codigo, { ciclo: input.ciclo, formato: input.formato }),
  });
}
