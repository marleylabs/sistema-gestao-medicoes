import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { prismaTest as db, assertConnectedToE2eDatabase } from "../lib/prisma-test";

// Cadastro de contratos no Administrativo (docs/brain/specs/contratos-cadastro.md).
const sufixo = `CTR${Date.now()}`;
const ator = { id: "00000000-0000-4000-8000-0000000000c3", usuario: `TESTE-${sufixo}`, nome: "Administrativo de teste" };

type Lib = typeof import("../lib/contratos-cadastro");
let lib: Lib;

before(async () => {
  await assertConnectedToE2eDatabase();
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST, "DATABASE_URL precisa ser o banco de teste");
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  lib = await import("../lib/contratos-cadastro");
});

after(async () => {
  await db.adminAuditLog.deleteMany({ where: { adminUsuario: ator.usuario } });
  await db.contrato.deleteMany({ where: { nome: { endsWith: sufixo } } });
});

async function rejeita(promessa: Promise<unknown>, status: number, mensagem?: RegExp) {
  await assert.rejects(promessa, (e: unknown) => {
    assert.ok(e instanceof lib.ContratoError, String(e));
    assert.equal(e.status, status);
    if (mensagem) assert.match(e.message, mensagem);
    return true;
  });
}

test("valor contratual: aceita ponto ou vírgula decimal, sem passar por float", () => {
  assert.equal(lib.valorContratual("1.234.567,89")?.toFixed(2), "1234567.89");
  assert.equal(lib.valorContratual("0.1")?.toFixed(2), "0.10");
  assert.equal(lib.valorContratual("9999999999999999.99")?.toFixed(2), "9999999999999999.99");
  assert.equal(lib.valorContratual(""), null);
  for (const invalido of ["-1", "1,234", "abc", "1.2.3", 1234]) assert.throws(() => lib.valorContratual(invalido), lib.ContratoError, String(invalido));
});

test("cria, edita, inativa e reativa com auditoria; valida nome, datas e vigência", async () => {
  const nome = `Contrato Salobo ${sufixo}`;
  const criado = await lib.criarContrato({
    body: { codigo: " 5900128908 ", nome, gestor: "Gestor A", fiscal: "Fiscal B", dataInicio: "2026-01-01", dataFim: "2026-12-31", valorTotal: "1.500.000,10" },
    ator,
  });
  assert.deepEqual(
    [criado.codigo, criado.dataInicio, criado.dataFim, criado.valorTotal, criado.ativo],
    ["5900128908", "2026-01-01", "2026-12-31", "1500000.10", true],
  );

  await rejeita(lib.criarContrato({ body: { nome: "  " }, ator }), 400, /nome/);
  await rejeita(lib.criarContrato({ body: { nome }, ator }), 409, /Já existe/);
  await rejeita(lib.criarContrato({ body: { nome: `X ${sufixo}`, dataInicio: "2026-02-30" }, ator }), 400, /início/);
  await rejeita(lib.atualizarContrato({ id: criado.id, body: { dataFim: "2025-12-31" }, ator }), 400, /término/);
  await rejeita(lib.atualizarContrato({ id: "00000000-0000-4000-8000-000000000999", body: { gestor: "X" }, ator }), 404);

  const editado = await lib.atualizarContrato({ id: criado.id, body: { gestor: "", valorTotal: null }, ator });
  assert.deepEqual([editado.gestor, editado.valorTotal, editado.fiscal], [null, null, "Fiscal B"], "campo ausente não muda; vazio limpa");

  assert.equal((await lib.atualizarContrato({ id: criado.id, body: { ativo: false }, ator })).ativo, false);
  await lib.atualizarContrato({ id: criado.id, body: { ativo: true }, ator });
  const acoes = await db.adminAuditLog.findMany({ where: { adminUsuario: ator.usuario, targetId: criado.id }, orderBy: { createdAt: "asc" }, select: { action: true, targetType: true } });
  assert.deepEqual(acoes.map((a) => a.action), ["CONTRATO_CRIADO", "CONTRATO_ATUALIZADO", "CONTRATO_INATIVADO", "CONTRATO_REATIVADO"]);
  assert.ok(acoes.every((a) => a.targetType === "CONTRATO"));
});

test("rotas de contratos: todas exigem requireContratos e não há DELETE", () => {
  for (const rota of ["app/api/admin/contratos/route.ts", "app/api/admin/contratos/[id]/route.ts"]) {
    const fonte = fs.readFileSync(path.join(process.cwd(), rota), "utf8");
    const handlers = fonte.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
    const guardas = fonte.match(/const auth = await requireContratos\(\);\s*if \(auth\.response\) return auth\.response;/g) ?? [];
    assert.ok(handlers.length > 0 && guardas.length === handlers.length, rota);
    assert.doesNotMatch(fonte, /export async function DELETE/, rota);
  }
});
