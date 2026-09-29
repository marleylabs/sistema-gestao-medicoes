/**
 * Reconciliação controlada do invariante CadastroFornecedor ativo -> Profissional canônico.
 *
 * Padrão (sempre read-only):
 *   npm run identities:reconcile -- --dry-run
 *
 * APPLY (somente após aprovação humana do fingerprint; nunca em produção):
 *   ALLOW_IDENTITY_REPAIR=true IDENTITY_REPAIR_ADMIN=P0000001 \
 *   npm run identities:reconcile -- --apply \
 *     --confirm RECONCILIAR_CATEGORIA_A --fingerprint <sha256-aprovado>
 */
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";

type Category = "A" | "B" | "C" | "D" | "E" | "F";
type Candidate = { id: string; codigo: string | null; deletedAt: string | null };
type Audit = { id: string; targetCodigo: string | null; targetId: string | null; identityNameHashes: string[]; createdAt: string };
type User = { id: string; login: string; ativo: boolean; excluidoAt: string | null };

type RawRow = {
  cadastroId: string;
  colaboradorCodigo: string;
  responsavel: string;
  ativo: boolean;
  inativadoAt: Date | null;
  final: Date | null;
  statusContrato: string | null;
  statusCadastro: string | null;
  cadastroUpdatedAt: Date;
  cnpjLength: number;
  cnpjSuffix: string;
  cadastroCount: number;
  candidates: unknown;
  users: unknown;
  audits: unknown;
  historicalTargetCount: number;
  historicalHashCount: number;
  medicoesByHistoricalId: number;
  medicoesBySnapshot: number;
  sgc: number;
  pagamentos: number;
  mapaPagamento: number;
  bmAux: number;
  divergencias: number;
};

type ReportItem = Omit<RawRow, "inativadoAt" | "final" | "cadastroUpdatedAt" | "candidates" | "users" | "audits"> & {
  inativadoAt: string | null;
  final: string | null;
  cadastroUpdatedAt: string;
  candidates: Candidate[];
  users: User[];
  audits: Audit[];
  category: Category;
  reason: string;
};

const inactivePattern = /(INATIV|ENCERR|CANCEL|SUSPENS|VENCID)/i;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function classifyIdentity(item: {
  cadastroCount: number;
  candidates: Candidate[];
  users: User[];
  historicalTargetCount: number;
  historicalHashCount: number;
  final: string | null;
  statusContrato: string | null;
  statusCadastro: string | null;
}, today = new Date()): { category: Category; reason: string } {
  const activeCandidates = item.candidates.filter((candidate) => !candidate.deletedAt);
  const tombstones = item.candidates.filter((candidate) => !!candidate.deletedAt);
  const activeUsers = item.users.filter((user) => user.ativo && !user.excluidoAt);

  if (item.cadastroCount > 1) return { category: "D", reason: "Mais de um CadastroFornecedor ativo usa o mesmo colaboradorCodigo." };
  if (activeCandidates.length > 1 || item.historicalTargetCount > 1 || item.historicalHashCount > 1 || item.users.length > 1) {
    return { category: "C", reason: "Mais de um candidato profissional, histórico ou usuário possível." };
  }
  if (tombstones.length > 0) return { category: "E", reason: "Existe Profissional correspondente com deletedAt preenchido." };

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const finalUtc = item.final ? new Date(item.final).getTime() : null;
  if ((finalUtc !== null && finalUtc < todayUtc) || inactivePattern.test(item.statusContrato ?? "") || inactivePattern.test(item.statusCadastro ?? "")) {
    return { category: "F", reason: "Há sinal cadastral objetivo de descontinuidade; requer decisão humana." };
  }
  if (activeCandidates.length !== 0 || item.historicalTargetCount !== 1 || item.historicalHashCount < 1 || activeUsers.length !== 1) {
    return { category: "B", reason: "Histórico ou vínculo de usuário insuficiente para reconciliação automática." };
  }
  return { category: "A", reason: "Código, histórico e usuário são únicos; não há candidato atual, tombstone ou conflito." };
}

