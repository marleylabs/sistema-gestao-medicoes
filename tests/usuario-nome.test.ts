import assert from "node:assert/strict";
import test from "node:test";
import { validateUserDisplayName, normalizeUserDisplayName, resolveNomeUpdate } from "../lib/usuario-nome";
import { prisma } from "../lib/prisma";

// ─── validateUserDisplayName ───────────────────────────────────────────────────────────────────

test("validateUserDisplayName: nome válido não retorna erro", () => {
  assert.equal(validateUserDisplayName("Anderson Marley Lima"), null);
});

test("validateUserDisplayName: vazio ou só espaços é rejeitado", () => {
  assert.ok(validateUserDisplayName(""));
  assert.ok(validateUserDisplayName("     "));
  assert.ok(validateUserDisplayName(null));
  assert.ok(validateUserDisplayName(undefined));
});

test("validateUserDisplayName: abaixo do mínimo (3) é rejeitado", () => {
  assert.ok(validateUserDisplayName("Jo"));
});

test("validateUserDisplayName: acima do máximo (120) é rejeitado", () => {
  assert.ok(validateUserDisplayName("A".repeat(121)));
  assert.equal(validateUserDisplayName("A".repeat(120)), null);
});

test("validateUserDisplayName: preserva acentos e nomes compostos", () => {
  assert.equal(validateUserDisplayName("João Ângelo Gonçalves"), null);
});

test("normalizeUserDisplayName: aplica trim mas preserva espaços internos e caixa original", () => {
  assert.equal(normalizeUserDisplayName("  Anderson Marley  "), "Anderson Marley");
  assert.equal(normalizeUserDisplayName("joão da silva"), "joão da silva");
});

// ─── resolveNomeUpdate: proteção contra mass assignment ────────────────────────────────────────

test("resolveNomeUpdate: payload válido retorna o nome normalizado", () => {
  const result = resolveNomeUpdate({ nome: "  Anderson Marley  " });
  assert.deepEqual(result, { ok: true, nome: "Anderson Marley" });
});

test("resolveNomeUpdate: payload sem 'nome' é rejeitado com 403 (mesma mensagem de dados cadastrais)", () => {
  const result = resolveNomeUpdate({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 403);
    assert.match(result.error, /Administrativo/);
  }
});

test("resolveNomeUpdate: 'perfil'/'role' no payload são ignorados — só 'nome' é lido, nunca escalona privilégio", () => {
  const result = resolveNomeUpdate({ nome: "Teste Válido", perfil: "SUPERADMIN", role: "ADMIN" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.nome, "Teste Válido");
    // A prova de que perfil/role foram ignorados: o resultado só carrega `nome`, nada mais.
    assert.deepEqual(Object.keys(result), ["ok", "nome"]);
  }
});

test("resolveNomeUpdate: 'id'/'usuario' arbitrários no payload são ignorados — nunca definem QUAL usuário é alterado", () => {
  const result = resolveNomeUpdate({ nome: "Teste Válido", id: "outro-id-qualquer", usuario: "P9999999" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(Object.keys(result), ["ok", "nome"]);
});

test("resolveNomeUpdate: nome inválido (vazio/curto/longo) retorna 400 com a mensagem de validação, não 403", () => {
  const vazio = resolveNomeUpdate({ nome: "   " });
  assert.equal(vazio.ok, false);
  if (!vazio.ok) assert.equal(vazio.status, 400);

  const curto = resolveNomeUpdate({ nome: "Jo" });
  assert.equal(curto.ok, false);
  if (!curto.ok) assert.equal(curto.status, 400);
});

test("resolveNomeUpdate: body nulo/não-objeto/nome não-string é tratado como ausência de 'nome' (403)", () => {
  assert.equal(resolveNomeUpdate(null).ok, false);
  assert.equal(resolveNomeUpdate(undefined).ok, false);
  assert.equal(resolveNomeUpdate("string solta").ok, false);
  assert.equal(resolveNomeUpdate({ nome: 123 }).ok, false);
});

// ─── Persistência real: só `nome` é gravado, outros campos do usuário nunca mudam ──────────────

test("persistência real: prisma.usuario.update com o resultado de resolveNomeUpdate altera SOMENTE o nome — usuario/perfil/id permanecem intactos", async () => {
  const suffix = `TESTE-NOME-${Date.now()}`;
  const created = await prisma.usuario.create({
    data: {
      usuario: `P${String(Date.now()).slice(-7)}`,
      nome: `${suffix}-Original`,
      senhaHash: "hash-fake-nao-usado-neste-teste",
      perfil: "MEDICAO",
      ativo: true,
    },
  });

  try {
    // Simula exatamente o payload malicioso do teste 39/40 do pedido: tenta escalar perfil e
    // trocar o próprio identificador dentro do mesmo payload de edição de nome.
    const result = resolveNomeUpdate({ nome: `${suffix}-Atualizado`, perfil: "ADMIN", usuario: "P0000001", id: "outro-id" });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const updated = await prisma.usuario.update({
      where: { id: created.id },
      data: { nome: result.nome },
      select: { id: true, usuario: true, nome: true, perfil: true, ativo: true },
    });

    assert.equal(updated.nome, `${suffix}-Atualizado`);
    assert.equal(updated.id, created.id, "o id do usuário nunca muda");
    assert.equal(updated.usuario, created.usuario, "o ID de acesso (usuario) nunca muda ao editar o nome");
    assert.equal(updated.perfil, "MEDICAO", "o perfil/role nunca é escalado por este fluxo, mesmo tentando no payload");
    assert.equal(updated.ativo, true);

    // Refresh direto do banco (não a variável local) — prova que persistiu de verdade, não só em memória.
    const reread = await prisma.usuario.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(reread.nome, `${suffix}-Atualizado`);
    assert.equal(reread.perfil, "MEDICAO");
  } finally {
    await prisma.usuario.delete({ where: { id: created.id } });
  }
});

test("persistência real: dois usuários distintos — atualizar o nome de um nunca afeta o outro", async () => {
  const suffix = `TESTE-NOME-ISOL-${Date.now()}`;
  const userA = await prisma.usuario.create({
    data: { usuario: `P${String(Date.now()).slice(-7)}`, nome: `${suffix}-A`, senhaHash: "hash-fake", perfil: "MEDICAO", ativo: true },
  });
  const userB = await prisma.usuario.create({
    data: { usuario: `P${String(Date.now() + 1).slice(-7)}`, nome: `${suffix}-B`, senhaHash: "hash-fake", perfil: "FINANCEIRO", ativo: true },
  });

  try {
    const result = resolveNomeUpdate({ nome: `${suffix}-A-Renomeado` });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    await prisma.usuario.update({ where: { id: userA.id }, data: { nome: result.nome } });

    const rereadA = await prisma.usuario.findUniqueOrThrow({ where: { id: userA.id } });
    const rereadB = await prisma.usuario.findUniqueOrThrow({ where: { id: userB.id } });
    assert.equal(rereadA.nome, `${suffix}-A-Renomeado`);
    assert.equal(rereadB.nome, `${suffix}-B`, "usuário B não pode ser afetado pela edição do usuário A");
    assert.equal(rereadB.perfil, "FINANCEIRO");
  } finally {
    await prisma.usuario.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
});
