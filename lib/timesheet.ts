import "server-only";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cicloToDates, isCicloValido } from "@/lib/ciclo";
import { feriadosNacionaisNoPeriodo } from "@/lib/feriados";
import { calcularDia, diasDoCiclo, isoDate, somarHoras, tipoDoDia, validarDia, type HorariosDia } from "@/lib/timesheet-calculo";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import type { AuthUser } from "@/lib/session";

/**
 * Timesheet ATO (spec docs/brain/specs/timesheet-ato.md): habilitação, leitura da folha com o
 * cálculo, gravação de um dia e envio. As rotas só traduzem HTTP; o `profissionalId` sempre vem da
 * sessão (getColaboradorEscopo), nunca do request.
 */

export class TimesheetError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "TimesheetError";
  }
}

/** Converte TimesheetError na resposta HTTP; qualquer outro erro sobe (500 sem detalhes). */
export function respostaTimesheetErro(e: unknown) {
  if (e instanceof TimesheetError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

export type Liberacao = "DIA_A_DIA" | "CICLO";
export type Ator = Pick<AuthUser, "id" | "usuario" | "nome">;
export type FeriadoDoPeriodo = { data: string; nome: string; origem: "NACIONAL" | "ESTADUAL" | "MUNICIPAL"; id: string | null; criadoEm: string | null };

const MAX_TEXTO = 200;

/** Data de hoje no fuso de Brasília ("YYYY-MM-DD"); toISOString() viraria o dia às 21:00. */
export function hojeSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export { diasDoCiclo };

/** "HH:MM" → minutos; vazio/null → null. Qualquer outra coisa é erro de entrada. */
export function parseHora(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const m = typeof valor === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(valor) : null;
  if (!m) throw new TimesheetError("Horário inválido. Use HH:MM.", 400);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatarHora(minutos: number | null) {
  if (minutos === null) return null;
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

export function texto(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") throw new TimesheetError(`${campo} inválido.`, 400);
  const limpo = valor.trim();
  if (limpo.length > MAX_TEXTO) throw new TimesheetError(`${campo} aceita até ${MAX_TEXTO} caracteres.`, 400);
  return limpo || null;
}

export function exigirCiclo(ciclo: unknown): string {
  if (!isCicloValido(ciclo)) throw new TimesheetError("Ciclo inválido.", 400);
  return ciclo;
}

/** Regra única da habilitação: a sobrescrita da medição vale; sem ela, o status ATO da importação. */
export function timesheetHabilitado(p: { statusColaborador: string | null; timesheetConfig: { habilitado: boolean | null } | null }) {
  return p.timesheetConfig?.habilitado ?? p.statusColaborador === "ATO";
}

async function getProfissionalAtivo(profissionalId: string | null) {
  if (!profissionalId) return null;
  return prisma.profissional.findFirst({
    where: { id: profissionalId, deletedAt: null },
    select: { id: true, codigo: true, nome: true, nomeCompleto: true, statusColaborador: true, timesheetConfig: { select: { habilitado: true } } },
  });
}

export async function getProfissionalHabilitado(profissionalId: string | null) {
  const p = await getProfissionalAtivo(profissionalId);
  return p && timesheetHabilitado(p) ? p : null;
}

async function exigirHabilitado(profissionalId: string | null) {
  const p = await getProfissionalHabilitado(profissionalId);
  if (!p) throw new TimesheetError("Timesheet não disponível para este fornecedor.", 404);
  return p;
}

export async function feriadosDoPeriodo(inicio: string, fim: string): Promise<FeriadoDoPeriodo[]> {
  const manuais = await prisma.feriado.findMany({
    where: { data: { gte: new Date(`${inicio}T00:00:00Z`), lte: new Date(`${fim}T00:00:00Z`) } },
    select: { id: true, data: true, nome: true, abrangencia: true, createdAt: true },
  });
  return [
    ...feriadosNacionaisNoPeriodo(inicio, fim).map((f) => ({ ...f, origem: "NACIONAL" as const, id: null, criadoEm: null })),
    ...manuais.map((f) => ({
      data: isoDate(f.data), nome: f.nome, origem: f.abrangencia === "MUNICIPAL" ? ("MUNICIPAL" as const) : ("ESTADUAL" as const),
      id: f.id, criadoEm: f.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.data.localeCompare(b.data));
}

export async function getLiberacao(ciclo: string): Promise<Liberacao> {
  const row = await prisma.timesheetCiclo.findUnique({ where: { ciclo }, select: { liberacao: true } });
  return row?.liberacao === "CICLO" ? "CICLO" : "DIA_A_DIA";
}

/**
 * O fornecedor só lança no ciclo em andamento (o ciclo ativo da medição). Um ciclo passado já foi
 * exportado e enviado ao gestor: mudar horas lá alteraria o que foi reportado.
 */
async function exigirCicloEmAndamento(ciclo: string, cicloAtivo?: string) {
  if (ciclo !== (cicloAtivo ?? (await getCicloAtivoMedicao()))) throw new TimesheetError("Só o ciclo em andamento aceita lançamentos.", 403);
}

function diaLiberado(data: string, liberacao: Liberacao, hoje: string) {
  return liberacao === "CICLO" || data <= hoje;
}

/**
 * Folha completa do ciclo: um item por dia, com tipo, feriado, horários, horas e se é editável.
 * `paraMedicao`: a medição lê a folha mesmo de quem foi desabilitado depois de preencher
 * (os dados continuam lá). O fornecedor sempre passa pela habilitação.
 */
export async function carregarFolha(profissionalId: string | null, cicloParam: unknown, hoje = hojeSaoPaulo(), opcoes: { paraMedicao?: boolean } = {}) {
  const ciclo = exigirCiclo(cicloParam);
  const profissional = opcoes.paraMedicao ? await getProfissionalAtivo(profissionalId) : await exigirHabilitado(profissionalId);
  if (!profissional) throw new TimesheetError("Fornecedor não encontrado.", 404);
  const { atoInicio, atoFim } = cicloToDates(ciclo);
  const [feriados, liberacao, folha, config] = await Promise.all([
    feriadosDoPeriodo(atoInicio, atoFim),
    getLiberacao(ciclo),
    prisma.timesheetFolha.findUnique({
      where: { profissionalId_ciclo: { profissionalId: profissional.id, ciclo } },
      select: {
        status: true,
        enviadaAt: true,
        dias: {
          select: {
            data: true, entrada1: true, saida1: true, entrada2: true, saida2: true,
            projetoPep: true, descricao: true, solicitante: true, updatedAt: true, updatedByNome: true,
          },
        },
      },
    }),
    prisma.timesheetConfig.findUnique({
      where: { profissionalId: profissional.id },
      select: {
        funcao: true, itemPq: true, local: true, area: true, numeroSe: true, docNumero: true,
        contrato: { select: { codigo: true, nome: true, fiscal: true } },
      },
    }),
  ]);

  const feriadoPorData = new Map(feriados.map((f) => [f.data, f.nome]));
  const datasFeriado = new Set(feriadoPorData.keys());
  const salvos = new Map((folha?.dias ?? []).map((d) => [isoDate(d.data), d]));
  const status = folha?.status === "ENVIADA" ? "ENVIADA" : "ABERTA";

  const dias = diasDoCiclo(ciclo).map((data) => {
    const salvo = salvos.get(data);
    const horarios: HorariosDia = {
      entrada1: salvo?.entrada1 ?? null, saida1: salvo?.saida1 ?? null,
      entrada2: salvo?.entrada2 ?? null, saida2: salvo?.saida2 ?? null,
    };
    const tipo = tipoDoDia(data, datasFeriado);
    return {
      data,
      tipo,
      feriado: feriadoPorData.get(data) ?? null,
      entrada1: formatarHora(horarios.entrada1),
      saida1: formatarHora(horarios.saida1),
      entrada2: formatarHora(horarios.entrada2),
      saida2: formatarHora(horarios.saida2),
      projetoPep: salvo?.projetoPep ?? null,
      descricao: salvo?.descricao ?? null,
      solicitante: salvo?.solicitante ?? null,
      horas: calcularDia(horarios, tipo),
      editavel: status === "ABERTA" && diaLiberado(data, liberacao, hoje),
      atualizadoEm: salvo?.updatedAt.toISOString() ?? null,
      atualizadoPor: salvo?.updatedByNome ?? null,
    };
  });

  return {
    ciclo,
    periodo: { inicio: atoInicio, fim: atoFim },
    liberacao,
    status,
    enviadaEm: folha?.enviadaAt?.toISOString() ?? null,
    fornecedor: { codigo: profissional.codigo, nome: profissional.nomeCompleto ?? profissional.nome },
    cabecalho: {
      contratoNumero: config?.contrato?.codigo ?? null,
      contratoNome: config?.contrato?.nome ?? null,
      fiscal: config?.contrato?.fiscal ?? null,
      funcao: config?.funcao ?? null,
      itemPq: config?.itemPq ?? null,
      local: config?.local ?? null,
      area: config?.area ?? null,
      numeroSe: config?.numeroSe ?? null,
      docNumero: config?.docNumero ?? null,
    },
    dias,
    totais: somarHoras(dias.map((d) => d.horas)),
  };
}

export type FolhaTimesheet = Awaited<ReturnType<typeof carregarFolha>>;

export function auditoria(
  ator: Ator, action: string, targetId: string | null, codigo: string | null, metadata: Record<string, unknown>, targetType = "TIMESHEET_FOLHA",
) {
  return {
    action, adminId: ator.id, adminUsuario: ator.usuario, adminNome: ator.nome,
    targetType, targetId, targetCodigo: codigo, metadata: metadata as object,
  };
}

export type EntradaDia = {
  data: unknown;
  entrada1?: unknown; saida1?: unknown; entrada2?: unknown; saida2?: unknown;
  projetoPep?: unknown; descricao?: unknown; solicitante?: unknown;
};

/** Grava um dia da folha (cria a folha na primeira gravação), com auditoria na mesma transação. */
export async function salvarDia(input: { profissionalId: string | null; ciclo: unknown; dia: EntradaDia; ator: Ator; hoje?: string; cicloAtivo?: string }) {
  const ciclo = exigirCiclo(input.ciclo);
  // Habilitação antes da validação: quem não tem timesheet recebe 404 em qualquer entrada.
  const profissional = await exigirHabilitado(input.profissionalId);
  await exigirCicloEmAndamento(ciclo, input.cicloAtivo);
  const data = typeof input.dia.data === "string" ? input.dia.data : "";
  if (!diasDoCiclo(ciclo).includes(data)) throw new TimesheetError("Data fora do ciclo.", 400);
  const horarios: HorariosDia = {
    entrada1: parseHora(input.dia.entrada1), saida1: parseHora(input.dia.saida1),
    entrada2: parseHora(input.dia.entrada2), saida2: parseHora(input.dia.saida2),
  };
  const erro = validarDia(horarios);
  if (erro) throw new TimesheetError(erro, 400);
  const textos = {
    projetoPep: texto(input.dia.projetoPep, "Projeto/PEP"),
    descricao: texto(input.dia.descricao, "Descrição"),
    solicitante: texto(input.dia.solicitante, "Solicitante"),
  };

  const liberacao = await getLiberacao(ciclo);
  if (!diaLiberado(data, liberacao, input.hoje ?? hojeSaoPaulo())) throw new TimesheetError("Este dia ainda não foi liberado para preenchimento.", 403);

  const dataDb = new Date(`${data}T00:00:00Z`);
  const gravar = () => prisma.$transaction(async (tx) => {
    const folha = await tx.timesheetFolha.upsert({
      where: { profissionalId_ciclo: { profissionalId: profissional.id, ciclo } },
      create: { profissionalId: profissional.id, ciclo },
      update: {},
      select: { id: true },
    });
    // Compare-and-swap: só grava com a folha ABERTA, e a linha fica travada até o fim (o envio espera).
    const aberta = await tx.timesheetFolha.updateMany({ where: { id: folha.id, status: "ABERTA" }, data: { updatedAt: new Date() } });
    if (aberta.count === 0) throw new TimesheetError("A folha já foi enviada. Peça à medição para reabrir.", 409);

    const antes = await tx.timesheetDia.findUnique({
      where: { folhaId_data: { folhaId: folha.id, data: dataDb } },
      select: { entrada1: true, saida1: true, entrada2: true, saida2: true, projetoPep: true, descricao: true, solicitante: true },
    });
    const valores = { ...horarios, ...textos, updatedById: input.ator.id, updatedByNome: input.ator.nome };
    await tx.timesheetDia.upsert({
      where: { folhaId_data: { folhaId: folha.id, data: dataDb } },
      create: { folhaId: folha.id, data: dataDb, ...valores },
      update: valores,
    });
    await tx.adminAuditLog.create({
      data: auditoria(input.ator, "TIMESHEET_DIA_SALVO", folha.id, profissional.codigo, { ciclo, data, antes, depois: { ...horarios, ...textos } }),
    });
  });
  try {
    await gravar();
  } catch (e) {
    // Duas primeiras gravações simultâneas criam a mesma folha: a perdedora tenta de novo e já encontra a folha.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") await gravar();
    else throw e;
  }
}

/** Fornecedor fecha a folha do ciclo: fica só leitura até a medição reabrir. */
export async function enviarFolha(input: { profissionalId: string | null; ciclo: unknown; ator: Ator; cicloAtivo?: string }) {
  const ciclo = exigirCiclo(input.ciclo);
  const profissional = await exigirHabilitado(input.profissionalId);
  await exigirCicloEmAndamento(ciclo, input.cicloAtivo);
  await prisma.$transaction(async (tx) => {
    const folha = await tx.timesheetFolha.findUnique({
      where: { profissionalId_ciclo: { profissionalId: profissional.id, ciclo } },
      // Dia salvo em branco não conta: precisa de ao menos um período lançado.
      select: { id: true, _count: { select: { dias: { where: { OR: [{ entrada1: { not: null } }, { entrada2: { not: null } }] } } } } },
    });
    if (!folha || folha._count.dias === 0) throw new TimesheetError("Preencha ao menos um dia antes de enviar.", 400);
    const enviada = await tx.timesheetFolha.updateMany({
      where: { id: folha.id, status: "ABERTA" },
      data: { status: "ENVIADA", enviadaAt: new Date(), enviadaPorId: input.ator.id },
    });
    if (enviada.count === 0) throw new TimesheetError("A folha já foi enviada.", 409);
    await tx.adminAuditLog.create({ data: auditoria(input.ator, "TIMESHEET_ENVIADA", folha.id, profissional.codigo, { ciclo }) });
  });
}
