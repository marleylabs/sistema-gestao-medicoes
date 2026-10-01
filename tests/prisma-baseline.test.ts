import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const BASE = "20260902000000_baseline_legado";
const base = fs.readFileSync(path.join(MIGRATIONS, BASE, "migration.sql"), "utf8");
const migrations = fs.readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();

test("migration base é a PRIMEIRA do histórico e as 6 incrementais vêm depois, na ordem", () => {
  assert.equal(migrations[0], BASE);
  assert.deepEqual(migrations.slice(1), [
    "20260903160000_profissional_exclusao_definitiva",
    "20260904120000_condicao_fixa_condicional",
    "20260904140000_fonte_medicao",
    "20260909150000_usuario_permissao_extra",
    "20260928173000_cadastro_fornecedor_inativacao",
    "20260930090000_profissional_alias",
  ]);
});

test("migration base é SQL puro: sem SET de sessão, search_path vazio ou meta-comandos do psql", () => {
  for (const linha of base.split("\n")) {
    assert.ok(!linha.startsWith("\\"), `meta-comando psql não é SQL: ${linha.slice(0, 30)}`);
    assert.ok(!/^SET /.test(linha), `SET de sessão vazaria para as próximas migrations: ${linha}`);
  }
  assert.doesNotMatch(base, /set_config\('search_path'/);
});

test("migration base contém o que o Prisma não gera (pgcrypto, CHECKs, view) e as FKs físicas", () => {
  assert.match(base, /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
  assert.match(base, /CREATE VIEW public\.vw_dashboard_medicoes/);
  for (const check of ["profissionais_status_colaborador_check", "sgc_aprovacoes_status_check", "medicoes_valor_medicao_nn"]) assert.ok(base.includes(check), check);
  for (const fk of ["divergencias_medicao_sgc_id_fkey", "sgc_logs_sgc_id_fkey", "chat_mensagens_autor_id_fkey", "medicoes_id_profissional_fkey"]) assert.ok(base.includes(fk), fk);
});

test("migration base NÃO contém os efeitos das 6 migrations seguintes (elas são aplicadas por cima)", () => {
  const sql = base.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  for (const objeto of ["admin_audit_logs", "usuarios_permissoes", "profissional_aliases", "deleted_at", "deleted_reason", "profissional_nome_snapshot", "tipo_condicao_fixa", "valor_condicao_fixa_com_producao", "fonte_medicao", "inativado_at"]) {
    assert.ok(!sql.includes(objeto), `${objeto} pertence a uma migration incremental`);
  }
});

test("docker-compose.yml não cria schema por initdb: o banco nasce só pelo histórico Prisma", () => {
  const compose = fs.readFileSync(path.join(__dirname, "..", "docker-compose.yml"), "utf8");
  assert.doesNotMatch(compose, /docker-entrypoint-initdb\.d/);
  assert.match(compose, /command: \["npx", "prisma", "migrate", "deploy"\]/);
  assert.match(compose, /name: \$\{POSTGRES_VOLUME_NAME:-projetocrud-medio_postgres_data\}/);
});
