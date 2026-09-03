import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { notifyBmAvailable } from "@/lib/email";
import { resolveFornecedorEmail } from "@/lib/email/resolve-recipients";
import { logBmAction } from "@/lib/bm-log";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const colaboradorCodigo = typeof payload?.colaboradorCodigo === "string" ? payload.colaboradorCodigo.trim() : "";
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "2605";

  if (!colaboradorCodigo) {
    return NextResponse.json({ error: "ID do fornecedor é obrigatório." }, { status: 400 });
  }

  const profissionais = await prisma.profissional.findMany({
    where: { deletedAt: null, OR: [{ codigo: colaboradorCodigo }, { codigo: null, nome: colaboradorCodigo }] },
    select: { nome: true, nomeCompleto: true, email: true },
  });
  const profissional = profissionais.length === 1 ? profissionais[0] : null;
  if (!profissional) {
    return NextResponse.json({ error: "Fornecedor inexistente ou excluído definitivamente." }, { status: 400 });
  }

  const existing = await prisma.sgcAprovacaoMedicao.findUnique({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
    select: { id: true, status: true, voltadoAt: true },
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
      statusConferencia: "AGUARDANDO_UPLOAD",
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
      statusConferencia: "AGUARDANDO_UPLOAD",
      conferenciaArquivo: null,
      conferenciaArquivoNome: null,
      conferenciaCarregadoAt: null,
      updatedAt: now,
    },
  });

  if (existing) {
    // Reenvio pós-revisão: descarta divergências de uma rodada de conferência anterior
    // para que o próximo upload comece limpo, sem misturar decisões de ciclos diferentes.
    await prisma.divergenciaMedicao.deleteMany({ where: { sgcId: sgc.id } });
  }

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

  // BM_AVAILABLE: momento real em que o fornecedor ganha uma ação disponível na plataforma —
  // início da conferência documental (upload da máscara), não a aprovação final. A política de
  // teste/produção e a auditoria vivem centralizadas em lib/email; falha aqui nunca desfaz o
  // envio do BM já concluído acima.
  //
  // O e-mail é resolvido por colaborador_codigo via resolveFornecedorEmail (CadastroFornecedor
  // primeiro, Profissional como fallback) — NUNCA mais a busca antiga por
  // `profissional.findUnique({ where: { codigo } })`, que falhava silenciosamente sempre que
  // Profissional.codigo estava vazio (caso comum nos registros importados pelo ETL) mesmo quando
  // o Administrativo já tinha o e-mail cadastrado em CadastroFornecedor.
  const recipient = await resolveFornecedorEmail(colaboradorCodigo, profissional?.nomeCompleto || profissional?.nome);

  const emailResult = await notifyBmAvailable({
    sgcId: sgc.id,
    colaboradorCodigo,
    ciclo,
    nome: recipient.nome,
    email: recipient.email,
    revisao: sgc.revisaoNumero,
    // "Retornar BM" (VOLTAR_BM em app/api/admin/financeiro/route.ts) volta o status para
    // AGUARDANDO_ENVIO sem passar por REVISAO_SOLICITADA — isRevisao fica false, revisaoNumero
    // não incrementa, e sem isto a chave de idempotência (sgcId+revisao) ficaria IDÊNTICA à do
    // envio original, fazendo o reenvio ser silenciosamente descartado como duplicata (bug real
    // encontrado nesta sessão: "Retornar BM" seguido de "Enviar BM" nunca notificava de novo).
    // voltadoAt muda a cada "Retornar BM" e é estável entre retries do mesmo ciclo de reenvio —
    // não mexe em revisaoNumero (que continua só para revisão de verdade solicitada pelo fornecedor).
    retornadoEm: existing?.voltadoAt ?? null,
  });
  await logBmAction({
    sgcId: sgc.id,
    colaboradorCodigo,
    ciclo,
    usuarioId: admin.user?.id,
    usuarioNome: admin.user?.nome,
    acao: emailResult.ok ? "EMAIL_ENVIADO" : "ERRO_EMAIL",
    observacao: emailResult.ok
      ? `Para: ${emailResult.actualRecipients.join(", ")}${emailResult.testMode ? " (modo de teste)" : ""}`
      : emailResult.error,
    telaOrigem: "Sistema",
  });

  return NextResponse.json({
    status: sgc.status,
    colaboradorCodigo: sgc.colaboradorCodigo,
    revisaoNumero: sgc.revisaoNumero,
    emailNotificacao: { ok: emailResult.ok, testMode: emailResult.testMode },
  });
}
