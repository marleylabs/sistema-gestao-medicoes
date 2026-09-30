/**
 * Reconciliação de identidades de PRODUÇÃO: restaura Profissionais canônicos ausentes (a partir do
 * CadastroFornecedor) e move as referências dos Profissionais legados do ETL para eles.
 * Núcleo e regras: scripts/lib/reconciliacao-identidades.ts. Aliases são um passo separado.
 *
 * DRY-RUN (padrão; transação READ ONLY — nunca grava):
 *   npm run identities:reconcile:prod -- --pares <pares.json> --out relatorio.md --aprovados-out aprovados.json
 *
 * APPLY (somente com a lista aprovada, depois do backup, em janela controlada):
 *   ALLOW_PROD_IDENTITY_RECONCILIATION=true RECONCILIACAO_ADMIN=<login ADMIN> \
 *   npm run identities:reconcile:prod -- --apply --pares <aprovados.json> --alvo <host:porta/banco> \
 *     --confirm RECONCILIAR_IDENTIDADES_PRODUCAO --fingerprint <sha256> \
 *     --backup <arquivo.dump> --backup-sha256 <sha256 do backup>
 *
 * Pares (fora do Git): [{ "legado": "CRISTIANO JEFERSON", "codigoCanonico": "CRISTIANO JEFERSON DA COSTA SILVA" }, …]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { prisma } from "../lib/prisma";
import { argValue } from "./lib/dev-guard";
import {
  aplicarPar, auditar, avaliar, carregarCadastros, ehEmpresarial, ehEspecial, ehNaoPessoa, fingerprint, normalizar,
  sugere, totalMovido, type Avaliacao, type Par,
} from "./lib/reconciliacao-identidades";

const mascararUrl = (u: string) => u.replace(/(:\/\/[^:]+:)[^@]*@/, "$1****@");
const alvoDaUrl = (u: string) => { const m = /@([^/?]+)\/([^?]+)/.exec(u); return m ? `${m[1]}/${m[2]}` : "?"; };
const refs = (r: Avaliacao["refsLegado"]) => `med ${r.medicoes} · coord ${r.coordenador} · mapa ${r.mapa} · BM AUX ${r.bmAux} · SGC ${r.sgc} · logs ${r.sgcLogs} · div ${r.divergencias}`;

async function contagens(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const [r] = await tx.$queryRaw<Array<Record<string, bigint>>>`
    select (select count(*) from profissionais) profissionais, (select count(*) from medicoes) medicoes,
           (select count(*) from mapa_pagamento_itens) mapa, (select count(*) from bm_aux_medicoes) bm_aux,
           (select count(*) from sgc_aprovacoes_medicao) sgc, (select count(*) from sgc_logs) sgc_logs`;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const alvoDb = alvoDaUrl(url);
  const apply = process.argv.includes("--apply");
  const paresFile = argValue("--pares");
  const pares: Par[] = paresFile ? JSON.parse(readFileSync(paresFile, "utf8")) : [];
  console.log(`Banco alvo: ${mascararUrl(url)} · modo: ${apply ? "APPLY" : "DRY-RUN (somente leitura)"}`);

  if (!apply) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const cadastros = await carregarCadastros(tx);
      const codigosCadastro = new Set(cadastros.map((c) => normalizar(c.colaboradorCodigo)));
      const profissionais = await tx.profissional.findMany({ where: { deletedAt: null }, select: { id: true, nome: true, codigo: true }, orderBy: { nome: "asc" } });

      // Categorias A–G de todos os Profissionais (somente classificação).
      const categorias = profissionais.map((p) => {
        const chave = normalizar(p.codigo ?? p.nome);
        const sugestoes = cadastros.filter((c) => sugere(p.nome, c.colaboradorCodigo)).map((c) => c.colaboradorCodigo);
        const cat =
          p.codigo && codigosCadastro.has(chave) ? "A canônico existente"
          : ehNaoPessoa(p.nome) ? "E não representa pessoa"
          : ehEmpresarial(p.nome) ? "D rótulo empresarial"
          : !p.codigo && codigosCadastro.has(normalizar(p.nome)) ? "G outro (sem código; nome = código de cadastro)"
          : sugestoes.length === 1 ? "B legado com candidato claro"
          : sugestoes.length > 1 ? "C legado ambíguo"
          : "F sem CadastroFornecedor correspondente";
        return { nome: p.nome, codigo: p.codigo, cat, sugestoes, especial: ehEspecial(p.nome) };
      });
      const porCat = categorias.reduce<Record<string, number>>((acc, c) => ((acc[c.cat] = (acc[c.cat] ?? 0) + 1), acc), {});
      const canonicosAusentes = cadastros.filter((c) => !profissionais.some((p) => p.codigo && normalizar(p.codigo) === normalizar(c.colaboradorCodigo)));

      const avaliacoes: Avaliacao[] = [];
      for (const par of pares) avaliacoes.push(await avaliar(tx, par, cadastros, pares));
      const aprovados = avaliacoes.filter((a) => a.status === "APROVAR");
      const fp = fingerprint(aprovados);

      const out: string[] = [`# Reconciliação de identidades — dry-run ${new Date().toISOString()}`, "", `Banco: \`${alvoDb}\` (somente leitura)`, ""];
      out.push("## 1. Auditoria", "", `- CadastroFornecedor: ${cadastros.length} (ativos: ${cadastros.filter((c) => c.ativo).length})`, `- Profissionais: ${profissionais.length}`, `- Cadastros sem Profissional canônico: ${canonicosAusentes.length}`, "");
      for (const [k, v] of Object.entries(porCat).sort()) out.push(`- ${k}: ${v}`);
      out.push("", "## 2. Profissionais por categoria", "", "| Profissional | Código | Categoria | Sugestão (fuzzy, só sugestão) | Especial |", "|---|---|---|---|---|");
      for (const c of categorias.sort((a, b) => a.cat.localeCompare(b.cat) || a.nome.localeCompare(b.nome, "pt-BR"))) out.push(`| ${c.nome} | ${c.codigo ?? "—"} | ${c.cat} | ${c.sugestoes.join("; ") || "—"} | ${c.especial ? "SIM" : ""} |`);
      for (const [titulo, st] of [["3. APROVAR", "APROVAR"], ["4. REVISAR", "REVISAR"], ["5. REJEITAR", "REJEITAR"]] as const) {
        const lista = avaliacoes.filter((a) => a.status === st);
        out.push("", `## ${titulo} (${lista.length})`, "", "| Legado | Canônico | Cadastro (empresa · CNPJ informativo) | Canônico existe? | Usuário | Refs do legado | Refs do canônico | Aliases | Evidência / motivo |", "|---|---|---|---|---|---|---|---|---|");
        for (const a of lista) {
          out.push(`| ${a.par.legado} | ${a.par.codigoCanonico} | ${a.cadastro ? `${a.cadastro.ativo ? "ativo" : "INATIVO"} · ${a.cadastro.razaoSocial ?? "—"} · CNPJ ${a.cadastro.cnpjFinal ?? "—"}` : "—"} | ${a.canonico ? "sim" : "NÃO (criar)"} | ${a.usuarios.join(", ") || "—"} | ${refs(a.refsLegado)} | ${refs(a.refsCanonico)} | ${a.aliasesExistentes.join(", ") || "—"} | ${a.motivos.join("; ") || "evidência consistente"} |`);
        }
      }
      out.push("", `Fingerprint dos APROVAR: \`${fp}\``, "", "Status é PROPOSTA: nada é aplicado sem aprovação humana da lista e do fingerprint.");
      const texto = out.join("\n");
      const outFile = argValue("--out");
      if (outFile) writeFileSync(outFile, texto, "utf8");
      const aprovadosOut = argValue("--aprovados-out");
      if (aprovadosOut) writeFileSync(aprovadosOut, JSON.stringify(aprovados.map((a) => a.par), null, 2), "utf8");
      console.log(texto);
      console.log("\nDRY-RUN: nada foi gravado.");
    }, { timeout: 180_000 });
    return;
  }

  // ─── APPLY: todas as travas são obrigatórias ──────────────────────────────────────────────
  if (process.env.ALLOW_PROD_IDENTITY_RECONCILIATION !== "true") throw new Error("APPLY exige ALLOW_PROD_IDENTITY_RECONCILIATION=true.");
  if (argValue("--confirm") !== "RECONCILIAR_IDENTIDADES_PRODUCAO") throw new Error("APPLY exige --confirm RECONCILIAR_IDENTIDADES_PRODUCAO.");
  if (argValue("--alvo") !== alvoDb) throw new Error(`--alvo precisa ser exatamente o banco da DATABASE_URL (${alvoDb}).`);
  if (!pares.length) throw new Error("APPLY exige --pares <lista aprovada> não vazia.");
  const backup = argValue("--backup"); const backupSha = argValue("--backup-sha256");
  if (!backup || !backupSha) throw new Error("APPLY exige --backup <arquivo> e --backup-sha256 <hash>.");
  if (createHash("sha256").update(readFileSync(backup)).digest("hex") !== backupSha) throw new Error("SHA-256 do backup não confere.");
  const login = process.env.RECONCILIACAO_ADMIN;
  const admin = login ? await prisma.usuario.findUnique({ where: { usuario: login }, select: { id: true, usuario: true, nome: true, perfil: true, ativo: true } }) : null;
  if (!admin || admin.perfil !== "ADMIN" || !admin.ativo) throw new Error("RECONCILIACAO_ADMIN deve ser o login de um ADMIN ativo.");
  const fpInformado = argValue("--fingerprint");

  const resultado = await prisma.$transaction(async (tx) => {
    const antes = await contagens(tx);
    const cadastros = await carregarCadastros(tx);
    const avaliacoes: Avaliacao[] = [];
    for (const par of pares) avaliacoes.push(await avaliar(tx, par, cadastros, pares));
    const bloqueados = avaliacoes.filter((a) => a.status !== "APROVAR");
    if (bloqueados.length) throw new Error(`Lista contém itens fora de APROVAR: ${bloqueados.map((a) => `${a.par.legado} (${a.status}: ${a.motivos.join("; ")})`).join(" | ")}`);
    const fp = fingerprint(avaliacoes);
    if (fpInformado !== fp) throw new Error("Fingerprint diferente do aprovado — rode o dry-run novamente e revise.");
    const movimentos = [];
    for (const a of avaliacoes) {
      const m = await aplicarPar(tx, a);
      if (totalMovido(m) > 0) await auditar(tx, admin, a, m, fp);
      movimentos.push({ legado: a.par.legado, canonico: a.par.codigoCanonico, ...m });
    }
    const depois = await contagens(tx);
    return { antes, depois, movimentos, fp };
  }, { timeout: 180_000 });
  console.log(JSON.stringify(resultado, null, 2));
  console.log(`APPLY concluído: ${resultado.movimentos.filter((m) => totalMovido(m) > 0).length} identidade(s) com mudança · fingerprint ${resultado.fp}`);
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
