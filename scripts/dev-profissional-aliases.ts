/**
 * Aliases operacionais iniciais (ProfissionalAlias, origem MIGRACAO_DEV) a partir de uma lista de
 * pares revisada por humano — NUNCA gerada automaticamente por nome parecido.
 *
 * Arquivo de pares (fora do repositório): [{ "alias": "RONALD LEAL", "codigoCanonico": "RONALD RAFAEL SILVA LEAL" }, …]
 *
 * Padrão (sempre read-only):
 *   npm run identities:aliases -- --pairs <arquivo.json> [--out relatorio.md]
 *
 * APPLY (somente no banco de desenvolvimento, após aprovação humana do fingerprint):
 *   ALLOW_DEV_ALIAS_SEED=true ALIAS_SEED_ADMIN=P0000001 \
 *   npm run identities:aliases -- --pairs <arquivo.json> --apply --confirm APLICAR_ALIASES_DEV --fingerprint <sha256>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { prisma } from "../lib/prisma";
import { argValue, assertDevDatabaseForWrite, assertLocalDatabase } from "./lib/dev-guard";

// Mesma normalização de ProfissionalAlias.aliasNormalizado (lib/profissional-identidade.ts::normalizarAlias);
// lib/cadastro-fornecedor declara "server-only", neutralizado aqui como nos demais scripts.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request: string, ...args: unknown[]) {
  return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
};
const { normalizePersonName } = require("../lib/cadastro-fornecedor") as typeof import("../lib/cadastro-fornecedor");

let tabelaAliasesExiste = false;

type Par = { alias: string; codigoCanonico: string };
type Linha = {
  alias: string;
  aliasNormalizado: string;
  codigoCanonico: string;
  status: "OK" | "JA_EXISTE" | "BLOQUEADO";
  motivo: string;
  alvo: { id: string; codigo: string | null; nomeCompleto: string | null } | null;
  cadastro: { ativo: boolean; responsavel: string | null; razaoSocial: string | null; cnpjFinal: string | null } | null;
  usuarios: string[];
  medicoesAlvo: number;
  legado: { id: string; codigo: string | null } | null;
  historicoLegado: { medicoes: number; coordenador: number; mapa: number; bmAux: number; sgc: number; divergencias: number };
};

async function contar(sql: string, valor: string) {
  const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql, valor);
  return Number(row?.n ?? 0);
}

async function analisar(par: Par): Promise<Linha> {
  const alias = par.alias.trim();
  const aliasNormalizado = normalizePersonName(alias).trim();
  const codigoCanonico = par.codigoCanonico.trim();
  const base: Linha = {
    alias, aliasNormalizado, codigoCanonico, status: "OK", motivo: "", alvo: null, cadastro: null, usuarios: [], medicoesAlvo: 0, legado: null,
    historicoLegado: { medicoes: 0, coordenador: 0, mapa: 0, bmAux: 0, sgc: 0, divergencias: 0 },
  };

  const alvo = await prisma.profissional.findFirst({ where: { codigo: codigoCanonico, deletedAt: null }, select: { id: true, codigo: true, nomeCompleto: true } });
  base.alvo = alvo;
  if (alvo) {
    const cadastro = await prisma.cadastroFornecedor.findFirst({
      where: { colaboradorCodigo: codigoCanonico }, orderBy: [{ ativo: "desc" }, { updatedAt: "desc" }],
      select: { ativo: true, responsavel: true, razaoSocial: true, cnpjNormalizado: true },
    });
    base.cadastro = cadastro && { ativo: cadastro.ativo, responsavel: cadastro.responsavel, razaoSocial: cadastro.razaoSocial, cnpjFinal: cadastro.cnpjNormalizado ? `…${cadastro.cnpjNormalizado.slice(-6)}` : null };
    if (cadastro?.responsavel) {
      const usuarios = await prisma.usuario.findMany({ where: { perfil: "COLABORADOR", excluidoAt: null, nome: { equals: cadastro.responsavel.trim(), mode: "insensitive" } }, select: { usuario: true, ativo: true } });
      base.usuarios = usuarios.map((u) => `${u.usuario}${u.ativo ? "" : " (inativo)"}`);
    }
    base.medicoesAlvo = await prisma.medicao.count({ where: { idProfissional: alvo.id } });
  }

  const legado = await prisma.profissional.findFirst({ where: { deletedAt: null, nome: { equals: alias, mode: "insensitive" } }, select: { id: true, codigo: true } });
  base.legado = legado;
  if (legado) {
    base.historicoLegado.medicoes = await prisma.medicao.count({ where: { idProfissional: legado.id } });
    base.historicoLegado.coordenador = await prisma.medicao.count({ where: { idCoordenador: legado.id } });
  }
  base.historicoLegado.mapa = await contar(`select count(*) n from mapa_pagamento_itens where upper(trim(projetista_codigo)) = upper(trim($1))`, alias);
  base.historicoLegado.bmAux = await contar(`select count(*) n from bm_aux_medicoes where upper(trim(responsavel_codigo)) = upper(trim($1))`, alias);
  base.historicoLegado.sgc = await contar(`select count(*) n from sgc_aprovacoes_medicao where upper(trim(colaborador_codigo)) = upper(trim($1))`, alias);
  base.historicoLegado.divergencias = await contar(`select count(*) n from divergencias_medicao where upper(trim(colaborador_codigo)) = upper(trim($1))`, alias);

  const bloquear = (motivo: string) => ({ ...base, status: "BLOQUEADO" as const, motivo });
  if (!aliasNormalizado) return bloquear("alias vazio");
  if (!alvo) return bloquear("código canônico não existe como Profissional ativo");
  if (!base.cadastro) return bloquear("alvo sem CadastroFornecedor");
  if (!base.cadastro.ativo) return bloquear("cadastro do alvo inativo");
  if (normalizePersonName(codigoCanonico) === aliasNormalizado) return bloquear("alias igual ao código canônico");
  // O alias não pode ser o código canônico de OUTRA identidade.
  const outroCodigo = await prisma.profissional.findFirst({ where: { deletedAt: null, codigo: { equals: alias, mode: "insensitive" }, NOT: { id: alvo.id } }, select: { codigo: true } });
  if (outroCodigo) return bloquear(`alias é o código canônico de outra identidade (${outroCodigo.codigo})`);
  if (legado?.codigo) return bloquear(`já existe Profissional com esse nome e código próprio (${legado.codigo})`);
  const existentes = tabelaAliasesExiste
    ? await prisma.profissionalAlias.findMany({ where: { aliasNormalizado, ativo: true }, select: { profissionalId: true } })
    : [];
  if (existentes.some((a) => a.profissionalId !== alvo.id)) return bloquear("alias já aponta para outra identidade (ficaria ambíguo)");
  if (existentes.some((a) => a.profissionalId === alvo.id)) return { ...base, status: "JA_EXISTE", motivo: "alias já cadastrado para o alvo" };
  return base;
}

function relatorio(linhas: Linha[], fingerprint: string) {
  const out = [`# Dry-run de aliases operacionais — ${new Date().toISOString()}`, "", `Fingerprint do plano: \`${fingerprint}\``, "",
    `OK: ${linhas.filter((l) => l.status === "OK").length} · já existentes: ${linhas.filter((l) => l.status === "JA_EXISTE").length} · bloqueados: ${linhas.filter((l) => l.status === "BLOQUEADO").length}`, ""];
  linhas.forEach((l, i) => {
    out.push(`## ${i + 1}. ${l.alias} → ${l.codigoCanonico} — ${l.status}${l.motivo ? ` (${l.motivo})` : ""}`);
    out.push(`- Alvo: ${l.alvo ? `${l.alvo.id} · código ${l.alvo.codigo} · ${l.alvo.nomeCompleto ?? "—"} · ${l.medicoesAlvo} medição(ões)` : "—"}`);
    out.push(`- Cadastro: ${l.cadastro ? `${l.cadastro.ativo ? "ativo" : "INATIVO"} · ${l.cadastro.responsavel ?? "—"} · ${l.cadastro.razaoSocial ?? "—"} · CNPJ ${l.cadastro.cnpjFinal ?? "—"}` : "—"}`);
    out.push(`- Usuário(s): ${l.usuarios.join(", ") || "—"}`);
    const h = l.historicoLegado;
    out.push(`- Legado "${l.alias}": ${l.legado ? `${l.legado.id}${l.legado.codigo ? ` (código ${l.legado.codigo})` : " (sem código)"}` : "não existe"} · medições ${h.medicoes} · coord ${h.coordenador} · mapa ${h.mapa} · BM AUX ${h.bmAux} · SGC ${h.sgc} · divergências ${h.divergencias}`);
    out.push(`- [ ] aprovar`, "");
  });
  return out.join("\n");
}

async function main() {
  const pairsFile = argValue("--pairs");
  if (!pairsFile) throw new Error("Informe --pairs <arquivo.json>.");
  const apply = process.argv.includes("--apply");
  if (apply) assertDevDatabaseForWrite("ALLOW_DEV_ALIAS_SEED"); else assertLocalDatabase();

  const [{ existe }] = await prisma.$queryRaw<Array<{ existe: boolean }>>`select to_regclass('public.profissional_aliases') is not null as existe`;
  tabelaAliasesExiste = existe;
  if (apply && !tabelaAliasesExiste) throw new Error("Tabela profissional_aliases ausente — aplique a migração 20260930090000_profissional_alias antes.");
  if (!tabelaAliasesExiste) console.log("(tabela profissional_aliases ainda não existe neste banco — dry-run sem checar aliases já cadastrados)");
  const pares = JSON.parse(readFileSync(pairsFile, "utf8")) as Par[];
  const vistos = new Map<string, string>();
  for (const p of pares) {
    const k = normalizePersonName(p.alias).trim();
    if (vistos.has(k) && vistos.get(k) !== p.codigoCanonico) throw new Error(`Alias "${p.alias}" aparece para dois alvos no arquivo de pares.`);
    vistos.set(k, p.codigoCanonico);
  }
  const linhas: Linha[] = [];
  for (const par of pares) linhas.push(await analisar(par));
  const plano = linhas.filter((l) => l.status === "OK").map((l) => ({ alias: l.aliasNormalizado, alvo: l.alvo!.id }));
  const fingerprint = createHash("sha256").update(JSON.stringify(plano)).digest("hex");
  const texto = relatorio(linhas, fingerprint);
  const out = argValue("--out");
  if (out) writeFileSync(out, texto, "utf8");
  console.log(texto);

  if (!apply) {
    console.log("\nDRY-RUN: nada foi gravado.");
    return;
  }
  if (argValue("--confirm") !== "APLICAR_ALIASES_DEV") throw new Error("APPLY exige --confirm APLICAR_ALIASES_DEV.");
  if (argValue("--fingerprint") !== fingerprint) throw new Error("Fingerprint diferente do plano aprovado — rode o dry-run novamente e revise.");
  const login = process.env.ALIAS_SEED_ADMIN;
  const admin = login ? await prisma.usuario.findUnique({ where: { usuario: login }, select: { id: true, usuario: true, nome: true, perfil: true } }) : null;
  if (!admin || admin.perfil !== "ADMIN") throw new Error("ALIAS_SEED_ADMIN deve ser o login de um ADMIN existente.");

  const criados = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const l of linhas.filter((x) => x.status === "OK")) {
      const alias = await tx.profissionalAlias.create({
        data: {
          profissionalId: l.alvo!.id, alias: l.alias, aliasNormalizado: l.aliasNormalizado, origem: "MIGRACAO_DEV",
          metadata: { fingerprint, legadoId: l.legado?.id ?? null, historicoLegado: l.historicoLegado },
          createdById: admin.id, createdByNome: admin.nome,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          action: "PROFISSIONAL_ALIAS_CRIADO", adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
          targetType: "Profissional", targetId: l.alvo!.id, targetCodigo: l.codigoCanonico,
          reason: "Alias operacional inicial (MIGRACAO_DEV) revisado par a par", metadata: { aliasId: alias.id, alias: l.alias, fingerprint },
        },
      });
      ids.push(alias.id);
    }
    return ids;
  });
  console.log(`\nAPPLY: ${criados.length} alias(es) criados (origem MIGRACAO_DEV).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
