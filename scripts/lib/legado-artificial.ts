import type { PrismaClient } from "@prisma/client";

/**
 * "Legado operacional artificial": Profissional criado pelo ETL antigo a partir do nome escrito na
 * planilha (upsert do BM AUX gravava `{ nome: X, codigo: X }`) — NÃO é uma identidade administrativa.
 * Critério estrito, todos obrigatórios:
 *   - não excluído; `codigo` igual a `nome` (ou sem código);
 *   - sem nome completo, razão social, CNPJ, CPF e e-mail;
 *   - nenhum CadastroFornecedor com esse código e nenhum Usuario com esse nome.
 * Um Profissional canônico real sempre tem CadastroFornecedor e, por isso, nunca se encaixa.
 */
export async function isLegadoOperacionalArtificial(
  prisma: Pick<PrismaClient, "profissional" | "cadastroFornecedor" | "usuario">,
  profissionalId: string,
) {
  const p = await prisma.profissional.findUnique({
    where: { id: profissionalId },
    select: { nome: true, codigo: true, nomeCompleto: true, razaoSocial: true, cnpj: true, cpf: true, email: true, deletedAt: true },
  });
  if (!p || p.deletedAt) return false;
  if (p.codigo && p.codigo.trim().toUpperCase() !== p.nome.trim().toUpperCase()) return false;
  if (p.nomeCompleto || p.razaoSocial || p.cnpj || p.cpf || p.email) return false;
  const [cadastros, usuarios] = await Promise.all([
    prisma.cadastroFornecedor.count({ where: { colaboradorCodigo: { equals: p.nome.trim(), mode: "insensitive" } } }),
    prisma.usuario.count({ where: { nome: { equals: p.nome.trim(), mode: "insensitive" } } }),
  ]);
  return cadastros === 0 && usuarios === 0;
}
