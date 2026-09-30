/**
 * Reconciliação de identidades (Profissional legado do ETL → Profissional canônico do
 * CadastroFornecedor). Núcleo testável; o CLI fica em scripts/prod-reconciliar-identidades.ts.
 *
 * Regras:
 *  - CadastroFornecedor é a fonte canônica; CNPJ nunca define identidade; fuzzy é só sugestão;
 *  - cada par legado → canônico é explícito (lista aprovada), nunca inferido;
 *  - o canônico só é criado quando existe CadastroFornecedor real com aquele código;
 *  - só a identidade referenciada muda (FK/código): valores, ciclos, status, datas, hashes ficam;
 *  - colisão (registro equivalente já no canônico) → REVISAR, nunca escolha automática;
 *  - o legado NÃO é apagado; aliases são um passo separado (scripts/prod-profissional-aliases.ts).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { isLegadoOperacionalArtificial } from "./legado-artificial";

type Tx = Prisma.TransactionClient;
export type Status = "APROVAR" | "REVISAR" | "REJEITAR";
export type Par = { legado: string; codigoCanonico: string };

export const ESPECIAIS = ["ENGEMELT", "GH ENGENHARIA", "PAULO SOUZA", "LEANDRO ALEIXO", "JOSE EVERTON"];
const EMPRESARIAL = /\b(LTDA|EIRELI|EPP|ME|S\/?A|ENGENHARIA|ENGEMELT|ENGEMEC|PROJETOS|SERVICOS|CONSULTORIA|ASSESSORIA|DIGITAL|INDUSTRIAIS)\b/;
const NAO_PESSOA = /(^GRD-|\d{4,}|HORAS DE ESTUDO|^\d|[-_/].*\d)/;
const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

export function normalizar(v: string | null | undefined) {
  return (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}
const tokens = (v: string) => normalizar(v).split(" ").filter((t) => t && !PARTICULAS.has(t));
/** Sugestão (nunca decisão): todos os tokens do rótulo aparecem no nome canônico e o primeiro nome coincide. */
export function sugere(rotulo: string, canonico: string) {
  const r = tokens(rotulo); const c = tokens(canonico);
  return r.length > 0 && r[0] === c[0] && r.every((t) => c.includes(t));
}
export const ehEmpresarial = (v: string) => EMPRESARIAL.test(normalizar(v));
export const ehNaoPessoa = (v: string) => NAO_PESSOA.test(normalizar(v));
export const ehEspecial = (...vs: string[]) => vs.some((v) => ESPECIAIS.some((e) => normalizar(v).includes(e)));

export type Referencias = { medicoes: number; coordenador: number; mapa: number; bmAux: number; sgc: number; sgcLogs: number; divergencias: number };

async function contar(tx: Tx, sql: Prisma.Sql) {
  return Number((await tx.$queryRaw<Array<{ n: bigint }>>(sql))[0]?.n ?? 0);
}

/** Referências por FK (id) e por código textual — auditadas em todas as colunas de texto do banco. */
export async function referencias(tx: Tx, prof: { id: string } | null, codigo: string): Promise<Referencias> {
  return {
    medicoes: prof ? await tx.medicao.count({ where: { idProfissional: prof.id } }) : 0,
    coordenador: prof ? await tx.medicao.count({ where: { idCoordenador: prof.id } }) : 0,
    mapa: await contar(tx, Prisma.sql`select count(*) n from mapa_pagamento_itens where upper(trim(projetista_codigo)) = upper(trim(${codigo}))`),
    bmAux: await contar(tx, Prisma.sql`select count(*) n from bm_aux_medicoes where upper(trim(responsavel_codigo)) = upper(trim(${codigo}))`),
    sgc: await contar(tx, Prisma.sql`select count(*) n from sgc_aprovacoes_medicao where upper(trim(colaborador_codigo)) = upper(trim(${codigo}))`),
    sgcLogs: await contar(tx, Prisma.sql`select count(*) n from sgc_logs where upper(trim(colaborador_codigo)) = upper(trim(${codigo}))`),
    divergencias: await contar(tx, Prisma.sql`select count(*) n from divergencias_medicao where upper(trim(colaborador_codigo)) = upper(trim(${codigo}))`),
  };
}
const total = (r: Referencias) => r.medicoes + r.coordenador + r.mapa + r.bmAux + r.sgc + r.sgcLogs + r.divergencias;

