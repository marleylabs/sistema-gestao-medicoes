import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { enviarBoletimFornecedor } from "@/lib/bm-envio";
import { normalizarPedidoEnvioBmLote, processarEnvioBmEmLote, type ItemEnvioBm } from "@/lib/bm-envio-lote";
import { isUuid } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";

/**
 * "Enviar BMs" em lote (Fornecedores, seleção dentro de UM ciclo). Mesma permissão do envio
 * individual (POST /api/sgc/enviar → requireAdmin: MEDICAO ou ADMIN), validada antes de ler o
 * corpo. Cada BM passa pela MESMA regra do individual (`enviarBoletimFornecedor`), com o estado
 * reconsultado no servidor; IDs são de itens do mapa de pagamento e precisam pertencer ao ciclo
 * do pedido.
 *
 * `requestId` (UUID gerado uma vez por confirmação) vai no log ENVIAR_BM de cada BM enviado: um
 * replay da mesma confirmação (duplo clique, "Tentar novamente") responde "já enviado nesta
 * operação" — a guarda de status do BM já impede qualquer reenvio de fato.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const body = (await request.json().catch(() => null)) as { ids?: unknown; ciclo?: unknown; requestId?: unknown } | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!isUuid(requestId)) return NextResponse.json({ error: "requestId inválido." }, { status: 400 });
  const pedido = normalizarPedidoEnvioBmLote({ ids: body?.ids, ciclo: body?.ciclo });
  if (!pedido.ok) return NextResponse.json({ error: pedido.error }, { status: 400 });

  const usuario = { id: admin.user?.id, nome: admin.user?.nome };
  const resumo = await processarEnvioBmEmLote({
    ids: pedido.ids,
    ciclo: pedido.ciclo,
    carregar: async (ids) => {
      const itens = await prisma.mapaPagamentoItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, ciclo: true, projetistaCodigo: true, responsavel: true, updatedAt: true, identidadeImportacao: { select: { status: true } } },
      });
      const codigos = [...new Set(itens.map((i) => i.projetistaCodigo).filter((c): c is string => !!c))];
      const bms = await prisma.sgcAprovacaoMedicao.findMany({
        where: { ciclo: pedido.ciclo, colaboradorCodigo: { in: codigos } },
        select: { id: true, colaboradorCodigo: true, status: true, statusConferencia: true, revisaoSolicitadaAt: true },
      });
      const bmPorCodigo = new Map(bms.map((b) => [b.colaboradorCodigo, b]));
      // "Pagamento alterado depois da revisão" avaliado no nível do BM (todos os itens do fornecedor
      // no ciclo), exatamente como o service faz dentro da trava.
      const ultimaAlteracao = new Map((await prisma.mapaPagamentoItem.groupBy({
        by: ["projetistaCodigo"],
        where: { ciclo: pedido.ciclo, projetistaCodigo: { in: codigos } },
        _max: { updatedAt: true },
      })).map((g) => [g.projetistaCodigo, g._max.updatedAt]));
      // Replay da mesma confirmação: BMs cujo envio foi registrado com este requestId.
      const enviadosPorEsta = new Set((await prisma.sgcLog.findMany({
        where: { sgcId: { in: bms.map((b) => b.id) }, acao: { in: ["ENVIAR_BM", "REENVIAR_BM"] }, observacao: `lote:${requestId}` },
        select: { sgcId: true },
      })).map((l) => l.sgcId));
      return new Map(itens.map((i): [string, ItemEnvioBm] => {
        const bm = i.projetistaCodigo ? bmPorCodigo.get(i.projetistaCodigo) : undefined;
        return [i.id, {
          id: i.id,
          ciclo: i.ciclo,
          colaboradorCodigo: i.projetistaCodigo,
          nome: i.responsavel,
          atualizadoEm: (i.projetistaCodigo ? ultimaAlteracao.get(i.projetistaCodigo) : null) ?? i.updatedAt,
          bm: bm ? { status: bm.status, statusConferencia: bm.statusConferencia, revisaoSolicitadaAt: bm.revisaoSolicitadaAt } : null,
          enviadoNestaOperacao: bm ? enviadosPorEsta.has(bm.id) : false,
          cadastroPendente: i.identidadeImportacao?.status === "PENDENTE",
        }];
      }));
    },
    enviar: async ({ colaboradorCodigo, ciclo }) => {
      const r = await enviarBoletimFornecedor({ colaboradorCodigo, ciclo, usuario, telaOrigem: "Fornecedores / Envio em lote", requestId });
      return r.ok
        ? { ok: true, alreadyProcessed: r.alreadyProcessed, emailOk: r.emailNotificacao.ok }
        : { ok: false, motivo: r.motivo, mensagem: r.error, statusAtual: r.statusAtual };
    },
  });

  return NextResponse.json(resumo);
}
