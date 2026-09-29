import type { Prisma } from "@prisma/client";

export const FORNECEDOR_INATIVO_MENSAGEM =
  "Fornecedor inativo. Reative o fornecedor no Administrativo antes de incluí-lo em uma nova medição.";

/**
 * Inativação explícita: a identidade canônica do Profissional já resolvido possui CadastroFornecedor
 * e nenhum está ativo. Profissional legado, sem qualquer cadastro, não é considerado inativo. Nunca
 * decide por CNPJ nem pelo texto bruto do request. A chave é `Profissional.codigo`; Profissional
 * legado sem `codigo` usa `nome` — mesma chave `codigo || nome` de lib/cadastro-fornecedor.ts e
 * de `resolveProjetistaCodigo` (lib/mapa-pagamento.ts).
 */
export async function isFornecedorInativo(
  client: Pick<Prisma.TransactionClient, "cadastroFornecedor">,
  profissional: { codigo: string | null; nome: string },
) {
  const codigoCanonico = profissional.codigo || profissional.nome;
  if (!codigoCanonico) return false;
  const cadastros = await client.cadastroFornecedor.findMany({
    where: { colaboradorCodigo: codigoCanonico },
    select: { ativo: true },
  });
  return cadastros.length > 0 && !cadastros.some((item) => item.ativo);
}
