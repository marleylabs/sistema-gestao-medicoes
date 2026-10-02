import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const ROUTE = "app/api/admin/usuarios/[id]/route.ts";
const LIB = "lib/first-access.ts";

function actionBlock(source: string) {
  const actionIndex = source.indexOf('action === "enviar_primeiro_acesso"');
  const nextActionIndex = source.indexOf('if (action ===', actionIndex + 1);
  return source.slice(actionIndex, nextActionIndex > -1 ? nextActionIndex : undefined);
}

/**
 * "Enviar primeiro acesso" (Painel Administrativo) — guardas de regressão sobre o código-fonte
 * real da rota e de lib/first-access.ts (para onde a rotação+envio foi extraída, testável sem
 * servidor HTTP — ver tests/first-access-concurrency.ts para o teste de concorrência real contra
 * o banco E2E). Cobre os cenários do pedido que são propriedades ESTÁTICAS do código; os cenários
 * que dependem de execução real (SENT/CC/idempotência de e-mail/EMAIL_TEST_MODE) estão em
 * scripts/test-first-access.ts.
 */

test("action 'enviar_primeiro_acesso' rejeita alvo com perfil ADMIN ANTES de chamar rotateAndSendFirstAccess (cenário C)", () => {
  const block = actionBlock(readRoute(ROUTE));
  const rotateCallIndex = block.indexOf("rotateAndSendFirstAccess(");
  const adminCheckIndex = block.indexOf('user.perfil === "ADMIN"');
  assert.ok(adminCheckIndex > -1 && rotateCallIndex > -1 && adminCheckIndex < rotateCallIndex, "a checagem de perfil ADMIN precisa vir ANTES de rotacionar/enviar qualquer coisa");
});

test("action 'enviar_primeiro_acesso' exige e-mail cadastrado ANTES de chamar rotateAndSendFirstAccess (cenário D)", () => {
  const block = actionBlock(readRoute(ROUTE));
  const rotateCallIndex = block.indexOf("rotateAndSendFirstAccess(");
  const emailCheckIndex = block.indexOf("Este usuário não possui e-mail cadastrado.");
  assert.ok(emailCheckIndex > -1 && rotateCallIndex > -1 && emailCheckIndex < rotateCallIndex, "a checagem de e-mail precisa vir ANTES de rotacionar/enviar qualquer coisa");
});

test("rotateAndSendFirstAccess NUNCA persiste a senha em texto puro (senhaTemporaria explicitamente null no update dentro da transação)", () => {
  const source = readRoute(LIB);
  const updateIndex = source.indexOf(".usuario.update(");
  const updateCallEnd = source.indexOf("});", updateIndex);
  const updateBlock = source.slice(updateIndex, updateCallEnd);
  assert.match(updateBlock, /senhaTemporaria:\s*null/, "senhaTemporaria precisa ser explicitamente null (a senha só existe em texto no e-mail, nunca no banco)");
  assert.doesNotMatch(updateBlock, /senhaTemporaria:\s*senha\b/, "nunca gravar a senha em texto puro em senhaTemporaria no banco");
});

test("rotateAndSendFirstAccess gera senha nova e marca primeiroLogin a cada rotação real (cenário E)", () => {
  const source = readRoute(LIB);
  assert.match(source, /generateTempPassword\(\)/);
  assert.match(source, /hashPassword\(senha\)/);
  assert.match(source, /primeiroLogin:\s*true/, "precisa marcar primeiroLogin novamente, mesmo que já tivesse sido enviado antes");
});

