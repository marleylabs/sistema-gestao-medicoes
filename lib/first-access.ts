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
  | { ok: false; status: 400 | 409 | 502; error: string; alreadyProcessed: boolean; motivo?: "ACESSO_JA_DEFINIDO" | "EM_ANDAMENTO" };

/**
 * Por quanto tempo um claim PENDENTE de OUTRA operação (outro requestId) bloqueia uma nova rotação
 * do mesmo usuário. PENDENTE só dura o envio ao provedor (rotação já commitada, e-mail em curso);
 * 2 minutos cobrem essa chamada com folga e, se o processo tiver caído no meio, uma nova
 * confirmação do ADMIN volta a funcionar depois disso (recuperação documentada abaixo).
 */
export const JANELA_OPERACAO_EM_ANDAMENTO_MS = 2 * 60 * 1000;

const ERRO_ACESSO_JA_DEFINIDO = "Este usuário já definiu a própria senha. Para trocar a senha dele, use Redefinir senha.";
const ERRO_EM_ANDAMENTO = "Esta operação já está em andamento. Aguarde alguns instantes e verifique novamente.";

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
 * Trava POR USUÁRIO (`first-access-user/{usuarioId}`): serializa também operações DIFERENTES
 * (outro requestId — dois ADMINs, ou individual + lote) para o mesmo usuário. Dentro dela, um
 * claim PENDENTE de outra operação criado há menos de JANELA_OPERACAO_EM_ANDAMENTO_MS significa
 * "outra rotação já commitada, e-mail ainda saindo": a segunda recebe 409 em vez de gerar uma
 * segunda senha que invalidaria a primeira. A transação continua curta (nenhuma chamada de rede
 * dentro dela); o envio ao provedor segue fora.
 *
 * Regra do domínio (a mesma do botão individual): primeiro acesso só para quem ainda não definiu a
 * própria senha (`primeiroLogin = true`) — relida DENTRO da trava. Quem já definiu recebe 409
 * ACESSO_JA_DEFINIDO e nada muda; trocar a senha dessa pessoa é o fluxo "Redefinir senha".
 *
 * Caso documentado (item 9 do pedido de correção): se o processo cair ENTRE a rotação (dentro da
 * transação) e o envio do e-mail (fora dela), o claim fica travado em "PENDENTE" para sempre.
 * Uma nova chamada com o MESMO requestId recebe 409 "em andamento" — nunca reprocessa
 * silenciosamente. A recuperação é uma NOVA confirmação do ADMIN (novo requestId, gerado ao
 * reabrir o modal), nunca um retry automático da mesma chamada — aceita depois da janela acima.
 */
export async function rotateAndSendFirstAccess(input: RotateAndSendFirstAccessInput): Promise<RotateAndSendFirstAccessResult> {
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  if (!isUuid(requestId)) {
    return { ok: false, status: 400, error: "requestId inválido.", alreadyProcessed: false };
  }
  const lockKey = `first-access-user/${input.usuarioId}`;

  const rotation = await input.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existingClaim = await tx.adminAuditLog.findFirst({
      where: { action: "FIRST_ACCESS_SENT", targetId: input.usuarioId, metadata: { path: ["requestId"], equals: requestId } },
      orderBy: { createdAt: "desc" },
    });
    if (existingClaim) {
      return { alreadyProcessed: true as const, claim: existingClaim };
    }

    const alvo = await tx.usuario.findUnique({ where: { id: input.usuarioId }, select: { primeiroLogin: true } });
    if (!alvo?.primeiroLogin) {
      return { alreadyProcessed: false as const, bloqueio: "ACESSO_JA_DEFINIDO" as const };
    }
    const outraEmAndamento = await tx.adminAuditLog.findFirst({
      where: {
        action: "FIRST_ACCESS_SENT",
        targetId: input.usuarioId,
        metadata: { path: ["resultado"], equals: "PENDENTE" },
        createdAt: { gte: new Date(Date.now() - JANELA_OPERACAO_EM_ANDAMENTO_MS) },
      },
      select: { id: true },
    });
    if (outraEmAndamento) {
      return { alreadyProcessed: false as const, bloqueio: "EM_ANDAMENTO" as const };
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
      return { ok: false, status: 409, error: ERRO_EM_ANDAMENTO, alreadyProcessed: true, motivo: "EM_ANDAMENTO" };
    }
    return {
      ok: false,
      status: 502,
      error: "A senha foi alterada, mas não foi possível enviar o e-mail de primeiro acesso. Clique novamente para gerar uma nova senha e tentar reenviar.",
      alreadyProcessed: true,
    };
  }

  if ("bloqueio" in rotation) {
    return rotation.bloqueio === "ACESSO_JA_DEFINIDO"
      ? { ok: false, status: 409, error: ERRO_ACESSO_JA_DEFINIDO, alreadyProcessed: false, motivo: "ACESSO_JA_DEFINIDO" }
      : { ok: false, status: 409, error: ERRO_EM_ANDAMENTO, alreadyProcessed: false, motivo: "EM_ANDAMENTO" };
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
