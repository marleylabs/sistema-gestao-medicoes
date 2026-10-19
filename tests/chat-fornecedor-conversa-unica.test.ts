import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { findFornecedorConversa } from "../lib/chat-teams";

/**
 * Bug: o mesmo fornecedor aparecia duas vezes no chat da equipe. A equipe abriu uma conversa DIRECT
 * com ele e, depois, o fornecedor clicou em "Equipe de Medição", que criava TEAM:MEDICAO:<id> sem
 * procurar a conversa existente. Todo caminho de criação (POST /api/chat/conversas e importação do
 * SGC) passa a reusar findFornecedorConversa.
 */

const sufixo = randomUUID().slice(0, 8);
let fornecedor: { id: string };
let medicao: { id: string };
let financeiro: { id: string };

before(async () => {
  await assertConnectedToE2eDatabase();
  const criar = (perfil: string) => prisma.usuario.create({
    data: { usuario: `E2E-CHAT-UNICO-${perfil}-${sufixo}`, nome: `E2E Chat ${perfil}`, perfil, senhaHash: "x", ativo: true },
    select: { id: true },
  });
  [fornecedor, medicao, financeiro] = await Promise.all([criar("COLABORADOR"), criar("MEDICAO"), criar("FINANCEIRO")]);
});

after(async () => {
  const ids = [fornecedor.id, medicao.id, financeiro.id];
  await prisma.chatConversa.deleteMany({ where: { participantes: { some: { usuarioId: { in: ids } } } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
});

test("fornecedor sem conversa com a equipe interna: nenhuma é encontrada", async () => {
  assert.equal(await findFornecedorConversa(prisma, fornecedor.id), null);
});

test("conversa DIRECT já aberta pela equipe é reusada quando o fornecedor abre a Equipe de Medição", async () => {
  const direta = await prisma.chatConversa.create({
    data: {
      chave: `DIRECT:${[fornecedor.id, medicao.id].sort().join(":")}`,
      participantes: { create: [{ usuarioId: fornecedor.id }, { usuarioId: medicao.id }] },
    },
    select: { id: true },
  });
  // Conversa do Financeiro (equipe desabilitada, oculta na lista) mais recente não pode ser escolhida.
  await prisma.chatConversa.create({
    data: {
      chave: `TEAM:FINANCEIRO:${fornecedor.id}`,
      tipo: "EQUIPE",
      updatedAt: new Date(Date.now() + 60_000),
      participantes: { create: [{ usuarioId: fornecedor.id }, { usuarioId: financeiro.id }] },
    },
  });

  assert.deepEqual(await findFornecedorConversa(prisma, fornecedor.id), { id: direta.id });
});