export type Cadastro = { id: string; colaboradorCodigo: string; responsavel: string | null; razaoSocial: string | null; cnpjFinal: string | null; ativo: boolean };

export async function carregarCadastros(tx: Tx): Promise<Cadastro[]> {
  const [{ temAtivo }] = await tx.$queryRaw<Array<{ temAtivo: boolean }>>`
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cadastros_fornecedores' and column_name = 'ativo') as "temAtivo"`;
  const rows = await tx.$queryRaw<Array<{ id: string; colaborador_codigo: string; responsavel: string | null; razao_social: string | null; cnpj: string | null; ativo: boolean }>>`
    select id::text, colaborador_codigo, responsavel, razao_social, cnpj_normalizado as cnpj, ${temAtivo ? Prisma.sql`ativo` : Prisma.sql`true`} as ativo
    from cadastros_fornecedores where colaborador_codigo is not null order by responsavel`;
  return rows.map((r) => ({ id: r.id, colaboradorCodigo: r.colaborador_codigo.trim(), responsavel: r.responsavel, razaoSocial: r.razao_social, cnpjFinal: r.cnpj ? `…${r.cnpj.slice(-6)}` : null, ativo: r.ativo }));
}

export type Avaliacao = {
  par: Par; status: Status; motivos: string[];
  cadastro: Cadastro | null;
  canonico: { id: string; codigo: string | null } | null;
  legado: { id: string; nome: string; codigo: string | null } | null;
  refsLegado: Referencias; refsCanonico: Referencias;
  usuarios: string[]; aliasesExistentes: string[]; outrosCandidatos: string[];
  colisoes: string[];
};

