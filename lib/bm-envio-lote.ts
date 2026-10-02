import { avaliarElegibilidadeEnvioBm } from "@/lib/bm-envio-elegibilidade";
import { isCicloValido } from "@/lib/ciclo";

/**
 * Envio de BMs EM LOTE (Fornecedores, um ciclo) — só orquestração. A regra é a do envio
 * individual: elegibilidade em lib/bm-envio-elegibilidade.ts e transição + e-mail em
 * `enviarBoletimFornecedor` (lib/bm-envio.ts), injetada como `enviar` pela rota (fakes nos testes).
 *
 * - Itens do mapa reconsultados (`carregar`) e conferidos contra o ciclo do lote: um item de outro
 *   ciclo nunca é enviado, mesmo que o ID venha no payload.
 * - Identidade da operação = o BM (colaboradorCodigo, ciclo). Duas linhas do mapa do mesmo
 *   fornecedor no ciclo são o MESMO BM: enviado uma vez. Fornecedores diferentes nunca colapsam.
 * - Sequencial e espaçado (nunca Promise.all): cada envio abre sua transação curta e chama o
 *   provedor de e-mail, que limita a taxa.
 * - Parcial: falha de um item não desfaz os anteriores.
 * - Resultado sem e-mail, credencial ou erro bruto do provedor.
 */

/**
 * Limite por requisição: sequencial e espaçado (~0,6 s entre envios + transação + e-mail ≈ 1–1,5 s
 * por BM), 50 cabem no tempo de resposta do proxy público (Cloudflare encerra em 100 s) e cobrem o
 * volume real de um ciclo (42 itens no mapa da pré-produção auditada). Acima disso, em partes.
 */
export const LIMITE_ENVIO_BM_LOTE = 50;

/** Resend: 2 requisições/s por padrão — 600 ms entre envios reais mantém o lote abaixo disso. */
export const INTERVALO_ENVIO_BM_MS = 600;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StatusEnvioBmLote = "ENVIADO" | "IGNORADO" | "FALHA";

export type ResultadoEnvioBmLote = {
  id: string;
  nome: string | null;
  status: StatusEnvioBmLote;
  motivo: string;
  /** BM enviado, mas a notificação por e-mail falhou (o envio não é desfeito — regra individual). */
  aviso?: string;
};

export type ResumoEnvioBmLote = {
  totalSelecionados: number;
  enviados: number;
  ignorados: number;
  falhas: number;
  /** Enviados cuja notificação por e-mail falhou. */
  semNotificacao: number;
  resultados: ResultadoEnvioBmLote[];
};

export type ItemEnvioBm = {
  id: string;
  ciclo: string;
  colaboradorCodigo: string | null;
  nome: string | null;
  atualizadoEm: Date | string | null;
  bm: { status: string; statusConferencia: string | null; revisaoSolicitadaAt: Date | string | null } | null;
  /** Este BM já foi enviado pela MESMA confirmação (replay: duplo clique, "Tentar novamente"). */
  enviadoNestaOperacao?: boolean;
};

/** Resultado do service individual, no formato que a orquestração precisa. */
export type EnvioBmResultado =
  | { ok: true; alreadyProcessed: boolean; emailOk: boolean }
  | { ok: false; motivo: string; mensagem: string; statusAtual?: string };

export function normalizarPedidoEnvioBmLote(raw: { ids?: unknown; ciclo?: unknown }):
  | { ok: true; ids: string[]; ciclo: string }
  | { ok: false; error: string } {
  const ciclo = typeof raw.ciclo === "string" ? raw.ciclo.trim() : "";
  // "Geral" não é um ciclo: o lote sempre opera numa competência específica (mesma regra do individual).
  if (!isCicloValido(ciclo)) return { ok: false, error: "Selecione um ciclo específico para enviar BMs em lote." };
  if (!Array.isArray(raw.ids)) return { ok: false, error: "Informe um array de IDs." };
  const ids = [...new Set(raw.ids.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id)))];
  if (ids.length === 0) return { ok: false, error: "Nenhum BM válido informado." };
  if (ids.length > LIMITE_ENVIO_BM_LOTE) return { ok: false, error: `No máximo ${LIMITE_ENVIO_BM_LOTE} BMs por envio. Envie em partes.` };
  return { ok: true, ids, ciclo };
}

const MOTIVO_FALHA = "Não foi possível concluir o envio. Tente novamente.";