async function loadReportItems(): Promise<ReportItem[]> {
  const rows = await prisma.$queryRaw<RawRow[]>`
    with bad as (
      select c.*
      from cadastros_fornecedores c
      left join profissionais p
        on upper(trim(p.codigo)) = upper(trim(c.colaborador_codigo))
       and p.deleted_at is null
      where c.ativo = true and c.colaborador_codigo is not null
      group by c.id
      having count(p.id) <> 1
    )
    select
      b.id as "cadastroId",
      b.colaborador_codigo as "colaboradorCodigo",
      b.responsavel,
      b.ativo,
      b.inativado_at as "inativadoAt",
      b.final,
      b.status_contrato as "statusContrato",
      b.status_cadastro as "statusCadastro",
      b.updated_at as "cadastroUpdatedAt",
      length(regexp_replace(b.cnpj_normalizado, '[^0-9]', '', 'g'))::int as "cnpjLength",
      right(regexp_replace(b.cnpj_normalizado, '[^0-9]', '', 'g'), 4) as "cnpjSuffix",
      (select count(*)::int from cadastros_fornecedores c2 where c2.ativo = true and upper(trim(c2.colaborador_codigo)) = upper(trim(b.colaborador_codigo))) as "cadastroCount",
      coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'deletedAt', p.deleted_at) order by p.created_at)
        from profissionais p where upper(trim(p.codigo)) = upper(trim(b.colaborador_codigo))
      ), '[]'::jsonb) as candidates,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'login', u.usuario, 'ativo', u.ativo, 'excluidoAt', u.excluido_at) order by u.usuario)
        from usuarios u where u.perfil = 'COLABORADOR' and upper(trim(u.nome)) = upper(trim(b.responsavel))
      ), '[]'::jsonb) as users,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'targetCodigo', a.target_codigo,
          'targetId', a.target_id,
          'identityNameHashes', coalesce(a.metadata::jsonb->'identityNameHashes', '[]'::jsonb),
          'createdAt', a.created_at
        ) order by a.created_at)
        from admin_audit_logs a
        where a.action = 'FORNECEDOR_EXCLUSAO_DEFINITIVA'
          and upper(trim(a.target_codigo)) = upper(trim(b.colaborador_codigo))
      ), '[]'::jsonb) as audits,
      (select count(distinct a.target_id)::int from admin_audit_logs a where a.action = 'FORNECEDOR_EXCLUSAO_DEFINITIVA' and upper(trim(a.target_codigo)) = upper(trim(b.colaborador_codigo)) and a.target_id is not null) as "historicalTargetCount",
      (select count(distinct h.hash)::int from admin_audit_logs a cross join lateral jsonb_array_elements_text(coalesce(a.metadata::jsonb->'identityNameHashes', '[]'::jsonb)) h(hash) where a.action = 'FORNECEDOR_EXCLUSAO_DEFINITIVA' and upper(trim(a.target_codigo)) = upper(trim(b.colaborador_codigo))) as "historicalHashCount",
      (select count(*)::int from medicoes m where m.id_profissional in (select a.target_id from admin_audit_logs a where a.action = 'FORNECEDOR_EXCLUSAO_DEFINITIVA' and upper(trim(a.target_codigo)) = upper(trim(b.colaborador_codigo))) or m.id_coordenador in (select a.target_id from admin_audit_logs a where a.action = 'FORNECEDOR_EXCLUSAO_DEFINITIVA' and upper(trim(a.target_codigo)) = upper(trim(b.colaborador_codigo)))) as "medicoesByHistoricalId",
      (select count(*)::int from medicoes m where upper(trim(coalesce(m.profissional_nome_snapshot, ''))) = upper(trim(b.responsavel)) or upper(trim(coalesce(m.coordenador_nome_snapshot, ''))) = upper(trim(b.responsavel))) as "medicoesBySnapshot",
      (select count(*)::int from sgc_aprovacoes_medicao s where upper(trim(s.colaborador_codigo)) = upper(trim(b.colaborador_codigo))) as sgc,
      (select count(*)::int from sgc_aprovacoes_medicao s where upper(trim(s.colaborador_codigo)) = upper(trim(b.colaborador_codigo)) and s.pago_at is not null) as pagamentos,
      (select count(*)::int from mapa_pagamento_itens m where upper(trim(m.projetista_codigo)) = upper(trim(b.colaborador_codigo))) as "mapaPagamento",
      (select count(*)::int from bm_aux_medicoes x where upper(trim(x.responsavel_codigo)) = upper(trim(b.colaborador_codigo))) as "bmAux",
      (select count(*)::int from divergencias_medicao d where upper(trim(d.colaborador_codigo)) = upper(trim(b.colaborador_codigo))) as divergencias
    from bad b
    order by upper(trim(b.colaborador_codigo)), b.id
  `;

  return rows.map((row) => {
    const normalized = {
      ...row,
      inativadoAt: row.inativadoAt?.toISOString() ?? null,
      final: row.final?.toISOString().slice(0, 10) ?? null,
      cadastroUpdatedAt: row.cadastroUpdatedAt.toISOString(),
      candidates: asArray<Candidate>(row.candidates).map((candidate) => ({ ...candidate, deletedAt: candidate.deletedAt ? new Date(candidate.deletedAt).toISOString() : null })),
      users: asArray<User>(row.users).map((user) => ({ ...user, excluidoAt: user.excluidoAt ? new Date(user.excluidoAt).toISOString() : null })),
      audits: asArray<Audit>(row.audits).map((audit) => ({ ...audit, createdAt: new Date(audit.createdAt).toISOString(), identityNameHashes: asArray<string>(audit.identityNameHashes).sort() })),
    };
    return { ...normalized, ...classifyIdentity(normalized) };
  });
}

