import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { sendEmail, bmDisponivel } from "@/lib/email";
import { logBmAction } from "@/lib/bm-log";
import { decryptSensitive } from "@/lib/encryption";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const colaboradorCodigo = typeof payload?.colaboradorCodigo === "string" ? payload.colaboradorCodigo.trim() : "";
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "2605";

  if (!colaboradorCodigo) {
    return NextResponse.json({ error: "Código do fornecedor é obrigatório." }, { status: 400 });
  }

  const profissional = await prisma.profissional.findUnique({
    where: { codigo: colaboradorCodigo },
    select: { nome: true, nomeCompleto: true, email: true },
  });

  const existing = await prisma.sgcAprovacaoMedicao.findUnique({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
    select: { id: true, status: true },
  });

  if (existing && !["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA", "CANCELADO"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Medição já enviada para este fornecedor neste ciclo." },
      { status: 409 },
    );
  }

  const isRevisao = existing?.status === "REVISAO_SOLICITADA";
  const now = new Date();

  const sgc = await prisma.sgcAprovacaoMedicao.upsert({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
    create: {
      colaboradorCodigo,
      ciclo,
      colaboradorNome: profissional?.nomeCompleto || profissional?.nome || colaboradorCodigo,
      status: "PENDENTE",
      revisaoNumero: 0,
    },
    update: {
      status: "PENDENTE",
      pontosDiscordancia: null,
      revisaoSolicitadaAt: null,
      aprovadoAt: null,
      salvoAt: null,
      reenviadoAt: isRevisao ? now : undefined,
      resolvidoAt: isRevisao ? now : undefined,
      revisaoNumero: isRevisao ? { increment: 1 } : undefined,
      updatedAt: now,
    },
  });

  await logBmAction({
    sgcId: sgc.id,
    colaboradorCodigo,
    ciclo,
    usuarioId: admin.user?.id,
    usuarioNome: admin.user?.nome,
    acao: isRevisao ? "REENVIAR_BM" : "ENVIAR_BM",
    statusAnterior: existing?.status ?? "AGUARDANDO_ENVIO",
    statusNovo: "PENDENTE",
    telaOrigem: "Medições / Admin",
  });

  // Send email notification. During testing, BM_EMAIL_TEST_TO redirects all BM notices to a safe inbox.
  const emailRaw = profissional?.email;
  const email = decryptSensitive(emailRaw) ?? emailRaw;
  const testEmail = process.env.BM_EMAIL_TEST_TO?.trim();
  const emailDestino = testEmail || email;
  const nome = profissional?.nomeCompleto || profissional?.nome || colaboradorCodigo;

  if (emailDestino) {
    const result = await sendEmail({
      to: emailDestino,
      subject: "Nova medição disponível para análise",
      html: bmDisponivel(nome, { ciclo, colaboradorCodigo }),
    });
    await logBmAction({
      sgcId: sgc.id,
      colaboradorCodigo,
      ciclo,
      usuarioId: admin.user?.id,
      usuarioNome: admin.user?.nome,
      acao: result.ok ? "EMAIL_ENVIADO" : "ERRO_EMAIL",
      observacao: result.ok
        ? `Para: ${emailDestino}${testEmail && email ? ` | Destinatário real: ${email}` : ""}`
        : result.error,
      telaOrigem: "Sistema",
    });
  }

  return NextResponse.json({
    status: sgc.status,
    colaboradorCodigo: sgc.colaboradorCodigo,
    revisaoNumero: sgc.revisaoNumero,
    emailNotificacao: emailDestino ? { to: emailDestino, teste: !!testEmail } : null,
  });
}