export async function processarEnvioBmEmLote(input: {
  ids: string[];
  ciclo: string;
  carregar: (ids: string[]) => Promise<Map<string, ItemEnvioBm>>;
  enviar: (alvo: { colaboradorCodigo: string; ciclo: string }) => Promise<EnvioBmResultado>;
  aguardar?: (ms: number) => Promise<void>;
  intervaloMs?: number;
}): Promise<ResumoEnvioBmLote> {
  const ids = [...new Set(input.ids)];
  const aguardar = input.aguardar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const intervaloMs = input.intervaloMs ?? INTERVALO_ENVIO_BM_MS;
  const itens = await input.carregar(ids);
  const bmsProcessados = new Set<string>();
  const resultados: ResultadoEnvioBmLote[] = [];
  let enviosReais = 0;

  for (const id of ids) {
    const item = itens.get(id);
    if (!item) {
      resultados.push({ id, nome: null, status: "IGNORADO", motivo: "Pagamento não encontrado" });
      continue;
    }
    const nome = item.nome ?? item.colaboradorCodigo;
    if (item.ciclo !== input.ciclo) {
      resultados.push({ id, nome, status: "IGNORADO", motivo: "Não pertence ao ciclo selecionado" });
      continue;
    }
    if (!item.colaboradorCodigo) {
      resultados.push({ id, nome, status: "IGNORADO", motivo: "Fornecedor sem código no mapa de pagamento" });
      continue;
    }
    const chaveBm = `${item.colaboradorCodigo}/${item.ciclo}`;
    if (bmsProcessados.has(chaveBm)) {
      resultados.push({ id, nome, status: "IGNORADO", motivo: "Mesmo BM de outra linha selecionada" });
      continue;
    }
    if (item.enviadoNestaOperacao) {
      // Replay: quem enviou foi esta mesma confirmação — resultado de sucesso, nada é refeito.
      bmsProcessados.add(chaveBm);
      resultados.push({ id, nome, status: "ENVIADO", motivo: "BM já enviado nesta operação" });
      continue;
    }
    const elegibilidade = avaliarElegibilidadeEnvioBm({
      status: item.bm?.status,
      statusConferencia: item.bm?.statusConferencia,
      revisaoSolicitadaAt: item.bm?.revisaoSolicitadaAt,
      itemAtualizadoEm: item.atualizadoEm,
    });
    if (!elegibilidade.elegivel) {
      resultados.push({ id, nome, status: "IGNORADO", motivo: elegibilidade.mensagem });
      continue;
    }
    bmsProcessados.add(chaveBm);

    if (enviosReais > 0 && intervaloMs > 0) await aguardar(intervaloMs);
    enviosReais += 1;
    try {
      const envio = await input.enviar({ colaboradorCodigo: item.colaboradorCodigo, ciclo: item.ciclo });
      if (envio.ok) {
        resultados.push({
          id, nome, status: "ENVIADO",
          motivo: envio.alreadyProcessed ? "BM já enviado nesta operação" : elegibilidade.reenvio ? "BM reenviado" : "BM enviado",
          ...(envio.emailOk ? {} : { aviso: "O e-mail de aviso ao fornecedor não foi enviado" }),
        });
      } else if (envio.motivo === "FORNECEDOR_INVALIDO") {
        resultados.push({ id, nome, status: "IGNORADO", motivo: "Fornecedor inexistente ou excluído definitivamente" });
      } else if (envio.motivo === "JA_ENVIADO") {
        // Revalidado dentro da trava do service: outro usuário/aba enviou antes.
        resultados.push({ id, nome, status: "IGNORADO", motivo: "BM já não estava mais aguardando envio" });
      } else {
        // Demais recusas do service vêm com o motivo da MESMA regra (avaliarElegibilidadeEnvioBm).
        resultados.push({ id, nome, status: "IGNORADO", motivo: envio.mensagem });
      }
    } catch (error) {
      console.error("[bm-envio-lote] envio falhou", { mapaItemId: id, error: error instanceof Error ? error.message : String(error) });
      resultados.push({ id, nome, status: "FALHA", motivo: MOTIVO_FALHA });
    }
  }

  return {
    totalSelecionados: ids.length,
    enviados: resultados.filter((r) => r.status === "ENVIADO").length,
    ignorados: resultados.filter((r) => r.status === "IGNORADO").length,
    falhas: resultados.filter((r) => r.status === "FALHA").length,
    semNotificacao: resultados.filter((r) => r.aviso).length,
    resultados,
  };
}
