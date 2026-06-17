import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (user.perfil !== "COLABORADOR") {
    return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const action = typeof payload?.action === "string" ? payload.action : "";
  const pontosDiscordancia = typeof payload?.pontosDiscordancia === "string" ? payload.pontosDiscordancia.trim() : "";
  const now = new Date();

  if (action === "SOLICITAR_REVISAO" && pontosDiscordancia.length < 10) {
    return NextResponse.json({ error: "Informe os pontos de discordância com mais detalhes." }, { status: 400 });
  }
  if (!["APROVAR", "SOLICITAR_REVISAO"].includes(action)) {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  // Fetch the most recent SGC record for this collaborator
  const current = await prisma.sgcAprovacaoMedicao.findFirst({
    where: { colaboradorCodigo: user.usuario },
    orderBy: { createdAt: "desc" },
    select: { status: true, ciclo: true },
  });

  if (current && current.status !== "PENDENTE") {
    return NextResponse.json(
      { error: "A medição já foi enviada para validação. Aguarde o reenvio da equipe de Medição." },
      { status: 409 },
    );
  }

  const ciclo = current?.ciclo ?? "2605";

  const profissional = await prisma.profissional.findUnique({
    where: { codigo: user.usuario },
    select: { nome: true, nomeCompleto: true },
  });

  const status = action === "APROVAR" ? "APROVADO" : "REVISAO_SOLICITADA";
  const sgc = await prisma.sgcAprovacaoMedicao.upsert({
    where: { colaboradorCodigo_ciclo: { colaboradorCodigo: user.usuario, ciclo } },
    create: {
      colaboradorCodigo: user.usuario,
      ciclo,
      colaboradorNome: profissional?.nomeCompleto || profissional?.nome || user.nome,
      status,
      pontosDiscordancia: action === "SOLICITAR_REVISAO" ? pontosDiscordancia : null,
      aprovadoAt: action === "APROVAR" ? now : null,
      revisaoSolicitadaAt: action === "SOLICITAR_REVISAO" ? now : null,
    },
    update: {
      colaboradorNome: profissional?.nomeCompleto || profissional?.nome || user.nome,
      status,
      pontosDiscordancia: action === "SOLICITAR_REVISAO" ? pontosDiscordancia : null,
      aprovadoAt: action === "APROVAR" ? now : null,
      revisaoSolicitadaAt: action === "SOLICITAR_REVISAO" ? now : null,
      updatedAt: now,
    },
  });

  return NextResponse.json({
    status: sgc.status,
    pontosDiscordancia: sgc.pontosDiscordancia,
    revisaoNumero: sgc.revisaoNumero,
    revisaoLabel: sgc.revisaoNumero > 0 ? `Rev. ${sgc.revisaoNumero}` : null,
    aprovadoAt: sgc.aprovadoAt?.toISOString() ?? null,
    revisaoSolicitadaAt: sgc.revisaoSolicitadaAt?.toISOString() ?? null,
  });
}
