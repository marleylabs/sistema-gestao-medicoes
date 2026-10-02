import { getMapaPagamentoStatusMeta } from "@/lib/sgc-display-status";

/**
 * Elegibilidade do "Enviar BM" em lote — a MESMA regra que hoje decide se o botão individual
 * "Enviar BM"/"Reenviar BM" aparece habilitado no detalhe (MapaItemActions):
 *  - sem BM no ciclo ou status AGUARDANDO_ENVIO → enviar;
 *  - REVISAO_SOLICITADA → reenviar, mas só se o pagamento foi alterado depois do pedido de revisão
 *    (o botão individual fica desabilitado: "Faça alguma alteração no pagamento antes de reenviar");
 *  - qualquer outro status → o BM já está com o fornecedor (ou concluído/cancelado): não envia.
 * CANCELADO é aceito pela rota, mas nunca é oferecido pelo botão — o lote segue o botão.
 * Regra de status pelo enum real (nunca pelo rótulo "Aguardando envio"). Puro: tela e servidor.
 * Antes de tudo: fornecedor com cadastro pendente de vínculo (identidade da importação) não envia.
 * Nada aqui vem do primeiro acesso — regras independentes.
 */

/**
 * "Pagamento alterado depois do pedido de revisão" é avaliado no nível do BM: a alteração mais
 * recente entre TODAS as linhas do fornecedor no ciclo. O servidor calcula o mesmo valor no banco
 * (`_max.updatedAt` em lib/bm-envio.ts e na rota do lote); a tela usa esta função sobre as linhas
 * do ciclo que já carregou — nunca só a linha aberta.
 */
export function ultimaAlteracaoDoBm(
  linhasDoCiclo: { projetistaCodigo?: string | null; updatedAt?: string | Date | null }[],
  colaboradorCodigo: string | null | undefined,
): Date | null {
  if (!colaboradorCodigo) return null;
  let maisRecente: Date | null = null;
  for (const linha of linhasDoCiclo) {
    if (linha.projetistaCodigo !== colaboradorCodigo || !linha.updatedAt) continue;
    const data = new Date(linha.updatedAt);
    if (!Number.isNaN(data.getTime()) && (!maisRecente || data > maisRecente)) maisRecente = data;
  }
  return maisRecente;
}

export type MotivoInelegivelEnvioBm = "CADASTRO_PENDENTE" | "REVISAO_SEM_ALTERACAO" | "JA_ENVIADO" | "CANCELADO";

/** Fornecedor do ciclo ainda sem vínculo cadastral (identidade PENDENTE da importação). */
export const MENSAGEM_CADASTRO_PENDENTE = "Cadastro pendente de vínculo. Vincule este registro a um cadastro para liberar o envio do BM.";

export type ElegibilidadeEnvioBm =
  | { elegivel: true; reenvio: boolean }
  | { elegivel: false; motivo: MotivoInelegivelEnvioBm; mensagem: string };

export function avaliarElegibilidadeEnvioBm(input: {
  /** Status atual do BM no ciclo (null/undefined = ainda não existe = Aguardando envio). */
  status: string | null | undefined;
  statusConferencia?: string | null;
  revisaoSolicitadaAt?: string | Date | null;
  /** updatedAt do item do mapa de pagamento (a linha selecionada). */
  itemAtualizadoEm?: string | Date | null;
  /** Linha de identidade PENDENTE da importação (sem cadastro): nunca recebe BM, qualquer que seja o status. */
  cadastroPendente?: boolean;
}): ElegibilidadeEnvioBm {
  if (input.cadastroPendente) return { elegivel: false, motivo: "CADASTRO_PENDENTE", mensagem: MENSAGEM_CADASTRO_PENDENTE };
  const status = input.status ?? "AGUARDANDO_ENVIO";
  if (status === "AGUARDANDO_ENVIO") return { elegivel: true, reenvio: false };
  if (status === "REVISAO_SOLICITADA") {
    const alterado = input.revisaoSolicitadaAt && input.itemAtualizadoEm
      ? new Date(input.itemAtualizadoEm) > new Date(input.revisaoSolicitadaAt)
      : true;
    return alterado
      ? { elegivel: true, reenvio: true }
      : { elegivel: false, motivo: "REVISAO_SEM_ALTERACAO", mensagem: "Revisão solicitada: altere o pagamento antes de reenviar" };
  }
  if (status === "CANCELADO") return { elegivel: false, motivo: "CANCELADO", mensagem: "BM cancelado neste ciclo" };
  const rotulo = getMapaPagamentoStatusMeta(status, input.statusConferencia).label;
  return { elegivel: false, motivo: "JA_ENVIADO", mensagem: `BM já enviado (${rotulo})` };
}
