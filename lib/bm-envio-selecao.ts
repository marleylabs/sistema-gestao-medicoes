import { avaliarElegibilidadeEnvioBm, ultimaAlteracaoDoBm, type ElegibilidadeEnvioBm } from "@/lib/bm-envio-elegibilidade";

/**
 * Seleção do "Enviar BMs" em lote na tela Fornecedores — funções puras (sem React) para a tela e
 * para os testes. A tabela de Fornecedores não tinha seleção para nenhuma outra ação, então o
 * checkbox significa só "incluir no envio em lote de BM": inaptos ficam desabilitados e o
 * "selecionar todos" marca apenas os aptos da visualização filtrada.
 */

export type LinhaEnvioBm = {
  id: string;
  projetistaCodigo?: string | null;
  updatedAt?: string | Date | null;
  /** Identidade PENDENTE da importação (sem cadastro): checkbox desabilitado com o motivo. */
  cadastroPendente?: boolean;
};

export type StatusBmDaLinha = { status?: string | null; statusConferencia?: string | null } | undefined;

export function elegibilidadeDaLinha(
  item: LinhaEnvioBm,
  bm: StatusBmDaLinha,
  revisaoSolicitadaAt: string | Date | null | undefined,
  /** Linhas do ciclo carregado: a alteração do BM é a mais recente entre as do mesmo fornecedor. */
  linhasDoCiclo: LinhaEnvioBm[] = [item],
): ElegibilidadeEnvioBm {
  return avaliarElegibilidadeEnvioBm({
    status: bm?.status,
    statusConferencia: bm?.statusConferencia,
    revisaoSolicitadaAt,
    itemAtualizadoEm: ultimaAlteracaoDoBm(linhasDoCiclo, item.projetistaCodigo) ?? item.updatedAt ?? null,
    cadastroPendente: item.cadastroPendente,
  });
}

/** Cabeçalho: todos/nenhum/parte dos APTOS da visualização (inaptos não contam). */
export function estadoCabecalho(aptosVisiveis: string[], selecionados: Set<string>): "checked" | "unchecked" | "indeterminate" {
  if (aptosVisiveis.length === 0) return "unchecked";
  const marcados = aptosVisiveis.filter((id) => selecionados.has(id)).length;
  if (marcados === 0) return "unchecked";
  return marcados === aptosVisiveis.length ? "checked" : "indeterminate";
}

/** Clique no cabeçalho: marcado → desmarca os aptos visíveis; senão marca todos os aptos visíveis. */
export function alternarTodosAptos(aptosVisiveis: string[], selecionados: Set<string>): Set<string> {
  const next = new Set(selecionados);
  const todos = aptosVisiveis.length > 0 && aptosVisiveis.every((id) => next.has(id));
  for (const id of aptosVisiveis) {
    if (todos) next.delete(id);
    else next.add(id);
  }
  return next;
}

/**
 * Prévia da confirmação: cada linha selecionada com a regra do botão individual; uma segunda linha
 * do MESMO fornecedor no ciclo é o mesmo BM (o servidor também envia uma vez só).
 */
export function previaEnvioBm<T extends LinhaEnvioBm>(
  selecionados: T[],
  avaliar: (item: T) => ElegibilidadeEnvioBm,
): { item: T; elegivel: boolean; motivo?: string }[] {
  const vistos = new Set<string>();
  return selecionados.map((item) => {
    const avaliacao = avaliar(item);
    if (!avaliacao.elegivel) return { item, elegivel: false, motivo: avaliacao.mensagem };
    const codigo = item.projetistaCodigo ?? "";
    if (!codigo) return { item, elegivel: false, motivo: "Fornecedor sem código no mapa de pagamento" };
    if (vistos.has(codigo)) return { item, elegivel: false, motivo: "Mesmo BM de outra linha selecionada" };
    vistos.add(codigo);
    return { item, elegivel: true };
  });
}
