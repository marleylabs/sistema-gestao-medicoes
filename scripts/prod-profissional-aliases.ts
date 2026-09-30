/**
 * Procedimento de aliases operacionais para PRODUÇÃO (ProfissionalAlias).
 *
 * Regras (obrigatórias, reforçadas no código):
 *  - CNPJ nunca define identidade; fuzzy é só SUGESTÃO; alias só com par explícito aprovado por humano;
 *  - rótulo com cara de empresa nunca vira pessoa automaticamente; alias ambíguo bloqueia;
 *  - nenhuma criação/exclusão de Profissional; a lista do DEV é só candidata de conferência.
 *
 * AUDITORIA / DRY-RUN (padrão; transação READ ONLY — nunca grava):
 *   npm run identities:aliases:prod -- --candidatos <pares.json> --out relatorio.md --aprovados-out proposta.json
 *
 * APPLY (somente depois das migrations, do backup, da lista aprovada e em janela controlada):
 *   ALLOW_PROD_ALIAS_APPLY=true ALIAS_APPLY_ADMIN=<login ADMIN> \
 *   npm run identities:aliases:prod -- --apply --pares <aprovados.json> --alvo <host:porta/banco> \
 *     --confirm APLICAR_ALIASES_PRODUCAO --fingerprint <sha256 do dry-run>
 *
 * Arquivos de pares: [{ "alias": "RONALD LEAL", "codigoCanonico": "RONALD RAFAEL SILVA LEAL" }, …] (fora do Git).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { argValue } from "./lib/dev-guard";
import { isLegadoOperacionalArtificial } from "./lib/legado-artificial";

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request: string, ...args: unknown[]) {
  return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
};
const { normalizePersonName } = require("../lib/cadastro-fornecedor") as typeof import("../lib/cadastro-fornecedor");

type Tx = Prisma.TransactionClient;
type Par = { alias: string; codigoCanonico: string };
type Status = "APROVAR" | "REJEITAR" | "REVISAR";

/** Casos que NUNCA são aprovados automaticamente (decisão de negócio pendente). */
const ESPECIAIS = ["ENGEMELT", "GH ENGENHARIA", "PAULO SOUZA", "LEANDRO ALEIXO", "JOSE EVERTON"];
/** Identidades já resolvidas no DEV que precisam de confirmação explícita com evidência de produção. */
const CONFIRMAR = ["CRISTIANO JEFERSON", "MAURICIO SPINDOLA"];
const EMPRESARIAL = /\b(LTDA|EIRELI|EPP|ME|S\/?A|ENGENHARIA|ENGEMELT|PROJETOS|SERVICOS|SERVIÇOS|CONSULTORIA|ASSESSORIA|DIGITAL|INDUSTRIAIS)\b/;
const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

const norm = (v: string | null | undefined) => normalizePersonName(v ?? "").trim();
const tokens = (v: string) => norm(v).split(/\s+/).filter((t) => t && !PARTICULAS.has(t));
const mascararUrl = (u: string) => u.replace(/(:\/\/[^:]+:)[^@]*@/, "$1****@");
const alvoDaUrl = (u: string) => { const m = /@([^/?]+)\/([^?]+)/.exec(u); return m ? `${m[1]}/${m[2]}` : "?"; };

/** Sugestão (nunca decisão): todos os tokens do rótulo aparecem no nome canônico e o primeiro nome coincide. */
function sugere(rotulo: string, canonico: string) {
  const r = tokens(rotulo); const c = tokens(canonico);
  return r.length > 0 && r[0] === c[0] && r.every((t) => c.includes(t));
}

type Canonico = { id: string; codigo: string; nomeCompleto: string | null; cadastroAtivo: boolean; responsavel: string | null; razaoSocial: string | null; cnpjFinal: string | null };

