import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logBmAction } from "@/lib/bm-log";

type Action = "SALVAR" | "ENVIAR" | "VOLTAR" | "CANCELAR" | "SOLICITAR_REVISAO";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });

  const payload = await request.json().catch(() => null);
  const action: Action = payload?.action;
  const observacao: string = typeof payload?.observacao === "string" ? payload.observacao.trim() : "";
  const pontosDiscordancia: string = typeof payload?.pontosDiscordancia === "string" ? payload.pontosDiscordancia.trim() : "";

  const allowed: Action[] = ["SALVAR", "ENVIAR", "VOLTAR", "CANCELAR", "SOLICITAR_REVISAO"];
  if (!allowed.includes(action)) {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  const existing = await prisma.sgcAprovacaoMedicao.findFirst({
    where: { colaboradorCodigo: user.usuario, status: { notIn: ["AGUARDANDO_ENVIO", "CANCELADO"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!existing) {
    return NextResponse.json({ error: "Nenhuma medição ativa encontrada." }, { status: 404 });
  }

  const now = new Date();
  const logBase = {
    sgcId: existing.id,
    colaboradorCodigo: user.usuario,
    ciclo: existing.ciclo,
    usuarioId: user.id,
    usuarioNome: user.nome,
    telaOrigem: "Portal do Colaborador",
  };

  // ── SALVAR ────────────────────────────────────────────────────────────────────
  if (action === "SALVAR") {
    if (!["PENDENTE", "REVISAO_SOLICITADA"].includes(existing.status)) {
      return NextResponse.json({ error: "Somente medições pendentes podem ser salvas." }, { status: 409 });
    }
    await prisma.sgcAprovacaoMedicao.update({
      where: { id: existing.id },
      data: { salvoAt: now, observacaoColaborador: observacao || null, updatedAt: now },
    });
    await logBmAction({ ...logBase, acao: "SALVAR", statusAnterior: existing.status, statusNovo: existing.status, observacao: observacao || undefined });
    return NextResponse.json({ ok: true, status: existing.status, salvoAt: now.toISOString() });
  }

  // ── ENVIAR ────────────────────────────────────────────────────────────────────
  if (action === "ENVIAR") {
    if (existing.status !== "PENDENTE") {
      return NextResponse.json({ error: "Somente medições pendentes podem ser enviadas." }, { status: 409 });
    }
    if (!existing.salvoAt) {
      return NextResponse.json({ error: "É necessário Salvar antes de Enviar." }, { status: 409 });
    }
    const updated = await prisma.sgcAprovacaoMedicao.update({
      where: { id: existing.id },
      data: { status: "AGUARDANDO_NF", aprovadoAt: now, updatedAt: now },
    });
    await logBmAction({ ...logBase, acao: "ENVIAR", statusAnterior: "PENDENTE", statusNovo: "AGUARDANDO_NF" });
    return NextResponse.json({ ok: true, status: updated.status });
  }

  // ── VOLTAR ────────────────────────────────────────────────────────────────────
  if (action === "VOLTAR") {
    if (existing.status !== "AGUARDANDO_NF") {
      return NextResponse.json({ error: "Somente medições em 'Aguardando NF' podem ser retornadas." }, { status: 409 });
    }
    if (existing.nfArquivo) {
      await logBmAction({ ...logBase, acao: "TENTATIVA_VOLTAR_COM_NF", statusAnterior: existing.status, observacao: "Bloqueado: NF já postada." });
      return NextResponse.json(
        { error: "Não é possível retornar este BM de forma automática, pois já existe Nota Fiscal postada pelo fornecedor." },
        { status: 409 },
      );
    }
    const updated = await prisma.sgcAprovacaoMedicao.update({
      where: { id: existing.id },
      data: { status: "PENDENTE", aprovadoAt: null, salvoAt: null, voltadoAt: now, updatedAt: now },
    });
    await logBmAction({ ...logBase, acao: "VOLTAR", statusAnterior: "AGUARDANDO_NF", statusNovo: "PENDENTE" });
    return NextResponse.json({ ok: true, status: updated.status });
  }

  // ── CANCELAR ──────────────────────────────────────────────────────────────────
  if (action === "CANCELAR") {
    if (!["PENDENTE", "REVISAO_SOLICITADA"].includes(existing.status)) {
      return NextResponse.json({ error: "Somente medições pendentes podem ser canceladas." }, { status: 409 });
    }
    const updated = await prisma.sgcAprovacaoMedicao.update({
      where: { id: existing.id },
      data: { status: "CANCELADO", updatedAt: now },
    });
    await logBmAction({ ...logBase, acao: "CANCELAR", statusAnterior: existing.status, statusNovo: "CANCELADO", observacao: observacao || undefined });
    return NextResponse.json({ ok: true, status: updated.status });
  }

  // ── SOLICITAR_REVISAO ─────────────────────────────────────────────────────────
  if (action === "SOLICITAR_REVISAO") {
    if (existing.status !== "PENDENTE") {
      return NextResponse.json({ error: "Somente medições pendentes permitem solicitar revisão." }, { status: 409 });
    }
    if (pontosDiscordancia.length < 10) {
      return NextResponse.json({ error: "Informe os pontos de discordância com mais detalhes." }, { status: 400 });
    }
    const updated = await prisma.sgcAprovacaoMedicao.update({
      where: { id: existing.id },
      data: { status: "REVISAO_SOLICITADA", pontosDiscordancia, revisaoSolicitadaAt: now, updatedAt: now },
    });
    await logBmAction({ ...logBase, acao: "SOLICITAR_REVISAO", statusAnterior: "PENDENTE", statusNovo: "REVISAO_SOLICITADA", observacao: pontosDiscordancia });
    return NextResponse.json({ ok: true, status: updated.status, revisaoNumero: updated.revisaoNumero });
  }

  return NextResponse.json({ error: "Ação não processada." }, { status: 400 });
}
