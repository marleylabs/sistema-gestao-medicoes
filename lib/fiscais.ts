import "server-only";

import { prisma } from "@/lib/prisma";
import { decryptSensitive } from "@/lib/encryption";
import { rotateAndSendFirstAccess } from "@/lib/first-access";
import { isValidEmail } from "@/lib/usuario-email-policy";
import { criarUsuarioInterno } from "@/lib/usuario-provisioning";
import type { AuthUser } from "@/lib/session";

/**
 * Cadastro dos fiscais (aba "Fiscais" do Administrativo; spec docs/brain/specs/timesheet-aprovacao-fiscal.md).
 * O fiscal é um `Usuario` com perfil FISCAL e login P0; o acesso vai pelo mesmo primeiro acesso dos funcionários.
 */

type Ator = Pick<AuthUser, "id" | "usuario" | "nome">;
type Falha = { ok: false; status: number; error: string };

export async function listarFiscais() {
  const fiscais = await prisma.usuario.findMany({
    where: { perfil: "FISCAL", excluidoAt: null },
    select: {
      id: true, usuario: true, nome: true, ativo: true, primeiroLogin: true, email: true, ultimoLoginAt: true,
      contratosFiscalizados: { select: { nome: true }, orderBy: { nome: "asc" } },
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
  return fiscais.map((f) => ({
    id: f.id, usuario: f.usuario, nome: f.nome, ativo: f.ativo, primeiroLogin: f.primeiroLogin,
    email: decryptSensitive(f.email),
    ultimoLoginAt: f.ultimoLoginAt?.toISOString() ?? null,
    contratos: f.contratosFiscalizados.map((c) => c.nome),
  }));
}
export type FiscalCadastro = Awaited<ReturnType<typeof listarFiscais>>[number];

/** Nome e e-mail obrigatórios: o acesso só chega por e-mail. */
export async function criarFiscal(input: { nome: unknown; email: unknown; ator: Ator }) {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!email || !isValidEmail(email)) return { ok: false, status: 400, error: "Informe um e-mail válido: o acesso do fiscal é enviado por e-mail." } satisfies Falha;
  const criado = await criarUsuarioInterno({ nome: input.nome, perfil: "FISCAL", email });
  if (!criado.ok) return criado;
  await prisma.adminAuditLog.create({
    data: {
      action: "FISCAL_CRIADO", adminId: input.ator.id, adminUsuario: input.ator.usuario, adminNome: input.ator.nome,
      targetType: "USUARIO", targetId: criado.usuario.id, targetCodigo: criado.usuario.usuario, metadata: { nome: criado.usuario.nome },
    },
  });
  return { ok: true as const, status: 201, fiscal: { id: criado.usuario.id, usuario: criado.usuario.usuario, nome: criado.usuario.nome } };
}

async function exigirFiscal(id: string) {
  return prisma.usuario.findFirst({ where: { id, perfil: "FISCAL", excluidoAt: null }, select: { id: true, nome: true, usuario: true, email: true, ativo: true } });
}

/** Ativa/inativa (inativo não entra; os contratos continuam apontando para ele até o Administrativo trocar). */
export async function definirFiscalAtivo(input: { id: string; ativo: unknown; ator: Ator }) {
  if (typeof input.ativo !== "boolean") return { ok: false, status: 400, error: "Situação inválida." } satisfies Falha;
  const fiscal = await exigirFiscal(input.id);
  if (!fiscal) return { ok: false, status: 404, error: "Fiscal não encontrado." } satisfies Falha;
  await prisma.$transaction([
    prisma.usuario.update({ where: { id: fiscal.id }, data: { ativo: input.ativo, updatedAt: new Date() } }),
    prisma.adminAuditLog.create({
      data: {
        action: input.ativo ? "FISCAL_REATIVADO" : "FISCAL_INATIVADO", adminId: input.ator.id, adminUsuario: input.ator.usuario, adminNome: input.ator.nome,
        targetType: "USUARIO", targetId: fiscal.id, targetCodigo: fiscal.usuario, metadata: { nome: fiscal.nome },
      },
    }),
  ]);
  return { ok: true as const };
}

/** Mesmo procedimento do primeiro acesso dos funcionários (idempotente por requestId). */
export async function enviarPrimeiroAcessoFiscal(input: { id: string; requestId: unknown; ator: Ator }) {
  const fiscal = await exigirFiscal(input.id);
  if (!fiscal) return { ok: false, status: 404, error: "Fiscal não encontrado." } satisfies Falha;
  if (!fiscal.ativo) return { ok: false, status: 409, error: "Reative o fiscal antes de enviar o acesso." } satisfies Falha;
  const email = decryptSensitive(fiscal.email);
  if (!email) return { ok: false, status: 409, error: "Este fiscal não possui e-mail cadastrado." } satisfies Falha;
  const r = await rotateAndSendFirstAccess({
    db: prisma, requestId: input.requestId, usuarioId: fiscal.id, usuarioNome: fiscal.nome, usuarioLogin: fiscal.usuario, email,
    adminId: input.ator.id, adminUsuario: input.ator.usuario, adminNome: input.ator.nome,
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.error } satisfies Falha;
  return { ok: true as const, alreadyProcessed: r.alreadyProcessed };
}
