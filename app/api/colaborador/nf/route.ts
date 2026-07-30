import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { detectAllowedDocumentMime, safeDownloadName } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import { toColaboradorCodigo } from "@/lib/usuario-format";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const cicloAtivo = await getCicloAtivoMedicao();
  const colaboradorCodigo = toColaboradorCodigo(user.usuario);
  const sgc = await prisma.sgcAprovacaoMedicao.findFirst({
    where: { colaboradorCodigo, ciclo: cicloAtivo },
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

  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  if (!allowed.has(file.type)) {
    return NextResponse.json({ error: "Formato inválido. Envie PDF, JPG ou PNG." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedMime = detectAllowedDocumentMime(buffer);
  if (!detectedMime || detectedMime !== file.type || !allowed.has(detectedMime)) {
    return NextResponse.json({ error: "O arquivo enviado não corresponde a PDF, JPG ou PNG válido." }, { status: 400 });
  }
  const now = new Date();

  await prisma.sgcAprovacaoMedicao.update({
    where: { id: sgc.id },
    data: {
      nfArquivo: buffer,
      nfArquivoNome: safeDownloadName(file.name, "nota-fiscal"),
      nfCarregadoAt: now,
      status: "APROVADO",
      aprovadoAt: now,
      updatedAt: now,
    },
  });

  return NextResponse.json({ ok: true });
}
