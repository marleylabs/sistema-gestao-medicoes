import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cicloToDates, cicloToMesReferencia } from "@/lib/ciclo";
import { coletarCandidatosLimpezaCiclo, deleteOrphanProfessionalsAfterCycleRemoval, deleteOrphanProjectsAfterCycleRemoval } from "@/lib/ciclo-cleanup";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const ciclos = await prisma.mapaPagamentoContexto.findMany({
    select: {
      ciclo: true,
      mesReferencia: true,
      ativoMedicao: true,
      updatedAt: true,
    },
    orderBy: { ciclo: "desc" },
  });

  return NextResponse.json(ciclos);
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "";

  if (!ciclo || !/^\d{4}$/.test(ciclo)) {
    return NextResponse.json({ error: "Ciclo inválido. Use formato YYMM (ex: 2606)." }, { status: 400 });
  }

  const existing = await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo } });
  if (existing) {
    return NextResponse.json({ error: "Ciclo já existe." }, { status: 409 });
  }

  const datas = cicloToDates(ciclo);
  const created = await prisma.mapaPagamentoContexto.create({
    data: {
      ciclo,
      mesReferencia:  cicloToMesReferencia(ciclo),
      producaoInicio: new Date(`${datas.producaoInicio}T00:00:00`),
      producaoFim:    new Date(`${datas.producaoFim}T00:00:00`),
      atoCiclo:       ciclo,
    },
  });

  return NextResponse.json({ ciclo: created.ciclo }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const payload = await request.json().catch(() => null);
  const ciclo = typeof payload?.ciclo === "string" ? payload.ciclo.trim() : "";
  const action = typeof payload?.action === "string" ? payload.action : "";

  if (action !== "set_ativo_medicao") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  if (!ciclo || !/^\d{4}$/.test(ciclo)) {
    return NextResponse.json({ error: "Ciclo inválido. Use formato YYMM (ex: 2606)." }, { status: 400 });
  }

  const existing = await prisma.mapaPagamentoContexto.findUnique({ where: { ciclo } });
  if (!existing) {
    return NextResponse.json({ error: "Ciclo não encontrado." }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.mapaPagamentoContexto.updateMany({ data: { ativoMedicao: false } }),
    prisma.mapaPagamentoContexto.update({ where: { ciclo }, data: { ativoMedicao: true, updatedAt: new Date() } }),
  ]);

  return NextResponse.json({ ciclo, ativoMedicao: true });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;
  if (admin.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Apenas administradores podem excluir ciclos." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (payload?.confirmacao !== "RESETAR_CICLOS") {
    return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
  }

  const ciclos = Array.isArray(payload?.ciclos)
    ? payload.ciclos.filter((ciclo: unknown): ciclo is string => typeof ciclo === "string" && /^\d{4}$/.test(ciclo))
    : [];
  const cicloUnico = typeof payload?.ciclo === "string" && /^\d{4}$/.test(payload.ciclo) ? payload.ciclo : "";
  const ciclosAlvo = Array.from(new Set([...(cicloUnico ? [cicloUnico] : []), ...ciclos]));

  if (ciclosAlvo.length === 0) {
    return NextResponse.json({ error: "Informe pelo menos um ciclo válido para excluir." }, { status: 400 });
  }

  const sgcLogs = await prisma.sgcLog.findMany({
    where: { ciclo: { in: ciclosAlvo } },
    select: { id: true },
  });
  const sgcOrigins = sgcLogs.map((log) => `sgc:${log.id}`);

  const removed = await prisma.$transaction(async (tx) => {
    // Escopo da limpeza: coletado ANTES de apagar os dados do ciclo. Depois, só esses candidatos
    // podem ser removidos como órfãos — nunca uma coleta de lixo global do banco.
    const candidatos = await coletarCandidatosLimpezaCiclo(tx, ciclosAlvo);
    const conversasDasMensagens = sgcOrigins.length
      ? (await tx.chatMensagem.findMany({ where: { origem: { in: sgcOrigins } }, select: { conversaId: true } })).map((m) => m.conversaId)
      : [];

    const chatMensagens = sgcOrigins.length
      ? await tx.chatMensagem.deleteMany({ where: { origem: { in: sgcOrigins } } })
      : { count: 0 };

    // Só as conversas que ficaram vazias por causa das mensagens removidas deste ciclo.
    const chatConversasVazias = conversasDasMensagens.length
      ? await tx.chatConversa.deleteMany({
          where: {
            id: { in: Array.from(new Set(conversasDasMensagens)) },
            mensagens: { none: {} },
            participantes: { none: {} },
          },
        })
      : { count: 0 };

    const sgcLogs = await tx.sgcLog.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });
    const sgcAprovacoes = await tx.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });
    const bmAux = await tx.bmAuxMedicao.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });
    const medicoes = await tx.medicao.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });
    const mapaPagamentoItens = await tx.mapaPagamentoItem.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });
    const etlExecucoes = await tx.etlExecucao.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });
    const ciclos = await tx.mapaPagamentoContexto.deleteMany({ where: { ciclo: { in: ciclosAlvo } } });

    const projetosOrfaos = await deleteOrphanProjectsAfterCycleRemoval(tx, candidatos.projetoIds);
    const profissionaisOrfaos = await deleteOrphanProfessionalsAfterCycleRemoval(tx, candidatos.profissionalIds);

    return {
      ciclos: ciclos.count,
      medicoes: medicoes.count,
      mapaPagamentoItens: mapaPagamentoItens.count,
      sgcAprovacoes: sgcAprovacoes.count,
      sgcLogs: sgcLogs.count,
      bmAux: bmAux.count,
      etlExecucoes: etlExecucoes.count,
      chatMensagens: chatMensagens.count,
      chatConversasVazias: chatConversasVazias.count,
      projetosOrfaos,
      profissionaisOrfaos,
    };
  });

  return NextResponse.json({ ok: true, removed });
}
