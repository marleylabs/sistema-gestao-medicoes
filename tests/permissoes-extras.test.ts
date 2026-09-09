import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const USUARIOS_ID_ROUTE = "app/api/admin/usuarios/[id]/route.ts";

/**
 * Guarda de regressão para a arquitetura de permissões extras (aditiva sobre Usuario.perfil).
 * Cobre exatamente os itens do pedido que são propriedades ESTÁTICAS do código-fonte (nunca podem
 * regredir): quem pode conceder/remover (só ADMIN literal), quem pode RECEBER (nunca ADMIN,
 * nunca COLABORADOR), que "alterar perfil" continua um action separado e também ADMIN-only, e que
 * a UI/backend do Administrativo em si não precisou ser reescrita. Os cenários A-G (comportamento
 * real de hasPermissao/getEffectivePermissions) estão em scripts/test-permissoes-extras.ts.
 */

test("action 'set_permissoes_extras' está atrás do MESMO gate ADMIN-only do topo do PATCH (nunca uma checagem própria mais fraca)", () => {
  const source = readSource(USUARIOS_ID_ROUTE);
  const actionIndex = source.indexOf('action === "set_permissoes_extras"');
  const topGateIndex = source.indexOf('admin.user?.perfil !== "ADMIN" && admin.user?.perfil !== "MEDICAO"');
  // Esta rota, antes desta mudança, já exigia ADMIN literal no topo do PATCH — confirma que a
  // ação nova está DEPOIS dessa checagem (nunca definiu seu próprio auth.user?.perfil mais fraco).
  const topGateIndexOriginal = source.indexOf('if (admin.user?.perfil !== "ADMIN") {');
  assert.ok(actionIndex > -1, "esperava encontrar a action set_permissoes_extras");
  assert.ok(topGateIndex > -1 || topGateIndexOriginal > -1, "esperava encontrar o gate ADMIN-only no topo do PATCH");
  const gateIndex = topGateIndex > -1 ? topGateIndex : topGateIndexOriginal;
  assert.ok(gateIndex < actionIndex, "o gate ADMIN-only do topo do handler precisa vir ANTES da action set_permissoes_extras");
});

test("set_permissoes_extras rejeita conceder para perfil ADMIN (item 9/10 — ADMIN não precisa de extras)", () => {
  const source = readSource(USUARIOS_ID_ROUTE);
  const actionIndex = source.indexOf('action === "set_permissoes_extras"');
  const nextActionIndex = source.indexOf('if (action ===', actionIndex + 1);
  const block = source.slice(actionIndex, nextActionIndex > -1 ? nextActionIndex : undefined);
  assert.match(block, /user\.perfil === "ADMIN"/);
});

test("set_permissoes_extras rejeita perfis não elegíveis (COLABORADOR nunca recebe permissão interna — princípio do menor privilégio)", () => {
  const source = readSource(USUARIOS_ID_ROUTE);
  const actionIndex = source.indexOf('action === "set_permissoes_extras"');
  const nextActionIndex = source.indexOf('if (action ===', actionIndex + 1);
  const block = source.slice(actionIndex, nextActionIndex > -1 ? nextActionIndex : undefined);
  assert.match(block, /isElegivelParaPermissaoExtra\(user\.perfil\)/);
});

test("set_permissoes_extras valida cada permissão da lista com isValidPermissao (nunca aceita string livre)", () => {
  const source = readSource(USUARIOS_ID_ROUTE);
  const actionIndex = source.indexOf('action === "set_permissoes_extras"');
  const nextActionIndex = source.indexOf('if (action ===', actionIndex + 1);
  const block = source.slice(actionIndex, nextActionIndex > -1 ? nextActionIndex : undefined);
  assert.match(block, /\.every\(isValidPermissao\)/);
});

test("set_permissoes_extras registra GRANT/REVOKE em AdminAuditLog sem gravar segredo", () => {
  const source = readSource(USUARIOS_ID_ROUTE);
  const actionIndex = source.indexOf('action === "set_permissoes_extras"');
  const nextActionIndex = source.indexOf('if (action ===', actionIndex + 1);
  const block = source.slice(actionIndex, nextActionIndex > -1 ? nextActionIndex : undefined);
  assert.match(block, /"GRANT_PERMISSAO_EXTRA"/);
  assert.match(block, /"REVOKE_PERMISSAO_EXTRA"/);
  assert.doesNotMatch(block, /senha/i);
});

test("'alterar perfil' (set_perfil) continua uma action separada, ADMIN-only pelo mesmo gate do topo — não foi fundida com permissões extras", () => {
  const source = readSource(USUARIOS_ID_ROUTE);
  assert.match(source, /action === "set_perfil"/);
  const setPerfilIndex = source.indexOf('action === "set_perfil"');
  const setPermissoesIndex = source.indexOf('action === "set_permissoes_extras"');
  assert.notEqual(setPerfilIndex, setPermissoesIndex, "set_perfil e set_permissoes_extras precisam continuar sendo duas actions distintas");
});