async function carregarCanonicos(tx: Tx): Promise<Canonico[]> {
  // Antes da migration cadastro_fornecedor_inativacao a coluna `ativo` não existe: todo cadastro é
  // ativo (é o DEFAULT true que a migration aplica). Funciona antes e depois das migrations.
  const [{ temAtivo }] = await tx.$queryRaw<Array<{ temAtivo: boolean }>>`
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cadastros_fornecedores' and column_name = 'ativo') as "temAtivo"`;
  const colunaAtivo = temAtivo ? Prisma.sql`cf.ativo` : Prisma.sql`true`;
  const rows = await tx.$queryRaw<Array<{ id: string; codigo: string; nome_completo: string | null; ativo: boolean; responsavel: string | null; razao_social: string | null; cnpj: string | null }>>`
    select distinct on (p.id) p.id::text, p.codigo, p.nome_completo, ${colunaAtivo} as ativo, cf.responsavel, cf.razao_social, cf.cnpj_normalizado as cnpj
    from profissionais p
    join cadastros_fornecedores cf on upper(trim(cf.colaborador_codigo)) = upper(trim(p.codigo))
    where p.deleted_at is null and p.codigo is not null
    order by p.id, ${temAtivo ? Prisma.sql`cf.ativo desc,` : Prisma.empty} cf.updated_at desc`;
  return rows.map((r) => ({ id: r.id, codigo: r.codigo, nomeCompleto: r.nome_completo, cadastroAtivo: r.ativo, responsavel: r.responsavel, razaoSocial: r.razao_social, cnpjFinal: r.cnpj ? `…${r.cnpj.slice(-6)}` : null }));
}

/** Rótulos operacionais presentes no banco (o que as planilhas/ETL gravaram) com a contagem por origem. */
async function carregarRotulos(tx: Tx) {
  const rows = await tx.$queryRaw<Array<{ rotulo: string; origem: string; n: bigint }>>`
    select nome as rotulo, 'profissional_sem_cadastro' as origem, count(*) as n from profissionais p
      where p.deleted_at is null and not exists (select 1 from cadastros_fornecedores cf where upper(trim(cf.colaborador_codigo)) = upper(trim(p.codigo)))
      group by nome
    union all select projetista_codigo, 'mapa', count(*) from mapa_pagamento_itens where projetista_codigo is not null group by projetista_codigo
    union all select responsavel_codigo, 'bm_aux', count(*) from bm_aux_medicoes group by responsavel_codigo
    union all select colaborador_codigo, 'sgc', count(*) from sgc_aprovacoes_medicao group by colaborador_codigo`;
  const porRotulo = new Map<string, { rotulo: string; origens: Record<string, number> }>();
  for (const r of rows) {
    const k = norm(r.rotulo);
    if (!k) continue;
    const item = porRotulo.get(k) ?? { rotulo: r.rotulo.trim(), origens: {} };
    item.origens[r.origem] = (item.origens[r.origem] ?? 0) + Number(r.n);
    porRotulo.set(k, item);
  }
  return porRotulo;
}

async function evidenciaDoRotulo(tx: Tx, rotulo: string) {
  const legado = await tx.profissional.findFirst({ where: { deletedAt: null, nome: { equals: rotulo, mode: "insensitive" } }, select: { id: true, codigo: true } });
  const conta = async (sql: Prisma.Sql) => Number((await tx.$queryRaw<Array<{ n: bigint }>>(sql))[0]?.n ?? 0);
  return {
    legado,
    legadoArtificial: legado ? await isLegadoOperacionalArtificial(tx as never, legado.id) : false,
    medicoes: legado ? await tx.medicao.count({ where: { idProfissional: legado.id } }) : 0,
    coordenador: legado ? await tx.medicao.count({ where: { idCoordenador: legado.id } }) : 0,
    mapa: await conta(Prisma.sql`select count(*) n from mapa_pagamento_itens where upper(trim(projetista_codigo)) = upper(trim(${rotulo}))`),
    bmAux: await conta(Prisma.sql`select count(*) n from bm_aux_medicoes where upper(trim(responsavel_codigo)) = upper(trim(${rotulo}))`),
    sgc: await conta(Prisma.sql`select count(*) n from sgc_aprovacoes_medicao where upper(trim(colaborador_codigo)) = upper(trim(${rotulo}))`),
  };
}

type Avaliacao = {
  alias: string; aliasNormalizado: string; codigoCanonico: string; status: Status; motivos: string[];
  alvo: Canonico | null; usuarios: string[]; evidencia: Awaited<ReturnType<typeof evidenciaDoRotulo>>; outrosCandidatos: string[];
};