test("rotateAndSendFirstAccess dispara notifyFirstAccess (nunca notifyPasswordReset — semântica diferente, ver item 15 do pedido original)", () => {
  const source = readRoute(LIB);
  assert.match(source, /notifyFirstAccess\(/);
  assert.doesNotMatch(source, /notifyPasswordReset/);
});

test("falha de e-mail em rotateAndSendFirstAccess NUNCA é silenciosa: erro deixa explícito que a senha já mudou (diferente do padrão fail-safe do BM)", () => {
  const source = readRoute(LIB);
  assert.match(source, /result\.ok/);
  assert.match(source, /senha foi alterada/i);
});

test("o claim FIRST_ACCESS_SENT (AdminAuditLog) nunca guarda a senha nem o e-mail completo em metadata", () => {
  const source = readRoute(LIB);
  assert.match(source, /action:\s*"FIRST_ACCESS_SENT"/);
  assert.doesNotMatch(source, /metadata:\s*\{[^}]*senha/i, "o claim nunca pode referenciar a senha em metadata");
  assert.doesNotMatch(source, /metadata:\s*\{[^}]*input\.email/i, "o claim nunca pode guardar o e-mail completo em metadata");
});

test("notifyFirstAccess nunca coloca a senha temporária em metadata (o que persistiria em email_logs)", () => {
  const source = readRoute("lib/email/events.ts");
  const fnIndex = source.indexOf("export async function notifyFirstAccess");
  const nextFnIndex = source.indexOf("export async function", fnIndex + 1);
  const block = source.slice(fnIndex, nextFnIndex > -1 ? nextFnIndex : undefined);
  const metadataMatch = block.match(/metadata:\s*\{([^}]*)\}/);
  assert.ok(metadataMatch, "esperava encontrar o objeto metadata em notifyFirstAccess");
  assert.doesNotMatch(metadataMatch[1], /senha/i, "metadata de FIRST_ACCESS nunca pode conter a senha temporária");
});

test("rotateAndSendFirstAccess exige requestId em formato UUID válido, rejeitado ANTES de qualquer transação", () => {
  const source = readRoute(LIB);
  const uuidCheckIndex = source.indexOf("isUuid(requestId)");
  const transactionIndex = source.indexOf("$transaction(");
  assert.ok(uuidCheckIndex > -1 && uuidCheckIndex < transactionIndex, "a validação de requestId precisa vir ANTES de abrir a transação de rotação");
});

test("a identidade da operação é o requestId (UUID do frontend), não updatedAt.getTime() — timestamp não é robusto sob concorrência", () => {
  const source = readRoute(LIB);
  assert.match(source, /credentialVersion:\s*requestId/, "chave do e-mail = first-access/{usuarioId}/{requestId}");
  assert.match(source, /metadata: \{ path: \["requestId"\], equals: requestId \}/, "o claim da operação é procurado pelo requestId");
});

test("trava POR USUÁRIO: duas operações diferentes (requestIds distintos) para o mesmo usuário são serializadas e a segunda não rotaciona enquanto a primeira está PENDENTE", () => {
  const source = readRoute(LIB);
  assert.match(source, /lockKey\s*=\s*`first-access-user\/\$\{input\.usuarioId\}`/);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)/);
  const txIndex = source.indexOf("$transaction(async (tx)");
  const pendenteIndex = source.indexOf('metadata: { path: ["resultado"], equals: "PENDENTE" }', txIndex);
  const rotateIndex = source.indexOf(".usuario.update(", txIndex);
  assert.ok(pendenteIndex > txIndex && pendenteIndex < rotateIndex, "checar operação em andamento ANTES de rotacionar, dentro da trava");
  assert.match(source, /JANELA_OPERACAO_EM_ANDAMENTO_MS/);
});

test("primeiroLogin é relido DENTRO da trava: quem já definiu a senha recebe 409 ACESSO_JA_DEFINIDO e nada é rotacionado", () => {
  const source = readRoute(LIB);
  const txIndex = source.indexOf("$transaction(async (tx)");
  const releituraIndex = source.indexOf("select: { primeiroLogin: true }", txIndex);
  const rotateIndex = source.indexOf(".usuario.update(", txIndex);
  assert.ok(releituraIndex > txIndex && releituraIndex < rotateIndex);
  assert.match(source, /motivo: "ACESSO_JA_DEFINIDO"/);
  const block = actionBlock(readRoute(ROUTE));
  assert.ok(block.indexOf("if (!user.primeiroLogin)") > -1 && block.indexOf("if (!user.primeiroLogin)") < block.indexOf("rotateAndSendFirstAccess("), "rota individual também barra primeiroLogin=false antes de rotacionar");
});