test("requireAdministrativo() considera hasPermissao (ADMIN/ADMINISTRATIVO continuam liberados de base, sem regressão)", () => {
  const source = readSource("lib/admin.ts");
  const fnIndex = source.indexOf("export async function requireAdministrativo");
  const fnEnd = source.indexOf("\nexport async function", fnIndex + 1);
  const block = source.slice(fnIndex, fnEnd > -1 ? fnEnd : undefined);
  assert.match(block, /\["ADMIN", "ADMINISTRATIVO"\]\.includes\(user\.perfil\)/, "ADMIN/ADMINISTRATIVO precisam continuar passando sem precisar de grant");
  assert.match(block, /hasPermissao\(user, "ADMINISTRATIVO"\)/);
});

test("requireAdmin()/requireFinanceiro() não foram tocados por esta mudança (fora de escopo — só ADMINISTRATIVO foi ligado a permissões extras nesta entrega)", () => {
  const source = readSource("lib/admin.ts");
  const requireAdminIndex = source.indexOf("export async function requireAdmin(");
  const requireAdministrativoIndex = source.indexOf("export async function requireAdministrativo");
  const block = source.slice(requireAdminIndex, requireAdministrativoIndex);
  assert.doesNotMatch(block, /hasPermissao/, "requireAdmin/requireFinanceiro não devem depender de permissões extras nesta entrega");
});

test("resolver-identidade, candidatos-identidade, bulk-delete e criar-funcionário CONTINUAM restritos a ADMIN literal (não foram abertos por permissão extra)", () => {
  for (const file of [
    "app/api/admin/administrativo/fornecedores/resolver-identidade/route.ts",
    "app/api/admin/administrativo/fornecedores/candidatos-identidade/route.ts",
    "app/api/admin/administrativo/fornecedores/bulk-delete/route.ts",
    "app/api/admin/administrativo/funcionarios/route.ts",
  ]) {
    const source = readSource(file);
    assert.match(source, /perfil !== "ADMIN"/, `${file} precisa continuar com a checagem ADMIN-only literal`);
    assert.doesNotMatch(source, /hasPermissao/, `${file} não deve ter sido aberto por permissão extra nesta entrega (escopo conservador)`);
  }
});

test("AdministrativoPanel/CadastroCard/FuncionarioCard: isAdmin continua isFullAdmin — quem entra só pela permissão extra tem a MESMA experiência reduzida do perfil ADMINISTRATIVO nativo (nenhuma ação nova precisou ser implementada no painel)", () => {
  const source = readSource("components/medicoes-app.tsx");
  assert.match(source, /<AdministrativoPanel isAdmin=\{isFullAdmin\} \/>/);
  assert.match(source, /isFullAdmin \|\| isAdministrativo \|\| temAcessoAdministrativoExtra/);
});

test("medicoes-app.tsx: permissão extra é lida uma vez por carregamento de página (prop, não fetch por render) e nunca é hardcoded por perfil", () => {
  const source = readSource("components/medicoes-app.tsx");
  assert.match(source, /permissoesExtras\s*=\s*\[\]/, "prop permissoesExtras precisa existir com default seguro");
  assert.match(source, /temAcessoAdministrativoExtra\s*=\s*permissoesExtras\.includes\("ADMINISTRATIVO"\)/);
});

test("app/page.tsx busca permissoesExtras uma vez por request (mesmo padrão de getCurrentUser) e passa como prop", () => {
  const source = readSource("app/page.tsx");
  assert.match(source, /getPermissoesExtras\(user\.id\)/);
  assert.match(source, /permissoesExtras=\{permissoesExtras\}/);
});

test("lib/permissoes.ts é um módulo puro (sem 'import \"server-only\"') — importável pelo frontend", () => {
  const source = readSource("lib/permissoes.ts");
  assert.doesNotMatch(source, /^import "server-only";/m);
  assert.doesNotMatch(source, /@\/lib\/prisma/, "o registro puro nunca deve importar prisma diretamente");
});

test("lib/permissoes-acesso.ts (funções que tocam banco) é 'server-only'", () => {
  const source = readSource("lib/permissoes-acesso.ts");
  assert.match(source, /^import "server-only";/m);
});

test("resolveMedicaoTeamEmails/resolveFinanceiroTeamEmails continuam chaveadas só por Usuario.perfil (não foram tocadas por esta mudança, item 33 do pedido)", () => {
  const source = readSource("lib/email/resolve-recipients.ts");
  assert.doesNotMatch(source, /permissoesExtras|hasPermissao|UsuarioPermissao/);
});

// ─── Ampliação: HISTORICO_MEDICOES (mesma arquitetura, nova permissão) ───