function fingerprintItems(items: ReportItem[]) {
  const state = items.map((item) => ({
    cadastroId: item.cadastroId,
    colaboradorCodigo: item.colaboradorCodigo,
    category: item.category,
    ativo: item.ativo,
    inativadoAt: item.inativadoAt,
    final: item.final,
    statusContrato: item.statusContrato,
    statusCadastro: item.statusCadastro,
    cadastroUpdatedAt: item.cadastroUpdatedAt,
    cadastroCount: item.cadastroCount,
    candidates: item.candidates,
    users: item.users,
    audits: item.audits,
    historicalTargetCount: item.historicalTargetCount,
    historicalHashCount: item.historicalHashCount,
    medicoesByHistoricalId: item.medicoesByHistoricalId,
    medicoesBySnapshot: item.medicoesBySnapshot,
    sgc: item.sgc,
    pagamentos: item.pagamentos,
    mapaPagamento: item.mapaPagamento,
    bmAux: item.bmAux,
    divergencias: item.divergencias,
  }));
  return createHash("sha256").update(JSON.stringify({ version: 1, items: state })).digest("hex");
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function buildReport() {
  const [items, total, consistent] = await Promise.all([
    loadReportItems(),
    prisma.cadastroFornecedor.count(),
    prisma.$queryRaw<Array<{ count: number }>>`
      select count(*)::int as count
      from cadastros_fornecedores c
      where c.ativo = true and c.colaborador_codigo is not null
        and 1 = (select count(*) from profissionais p where p.deleted_at is null and upper(trim(p.codigo)) = upper(trim(c.colaborador_codigo)))
    `,
  ]);
  const categories = Object.fromEntries((["A", "B", "C", "D", "E", "F"] as Category[]).map((category) => [category, items.filter((item) => item.category === category).length]));
  return { mode: "DRY_RUN", generatedAt: new Date().toISOString(), fingerprint: fingerprintItems(items), totals: { cadastros: total, consistent: consistent[0]?.count ?? 0, inconsistent: items.length, categories }, items };
}

async function loadService() {
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...args: unknown[]) {
    return request === "server-only" ? {} : originalLoad.call(this, request, ...args);
  };
  return import("../lib/cadastro-fornecedor");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run");
  if (apply && dryRun) throw new Error("Escolha somente --dry-run ou --apply.");

  const report = await buildReport();
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;

  if (process.env.NODE_ENV === "production") throw new Error("APPLY negado em NODE_ENV=production.");
  if (process.env.ALLOW_IDENTITY_REPAIR !== "true") throw new Error("APPLY negado: defina ALLOW_IDENTITY_REPAIR=true.");
  if (argument("--confirm") !== "RECONCILIAR_CATEGORIA_A") throw new Error("APPLY negado: confirmação explícita inválida.");
  const approvedFingerprint = argument("--fingerprint");
  if (!approvedFingerprint || approvedFingerprint !== report.fingerprint) throw new Error("APPLY abortado: fingerprint ausente ou estado diferente do dry-run aprovado.");

  const adminLogin = process.env.IDENTITY_REPAIR_ADMIN;
  if (!adminLogin) throw new Error("APPLY negado: defina IDENTITY_REPAIR_ADMIN.");
  const admin = await prisma.usuario.findUnique({ where: { usuario: adminLogin }, select: { id: true, usuario: true, nome: true, perfil: true, ativo: true, excluidoAt: true } });
  if (!admin || admin.perfil !== "ADMIN" || !admin.ativo || admin.excluidoAt) throw new Error("APPLY negado: operador ADMIN ativo não encontrado.");

  const service = await loadService();
  const results: Array<Record<string, unknown>> = [];
  for (const item of report.items.filter((candidate) => candidate.category === "A")) {
    try {
      const result = await service.reconcileActiveCadastroIdentity(item.cadastroId, admin);
      const audit = await prisma.adminAuditLog.findFirst({ where: { action: "FORNECEDOR_IDENTIDADE_RECONCILIADA", targetId: result.profissionalId }, orderBy: { createdAt: "desc" }, select: { id: true } });
      results.push({ cadastroId: item.cadastroId, colaboradorCodigo: item.colaboradorCodigo, profissionalAnterior: null, profissionalCriadoOuReutilizado: result.profissionalId, usuario: item.users[0] ?? null, resultado: result.created ? "CRIADO" : "JA_EXISTENTE", auditLogId: audit?.id ?? null });
    } catch (error) {
      results.push({ cadastroId: item.cadastroId, colaboradorCodigo: item.colaboradorCodigo, resultado: "FALHA", erro: error instanceof Error ? error.message : String(error) });
      console.error(JSON.stringify({ mode: "APPLY_ABORTADO", results }, null, 2));
      throw error;
    }
  }
  console.log(JSON.stringify({ mode: "APPLY_CONCLUIDO", approvedFingerprint, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
