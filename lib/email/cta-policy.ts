/**
 * Liga/desliga temporariamente o botão de acesso (CTA) dos e-mails OPERACIONAIS de BM/Financeiro
 * — nunca do PASSWORD_RESET, que é segurança/autenticação e sempre mantém o link. Interpretação
 * estrita por segurança: só o literal "true" habilita; qualquer outra coisa (ausente, "false",
 * vazio, valor mal digitado) mantém os botões desabilitados. Módulo puro (sem "server-only"):
 * testável diretamente e reutilizável no script de pré-flight.
 */
export function isEmailCtaEnabled(): boolean {
  return process.env.EMAIL_CTA_ENABLED === "true";
}
