import { prisma } from "@/lib/prisma";

type SgcChatSource = {
  pontosDiscordancia?: string | null;
  respostaAdmin?: string | null;
  observacaoColaborador?: string | null;
  revisaoSolicitadaAt?: Date | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
};

type SgcChatLog = {
  id: string;
  acao: string;
  observacao: string | null;
  usuarioId?: string | null;
  tipoMensagem?: string | null;
  audioMime?: string | null;
  audioNome?: string | null;
  usuarioNome: string | null;
  lidoAt?: Date | null;
  createdAt: Date;
};

type SgcChatOptions = {
  fornecedorAvatarUrl?: string | null;
  defaultMedicaoAvatarUrl?: string | null;
  medicaoAvatarUrlsByUsuarioId?: Record<string, string | null>;
};

export async function logBmAction(opts: {
  sgcId?: string;
  colaboradorCodigo: string;
  ciclo?: string;
  usuarioId?: string;
  usuarioNome?: string;
  acao: string;
  statusAnterior?: string;
  statusNovo?: string;
  telaOrigem?: string;
  observacao?: string;
}) {
  try {
    await prisma.sgcLog.create({ data: opts });
  } catch {
    // log errors must never interrupt the main flow
  }
}

export function buildSgcChatMessages(sgc: SgcChatSource, logs: SgcChatLog[], options: SgcChatOptions = {}) {
  const chatActions = new Set(["SOLICITAR_REVISAO", "RESPONDER_REVISAO", "RESPONDER_MEDICAO"]);
  const stableFallbackAt = () => (sgc.revisaoSolicitadaAt ?? sgc.createdAt ?? new Date()).toISOString();
  const messages = logs
    .filter((log) => chatActions.has(log.acao) && !!log.observacao?.trim())
    .map((log) => {
      const isMedicao = log.acao === "RESPONDER_REVISAO";
      return {
        id: log.id,
        autor: isMedicao ? "MEDICAO" : "FORNECEDOR",
        autorNome: isMedicao ? (log.usuarioNome || "Equipe de Medição") : (log.usuarioNome || "Fornecedor"),
        autorAvatarUrl: isMedicao
          ? (log.usuarioId ? options.medicaoAvatarUrlsByUsuarioId?.[log.usuarioId] ?? options.defaultMedicaoAvatarUrl ?? null : options.defaultMedicaoAvatarUrl ?? null)
          : options.fornecedorAvatarUrl ?? null,
        texto: log.observacao?.trim() ?? "",
        tipo: log.tipoMensagem === "AUDIO" ? "AUDIO" : "TEXTO",
        audioUrl: log.tipoMensagem === "AUDIO" ? `/api/sgc/chat/audio/${log.id}` : null,
        audioMime: log.audioMime ?? null,
        audioNome: log.audioNome ?? null,
        lidoAt: log.lidoAt?.toISOString() ?? null,
        criadoAt: log.createdAt.toISOString(),
      };
    });

  const hasText = (texto: string | null | undefined, autor: "MEDICAO" | "FORNECEDOR") =>
    !!texto?.trim() && messages.some((message) => message.autor === autor && message.texto === texto.trim());

  if (sgc.pontosDiscordancia?.trim() && !hasText(sgc.pontosDiscordancia, "FORNECEDOR")) {
    const criadoAt = (sgc.revisaoSolicitadaAt ?? sgc.createdAt ?? new Date()).toISOString();
    messages.unshift({
      id: "pontos-discordancia",
      autor: "FORNECEDOR",
      autorNome: "Fornecedor",
      autorAvatarUrl: options.fornecedorAvatarUrl ?? null,
      texto: sgc.pontosDiscordancia.trim(),
      tipo: "TEXTO",
      audioUrl: null,
      audioMime: null,
      audioNome: null,
      lidoAt: criadoAt,
      criadoAt,
    });
  }

  if (sgc.respostaAdmin?.trim() && !hasText(sgc.respostaAdmin, "MEDICAO")) {
    const criadoAt = stableFallbackAt();
    messages.push({
      id: "resposta-admin",
      autor: "MEDICAO",
      autorNome: "Equipe de Medição",
      autorAvatarUrl: options.defaultMedicaoAvatarUrl ?? null,
      texto: sgc.respostaAdmin.trim(),
      tipo: "TEXTO",
      audioUrl: null,
      audioMime: null,
      audioNome: null,
      lidoAt: criadoAt,
      criadoAt,
    });
  }

  if (sgc.observacaoColaborador?.trim() && sgc.respostaAdmin?.trim() && !hasText(sgc.observacaoColaborador, "FORNECEDOR")) {
    const criadoAt = stableFallbackAt();
    messages.push({
      id: "observacao-colaborador",
      autor: "FORNECEDOR",
      autorNome: "Fornecedor",
      autorAvatarUrl: options.fornecedorAvatarUrl ?? null,
      texto: sgc.observacaoColaborador.trim(),
      tipo: "TEXTO",
      audioUrl: null,
      audioMime: null,
      audioNome: null,
      lidoAt: criadoAt,
      criadoAt,
    });
  }

  return messages.sort((a, b) => new Date(a.criadoAt).getTime() - new Date(b.criadoAt).getTime());
}
