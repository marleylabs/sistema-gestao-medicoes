import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSensitive } from "@/lib/encryption";

export type ResolvedRecipient = {
  email: string | null;
  nome: string;
  /** true quando o destinatário lógico existe mas não tem e-mail cadastrado — nunca quebra o workflow, só fica registrado para preparar produção. */
  missing: boolean;
};

/**
 * Resolve o e-mail de um fornecedor a partir do `colaborador_codigo` canônico — nunca por CNPJ
 * (a aplicação permite fornecedores diferentes com o mesmo CNPJ). Fonte primária:
 * `CadastroFornecedor` (Administrativo, mesmo dado que alimenta NF/pagamentos); fallback:
 * `Profissional.email` (ETL) quando o Administrativo ainda não tem o cadastro.
 */
export async function resolveFornecedorEmail(colaboradorCodigo: string, nomeFallback?: string | null): Promise<ResolvedRecipient> {
  const cadastro = await prisma.cadastroFornecedor.findFirst({
    where: { colaboradorCodigo },
    orderBy: { updatedAt: "desc" },
    select: { email: true, responsavel: true },
  });
  const cadastroEmail = decryptSensitive(cadastro?.email);
  if (cadastroEmail) {
    return { email: cadastroEmail, nome: cadastro?.responsavel || nomeFallback || colaboradorCodigo, missing: false };
  }

  const profissional = await prisma.profissional.findUnique({
    where: { codigo: colaboradorCodigo },
    select: { email: true, nome: true, nomeCompleto: true },
  });
  const profissionalEmail = decryptSensitive(profissional?.email) ?? profissional?.email ?? null;
  const nome = cadastro?.responsavel || profissional?.nomeCompleto || profissional?.nome || nomeFallback || colaboradorCodigo;
  return { email: profissionalEmail, nome, missing: !profissionalEmail };
}

async function resolveTeamEmailsByPerfil(perfil: string): Promise<{ emails: string[]; missingCount: number }> {
  const usuarios = await prisma.usuario.findMany({
    where: { perfil, ativo: true, excluidoAt: null },
    select: { email: true },
  });
  const emails = Array.from(new Set(
    usuarios.map((u) => decryptSensitive(u.email)).filter((e): e is string => !!e),
  ));
  return { emails, missingCount: usuarios.length - emails.length };
}

/** Usuários ativos cujo perfil represente a Equipe de Medição — nunca endereço hardcoded. */
export async function resolveMedicaoTeamEmails() {
  return resolveTeamEmailsByPerfil("MEDICAO");
}

/** Usuários ativos cujo perfil represente o Financeiro — independente do chat "Financeiro" (mecanismos distintos). */
export async function resolveFinanceiroTeamEmails() {
  return resolveTeamEmailsByPerfil("FINANCEIRO");
}