export async function avaliar(tx: Tx, par: Par, cadastros: Cadastro[], paresDaLista: Par[]): Promise<Avaliacao> {
  const motivos: string[] = []; const colisoes: string[] = [];
  let status: Status = "APROVAR";
  const rebaixar = (s: Status, m: string) => { motivos.push(m); if (s === "REJEITAR") status = "REJEITAR"; else if (status === "APROVAR") status = "REVISAR"; };

  const cadastro = cadastros.find((c) => normalizar(c.colaboradorCodigo) === normalizar(par.codigoCanonico)) ?? null;
  const canonico = await tx.profissional.findFirst({ where: { deletedAt: null, codigo: { equals: par.codigoCanonico.trim(), mode: "insensitive" } }, select: { id: true, codigo: true } });
  const legado = await tx.profissional.findFirst({ where: { deletedAt: null, nome: { equals: par.legado.trim(), mode: "insensitive" } }, select: { id: true, nome: true, codigo: true } });
  const refsLegado = await referencias(tx, legado, legado?.codigo ?? par.legado);
  const refsCanonico = await referencias(tx, canonico, par.codigoCanonico);
  const usuarios = cadastro?.responsavel
    ? (await tx.usuario.findMany({ where: { excluidoAt: null, nome: { equals: cadastro.responsavel.trim(), mode: "insensitive" } }, select: { usuario: true, ativo: true } })).map((u) => `${u.usuario}${u.ativo ? "" : " (inativo)"}`)
    : [];
  const [{ existe }] = await tx.$queryRaw<Array<{ existe: boolean }>>`select to_regclass('public.profissional_aliases') is not null as existe`;
  const aliasesExistentes = existe && canonico ? (await tx.profissionalAlias.findMany({ where: { profissionalId: canonico.id, ativo: true }, select: { alias: true } })).map((a) => a.alias) : [];
  const outrosCandidatos = cadastros.filter((c) => normalizar(c.colaboradorCodigo) !== normalizar(par.codigoCanonico) && sugere(par.legado, c.colaboradorCodigo)).map((c) => c.colaboradorCodigo);

  if (!cadastro) rebaixar("REJEITAR", "não existe CadastroFornecedor com o código canônico (fonte obrigatória)");
  else if (!cadastro.ativo) rebaixar("REVISAR", "CadastroFornecedor inativo");
  if (!legado) rebaixar("REJEITAR", "Profissional legado não encontrado (sem evidência em produção)");
  if (legado && canonico && legado.id === canonico.id) rebaixar("REJEITAR", "legado e canônico são o mesmo registro");
  if (legado) {
    const cadastroDoLegado = cadastros.find((c) => normalizar(c.colaboradorCodigo) === normalizar(legado.codigo ?? legado.nome));
    if (cadastroDoLegado) rebaixar("REJEITAR", "o 'legado' tem CadastroFornecedor próprio — é uma identidade canônica");
    else if (!(await isLegadoOperacionalArtificial(tx as never, legado.id))) rebaixar("REVISAR", "legado não é artefato do ETL (tem dados próprios ou Usuario com o mesmo nome) — conferir");
  }
  if (!sugere(par.legado, par.codigoCanonico)) rebaixar("REVISAR", "rótulo não é subconjunto do nome canônico (grafia diferente) — conferir manualmente");
  if (outrosCandidatos.length) rebaixar("REVISAR", `ambíguo: o rótulo também sugere ${outrosCandidatos.join(", ")}`);
  if (ehEmpresarial(par.legado) || ehEmpresarial(par.codigoCanonico)) rebaixar("REVISAR", "rótulo empresarial — nunca vira pessoa automaticamente");
  if (ehNaoPessoa(par.legado)) rebaixar("REJEITAR", "rótulo não representa pessoa (documento/GRD/texto)");
  if (ehEspecial(par.legado, par.codigoCanonico)) rebaixar("REVISAR", "caso especial com decisão de negócio pendente");
  if (paresDaLista.filter((p) => normalizar(p.legado) === normalizar(par.legado)).length > 1) rebaixar("REVISAR", "o mesmo legado aparece para mais de um canônico na lista");
  if (canonico && canonico.codigo === null) rebaixar("REVISAR", "canônico sem código");
  if (!canonico) motivos.push("canônico ausente: será criado a partir do CadastroFornecedor");

  // Colisões: registro equivalente já apontando para o canônico no mesmo ciclo.
  if (legado) {
    const codLeg = legado.codigo ?? par.legado;
    const sgcColide = await tx.$queryRaw<Array<{ ciclo: string }>>`
      select l.ciclo from sgc_aprovacoes_medicao l join sgc_aprovacoes_medicao c on c.ciclo = l.ciclo
      where upper(trim(l.colaborador_codigo)) = upper(trim(${codLeg})) and upper(trim(c.colaborador_codigo)) = upper(trim(${par.codigoCanonico}))`;
    for (const r of sgcColide) colisoes.push(`SGC ${r.ciclo} já existe para os dois`);
    const mapaColide = await tx.$queryRaw<Array<{ ciclo: string }>>`
      select distinct l.ciclo from mapa_pagamento_itens l join mapa_pagamento_itens c on c.ciclo = l.ciclo
      where upper(trim(l.projetista_codigo)) = upper(trim(${codLeg})) and upper(trim(c.projetista_codigo)) = upper(trim(${par.codigoCanonico}))`;
    for (const r of mapaColide) colisoes.push(`mapa ${r.ciclo} já tem item para os dois`);
    const bmColide = await tx.$queryRaw<Array<{ ciclo: string | null }>>`
      select distinct l.ciclo from bm_aux_medicoes l join bm_aux_medicoes c on c.ciclo is not distinct from l.ciclo
      where upper(trim(l.responsavel_codigo)) = upper(trim(${codLeg})) and upper(trim(c.responsavel_codigo)) = upper(trim(${par.codigoCanonico}))`;
    for (const r of bmColide) colisoes.push(`BM AUX ${r.ciclo ?? "sem ciclo"} já tem linhas para os dois`);
    if (colisoes.length) rebaixar("REVISAR", `colisão: ${colisoes.join("; ")}`);
  }
  if (legado && canonico && legado.id !== canonico.id && total(refsLegado) === 0 && status === "APROVAR") motivos.push("já reconciliado (idempotente: 0 mudanças)");
  return { par, status, motivos, cadastro, canonico, legado, refsLegado, refsCanonico, usuarios, aliasesExistentes, outrosCandidatos, colisoes };
}

