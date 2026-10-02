/**
 * Elegibilidade para "Enviar primeiro acesso" — UMA regra, derivada do fluxo individual existente
 * (nada inventado):
 *  - fornecedor sem `Usuario` vinculado: o detalhe mostra "Nenhum usuário de acesso vinculado";
 *  - alvo ADMIN: a rota PATCH /api/admin/usuarios/[id] responde 403 e o botão nunca aparece;
 *  - `primeiroLogin = false` (senha já definida pelo próprio usuário): o botão individual não
 *    aparece — enviar aqui seria um REENVIO que troca a senha de quem já acessa, não primeiro acesso;
 *  - sem e-mail de acesso (`Usuario.email`): a rota responde 409 e o botão fica desabilitado. Quando
 *    só o e-mail cadastral existe, é o mesmo aviso do detalhe ("ainda não sincronizado").
 * Ativo/inativo NÃO entra: o fluxo individual não usa (ver relatório).
 *
 * Puro (sem prisma/server-only): usado pela tela (seleção/confirmação) e revalidado no servidor
 * pela rota em lote, com os dados reconsultados no momento do envio.
 */

export type AcessoPrimeiroAcesso = {
  perfil: string;
  primeiroLogin: boolean;
  email: string | null;
};

export type MotivoInelegivelPrimeiroAcesso = "SEM_ACESSO" | "PERFIL_ADMIN" | "ACESSO_JA_DEFINIDO" | "SEM_EMAIL";

export type ElegibilidadePrimeiroAcesso =
  | { elegivel: true }
  | { elegivel: false; motivo: MotivoInelegivelPrimeiroAcesso; mensagem: string };

export function avaliarElegibilidadePrimeiroAcesso(
  acesso: AcessoPrimeiroAcesso | null | undefined,
  emailCadastral?: string | null,
): ElegibilidadePrimeiroAcesso {
  if (!acesso) return { elegivel: false, motivo: "SEM_ACESSO", mensagem: "Sem usuário de acesso vinculado" };
  if (acesso.perfil === "ADMIN") return { elegivel: false, motivo: "PERFIL_ADMIN", mensagem: "Administrador não recebe primeiro acesso" };
  if (!acesso.primeiroLogin) return { elegivel: false, motivo: "ACESSO_JA_DEFINIDO", mensagem: "Acesso já ativado (senha definida pelo usuário)" };
  if (!acesso.email?.trim()) {
    return {
      elegivel: false,
      motivo: "SEM_EMAIL",
      mensagem: emailCadastral?.trim() ? "E-mail de acesso ainda não sincronizado" : "Sem e-mail cadastrado",
    };
  }
  return { elegivel: true };
}