async function avaliarPar(tx: Tx, par: Par, canonicos: Canonico[], tabelaAliases: boolean): Promise<Avaliacao> {
  const alias = par.alias.trim();
  const aliasNormalizado = norm(alias);
  const alvo = canonicos.find((c) => norm(c.codigo) === norm(par.codigoCanonico)) ?? null;
  const evidencia = await evidenciaDoRotulo(tx, alias);
  const usuarios = alvo?.responsavel
    ? (await tx.usuario.findMany({ where: { perfil: "COLABORADOR", excluidoAt: null, nome: { equals: alvo.responsavel.trim(), mode: "insensitive" } }, select: { usuario: true, ativo: true } })).map((u) => `${u.usuario}${u.ativo ? "" : " (inativo)"}`)
    : [];
  const outrosCandidatos = canonicos.filter((c) => c.id !== alvo?.id && sugere(alias, c.codigo)).map((c) => c.codigo);
  const motivos: string[] = [];
  let status: Status = "APROVAR";
  // Precedência: REJEITAR > REVISAR > APROVAR.
  const rebaixar = (s: Status, m: string) => {
    motivos.push(m);
    if (s === "REJEITAR") status = "REJEITAR";
    else if (status === "APROVAR") status = "REVISAR";
  };

  if (!aliasNormalizado) rebaixar("REJEITAR", "alias vazio");
  if (!alvo) rebaixar("REJEITAR", "código canônico não existe em produção como Profissional com CadastroFornecedor");
  if (alvo && !alvo.cadastroAtivo) rebaixar("REVISAR", "cadastro do alvo inativo");
  if (alvo && norm(alvo.codigo) === aliasNormalizado) rebaixar("REJEITAR", "alias igual ao código canônico (desnecessário)");
  const conflito = await tx.profissional.findFirst({ where: { deletedAt: null, codigo: { equals: alias, mode: "insensitive" }, ...(alvo ? { NOT: { id: alvo.id } } : {}) }, select: { id: true, codigo: true } });
  if (conflito && !(await isLegadoOperacionalArtificial(tx as never, conflito.id))) rebaixar("REJEITAR", `alias é o código de outra identidade real (${conflito.codigo})`);
  const semEvidencia = !evidencia.legado && evidencia.mapa + evidencia.bmAux + evidencia.sgc === 0;
  if (semEvidencia) rebaixar("REVISAR", "sem evidência em produção (rótulo não aparece em nenhuma tabela) — alias não é necessário agora");
  if (outrosCandidatos.length) rebaixar("REVISAR", `ambíguo: o rótulo também sugere ${outrosCandidatos.join(", ")}`);
  if (alvo && !sugere(alias, alvo.codigo)) rebaixar("REVISAR", "rótulo não é subconjunto do nome canônico (grafia diferente) — conferir manualmente");
  if (EMPRESARIAL.test(aliasNormalizado)) rebaixar("REVISAR", "rótulo com cara de empresa — nunca vira pessoa automaticamente");
  if (ESPECIAIS.some((e) => aliasNormalizado.includes(e) || norm(par.codigoCanonico).includes(e))) rebaixar("REVISAR", "caso especial com decisão de negócio pendente — nunca aprovado automaticamente");
  if (CONFIRMAR.some((e) => aliasNormalizado.startsWith(e)) && status === "APROVAR") motivos.push("confirmado com evidência de produção (exigido para este caso)");
  if (tabelaAliases && alvo) {
    const existentes = await tx.profissionalAlias.findMany({ where: { aliasNormalizado, ativo: true }, select: { profissionalId: true } });
    if (existentes.some((a) => a.profissionalId !== alvo.id)) rebaixar("REJEITAR", "alias já aponta para outra identidade (ambíguo)");
    else if (existentes.length) { motivos.push("já cadastrado para o alvo (idempotente: nada a fazer)"); }
  }
  return { alias, aliasNormalizado, codigoCanonico: par.codigoCanonico.trim(), status, motivos, alvo, usuarios, evidencia, outrosCandidatos };
}

function fingerprintDe(aprovados: Avaliacao[]) {
  const plano = aprovados.map((a) => ({ alias: a.aliasNormalizado, alvo: a.alvo!.id })).sort((x, y) => x.alias.localeCompare(y.alias));
  return createHash("sha256").update(JSON.stringify(plano)).digest("hex");
}

