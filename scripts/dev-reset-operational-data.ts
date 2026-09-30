/**
 * Reset DIRIGIDO dos dados operacionais de TESTE do banco de desenvolvimento, para reimportar a
 * máscara com a resolução de identidade por alias. Nunca produção, nunca a VM, nunca o E2E.
 *
 * Remove (nesta ordem de FK): divergencias_medicao, sgc_logs, sgc_aprovacoes_medicao, medicoes,
 * bm_aux_medicoes, mapa_pagamento_itens, mapa_pagamento_contexto, etl_execucoes — e SOMENTE os
 * Profissionais legados (sem código) cujo nome é hoje um alias ativo de OUTRA identidade e que não
 * têm mais nenhuma referência (medições, cadastro, usuário).
 *
 * Preserva: cadastros_fornecedores, usuarios (+ permissões), contratos, projetos, profissionais
 * canônicos/legados restantes/coordenadores, profissional_aliases, admin_audit_logs, email_logs, chat.
 *
 * Padrão (read-only): npm run dev:reset-operational
 * APPLY: ALLOW_DEV_DATA_RESET=true npm run dev:reset-operational -- --apply \
 *          --confirm RESETAR_DADOS_OPERACIONAIS_DEV --backup <arquivo.dump>
 *        (exige <arquivo.dump>.sha256 conferindo com o arquivo)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

import { prisma } from "../lib/prisma";
import { argValue, assertDevDatabaseForWrite, assertLocalDatabase } from "./lib/dev-guard";
import { isLegadoOperacionalArtificial } from "./lib/legado-artificial";

const OPERACIONAIS = [
  "divergencias_medicao",
  "sgc_logs",
  "sgc_aprovacoes_medicao",
  "medicoes",
  "bm_aux_medicoes",
  "mapa_pagamento_itens",
  "mapa_pagamento_contexto",
  "etl_execucoes",
] as const;
const PRESERVADAS = [
  "cadastros_fornecedores", "usuarios", "usuarios_permissoes", "contratos", "projetos", "profissionais",
  "profissional_aliases", "admin_audit_logs", "email_logs", "chat_conversas", "chat_participantes", "chat_mensagens",
] as const;

// Mesma normalização de ProfissionalAlias.aliasNormalizado ("server-only" neutralizado como nos demais scripts).
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request: string, ...args: unknown[]) {
  return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
};
const { normalizePersonName } = require("../lib/cadastro-fornecedor") as typeof import("../lib/cadastro-fornecedor");

/** Legado que virou alias: sem código, nome == alias ativo de OUTRO Profissional canônico, e sem
 * vínculo administrativo (cadastro/usuário). Medições são removidas antes; "sem referência" é
 * reconferido dentro da transação. */
async function legadosQueViraramAlias() {
  const aliases = await prisma.profissionalAlias.findMany({
    where: { ativo: true, profissional: { deletedAt: null, codigo: { not: null } } },
    select: { aliasNormalizado: true, profissionalId: true },
  });
  const porAlias = new Map<string, Set<string>>();
  aliases.forEach((a) => porAlias.set(a.aliasNormalizado, (porAlias.get(a.aliasNormalizado) ?? new Set()).add(a.profissionalId)));
  // Sem código, ou legado operacional artificial (código = nome, criado pelo ETL antigo) — o critério
  // estrito é reconferido por isLegadoOperacionalArtificial abaixo.
  const legados = await prisma.profissional.findMany({ where: { deletedAt: null, OR: [{ codigo: null }, { nomeCompleto: null, razaoSocial: null, cnpj: null }] }, select: { id: true, nome: true, codigo: true } });
  const out: Array<{ id: string; nome: string; alvoId: string }> = [];
  for (const l of legados) {
    const alvos = porAlias.get(normalizePersonName(l.nome).trim());
    if (!alvos || alvos.size !== 1 || alvos.has(l.id)) continue;
    if (l.codigo && !(await isLegadoOperacionalArtificial(prisma, l.id))) continue;
    const [cadastro, usuario] = await Promise.all([
      prisma.cadastroFornecedor.count({ where: { colaboradorCodigo: { equals: l.nome.trim(), mode: "insensitive" } } }),
      prisma.usuario.count({ where: { nome: { equals: l.nome.trim(), mode: "insensitive" } } }),
    ]);
    if (cadastro === 0 && usuario === 0) out.push({ id: l.id, nome: l.nome, alvoId: [...alvos][0] });
  }
  return out;
}

