import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const cicloAtivo = await getCicloAtivoMedicao();
  const sgc = await prisma.sgcAprovacaoMedicao.findFirst({
    where: { colaboradorCodigo: user.usuario, ciclo: cicloAtivo },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  if (!sgc || sgc.status !== "AGUARDANDO_NF") {
    return NextResponse.json({ error: "Medição não está aguardando NF." }, { status: 409 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("nf") as File | null;
  if (!file) return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Arquivo muito grande (máx. 10 MB)." }, { status: 400 });

  const allowed = ["application/pdf", "image/jpeg", "image/png"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Formato inválido. Envie PDF, JPG ou PNG." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const now = new Date();

  await prisma.sgcAprovacaoMedicao.update({
    where: { id: sgc.id },
    data: {
      nfArquivo: buffer,
      nfArquivoNome: file.name,
      nfCarregadoAt: now,
      status: "APROVADO",
      aprovadoAt: now,
      updatedAt: now,
    },
  });

  return NextResponse.json({ ok: true });
}