test("item 29.A — VALID_PERMISSOES inclui HISTORICO_MEDICOES, com label/descrição próprios no registry (nunca string mágica)", () => {
  const source = readSource("lib/permissoes.ts");
  assert.match(source, /VALID_PERMISSOES = \["ADMINISTRATIVO", "HISTORICO_MEDICOES"\]/);
  assert.match(source, /HISTORICO_MEDICOES:\s*"Histórico de Medições"/);
  assert.match(source, /HISTORICO_MEDICOES:\s*\n\s*"Permite consultar/);
});

test("HISTORICO_MEDICOES não tem entrada em PERMISSOES_BASE_POR_PERFIL para nenhum perfil (auditoria confirmou: só ADMIN tinha 'historico' antes, e ADMIN já passa pelo fast-path perfil==='ADMIN', sem precisar de mapa base)", () => {
  const source = readSource("lib/permissoes.ts");
  const baseIndex = source.indexOf("PERMISSOES_BASE_POR_PERFIL");
  const block = source.slice(baseIndex);
  assert.doesNotMatch(block, /HISTORICO_MEDICOES/, "nenhum perfil deve receber HISTORICO_MEDICOES de base — precisa sempre de concessão nominal");
});

test("medicoes-app.tsx: temAcessoHistoricoExtra existe e gate 'historico' em VALID_SECTIONS/navItems para FINANCEIRO, ADMINISTRATIVO e MEDICAO — nunca perfil === 'FINANCEIRO' como exceção direta", () => {
  const source = readSource("components/medicoes-app.tsx");
  assert.match(source, /temAcessoHistoricoExtra\s*=\s*permissoesExtras\.includes\("HISTORICO_MEDICOES"\)/);
  // Precisa aparecer condicionado à variável de permissão, não a um perfil específico isolado.
  const matches = source.match(/temAcessoHistoricoExtra \? \[(?:navItemHistoricoExtra|"historico" as const)\]/g) ?? [];
  assert.ok(matches.length >= 3, `esperava pelo menos 3 usos de temAcessoHistoricoExtra gateando 'historico' (financeiro/administrativo/medicao), achou ${matches.length}`);
});

test("HistoricoSection continua recebendo isAdmin={isAdmin} e canResetCiclos={isFullAdmin} inalterados — HISTORICO_MEDICOES nunca libera Novo ciclo/Ativar medição/Excluir ciclo para quem não tem o perfil correto (item 10/11/25)", () => {
  const source = readSource("components/medicoes-app.tsx");
  const historicoSectionCallIndex = source.indexOf("<HistoricoSection");
  const callEnd = source.indexOf("/>", historicoSectionCallIndex);
  const block = source.slice(historicoSectionCallIndex, callEnd);
  assert.match(block, /isAdmin=\{isAdmin\}/);
  assert.match(block, /canResetCiclos=\{isFullAdmin\}/);
  assert.doesNotMatch(block, /temAcessoHistoricoExtra/, "a permissão de LEITURA do histórico nunca deve ser passada como isAdmin/canResetCiclos — essas continuam exclusivas do perfil Medição/ADMIN real");
});

test("/api/ciclos (leitura e ações críticas de manutenção de ciclo) não foi alterado por HISTORICO_MEDICOES — GET continua sem checagem de perfil (já era assim antes), POST/PATCH continuam requireAdmin(), DELETE continua ADMIN literal", () => {
  const source = readSource("app/api/ciclos/route.ts");
  assert.doesNotMatch(source, /hasPermissao|permissoesExtras|HISTORICO_MEDICOES/, "esta rota não deve saber nada sobre a nova permissão — ela já era pública para leitura e ADMIN-only para escrita antes desta mudança");
  assert.match(source, /requireAdmin\(\)/);
  assert.match(source, /perfil !== "ADMIN"/);
});

test("PermissoesExtrasModal deriva os checkboxes do registry (PERMISSAO_OPTIONS) — HISTORICO_MEDICOES aparece automaticamente, sem JSX hardcoded novo", () => {
  const source = readSource("components/administrativo-panel.tsx");
  assert.doesNotMatch(source, /HISTORICO_MEDICOES/, "o componente nunca deve referenciar o valor da permissão diretamente — só o registry (lib/permissoes.ts) conhece esse literal");
  assert.match(source, /opcoesExtras\.map\(\(option\)/, "os checkboxes continuam gerados a partir da lista de opções do registry");
});

test("FuncionarioCard exibe múltiplas permissões extras compactamente (join por vírgula), sem lógica nova por permissão", () => {
  const source = readSource("components/administrativo-panel.tsx");
  assert.match(source, /item\.permissoesExtras\.map\(\(p\) => PERMISSAO_LABEL_LOOSE\[p\] \?\? p\)\.join\(", "\)/);
});
