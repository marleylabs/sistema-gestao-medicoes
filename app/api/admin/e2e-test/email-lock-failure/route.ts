import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { __setEmailLockFailureInjectionForTests } from "@/lib/email/send-email";

/**
 * Rota EXCLUSIVA de teste — liga/desliga a injeção proposital de falha do advisory
 * lock/transação de idempotência de e-mail, para e2e/bm-email-lock-failure.spec.ts provar que uma
 * falha real nessa camada bloqueia o envio (nunca cai para um caminho sem trava).
 *
 * `__setEmailLockFailureInjectionForTests` já se recusa a fazer qualquer coisa fora de
 * NODE_ENV !== "production" && ALLOW_E2E_DATABASE === "true" — o guard abaixo é uma segunda
 * camada (404, nem revela que a rota existe) para produção nunca alcançar este código.
 *
 * IMPORTANTE: uma pasta prefixada com "_" (ex.: "_test") é tratada pelo App Router do Next.js
 * como pasta privada e EXCLUÍDA do roteamento — por isso "e2e-test" (sem underscore) aqui.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  if (process.env.NODE_ENV === "production" || process.env.ALLOW_E2E_DATABASE !== "true") {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const enabled = body?.enabled === true;
  __setEmailLockFailureInjectionForTests(enabled);
  return NextResponse.json({ ok: true, enabled });
}
