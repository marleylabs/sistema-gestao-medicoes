/**
 * Credenciais e identificadores do ambiente E2E — lidos de .env.test (nunca hardcoded, nunca
 * reais). Playwright carrega .env/.env.test via playwright.config.ts antes de qualquer teste.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[e2e/fixtures] ${name} não configurada — rode a suíte via npm run test:e2e (que carrega .env.test).`);
  return value;
}

export const e2eUsers = {
  admin: { usuario: requireEnv("E2E_ADMIN_USUARIO"), senha: requireEnv("E2E_ADMIN_PASSWORD") },
  medicao: { usuario: requireEnv("E2E_MEDICAO_USUARIO"), senha: requireEnv("E2E_MEDICAO_PASSWORD") },
  financeiro: { usuario: requireEnv("E2E_FINANCEIRO_USUARIO"), senha: requireEnv("E2E_FINANCEIRO_PASSWORD") },
  fornecedorA: { usuario: requireEnv("E2E_FORNECEDOR_A_USUARIO"), senha: requireEnv("E2E_FORNECEDOR_A_PASSWORD") },
  fornecedorB: { usuario: requireEnv("E2E_FORNECEDOR_B_USUARIO"), senha: requireEnv("E2E_FORNECEDOR_B_PASSWORD") },
  fornecedorC: { usuario: requireEnv("E2E_FORNECEDOR_C_USUARIO"), senha: requireEnv("E2E_FORNECEDOR_C_PASSWORD") },
  fornecedorD: { usuario: requireEnv("E2E_FORNECEDOR_D_USUARIO"), senha: requireEnv("E2E_FORNECEDOR_D_PASSWORD") },
  administrativo: { usuario: requireEnv("E2E_ADMINISTRATIVO_USUARIO"), senha: requireEnv("E2E_ADMINISTRATIVO_PASSWORD") },
  inativo: { usuario: requireEnv("E2E_INATIVO_USUARIO"), senha: requireEnv("E2E_INATIVO_PASSWORD") },
};

export const e2eCiclo = () => requireEnv("E2E_CICLO");