test("checagem de 'já processado' e rotação da senha acontecem dentro da MESMA transação com advisory lock (nunca só depois, via email_logs) — garante 1 única rotação sob concorrência", () => {
  const source = readRoute(LIB);
  const txIndex = source.indexOf("$transaction(async (tx)");
  assert.ok(txIndex > -1, "a rotação precisa rodar dentro de $transaction");
  const lockIndex = source.indexOf("pg_advisory_xact_lock", txIndex);
  const claimCheckIndex = source.indexOf("adminAuditLog.findFirst(", txIndex);
  const rotateIndex = source.indexOf(".usuario.update(", txIndex);
  const claimWriteIndex = source.indexOf("adminAuditLog.create(", txIndex);
  const txEndIndex = source.indexOf("{ timeout:", txIndex);

  assert.ok(lockIndex > txIndex && lockIndex < claimCheckIndex, "o advisory lock precisa ser adquirido ANTES de checar se já foi processado");
  assert.ok(claimCheckIndex < rotateIndex, "checar o claim existente precisa vir ANTES de rotacionar a senha");
  assert.ok(rotateIndex < claimWriteIndex && claimWriteIndex < txEndIndex, "o claim (AdminAuditLog) precisa ser escrito DENTRO da MESMA transação da rotação, não depois — senão duas requisições concorrentes rotacionariam duas vezes antes que qualquer uma criasse um email_log");
});

test("retry com o MESMO requestId nunca rotaciona/envia de novo — trata os 3 estados do claim (SENT/PENDENTE/outro) sem reprocessar", () => {
  const source = readRoute(LIB);
  assert.match(source, /rotation\.alreadyProcessed/);
  assert.match(source, /"SENT"/);
  assert.match(source, /"PENDENTE"/);
  assert.match(source, /alreadyProcessed:\s*true/);
});

test("FIRST_ACCESS não está nas categorias BM/FINANCE de CC (getEmailCcForEvent retorna sempre [])", () => {
  process.env.EMAIL_BM_CC = "a@example.test";
  process.env.EMAIL_FINANCE_CC = "b@example.test";
  const { getEmailCcForEvent } = require("../lib/email/cc-policy");
  assert.deepEqual(getEmailCcForEvent("FIRST_ACCESS"), [], "FIRST_ACCESS nunca deve receber CC automático — contém credencial, item 16 do pedido original");
});

test("botão 'Enviar primeiro acesso' no card nunca aparece para perfil ADMIN (checagem por perfil, nunca por nome/código específico)", () => {
  // Redesign do Administrativo: as ações de acesso vivem no detalhe lateral (components/administrativo/detalhes.tsx).
  const source = readRoute("components/administrativo/detalhes.tsx");
  assert.match(source, /item\.perfil !== "ADMIN" && item\.primeiroLogin/, "Detalhe do funcionário precisa checar perfil !== ADMIN antes de mostrar o botão");
  assert.match(source, /item\.acesso\.perfil !== "ADMIN" && item\.acesso\.primeiroLogin/, "Detalhe do fornecedor precisa checar perfil !== ADMIN antes de mostrar o botão");
  for (const file of ["components/administrativo/detalhes.tsx", "components/administrativo-panel.tsx"]) {
    assert.doesNotMatch(readRoute(file), /usuario === "P0000001"/, "nunca esconder o botão por código/nome específico — sempre por perfil");
  }
});

test("frontend gera requestId (crypto.randomUUID()) ao abrir a confirmação e o envia no PATCH", () => {
  const source = readRoute("components/administrativo-panel.tsx");
  assert.match(source, /requestId:\s*crypto\.randomUUID\(\)/);
  assert.match(source, /JSON\.stringify\(\{\s*action:\s*"enviar_primeiro_acesso",\s*requestId\s*\}\)/);
});
