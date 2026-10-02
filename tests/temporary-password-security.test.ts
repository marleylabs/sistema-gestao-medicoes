import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Hardening da senha temporária. Estado garantido:
 *  - nenhuma senha em texto puro é gravada em `usuarios.senha_temporaria` (coluna legada, sempre NULL);
 *  - nenhuma listagem/GET devolve senha, hash ou senha temporária (inclui o que ADMINISTRATIVO lê);
 *  - a senha gerada existe só na resposta IMEDIATA da operação que a criou (reset, criação de
 *    funcionário, cadastro/importação/resolução de fornecedor) — sempre `Cache-Control: no-store`;
 *  - a autenticação usa só `senhaHash` (scrypt).
 * Guardas estáticas sobre o código real; o comportamento ponta a ponta está em
 * e2e/seguranca-senha-temporaria.spec.ts.
 */

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const fontes = [...walk("app"), ...walk("lib"), ...walk("components")];

test("nenhuma gravação de senha temporária em texto puro: toda atribuição `senhaTemporaria:` em dados persistidos é null", () => {
  // Únicas exceções: chaves de RESPOSTA de exibição única (nunca `data:` de Prisma).
  const respostasPermitidas: Record<string, RegExp[]> = {
    "app/api/admin/usuarios/[id]/route.ts": [/senhaTemporaria: tempPass,/],
    "lib/usuario-provisioning.ts": [/senhaTemporaria: senha \}/],
    // Conteúdo do e-mail FIRST_ACCESS: a senha vai só no corpo do e-mail ao destinatário, nunca persistida.
    "lib/first-access.ts": [/^\s*senhaTemporaria: rotation\.senha,$/],
    "lib/email/events.ts": [/firstAccessTemplate\(\{ nome: input\.nome, usuario: input\.usuario, senhaTemporaria: input\.senhaTemporaria, appUrl: loginUrl\(\) \}\)/],
  };
  const violacoes: string[] = [];
  for (const rel of fontes) {
    const src = code(read(rel));
    for (const m of src.matchAll(/senhaTemporaria:\s*([^,\n}]+)/g)) {
      const valor = m[1].trim();
      if (valor === "null" || /^(string|boolean)\b/.test(valor) || valor.startsWith("string | null")) continue;
      const linha = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
      if ((respostasPermitidas[rel] ?? []).some((re) => re.test(linha))) continue;
      violacoes.push(`${rel}: ${linha.trim()}`);
    }
  }
  assert.deepEqual(violacoes, []);
});

test("nenhum select/leitura de senha temporária ou hash para montar resposta (só o login lê senhaHash)", () => {
  for (const rel of fontes) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /senhaTemporaria:\s*true/, `${rel}: select de senhaTemporaria`);
    if (rel !== "app/api/auth/login/route.ts" && rel !== "lib/auth.ts") {
      assert.doesNotMatch(src, /senhaHash:\s*true/, `${rel}: select de senhaHash`);
    }
  }
  const login = code(read("app/api/auth/login/route.ts"));
  assert.match(login, /verifyPassword\(password, user\.senhaHash\)/, "autenticação só pelo hash");
  assert.doesNotMatch(login, /senhaTemporaria/);
  assert.match(code(read("lib/auth.ts")), /scrypt:\$\{salt\.toString\("base64"\)\}/, "hash scrypt inalterado");
});

test("nenhuma rota GET devolve credencial (listagens de fornecedores, funcionários e usuários incluídas)", () => {
  for (const rel of fontes.filter((f) => f.startsWith("app/api/") && f.endsWith("route.ts"))) {
    const src = code(read(rel));
    const inicio = src.indexOf("export async function GET");
    if (inicio === -1) continue;
    const fim = src.indexOf("export async function", inicio + 10);
    const get = src.slice(inicio, fim === -1 ? undefined : fim);
    assert.doesNotMatch(get, /senhaTemporaria|senha_temporaria|senhaHash|tempPass|password/i, `${rel}: GET com credencial`);
  }
  const lista = code(read("lib/cadastro-fornecedor.ts"));
  const inicio = lista.indexOf("export async function findColaboradorUsuarios");
  const corpo = lista.slice(inicio, lista.indexOf("\n}\n", inicio));
  assert.doesNotMatch(corpo, /senha/i, "DTO do acesso (listagem de fornecedores, lida também por ADMINISTRATIVO) sem credencial");
  assert.match(corpo, /select: \{ id: true, usuario: true, nome: true, perfil: true, ativo: true, email: true, primeiroLogin: true \}/);
});

