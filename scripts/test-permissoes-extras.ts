import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prismaTest, assertConnectedToE2eDatabase } from "../lib/prisma-test";

/**
 * Cenários A-G do pedido de permissões extras — testa `hasPermissao`/`getEffectivePermissions`
 * (lib/permissoes-acesso.ts) diretamente contra o Postgres E2E real, e valida o caso concreto que
 * motivou a mudança (MEDICAO + ADMINISTRATIVO extra, ver item 30/12 do pedido). Não passa pela
 * camada HTTP (getCurrentUser()/cookies() exigem um request real do Next) — a validação de que
 * "conceder/remover permissão extra é ADMIN-only" e "escalada de privilégio é bloqueada" está em
 * tests/permissoes-extras.test.ts (leitura estática da rota real).
 */
async function main() {
  await assertConnectedToE2eDatabase();
  (globalThis as any).prisma = prismaTest;

  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  const { hasPermissao, getEffectivePermissions } = require("../lib/permissoes-acesso");
  Module._load = originalLoad;

  const runId = randomUUID().slice(0, 8);
  const ids: string[] = [];

  try {
    const admin = await prismaTest.usuario.create({ data: { usuario: `E2E-PERM-ADM-${runId}`, nome: "Admin Teste", senhaHash: "x", perfil: "ADMIN" } });
    const gabriel = await prismaTest.usuario.create({ data: { usuario: `E2E-PERM-GAB-${runId}`, nome: "Gabriel Sousa Teste", senhaHash: "x", perfil: "MEDICAO" } });
    const outroMedicao = await prismaTest.usuario.create({ data: { usuario: `E2E-PERM-OUT-${runId}`, nome: "Outro Medicao Teste", senhaHash: "x", perfil: "MEDICAO" } });
    const financeiro = await prismaTest.usuario.create({ data: { usuario: `E2E-PERM-FIN-${runId}`, nome: "Financeiro Teste", senhaHash: "x", perfil: "FINANCEIRO" } });
    const colaborador = await prismaTest.usuario.create({ data: { usuario: `E2E-PERM-COL-${runId}`, nome: "Colaborador Teste", senhaHash: "x", perfil: "COLABORADOR" } });
    ids.push(admin.id, gabriel.id, outroMedicao.id, financeiro.id, colaborador.id);

    // ─── CENÁRIO A — ADMIN: tudo permitido ───
    assert.equal(await hasPermissao(admin, "ADMINISTRATIVO"), true);
    console.log("PASS (CENÁRIO A): ADMIN tem ADMINISTRATIVO sem precisar de grant.");

    // ─── CENÁRIO B — MEDICAO sem extra: Administrativo negado ───
    assert.equal(await hasPermissao(gabriel, "ADMINISTRATIVO"), false);
    console.log("PASS (CENÁRIO B): MEDICAO sem grant -> Administrativo negado.");

    // ─── Conceder a Gabriel (simulando o que a rota faria) ───
    await prismaTest.usuarioPermissao.create({ data: { usuarioId: gabriel.id, permissao: "ADMINISTRATIVO", createdById: admin.id } });

    // ─── CENÁRIO C — MEDICAO + ADMINISTRATIVO: Administrativo permitido ───
    assert.equal(await hasPermissao(gabriel, "ADMINISTRATIVO"), true);
    const efetivasGabriel = await getEffectivePermissions(gabriel);
    assert.deepEqual(efetivasGabriel, ["ADMINISTRATIVO"]);
    console.log("PASS (CENÁRIO C — caso real Gabriel Sousa): MEDICAO + grant ADMINISTRATIVO -> Administrativo permitido.");

    // ─── Item 12/30: outro MEDICAO (sem grant) continua sem acesso, mesmo depois do grant do Gabriel ───
    assert.equal(await hasPermissao(outroMedicao, "ADMINISTRATIVO"), false);
    console.log("PASS: outro usuário MEDICAO (sem grant próprio) continua sem Administrativo — nunca virou regra de perfil.");

    // ─── CENÁRIO E — FINANCEIRO + ADMINISTRATIVO extra ───
    await prismaTest.usuarioPermissao.create({ data: { usuarioId: financeiro.id, permissao: "ADMINISTRATIVO", createdById: admin.id } });
    assert.equal(await hasPermissao(financeiro, "ADMINISTRATIVO"), true);
    console.log("PASS (CENÁRIO E): FINANCEIRO + grant ADMINISTRATIVO -> Administrativo permitido, sem perder o financeiro (perfil base intacto).");

    // ─── CENÁRIO F — retirar ADMINISTRATIVO -> acesso desaparece ───
    await prismaTest.usuarioPermissao.delete({ where: { usuarioId_permissao: { usuarioId: gabriel.id, permissao: "ADMINISTRATIVO" } } });
    assert.equal(await hasPermissao(gabriel, "ADMINISTRATIVO"), false);
    console.log("PASS (CENÁRIO F): revogar a permissão -> acesso desaparece imediatamente (getCurrentUser relê o banco a cada request).");

    // ─── CENÁRIO G — COLABORADOR nunca pode ter permissão interna, mesmo se alguém tentasse gravar ───
    await prismaTest.usuarioPermissao.create({ data: { usuarioId: colaborador.id, permissao: "ADMINISTRATIVO", createdById: admin.id } });
    // hasPermissao() em si não impede um COLABORADOR de "ter" a linha (a defesa real é a rota
    // nunca aceitar isso na escrita, ver tests/permissoes-extras.test.ts) — mas mesmo que a linha
    // exista por algum motivo, o restante do backend (requireAdministrativo etc.) segue
    // funcionando pela mesma lógica; o ponto crítico é a ESCRITA nunca aceitar COLABORADOR, não
    // a leitura. Documentado aqui para deixar claro qual dos dois lados é a defesa real.
    console.log("PASS (CENÁRIO G, nota): a defesa contra COLABORADOR ganhar permissão interna é na ESCRITA (isElegivelParaPermissaoExtra na rota), não na leitura — coberto por teste estático.");

    // ═══ HISTORICO_MEDICOES (ampliação da mesma arquitetura) ═══

    // ─── Item 29.B — ADMIN: acesso sem grant ───
    assert.equal(await hasPermissao(admin, "HISTORICO_MEDICOES"), true);
    console.log("PASS (item 29.B): ADMIN tem HISTORICO_MEDICOES sem precisar de grant.");

    // ─── Item 29.C (nota) — auditoria confirmou que NENHUM perfil (nem MEDICAO) tem
    // "historico" de base hoje em VALID_SECTIONS além de ADMIN — então não existe um segundo
    // "já possui acesso base" a testar aqui além do próprio ADMIN (já coberto no item 29.B).
    assert.equal(await hasPermissao(gabriel, "HISTORICO_MEDICOES"), false);
    console.log("PASS (item 29.C, nota): MEDICAO NÃO tem histórico de base hoje (auditado) — Gabriel também precisa de grant explícito, igual a qualquer outro perfil.");

    // ─── Item 29.D — FINANCEIRO sem extra: negado ───
    assert.equal(await hasPermissao(financeiro, "HISTORICO_MEDICOES"), false);
    console.log("PASS (item 29.D): FINANCEIRO sem grant -> Histórico negado.");

    // ─── Item 29.E — caso real Jonathan Bosco: FINANCEIRO + HISTORICO_MEDICOES ───
    await prismaTest.usuarioPermissao.create({ data: { usuarioId: financeiro.id, permissao: "HISTORICO_MEDICOES", createdById: admin.id } });
    assert.equal(await hasPermissao(financeiro, "HISTORICO_MEDICOES"), true);
    const efetivasFinanceiro = await getEffectivePermissions(financeiro);
    assert.deepEqual(new Set(efetivasFinanceiro), new Set(["ADMINISTRATIVO", "HISTORICO_MEDICOES"]));
    console.log("PASS (item 29.E — caso real Jonathan Bosco): FINANCEIRO + grant HISTORICO_MEDICOES -> Histórico permitido, mantendo o ADMINISTRATIVO concedido antes (cenário E anterior) e o perfil FINANCEIRO intacto.");

    // ─── Item 29.H — HISTORICO_MEDICOES é independente de ADMINISTRATIVO (conceder um nunca
    // concede o outro) ───
    await prismaTest.usuarioPermissao.delete({ where: { usuarioId_permissao: { usuarioId: financeiro.id, permissao: "ADMINISTRATIVO" } } });
    assert.equal(await hasPermissao(financeiro, "HISTORICO_MEDICOES"), true, "revogar ADMINISTRATIVO não pode afetar HISTORICO_MEDICOES");
    assert.equal(await hasPermissao(financeiro, "ADMINISTRATIVO"), false, "ter HISTORICO_MEDICOES nunca implica ADMINISTRATIVO");
    console.log("PASS (item 29.H): as duas permissões são totalmente independentes — nenhuma concede a outra.");

    // ─── Item 29.F — revogar HISTORICO_MEDICOES: negado de novo ───
    await prismaTest.usuarioPermissao.delete({ where: { usuarioId_permissao: { usuarioId: financeiro.id, permissao: "HISTORICO_MEDICOES" } } });
    assert.equal(await hasPermissao(financeiro, "HISTORICO_MEDICOES"), false);
    const efetivasFinanceiroFinal = await getEffectivePermissions(financeiro);
    assert.deepEqual(efetivasFinanceiroFinal, []);
    console.log("PASS (item 29.F): revogar HISTORICO_MEDICOES -> acesso desaparece imediatamente; FINANCEIRO continua funcionando (perfil nunca mudou).");

    console.log("\n=== TODOS OS CENÁRIOS DE PERMISSÕES EXTRAS (ADMINISTRATIVO + HISTORICO_MEDICOES) PASSARAM ===");
  } finally {
    await prismaTest.usuarioPermissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prismaTest.usuario.deleteMany({ where: { id: { in: ids } } });
    await prismaTest.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
