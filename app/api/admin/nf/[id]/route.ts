import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiro } from "@/lib/admin";
import { safeDownloadName } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const fin = await requireFinanceiro();
  if (fin.response) return fin.response;

  const { id } = await params;
  const sgc = await (prisma.sgcAprovacaoMedicao as any).findUnique({
    where: { id },
    select: { nfArquivo: true, nfArquivoNome: true },
  });

  if (!sgc?.nfArquivo) return NextResponse.json({ error: "NF não encontrada." }, { status: 404 });

  const nome = safeDownloadName(sgc.nfArquivoNome, "nota-fiscal");
  const ext = nome.split(".").pop()?.toLowerCase();
  const contentType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";

  return new NextResponse(sgc.nfArquivo, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${nome}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
