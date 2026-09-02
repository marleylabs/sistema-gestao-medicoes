import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Guarda de regressão para um bug real encontrado via Playwright E2E (Fase 4 desta auditoria):
 * `importSgcChatsForUser` (app/api/chat/_helpers.ts), chamada por GET /api/chat/conversas — rota
 * pollada continuamente pelo GeneralChatWidget — fazia `chatConversa.upsert`/`chatMensagem.upsert`
 * sem tratar corrida entre requisições concorrentes: duas chamadas simultâneas que tentam criar a
 * MESMA `chave`/`origem` (mesmo par fornecedor/equipe, mesmo log de SGC) resultavam num
 * `PrismaClientKnownRequestError P2002` não tratado, propagando como 500 para o navegador (visto
 * nos logs do dev server durante `e2e/workflow-revision.spec.ts`). Reproduzido aqui sem "server-
 * only" (helper transitivamente importa `lib/colaborador-alias.ts`, que tem a diretiva) disparando
 * duas cópias verbatim do trecho corrigido ao mesmo tempo contra o mesmo par de chaves.
 */

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function upsertConversaFixed(chave: string, usuarioAId: string, usuarioBId: string) {
  try {
    return await prisma.chatConversa.upsert({
      where: { chave },
      create: {
        chave,
        tipo: "DIRETA",
        participantes: { create: [{ usuarioId: usuarioAId }, { usuarioId: usuarioBId }] },
      },
      update: {},
      select: { id: true },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return prisma.chatConversa.findUniqueOrThrow({ where: { chave }, select: { id: true } });
  }
}

async function upsertMensagemFixed(origem: string, conversaId: string, autorId: string) {
  try {
    await prisma.chatMensagem.upsert({
      where: { origem },
      create: { conversaId, autorId, texto: "Mensagem", origem },
      update: {},
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
  }
}

let usuarioA: { id: string };
let usuarioB: { id: string };

before(async () => {
  await assertConnectedToE2eDatabase();
  usuarioA = await prisma.usuario.create({
    data: { usuario: `E2E-CHAT-A-${randomUUID().slice(0, 8)}`, nome: "E2E Chat A", perfil: "COLABORADOR", senhaHash: "x", ativo: true },
  });
  usuarioB = await prisma.usuario.create({
    data: { usuario: `E2E-CHAT-B-${randomUUID().slice(0, 8)}`, nome: "E2E Chat B", perfil: "MEDICAO", senhaHash: "x", ativo: true },
  });
});

after(async () => {
  await prisma.chatMensagem.deleteMany({ where: { autorId: { in: [usuarioA.id, usuarioB.id] } } });
  await prisma.chatParticipante.deleteMany({ where: { usuarioId: { in: [usuarioA.id, usuarioB.id] } } });
  await prisma.chatConversa.deleteMany({ where: { chave: { startsWith: "DIRECT:E2E-CHAT-TEST-" } } });
  await prisma.usuario.deleteMany({ where: { id: { in: [usuarioA.id, usuarioB.id] } } });
});

test("chatConversa.upsert concorrente na mesma chave não lança P2002 (versão corrigida)", async () => {
  const chave = `DIRECT:E2E-CHAT-TEST-${randomUUID()}`;
  const results = await Promise.all([
    upsertConversaFixed(chave, usuarioA.id, usuarioB.id),
    upsertConversaFixed(chave, usuarioA.id, usuarioB.id),
    upsertConversaFixed(chave, usuarioA.id, usuarioB.id),
  ]);
  assert.equal(new Set(results.map((r) => r.id)).size, 1, "todas as chamadas concorrentes devem convergir para a mesma conversa");

  const count = await prisma.chatConversa.count({ where: { chave } });
  assert.equal(count, 1);
});

test("chatMensagem.upsert concorrente na mesma origem não lança P2002 (versão corrigida)", async () => {
  const chave = `DIRECT:E2E-CHAT-TEST-${randomUUID()}`;
  const conversa = await upsertConversaFixed(chave, usuarioA.id, usuarioB.id);
  const origem = `sgc:E2E-CHAT-TEST-${randomUUID()}`;

  await Promise.all([
    upsertMensagemFixed(origem, conversa.id, usuarioA.id),
    upsertMensagemFixed(origem, conversa.id, usuarioA.id),
    upsertMensagemFixed(origem, conversa.id, usuarioA.id),
  ]);

  const count = await prisma.chatMensagem.count({ where: { origem } });
  assert.equal(count, 1);
});

test("REGRESSÃO: sem o catch de P2002, a mesma corrida lança (prova de que o bug era real)", async () => {
  const chave = `DIRECT:E2E-CHAT-TEST-${randomUUID()}`;
  const attempts = await Promise.allSettled([
    prisma.chatConversa.upsert({
      where: { chave },
      create: { chave, tipo: "DIRETA", participantes: { create: [{ usuarioId: usuarioA.id }, { usuarioId: usuarioB.id }] } },
      update: {},
    }),
    prisma.chatConversa.upsert({
      where: { chave },
      create: { chave, tipo: "DIRETA", participantes: { create: [{ usuarioId: usuarioA.id }, { usuarioId: usuarioB.id }] } },
      update: {},
    }),
  ]);
  const rejected = attempts.filter((a) => a.status === "rejected");
  assert.ok(rejected.length >= 1, "a versão SEM tratamento deveria falhar sob corrida — se isso parar de falhar, o Prisma passou a tornar upsert atômico e este teste (não o fix) deve ser revisto");
});
