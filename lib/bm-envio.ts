import "server-only";

import { prisma } from "@/lib/prisma";
import { notifyBmAvailable } from "@/lib/email";
import { resolveFornecedorEmail } from "@/lib/email/resolve-recipients";
import { logBmAction } from "@/lib/bm-log";

/** Status a partir dos quais o servidor aceita (re)enviar o BM — mesma lista de sempre da rota. */
export const STATUS_REENVIAVEIS_SERVIDOR = ["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA", "CANCELADO"] as const;

export type EnviarBoletimInput = {
  colaboradorCodigo: string;
  ciclo: string;
  usuario: { id?: string; nome?: string };
  /** Tela que originou a ação (sgc_logs.telaOrigem) — informativo, não exibido. */
  telaOrigem: string;
  /** Envio em lote: identifica a confirmação (sgc_logs.observacao do ENVIAR_BM) para replay seguro. */
  requestId?: string;
};

export type EnviarBoletimResult =
  | {
      ok: true;
      sgcId: string;
      status: string;
      colaboradorCodigo: string;
      revisaoNumero: number;
      emailNotificacao: { ok: boolean; testMode: boolean };
      /** Replay da MESMA confirmação de lote: já enviado por ela, nada foi refeito. */
      alreadyProcessed: boolean;
    }
  | { ok: false; httpStatus: 400 | 409; error: string; motivo: "FORNECEDOR_INVALIDO" | "JA_ENVIADO"; statusAtual?: string };

const ERRO_FORNECEDOR = "Fornecedor inexistente ou excluído definitivamente.";
const ERRO_JA_ENVIADO = "Medição já enviada para este fornecedor neste ciclo.";

const marcaLote = (requestId: string) => `lote:${requestId}`;

/**
 * Envio do BM ao fornecedor — fonte única usada pelo envio individual (POST /api/sgc/enviar) e pelo
 * envio em lote (POST /api/sgc/enviar/lote). Comportamento (extraído da rota, sem mudança de regra):
 *  1. o fornecedor precisa ser exatamente um Profissional não excluído com esse código;
 *  2. só (re)envia a partir de AGUARDANDO_ENVIO (ou sem BM), REVISAO_SOLICITADA ou CANCELADO;
 *  3. transição para PENDENTE + statusConferencia AGUARDANDO_UPLOAD (revisão incrementa
 *     revisaoNumero) e limpa divergências de uma rodada anterior;
 *  4. log ENVIAR_BM/REENVIAR_BM e, DEPOIS (fora da transação), o e-mail BM_AVAILABLE + log
 *     EMAIL_ENVIADO/ERRO_EMAIL — falha de e-mail nunca desfaz o envio.
 *
 * Concorrência: checagem de status + transição acontecem numa transação curta atrás de
 * `pg_advisory_xact_lock` por BM (colaboradorCodigo, ciclo), com o status relido dentro da trava.
 * Antes eram leitura e upsert soltos: dois envios simultâneos podiam passar pela checagem — numa
 * revisão, revisaoNumero subia duas vezes. Agora o segundo vê PENDENTE e recebe 409. Nenhuma
 * chamada de rede dentro da transação.
 */
export async function enviarBoletimFornecedor(input: EnviarBoletimInput): Promise<EnviarBoletimResult> {
  const { colaboradorCodigo, ciclo } = input;

  const profissionais = await prisma.profissional.findMany({
    where: { deletedAt: null, OR: [{ codigo: colaboradorCodigo }, { codigo: null, nome: colaboradorCodigo }] },
    select: { nome: true, nomeCompleto: true, email: true },
  });
  const profissional = profissionais.length === 1 ? profissionais[0] : null;
  if (!profissional) {
    return { ok: false, httpStatus: 400, error: ERRO_FORNECEDOR, motivo: "FORNECEDOR_INVALIDO" };
  }

  const lockKey = `bm-envio/${colaboradorCodigo}/${ciclo}`;
  const transicao = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existing = await tx.sgcAprovacaoMedicao.findUnique({
      where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
      select: { id: true, status: true, voltadoAt: true, revisaoNumero: true },
    });

    if (existing && !(STATUS_REENVIAVEIS_SERVIDOR as readonly string[]).includes(existing.status)) {
      return { bloqueado: true as const, existing };
    }

    const isRevisao = existing?.status === "REVISAO_SOLICITADA";
    const now = new Date();
    const sgc = await tx.sgcAprovacaoMedicao.upsert({
      where: { colaboradorCodigo_ciclo: { colaboradorCodigo, ciclo } },
      create: {
        colaboradorCodigo,
        ciclo,
        colaboradorNome: profissional.nomeCompleto || profissional.nome || colaboradorCodigo,
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
      await tx.divergenciaMedicao.deleteMany({ where: { sgcId: sgc.id } });
    }
    return { bloqueado: false as const, existing, sgc, isRevisao };
  });

  if (transicao.bloqueado) {
    const atual = transicao.existing;
    // Replay da MESMA confirmação de lote (duplo clique, "Tentar novamente" após queda de rede):
    // se foi ela que enviou este BM, o resultado é "já enviado nesta operação", sem refazer nada.
    if (input.requestId) {
      const enviadoPorEsta = await prisma.sgcLog.findFirst({
        where: { sgcId: atual.id, acao: { in: ["ENVIAR_BM", "REENVIAR_BM"] }, observacao: marcaLote(input.requestId) },
        select: { id: true },
      });
      if (enviadoPorEsta) {
        return { ok: true, sgcId: atual.id, status: atual.status, colaboradorCodigo, revisaoNumero: atual.revisaoNumero, emailNotificacao: { ok: true, testMode: false }, alreadyProcessed: true };
      }
    }
    return { ok: false, httpStatus: 409, error: ERRO_JA_ENVIADO, motivo: "JA_ENVIADO", statusAtual: atual.status };
  }

  const { existing, sgc, isRevisao } = transicao;
  await logBmAction({
    sgcId: sgc.id,
    colaboradorCodigo,
    ciclo,
    usuarioId: input.usuario.id,
    usuarioNome: input.usuario.nome,
    acao: isRevisao ? "REENVIAR_BM" : "ENVIAR_BM",
    statusAnterior: existing?.status ?? "AGUARDANDO_ENVIO",
    statusNovo: "PENDENTE",
    telaOrigem: input.telaOrigem,
    ...(input.requestId ? { observacao: marcaLote(input.requestId) } : {}),
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
  const recipient = await resolveFornecedorEmail(colaboradorCodigo, profissional.nomeCompleto || profissional.nome);

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
    usuarioId: input.usuario.id,
    usuarioNome: input.usuario.nome,
    acao: emailResult.ok ? "EMAIL_ENVIADO" : "ERRO_EMAIL",
    observacao: emailResult.ok
      ? `Para: ${emailResult.actualRecipients.join(", ")}${emailResult.testMode ? " (modo de teste)" : ""}`
      : emailResult.error,
    telaOrigem: "Sistema",
  });

  return {
    ok: true,
    sgcId: sgc.id,
    status: sgc.status,
    colaboradorCodigo: sgc.colaboradorCodigo,
    revisaoNumero: sgc.revisaoNumero,
    emailNotificacao: { ok: emailResult.ok, testMode: emailResult.testMode },
    alreadyProcessed: false,
  };
}
