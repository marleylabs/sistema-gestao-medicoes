import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Bug: GET /api/chat/conversas dava 500 intermitente (visto em e2e/timesheet-fiscal.spec.ts).
 * `joinSharedFornecedorChats` fazia `chatParticipante.upsert` por conversa; o upsert do Prisma não é
 * atômico, então duas requisições simultâneas do mesmo usuário interno (a tela dispara mais de uma)
 * tentavam inserir o mesmo (conversa_id, usuario_id) e uma caía em P2002.
 */

const sufixo = randomUUID().slice(0, 8);
let joinSharedFornecedorChats: typeof import("../app/api/chat/_helpers").joinSharedFornecedorChats;
let fornecedor: { id: string };
let medicao: { id: string };
let financeiro: { id: string; usuario: string; nome: string };
const conversaIds: string[] = [];

before(async () => {
  await assertConnectedToE2eDatabase();
  // O helper usa lib/prisma (DATABASE_URL): só roda se ele aponta para o banco de teste.
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  ({ joinSharedFornecedorChats } = await import("../app/api/chat/_helpers"));

  const criar = (perfil: string) => prisma.usuario.create({
    data: { usuario: `E2E-CHAT-JOIN-${perfil}-${sufixo}`, nome: `E2E Chat Join ${perfil}`, perfil, senhaHash: "x", ativo: true },
    select: { id: true, usuario: true, nome: true },
  });
  [fornecedor, medicao, financeiro] = await Promise.all([criar("COLABORADOR"), criar("MEDICAO"), criar("FINANCEIRO")]);
  for (let i = 0; i < 20; i++) {
    const conversa = await prisma.chatConversa.create({
      data: {
        chave: `E2E-CHAT-JOIN-${sufixo}-${i}`,
        tipo: "DIRETA",
        participantes: { create: [{ usuarioId: fornecedor.id }, { usuarioId: medicao.id }] },
      },
      select: { id: true },
    });
    conversaIds.push(conversa.id);
  }
});

after(async () => {
  await prisma.chatConversa.deleteMany({ where: { id: { in: conversaIds } } });
  await prisma.usuario.deleteMany({ where: { id: { in: [fornecedor.id, medicao.id, financeiro.id] } } });
});

test("joinSharedFornecedorChats concorrente do mesmo usuário não lança P2002", async () => {
  const user = { ...financeiro, perfil: "FINANCEIRO" };
  await Promise.all([joinSharedFornecedorChats(user), joinSharedFornecedorChats(user), joinSharedFornecedorChats(user)]);

  const participacoes = await prisma.chatParticipante.findMany({
    where: { usuarioId: financeiro.id, conversaId: { in: conversaIds } },
    select: { conversaId: true },
  });
  assert.equal(participacoes.length, conversaIds.length, "entra uma vez em cada conversa compartilhada");
});
