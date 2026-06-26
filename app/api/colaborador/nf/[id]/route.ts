import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { id } = await params;
  const sgc = await (prisma.sgcAprovacaoMedicao as any).findUnique({
    where: { id },
    select: { colaboradorCodigo: true, nfArquivo: true, nfArquivoNome: true },
  });

  if (!sgc?.nfArquivo) return NextResponse.json({ error: "NF não encontrada." }, { status: 404 });

  // colaborador só pode acessar a própria NF; admin acessa qualquer uma
  if (user.perfil === "COLABORADOR" && sgc.colaboradorCodigo !== user.usuario) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const nome = sgc.nfArquivoNome ?? "nota-fiscal";
  const ext = nome.split(".").pop()?.toLowerCase();
  const contentType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";

  return new NextResponse(sgc.nfArquivo, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${nome}"`,
    },
  });
}