test("tipos de DTO do frontend não carregam senha temporária; a senha de criação vem só da resposta da operação", () => {
  const shared = code(read("components/administrativo/shared.ts"));
  assert.doesNotMatch(shared, /senhaTemporaria/);
  const prov = code(read("lib/usuario-provisioning.ts"));
  const tipo = prov.slice(prov.indexOf("export type UsuarioSerializado"), prov.indexOf("};", prov.indexOf("export type UsuarioSerializado")));
  assert.doesNotMatch(tipo, /senha/i);
  assert.match(prov, /export type UsuarioCriado = UsuarioSerializado & \{ senhaTemporaria: string \}/);
});

test("respostas com senha de exibição única são no-store", () => {
  assert.match(read("lib/no-store.ts"), /"Cache-Control": "no-store, max-age=0"/);
  const casos: [string, RegExp][] = [
    ["app/api/admin/usuarios/[id]/route.ts", /return jsonNoStore\(\{\s*senhaTemporaria: tempPass,/],
    ["app/api/admin/usuarios/route.ts", /return jsonNoStore\(result\.usuario/],
    ["app/api/admin/administrativo/funcionarios/route.ts", /return jsonNoStore\(result\.usuario/],
    ["app/api/admin/administrativo/fornecedores/route.ts", /return jsonNoStore\(result\)/],
    ["app/api/admin/administrativo/fornecedores/manual/route.ts", /return jsonNoStore\(\s*\{\s*cadastro:/],
    ["app/api/admin/administrativo/fornecedores/resolver-identidade/route.ts", /return jsonNoStore\(resultado\)/],
  ];
  for (const [rel, re] of casos) assert.match(code(read(rel)), re, rel);
});

test("reset_senha: grava só o hash (senhaTemporaria null) e continua sendo exclusivo do ADMIN literal", () => {
  const src = code(read("app/api/admin/usuarios/[id]/route.ts"));
  const bloco = src.slice(src.indexOf('action === "reset_senha"'), src.indexOf('action === "enviar_primeiro_acesso"'));
  assert.match(bloco, /data: \{ senhaHash: tempHash, senhaTemporaria: null, primeiroLogin: true/);
  assert.doesNotMatch(bloco, /senhaTemporaria: tempPass, primeiroLogin/);
  assert.match(src.slice(0, src.indexOf('action === "toggle_ativo"')), /admin\.user\?\.perfil !== "ADMIN"/);
});

test("senha nunca vai para log, auditoria ou e-mail de reset", () => {
  for (const rel of fontes.filter((f) => !f.startsWith("components/"))) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)\([^)]*(senha|tempPass|password)/i, `${rel}: senha em log`);
    assert.doesNotMatch(src, /metadata:\s*\{[^}]*(senha|tempPass)/i, `${rel}: senha em metadata de auditoria/e-mail`);
  }
  assert.doesNotMatch(code(read("lib/email/templates/password-reset.ts")), /senha:|senhaTemporaria/, "e-mail de reset nunca leva a senha");
});

test("frontend: senha só em memória do diálogo; aviso de exibição única; nada em storage do navegador", () => {
  const painel = code(read("components/administrativo-panel.tsx"));
  assert.match(painel, /Copie esta senha agora\. Ela não poderá ser visualizada novamente\./);
  assert.match(painel, /setCredencial\(\{ titulo: "Senha redefinida com sucesso", nome, email, senha: payload\.senhaTemporaria \}\)/, "alimentado pela resposta do reset");
  for (const rel of fontes.filter((f) => f.startsWith("components/administrativo"))) {
    assert.doesNotMatch(code(read(rel)), /localStorage|sessionStorage|document\.cookie/, rel);
  }
});
