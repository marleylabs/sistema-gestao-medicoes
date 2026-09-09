import "server-only";

import { PrismaClient } from "@prisma/client";
import { generateTempPassword, hashPassword } from "@/lib/auth";
import { notifyFirstAccess } from "@/lib/email";
import { isUuid } from "@/lib/file-security";

export type RotateAndSendFirstAccessInput = {
  db: PrismaClient;
  requestId: unknown;
  usuarioId: string;
  usuarioNome: string;
  usuarioLogin: string;
  email: string;
  adminId: string;
  adminUsuario: string;
  adminNome: string;
};

export type RotateAndSendFirstAccessResult =
  | { ok: true; alreadyProcessed: boolean }
  | { ok: false; status: 400 | 409 | 502; error: string; alreadyProcessed: boolean };

/**
 * Rotaciona a credencial de "primeiro acesso" e envia o e-mail FIRST_ACCESS de forma
 * idempotente por (usuarioId, requestId) — extraído de `app/api/admin/usuarios/[id]/route.ts`
 * para ser testável isoladamente (ver tests/first-access-concurrency.ts) sem precisar de um
 * servidor HTTP real.
 *
 * `requestId` (UUID, gerado pelo frontend UMA VEZ por confirmação do ADMIN) é a identidade real
 * da operação — NUNCA `updatedAt.getTime()` (versão anterior): timestamp de servidor não é
 * identidade robusta de requisição concorrente, porque duas requisições "simultâneas" ainda assim
 * recebem instantes diferentes e nunca colidiriam na trava.
 *
 * Garantia de concorrência: a checagem de "já processado" (via `AdminAuditLog`, reaproveitado
 * como claim — sem migration nova) e a rotação da senha acontecem dentro da MESMA transação,
 * atrás do MESMO advisory lock (`pg_advisory_xact_lock`, mesmo mecanismo já usado por
 * `sendTransactionalEmail` para idempotência de e-mail — nunca alterado/removido do lado do
 * e-mail). Duas chamadas concorrentes com o mesmo (usuarioId, requestId) são serializadas: a
 * segunda só entra depois que a primeira já commitou a transação, e nesse ponto o claim já existe
 * — então a segunda NUNCA rotaciona nem envia de novo. Checar só `email_logs` não seria
 * suficiente: aquele registro só é criado DEPOIS da rotação (o envio real ao provider não pode
 * ficar preso dentro da transação de rotação), deixando uma janela onde as duas requisições
 * veriam "nenhum log ainda" e as duas rotacionariam.
 *
 * Caso documentado (item 9 do pedido de correção): se o processo cair ENTRE a rotação (dentro da
 * transação) e o envio do e-mail (fora dela), o claim fica travado em "PENDENTE" para sempre.
 * Uma nova chamada com o MESMO requestId recebe 409 "em andamento" — nunca reprocessa
 * silenciosamente. A recuperação é uma NOVA confirmação do ADMIN (novo requestId, gerado ao
 * reabrir o modal), nunca um retry automático da mesma chamada.
 */
export async function rotateAndSendFirstAccess(input: RotateAndSendFirstAccessInput): Promise<RotateAndSendFirstAccessResult> {
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  if (!isUuid(requestId)) {
    return { ok: false, status: 400, error: "requestId inválido.", alreadyProcessed: false };
  }
  const idempotencyKey = `first-access/${input.usuarioId}/${requestId}`;

  const rotation = await input.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;

    const existingClaim = await tx.adminAuditLog.findFirst({
      where: { action: "FIRST_ACCESS_SENT", targetId: input.usuarioId, metadata: { path: ["requestId"], equals: requestId } },
      orderBy: { createdAt: "desc" },
    });
    if (existingClaim) {
      return { alreadyProcessed: true as const, claim: existingClaim };
    }

    const senha = generateTempPassword();
    const senhaHash = await hashPassword(senha);
    await tx.usuario.update({
      where: { id: input.usuarioId },
      data: { senhaHash, senhaTemporaria: null, primeiroLogin: true, updatedAt: new Date() },
    });
    const claim = await tx.adminAuditLog.create({
      data: {
        action: "FIRST_ACCESS_SENT",
        adminId: input.adminId,
        adminUsuario: input.adminUsuario,
        adminNome: input.adminNome,
        targetType: "Usuario",
        targetId: input.usuarioId,
        targetCodigo: input.usuarioLogin,
        metadata: { requestId, resultado: "PENDENTE" },
      },
    });
    return { alreadyProcessed: false as const, senha, claimId: claim.id };
  }, { timeout: 20_000, maxWait: 20_000 });

  if (rotation.alreadyProcessed) {
    const resultado = (rotation.claim.metadata as { resultado?: string } | null)?.resultado;
    if (resultado === "SENT") {
      return { ok: true, alreadyProcessed: true };
    }
    if (resultado === "PENDENTE") {
      return { ok: false, status: 409, error: "Esta operação já está em andamento. Aguarde alguns instantes e verifique novamente.", alreadyProcessed: true };
    }
    return {
      ok: false,
      status: 502,
      error: "A senha foi alterada, mas não foi possível enviar o e-mail de primeiro acesso. Clique novamente para gerar uma nova senha e tentar reenviar.",
      alreadyProcessed: true,
    };
  }

  const result = await notifyFirstAccess({
    usuarioId: input.usuarioId,
    nome: input.usuarioNome,
    usuario: input.usuarioLogin,
    email: input.email,
    senhaTemporaria: rotation.senha,
    credentialVersion: requestId,
  });

  await input.db.adminAuditLog.update({
    where: { id: rotation.claimId },
    data: { metadata: { requestId, resultado: result.ok ? "SENT" : "FALHA_ENVIO" } },
  });

  if (!result.ok) {
    return {
      ok: false,
      status: 502,
      error: "A senha foi alterada, mas não foi possível enviar o e-mail de primeiro acesso. Clique novamente para gerar uma nova senha e tentar reenviar.",
      alreadyProcessed: false,
    };
  }
  return { ok: true, alreadyProcessed: false };
}