function relatorio(alvoDb: string, rotulos: Array<{ rotulo: string; origens: Record<string, number>; classe: string; sugestoes: string[] }>, avaliacoes: Avaliacao[], fingerprint: string) {
  const out: string[] = [`# Aliases de produção — dry-run ${new Date().toISOString()}`, "", `Banco: \`${alvoDb}\` (somente leitura)`, ""];
  out.push("## A. Rótulos operacionais sem identidade canônica direta", "", "| Rótulo | Origens | Classe | Sugestões (fuzzy, só sugestão) |", "|---|---|---|---|");
  for (const r of rotulos) out.push(`| ${r.rotulo} | ${Object.entries(r.origens).map(([k, v]) => `${k}:${v}`).join(" ")} | ${r.classe} | ${r.sugestoes.join("; ") || "—"} |`);
  out.push("", "## B. Candidatos (lista de conferência)", "", `APROVAR: ${avaliacoes.filter((a) => a.status === "APROVAR").length} · REVISAR: ${avaliacoes.filter((a) => a.status === "REVISAR").length} · REJEITAR: ${avaliacoes.filter((a) => a.status === "REJEITAR").length}`, "");
  out.push("| # | Alias | Canônico candidato | Evidência em produção | Cadastro | Usuário | Status | Motivo |", "|---|---|---|---|---|---|---|---|");
  avaliacoes.forEach((a, i) => {
    const e = a.evidencia;
    const ev = [e.legado ? `legado ${e.legadoArtificial ? "artificial" : "com código próprio"}` : "sem legado", `medições ${e.medicoes}`, `coord ${e.coordenador}`, `mapa ${e.mapa}`, `BM AUX ${e.bmAux}`, `SGC ${e.sgc}`].join(" · ");
    const cad = a.alvo ? `${a.alvo.cadastroAtivo ? "ativo" : "INATIVO"} · ${a.alvo.razaoSocial ?? "—"} · CNPJ ${a.alvo.cnpjFinal ?? "—"}` : "—";
    out.push(`| ${i + 1} | ${a.alias} | ${a.codigoCanonico}${a.alvo ? "" : " (não encontrado)"} | ${ev} | ${cad} | ${a.usuarios.join(", ") || "—"} | **${a.status}** | ${a.motivos.join("; ") || "evidência consistente"} |`);
  });
  out.push("", `Fingerprint dos APROVAR: \`${fingerprint}\``, "", "O status é uma PROPOSTA: nenhum alias é criado sem aprovação humana da lista e do fingerprint.");
  return out.join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const alvoDb = alvoDaUrl(url);
  const apply = process.argv.includes("--apply");
  console.log(`Banco alvo: ${mascararUrl(url)} · modo: ${apply ? "APPLY" : "DRY-RUN (somente leitura)"}`);

  if (!apply) {
    const candidatosFile = argValue("--candidatos");
    const pares: Par[] = candidatosFile ? JSON.parse(readFileSync(candidatosFile, "utf8")) : [];
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [{ existe }] = await tx.$queryRaw<Array<{ existe: boolean }>>`select to_regclass('public.profissional_aliases') is not null as existe`;
      const canonicos = await carregarCanonicos(tx);
      const porRotulo = await carregarRotulos(tx);
      const codigos = new Set(canonicos.map((c) => norm(c.codigo)));
      const rotulos = Array.from(porRotulo.entries())
        .filter(([k]) => !codigos.has(k))
        .map(([k, r]) => {
          const sugestoes = canonicos.filter((c) => sugere(k, c.codigo)).map((c) => c.codigo);
          const classe = EMPRESARIAL.test(k) ? "EMPRESARIAL (não vira pessoa)" : ESPECIAIS.some((e) => k.includes(e)) ? "ESPECIAL (decisão pendente)" : sugestoes.length > 1 ? "AMBIGUO" : sugestoes.length === 1 ? "SUGESTAO_UNICA" : "SEM_EVIDENCIA_DE_ALVO";
          return { ...r, classe, sugestoes };
        })
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
      const vistos = new Map<string, string>();
      for (const p of pares) {
        const k = norm(p.alias);
        if (vistos.has(k) && vistos.get(k) !== norm(p.codigoCanonico)) throw new Error(`Alias "${p.alias}" aparece para dois alvos na lista.`);
        vistos.set(k, norm(p.codigoCanonico));
      }
      const avaliacoes: Avaliacao[] = [];
      for (const p of pares) avaliacoes.push(await avaliarPar(tx, p, canonicos, existe));
      const aprovados = avaliacoes.filter((a) => a.status === "APROVAR");
      const fingerprint = fingerprintDe(aprovados);
      const texto = relatorio(alvoDb, rotulos, avaliacoes, fingerprint);
      const out = argValue("--out");
      if (out) writeFileSync(out, texto, "utf8");
      const aprovadosOut = argValue("--aprovados-out");
      if (aprovadosOut) writeFileSync(aprovadosOut, JSON.stringify(aprovados.map((a) => ({ alias: a.alias, codigoCanonico: a.codigoCanonico })), null, 2), "utf8");
      console.log(texto);
      console.log(`\nDRY-RUN: nada foi gravado (tabela profissional_aliases ${existe ? "existe" : "ainda não existe"}).`);
    }, { timeout: 120_000 });
    return;
  }

  // ─── APPLY: todas as travas são obrigatórias ──────────────────────────────────────────────
  if (process.env.ALLOW_PROD_ALIAS_APPLY !== "true") throw new Error("APPLY exige ALLOW_PROD_ALIAS_APPLY=true.");
  if (argValue("--confirm") !== "APLICAR_ALIASES_PRODUCAO") throw new Error("APPLY exige --confirm APLICAR_ALIASES_PRODUCAO.");
  if (argValue("--alvo") !== alvoDb) throw new Error(`--alvo precisa ser exatamente o banco da DATABASE_URL (${alvoDb}).`);
  const paresFile = argValue("--pares");
  if (!paresFile) throw new Error("APPLY exige --pares <lista aprovada>.");
  const pares = JSON.parse(readFileSync(paresFile, "utf8")) as Par[];
  const fingerprintInformado = argValue("--fingerprint");
  const login = process.env.ALIAS_APPLY_ADMIN;
  const admin = login ? await prisma.usuario.findUnique({ where: { usuario: login }, select: { id: true, usuario: true, nome: true, perfil: true, ativo: true } }) : null;
  if (!admin || admin.perfil !== "ADMIN" || !admin.ativo) throw new Error("ALIAS_APPLY_ADMIN deve ser o login de um ADMIN ativo.");

  const resultado = await prisma.$transaction(async (tx) => {
    const [{ existe }] = await tx.$queryRaw<Array<{ existe: boolean }>>`select to_regclass('public.profissional_aliases') is not null as existe`;
    if (!existe) throw new Error("Tabela profissional_aliases ausente — aplique as migrations antes.");
    const canonicos = await carregarCanonicos(tx);
    const avaliacoes: Avaliacao[] = [];
    for (const p of pares) avaliacoes.push(await avaliarPar(tx, p, canonicos, true));
    const naoAprovados = avaliacoes.filter((a) => a.status !== "APROVAR");
    if (naoAprovados.length) throw new Error(`Lista contém pares que não estão APROVAR agora: ${naoAprovados.map((a) => `${a.alias} (${a.status}: ${a.motivos.join("; ")})`).join(" | ")}`);
    const fingerprint = fingerprintDe(avaliacoes);
    if (fingerprintInformado !== fingerprint) throw new Error("Fingerprint diferente do aprovado — rode o dry-run novamente e revise.");
    const antes = await tx.profissionalAlias.count();
    let criados = 0; let jaExistentes = 0;
    for (const a of avaliacoes) {
      const existente = await tx.profissionalAlias.findFirst({ where: { profissionalId: a.alvo!.id, aliasNormalizado: a.aliasNormalizado } });
      if (existente) { jaExistentes++; continue; } // idempotente
      const criado = await tx.profissionalAlias.create({
        data: {
          profissionalId: a.alvo!.id, alias: a.alias, aliasNormalizado: a.aliasNormalizado, origem: "MANUAL",
          metadata: { procedimento: "PRODUCAO_ALIASES", fingerprint, evidencia: { ...a.evidencia, legado: a.evidencia.legado?.id ?? null } },
          createdById: admin.id, createdByNome: admin.nome,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          action: "PROFISSIONAL_ALIAS_CRIADO", adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
          targetType: "Profissional", targetId: a.alvo!.id, targetCodigo: a.codigoCanonico,
          reason: "Alias operacional de produção aprovado par a par", metadata: { aliasId: criado.id, alias: a.alias, fingerprint },
        },
      });
      criados++;
    }
    const depois = await tx.profissionalAlias.count();
    return { antes, depois, criados, jaExistentes, fingerprint };
  }, { timeout: 120_000 });
  console.log(`APPLY concluído: aliases antes=${resultado.antes} depois=${resultado.depois} · criados=${resultado.criados} · já existentes=${resultado.jaExistentes} · fingerprint ${resultado.fingerprint}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