async function contagens(tabelas: readonly string[]) {
  const out: Record<string, number> = {};
  for (const t of tabelas) {
    const [r] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) n from "${t}"`);
    out[t] = Number(r.n);
  }
  return out;
}

function conferirBackup(arquivo: string | undefined) {
  if (!arquivo || !existsSync(arquivo)) throw new Error("APPLY exige --backup <arquivo.dump> existente (pg_dump -Fc).");
  if (statSync(arquivo).size < 1024) throw new Error("Backup suspeito (menos de 1 KB).");
  const esperado = existsSync(`${arquivo}.sha256`) ? readFileSync(`${arquivo}.sha256`, "utf8").trim().split(/\s+/)[0] : "";
  const real = createHash("sha256").update(readFileSync(arquivo)).digest("hex");
  if (!esperado || esperado.toLowerCase() !== real) throw new Error("SHA-256 do backup não confere com <arquivo>.sha256.");
  return real;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = apply ? assertDevDatabaseForWrite("ALLOW_DEV_DATA_RESET") : assertLocalDatabase();
  const [{ banco }] = await prisma.$queryRaw<Array<{ banco: string }>>`select current_database() as banco`;
  if (banco !== db.database) throw new Error(`Conectado a "${banco}", esperado "${db.database}".`);
  const [{ existe }] = await prisma.$queryRaw<Array<{ existe: boolean }>>`select to_regclass('public.profissional_aliases') is not null as existe`;

  const antes = await contagens([...OPERACIONAIS, ...PRESERVADAS.filter((t) => t !== "profissional_aliases" || existe)]);
  const legados = existe ? await legadosQueViraramAlias() : [];
  console.log(JSON.stringify({ banco, modo: apply ? "APPLY" : "DRY-RUN", antes, legadosAliasARemover: legados.map((l) => l.nome) }, null, 2));
  if (!existe) console.log("(tabela profissional_aliases ausente — nenhum legado seria removido)");
  if (!apply) {
    console.log("DRY-RUN: nada foi alterado.");
    return;
  }

  if (argValue("--confirm") !== "RESETAR_DADOS_OPERACIONAIS_DEV") throw new Error("APPLY exige --confirm RESETAR_DADOS_OPERACIONAIS_DEV.");
  const sha = conferirBackup(argValue("--backup"));

  const removidos = await prisma.$transaction(async (tx) => {
    const r: Record<string, number> = {};
    for (const t of OPERACIONAIS) r[t] = await tx.$executeRawUnsafe(`delete from "${t}"`);
    const ids = legados.map((l) => l.id);
    r.profissionais_legados_alias = ids.length
      ? await tx.$executeRawUnsafe(
          `delete from profissionais p where p.id = any($1::uuid[])
             and (p.codigo is null or (upper(p.codigo) = upper(p.nome) and p.nome_completo is null and p.razao_social is null and p.cnpj is null and p.cpf is null and p.email is null))
             and not exists (select 1 from medicoes m where m.id_profissional = p.id or m.id_coordenador = p.id)`,
          ids,
        )
      : 0;
    if (r.profissionais_legados_alias !== ids.length) throw new Error("Legado com referência remanescente — reset abortado (rollback).");
    return r;
  }, { timeout: 120000 });

  const depois = await contagens([...OPERACIONAIS, ...PRESERVADAS]);
  for (const t of PRESERVADAS) {
    const esperado = t === "profissionais" ? antes[t] - removidos.profissionais_legados_alias : antes[t];
    if (t in antes && depois[t] !== esperado) console.warn(`ATENÇÃO: ${t} mudou (${antes[t]} → ${depois[t]}).`);
  }
  console.log(JSON.stringify({ backupSha256: sha, removidos, depois }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
