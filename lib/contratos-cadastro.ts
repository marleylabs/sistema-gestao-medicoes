import "server-only";

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/session";
import { isUuid } from "@/lib/file-security";

/**
 * Cadastro de contratos (aba Contratos do Administrativo; spec docs/brain/specs/contratos-cadastro.md).
 * Não há exclusão: o contrato sai de uso por inativação, preservando feriados e configurações do timesheet.
 */

export class ContratoError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

export function respostaContratoErro(e: unknown) {
  if (e instanceof ContratoError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

type Ator = Pick<AuthUser, "id" | "usuario" | "nome">;

const SELECT = {
  id: true, nome: true, codigo: true, gestor: true, fiscal: true, dataInicio: true, dataFim: true, valorTotal: true, ativo: true,
  fiscalId: true, fiscalUsuario: { select: { nome: true } },
} as const;

type Linha = Prisma.ContratoGetPayload<{ select: typeof SELECT }>;

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
function serializar({ fiscalUsuario, ...c }: Linha) {
  // `fiscal` exibido = o usuário FISCAL vinculado; o texto antigo só quando não há vínculo.
  return { ...c, fiscal: fiscalUsuario?.nome ?? c.fiscal, dataInicio: iso(c.dataInicio), dataFim: iso(c.dataFim), valorTotal: c.valorTotal?.toFixed(2) ?? null };
}
export type ContratoCadastro = ReturnType<typeof serializar>;

function texto(v: unknown, rotulo: string) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new ContratoError(`${rotulo} inválido.`, 400);
  const t = v.trim();
  if (t.length > 200) throw new ContratoError(`${rotulo}: até 200 caracteres.`, 400);
  return t || null;
}

function data(v: unknown, rotulo: string) {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || iso(d) !== v) throw new ContratoError(`${rotulo} inválida.`, 400);
  return d;
}

/** Aceita "1234.56", "1234,56" e "1.234,56"; nunca passa por float. */
export function valorContratual(v: unknown) {
  if (v === null || v === undefined || v === "") return null;
  const bruto = typeof v === "string" ? v.trim() : "";
  const normal = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(normal)) throw new ContratoError("Valor contratual inválido. Use até 2 casas decimais.", 400);
  return new Prisma.Decimal(normal);
}

/** Campos enviados no body; os ausentes ficam de fora (atualização parcial). */
function lerCampos(body: Record<string, unknown>) {
  const campos: Prisma.ContratoUncheckedUpdateInput = {};
  if ("nome" in body) {
    const nome = texto(body.nome, "Nome do contrato");
    if (!nome) throw new ContratoError("Informe o nome do contrato.", 400);
    campos.nome = nome;
  }
  if ("codigo" in body) campos.codigo = texto(body.codigo, "Nº do contrato");
  if ("gestor" in body) campos.gestor = texto(body.gestor, "Gestor");
  if ("fiscal" in body) campos.fiscal = texto(body.fiscal, "Fiscal");
  if ("fiscalId" in body) {
    if (body.fiscalId !== null && body.fiscalId !== "" && (typeof body.fiscalId !== "string" || !isUuid(body.fiscalId))) throw new ContratoError("Fiscal inválido.", 400);
    campos.fiscalId = body.fiscalId || null;
  }
  if ("dataInicio" in body) campos.dataInicio = data(body.dataInicio, "Data de início");
  if ("dataFim" in body) campos.dataFim = data(body.dataFim, "Data de término");
  if ("valorTotal" in body) campos.valorTotal = valorContratual(body.valorTotal);
  if ("ativo" in body) {
    if (typeof body.ativo !== "boolean") throw new ContratoError("Situação inválida.", 400);
    campos.ativo = body.ativo;
  }
  return campos;
}

function exigirVigencia(inicio: Date | null | undefined, fim: Date | null | undefined) {
  if (inicio && fim && fim < inicio) throw new ContratoError("A data de término não pode ser anterior à de início.", 400);
}

function auditoria(ator: Ator, action: string, id: string, codigo: string | null, metadata: object) {
  return { action, adminId: ator.id, adminUsuario: ator.usuario, adminNome: ator.nome, targetType: "CONTRATO", targetId: id, targetCodigo: codigo, metadata };
}

/** O fiscal do contrato precisa ser um usuário FISCAL ativo. */
async function exigirFiscalValido(tx: Prisma.TransactionClient, fiscalId: unknown) {
  if (typeof fiscalId !== "string") return;
  const ok = await tx.usuario.findFirst({ where: { id: fiscalId, perfil: "FISCAL", ativo: true, excluidoAt: null }, select: { id: true } });
  if (!ok) throw new ContratoError("Fiscal não encontrado ou inativo.", 400);
}

function conflitoDeNome(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ContratoError("Já existe um contrato com esse nome.", 409);
  throw e;
}

export async function listarContratos() {
  return (await prisma.contrato.findMany({ select: SELECT, orderBy: { nome: "asc" } })).map(serializar);
}

export async function criarContrato(input: { body: unknown; ator: Ator }) {
  const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : {};
  const campos = lerCampos({ nome: body.nome ?? null, ...body });
  exigirVigencia(campos.dataInicio as Date | null, campos.dataFim as Date | null);
  try {
    return await prisma.$transaction(async (tx) => {
      await exigirFiscalValido(tx, campos.fiscalId);
      const criado = await tx.contrato.create({ data: campos as Prisma.ContratoUncheckedCreateInput, select: SELECT });
      const c = serializar(criado);
      await tx.adminAuditLog.create({ data: auditoria(input.ator, "CONTRATO_CRIADO", c.id, c.codigo, { depois: c }) });
      return c;
    });
  } catch (e) {
    conflitoDeNome(e);
  }
}

export async function atualizarContrato(input: { id: string; body: unknown; ator: Ator }) {
  const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : {};
  const campos = lerCampos(body);
  try {
    return await prisma.$transaction(async (tx) => {
      const antes = await tx.contrato.findUnique({ where: { id: input.id }, select: SELECT });
      if (!antes) throw new ContratoError("Contrato não encontrado.", 404);
      if (campos.fiscalId !== antes.fiscalId) await exigirFiscalValido(tx, campos.fiscalId);
      exigirVigencia(
        "dataInicio" in campos ? (campos.dataInicio as Date | null) : antes.dataInicio,
        "dataFim" in campos ? (campos.dataFim as Date | null) : antes.dataFim,
      );
      const depois = serializar(await tx.contrato.update({ where: { id: input.id }, data: { ...campos, updatedAt: new Date() }, select: SELECT }));
      const acao = "ativo" in campos && campos.ativo !== antes.ativo ? (campos.ativo ? "CONTRATO_REATIVADO" : "CONTRATO_INATIVADO") : "CONTRATO_ATUALIZADO";
      await tx.adminAuditLog.create({ data: auditoria(input.ator, acao, depois.id, depois.codigo, { antes: serializar(antes), depois }) });
      return depois;
    });
  } catch (e) {
    conflitoDeNome(e);
  }
}