export function fingerprint(aprovados: Avaliacao[]) {
  const plano = aprovados.map((a) => ({ legado: a.legado!.id, canonico: normalizar(a.par.codigoCanonico) })).sort((x, y) => x.legado.localeCompare(y.legado));
  return createHash("sha256").update(JSON.stringify(plano)).digest("hex");
}

export type Movimento = { legadoId: string; canonicoId: string; canonicoCriado: boolean; movidos: Referencias };

/** Aplica UM par aprovado dentro da transação recebida. Idempotente: segunda execução = 0 mudanças. */
export async function aplicarPar(tx: Tx, a: Avaliacao): Promise<Movimento> {
  if (a.status !== "APROVAR" || !a.legado || !a.cadastro) throw new Error(`Par não aprovado: ${a.par.legado} → ${a.par.codigoCanonico}`);
  const codigo = a.cadastro.colaboradorCodigo;
  let canonico = await tx.profissional.findFirst({ where: { deletedAt: null, codigo: { equals: codigo, mode: "insensitive" } }, select: { id: true } });
  let canonicoCriado = false;
  if (!canonico) {
    // Mesma convenção do upsert de lib/cadastro-fornecedor (nome = codigo = código administrativo),
    // só com dados não sensíveis do cadastro; CPF/CNPJ/e-mail não são copiados aqui.
    canonico = await tx.profissional.create({ data: { nome: codigo, codigo, nomeCompleto: a.cadastro.responsavel, razaoSocial: a.cadastro.razaoSocial }, select: { id: true } });
    canonicoCriado = true;
  }
  const codLeg = a.legado.codigo ?? a.legado.nome;
  const movidos: Referencias = {
    medicoes: (await tx.medicao.updateMany({ where: { idProfissional: a.legado.id }, data: { idProfissional: canonico.id } })).count,
    coordenador: (await tx.medicao.updateMany({ where: { idCoordenador: a.legado.id }, data: { idCoordenador: canonico.id } })).count,
    mapa: await tx.$executeRaw`update mapa_pagamento_itens set projetista_codigo = ${codigo} where upper(trim(projetista_codigo)) = upper(trim(${codLeg}))`,
    bmAux: await tx.$executeRaw`update bm_aux_medicoes set responsavel_codigo = ${codigo} where upper(trim(responsavel_codigo)) = upper(trim(${codLeg}))`,
    sgc: await tx.$executeRaw`update sgc_aprovacoes_medicao set colaborador_codigo = ${codigo} where upper(trim(colaborador_codigo)) = upper(trim(${codLeg}))`,
    sgcLogs: await tx.$executeRaw`update sgc_logs set colaborador_codigo = ${codigo} where upper(trim(colaborador_codigo)) = upper(trim(${codLeg}))`,
    divergencias: await tx.$executeRaw`update divergencias_medicao set colaborador_codigo = ${codigo} where upper(trim(colaborador_codigo)) = upper(trim(${codLeg}))`,
  };
  return { legadoId: a.legado.id, canonicoId: canonico.id, canonicoCriado, movidos };
}

export const totalMovido = (m: Movimento) => total(m.movidos) + (m.canonicoCriado ? 1 : 0);

/** Auditoria da reconciliação no mecanismo existente (admin_audit_logs). */
export async function auditar(tx: Tx, admin: { id: string; usuario: string; nome: string }, a: Avaliacao, m: Movimento, fp: string) {
  await tx.adminAuditLog.create({
    data: {
      action: "IDENTIDADE_RECONCILIADA", adminId: admin.id, adminUsuario: admin.usuario, adminNome: admin.nome,
      targetType: "Profissional", targetId: m.canonicoId, targetCodigo: a.cadastro!.colaboradorCodigo,
      reason: "Reconciliação de identidade legado → canônico aprovada par a par",
      metadata: { fingerprint: fp, legadoId: m.legadoId, legadoNome: a.legado!.nome, canonicoId: m.canonicoId, canonicoCriado: m.canonicoCriado, movidos: m.movidos },
    },
  });
}
