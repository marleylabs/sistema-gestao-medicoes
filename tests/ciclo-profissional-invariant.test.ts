import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cleanupSource = fs.readFileSync(path.join(process.cwd(), "lib/ciclo-cleanup.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(process.cwd(), "app/api/ciclos/route.ts"), "utf8");

test("limpeza de ciclos protege Profissional vinculado a qualquer CadastroFornecedor pelo código canônico", () => {
  assert.match(cleanupSource, /from cadastros_fornecedores cf/);
  assert.doesNotMatch(cleanupSource, /cf\.ativo/);
  assert.match(cleanupSource, /upper\(trim\(cf\.colaborador_codigo\)\) = upper\(trim\(p\.codigo\)\)/);
  assert.doesNotMatch(cleanupSource, /cnpj/i);
});

test("limpeza continua exigindo ausência das referências históricas e operacionais", () => {
  for (const table of ["medicoes", "mapa_pagamento_itens", "bm_aux_medicoes", "sgc_aprovacoes_medicao", "sgc_logs", "divergencias_medicao"]) {
    assert.match(cleanupSource, new RegExp(`from ${table}`));
  }
  assert.match(cleanupSource, /p\.deleted_at is null/);
});

test("rota de exclusão de ciclos usa a limpeza centralizada após remover os dados do ciclo", () => {
  assert.match(routeSource, /deleteOrphanProfessionalsAfterCycleRemoval\(tx, candidatos\.profissionalIds\)/);
  assert.ok(routeSource.indexOf("deleteOrphanProfessionalsAfterCycleRemoval(tx") > routeSource.indexOf("tx.medicao.deleteMany"));
});

test("excluir ciclo nunca faz coleta de lixo global: candidatos coletados antes, limpeza restrita a eles", () => {
  const coleta = routeSource.indexOf("coletarCandidatosLimpezaCiclo(tx, ciclosAlvo)");
  assert.ok(coleta > -1 && coleta < routeSource.indexOf("tx.medicao.deleteMany"), "candidatos precisam ser coletados antes de apagar as medições");
  assert.match(routeSource, /deleteOrphanProjectsAfterCycleRemoval\(tx, candidatos\.projetoIds\)/);
  assert.doesNotMatch(routeSource, /delete from projetos/i, "sem DELETE global de projetos na rota");
  assert.match(cleanupSource, /where p\.id = any\(\$\{candidatos\}::uuid\[\]\)/);
  assert.match(cleanupSource, /from profissional_aliases pa/, "aliases (FK em cascata) protegem a identidade");
  // Conversas: só as esvaziadas pelas mensagens deste ciclo.
  assert.match(routeSource, /id: \{ in: Array\.from\(new Set\(conversasDasMensagens\)\) \}/);
});
