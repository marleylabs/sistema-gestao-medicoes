import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { aplicarMesclagemChat, planejarMesclagemChat } from "../lib/chat-mesclar-duplicadas";

const sufixo = randomUUID().slice(0, 8);
let fornecedor: { id: string };
let medicaoA: { id: string };
let medicaoB: { id: string };
let financeiro: { id: string };

before(async () => {
  await assertConnectedToE2eDatabase();
  const criar = (perfil: string, n = "") => prisma.usuario.create({
    data: { usuario: `E2E-CHAT-MESCLA-${perfil}${n}-${sufixo}`, nome: `E2E Mescla ${perfil}`, perfil, senhaHash: "x", ativo: true },
    select: { id: true },
  });
  [fornecedor, medicaoA, medicaoB, financeiro] = await Promise.all([criar("COLABORADOR"), criar("MEDICAO", "A"), criar("MEDICAO", "B"), criar("FINANCEIRO")]);
});

after(async () => {
  const ids = [fornecedor.id, medicaoA.id, medicaoB.id, financeiro.id];
  await prisma.chatConversa.deleteMany({ where: { participantes: { some: { usuarioId: { in: ids } } } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
});

test("mescla a conversa duplicada do fornecedor na mais recente, sem perder mensagens nem participantes", async () => {
  const lidoA = new Date("2026-10-01T12:00:00Z");
  const antiga = await prisma.chatConversa.create({
    data: {
      chave: `DIRECT:${[fornecedor.id, medicaoA.id].sort().join(":")}`,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      participantes: { create: [{ usuarioId: fornecedor.id }, { usuarioId: medicaoA.id, ultimoLidoAt: lidoA }] },
      mensagens: { create: [{ autorId: medicaoA.id, texto: "f5 na página" }, { autorId: fornecedor.id, texto: "ok" }] },
    },
    select: { id: true },
  });
  const recente = await prisma.chatConversa.create({
    data: {
      chave: `TEAM:MEDICAO:${fornecedor.id}`,
      tipo: "EQUIPE",
      updatedAt: new Date("2026-10-02T00:00:00Z"),
      participantes: { create: [{ usuarioId: fornecedor.id }, { usuarioId: medicaoB.id }] },
    },
    select: { id: true },
  });
  // Financeiro é equipe desabilitada: não entra na mesclagem.
  const doFinanceiro = await prisma.chatConversa.create({
    data: { chave: `TEAM:FINANCEIRO:${fornecedor.id}`, tipo: "EQUIPE", participantes: { create: [{ usuarioId: fornecedor.id }, { usuarioId: financeiro.id }] } },
    select: { id: true },
  });

  const grupos = (await planejarMesclagemChat(prisma)).filter((g) => g.fornecedorId === fornecedor.id);
  assert.deepEqual(grupos.map(({ manterId, mesclarIds, mensagens }) => ({ manterId, mesclarIds, mensagens })), [
    { manterId: recente.id, mesclarIds: [antiga.id], mensagens: 2 },
  ]);

  assert.deepEqual(await aplicarMesclagemChat(prisma, grupos), { fornecedores: 1, conversasRemovidas: 1, mensagensMovidas: 2 });

  assert.equal(await prisma.chatConversa.count({ where: { id: antiga.id } }), 0);
  assert.equal(await prisma.chatConversa.count({ where: { id: doFinanceiro.id } }), 1);
  assert.equal(await prisma.chatMensagem.count({ where: { conversaId: recente.id } }), 2);
  const participantes = await prisma.chatParticipante.findMany({ where: { conversaId: recente.id }, select: { usuarioId: true, ultimoLidoAt: true } });
  assert.deepEqual(
    participantes.map((p) => p.usuarioId).sort(),
    [fornecedor.id, medicaoA.id, medicaoB.id].sort(),
  );
  assert.deepEqual(participantes.find((p) => p.usuarioId === medicaoA.id)?.ultimoLidoAt, lidoA);

  const depois = (await planejarMesclagemChat(prisma)).filter((g) => g.fornecedorId === fornecedor.id);
  assert.deepEqual(depois, [], "rodar de novo não encontra mais duplicatas");
});
