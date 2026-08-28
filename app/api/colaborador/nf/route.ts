import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { detectAllowedDocumentMime, safeDownloadName } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import { toColaboradorCodigo } from "@/lib/usuario-format";
import { validateFornecedorForNfUpload } from "@/lib/cadastro-fornecedor";
import { validateNfDocumentAgainstCadastro } from "@/lib/nf-document-validation";
import { getColaboradorCodigoAliases } from "@/lib/colaborador-alias";
import { notifyPaymentReady } from "@/lib/email";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const cicloAtivo = await getCicloAtivoMedicao();
  const colaboradorCodigo = toColaboradorCodigo(user.usuario);
  const codigoAliases = await getColaboradorCodigoAliases(user.usuario, cicloAtivo);
  const sgc = await prisma.sgcAprovacaoMedicao.findFirst({
    where: { colaboradorCodigo: { in: codigoAliases }, ciclo: cicloAtivo },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, ciclo: true, colaboradorCodigo: true, colaboradorNome: true },
  });

  if (!sgc || sgc.status !== "AGUARDANDO_NF") {
    return NextResponse.json({ error: "Medição não está aguardando NF." }, { status: 409 });
  }

  const cadastroValidation = await validateFornecedorForNfUpload(colaboradorCodigo, user.nome);
  if (!cadastroValidation.ok || !cadastroValidation.cadastro) {
    return NextResponse.json({ error: cadastroValidation.error }, { status: 409 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("nf") as File | null;
  if (!file) return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Arquivo muito grande (máx. 10 MB)." }, { status: 400 });

  const allowed = new Set(["application/pdf"]);
  if (!allowed.has(file.type)) {
    return NextResponse.json({ error: "Formato inválido. Envie uma NF em PDF pesquisável." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedMime = detectAllowedDocumentMime(buffer);
  if (!detectedMime || detectedMime !== file.type || !allowed.has(detectedMime)) {
    return NextResponse.json({ error: "O arquivo enviado não corresponde a um PDF válido." }, { status: 400 });
  }

  const nfValidation = await validateNfDocumentAgainstCadastro({
    buffer,
    mimeType: detectedMime,
    expectedCnpj: cadastroValidation.cadastro.cnpjNormalizado,
    expectedRazaoSocial: cadastroValidation.cadastro.razaoSocial,
  });
  if (!nfValidation.ok) {
    return NextResponse.json({ error: nfValidation.error }, { status: 409 });
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

  // PAYMENT_READY: só dispara aqui, depois da NF validada com sucesso — é o momento real em que
  // o processo entra na fila do Financeiro, não quando o BM foi aprovado. Falha de e-mail nunca
  // desfaz a NF já registrada acima.
  const mapaItem = await prisma.mapaPagamentoItem.findFirst({
    where: { projetistaCodigo: { equals: sgc.colaboradorCodigo, mode: "insensitive" }, ciclo: sgc.ciclo },
    select: { valor: true },
  });
  await notifyPaymentReady({
    sgcId: sgc.id,
    ciclo: sgc.ciclo,
    fornecedorNome: sgc.colaboradorNome || sgc.colaboradorCodigo,
    valor: mapaItem ? Number(mapaItem.valor) : null,
  });

  return NextResponse.json({ ok: true });
}
