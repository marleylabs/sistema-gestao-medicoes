import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { detectXlsxMime, safeDownloadName } from "@/lib/file-security";
import { prisma } from "@/lib/prisma";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import { getColaboradorCodigoAliases } from "@/lib/colaborador-alias";
import { logBmAction } from "@/lib/bm-log";
import { toNumber } from "@/lib/format";
import { parseSimpleXlsx } from "@/lib/xlsx";
import { compararDocumentos, parseFornecedorPlanilha, type EquipeDoc } from "@/lib/conferencia-medicao";
import { notifyBmDivergence } from "@/lib/email";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm"];

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  // Ownership: ciclo e fornecedor vêm exclusivamente da sessão resolvida — nunca de parâmetro do cliente.
  const cicloAtivo = await getCicloAtivoMedicao();
  const codigoAliases = await getColaboradorCodigoAliases(user.usuario, cicloAtivo);
  const sgc = await prisma.sgcAprovacaoMedicao.findFirst({
    where: { colaboradorCodigo: { in: codigoAliases }, ciclo: cicloAtivo },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, ciclo: true, colaboradorCodigo: true, colaboradorNome: true, statusConferencia: true },
  });

  if (!sgc || sgc.status !== "PENDENTE") {
    return NextResponse.json({ error: "Nenhuma medição pendente de conferência." }, { status: 409 });
  }
  if (sgc.statusConferencia === "CONCLUIDA") {
    return NextResponse.json({ error: "A conferência deste ciclo já foi concluída." }, { status: 409 });
  }
  if (sgc.statusConferencia === "DIVERGENCIA") {
    return NextResponse.json({ error: "A conferência já está em andamento com divergências. Aguarde a Equipe de Medição resolver." }, { status: 409 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("planilha") as File | null;
  if (!file) return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "Arquivo muito grande (máx. 5 MB)." }, { status: 400 });

  const nomeArquivo = file.name || "";
  const extensao = nomeArquivo.slice(nomeArquivo.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extensao)) {
    return NextResponse.json({ error: "Formato inválido. Envie um arquivo .xlsx." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!detectXlsxMime(buffer)) {
    return NextResponse.json({ error: "O arquivo enviado não corresponde a uma planilha Excel válida." }, { status: 400 });
  }

  let planilha: ReturnType<typeof parseSimpleXlsx>;
  try {
    planilha = parseSimpleXlsx(buffer);
  } catch {
    return NextResponse.json({ error: "Não foi possível processar a planilha. Verifique se o arquivo não está corrompido." }, { status: 400 });
  }

  const primeiraAba = Object.values(planilha)[0];
  const parsed = parseFornecedorPlanilha(primeiraAba ?? []);
  if (!parsed.ok) {
    return NextResponse.json({ error: `Não foi possível processar a planilha. ${parsed.erro}` }, { status: 400 });
  }

  const medicoesEquipe = await prisma.medicao.findMany({
    where: {
      ciclo: sgc.ciclo,
      profissional: {
        OR: codigoAliases.flatMap((codigo) => [
          { codigo: { equals: codigo, mode: "insensitive" as const } },
          { nome: { equals: codigo, mode: "insensitive" as const } },
          { nomeCompleto: { equals: codigo, mode: "insensitive" as const } },
        ]),
      },
    },
    select: { id: true, numeroDocumento: true, formato: true, equivalenteA1Horas: true, percentualEmissao: true, tipo2: true },
  });

  const equipeDocs: EquipeDoc[] = medicoesEquipe.map((m) => ({
    id: m.id,
    numeroDocumento: m.numeroDocumento,
    formato: m.formato,
    equivalenteA1Horas: toNumber(m.equivalenteA1Horas),
    percentualEmissao: toNumber(m.percentualEmissao ?? 0),
    tipo2: m.tipo2,
  }));

  const divergencias = compararDocumentos(equipeDocs, parsed.linhas);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (divergencias.length === 0) {
      await tx.sgcAprovacaoMedicao.update({
        where: { id: sgc.id },
        data: {
          statusConferencia: "CONCLUIDA",
          conferenciaArquivo: buffer,
          conferenciaArquivoNome: safeDownloadName(file.name, "conferencia"),
          conferenciaCarregadoAt: now,
          updatedAt: now,
        },
      });
      return;
    }

    await tx.sgcAprovacaoMedicao.update({
      where: { id: sgc.id },
      data: {
        statusConferencia: "DIVERGENCIA",
        conferenciaArquivo: buffer,
        conferenciaArquivoNome: safeDownloadName(file.name, "conferencia"),
        conferenciaCarregadoAt: now,
        updatedAt: now,
      },
    });

    for (const d of divergencias) {
      await tx.divergenciaMedicao.upsert({
        where: { sgcId_nrVale: { sgcId: sgc.id, nrVale: d.nrVale } },
        create: {
          sgcId: sgc.id,
          colaboradorCodigo: sgc.colaboradorCodigo,
          ciclo: sgc.ciclo,
          idMedicaoExistente: d.idMedicaoExistente,
          nrVale: d.nrVale,
          documentoNaoMapeado: d.documentoNaoMapeado,
          comparacaoAmbigua: d.comparacaoAmbigua,
          formatoDivergente: d.formatoDivergente,
          a1eqDivergente: d.a1eqDivergente,
          emissaoDivergente: d.emissaoDivergente,
          tipoDivergente: d.tipoDivergente,
          equipeFormato: d.equipe?.formato ?? null,
          equipeA1eqHh: d.equipe?.a1eqHh ?? null,
          equipePercentualEmissao: d.equipe?.percentualEmissao ?? null,
          equipeTipo: d.equipe?.tipo ?? null,
          fornecedorFormato: d.fornecedor.formato,
          fornecedorA1eqHh: d.fornecedor.a1eqHh,
          fornecedorPercentualEmissao: d.fornecedor.percentualEmissao,
          fornecedorTipo: d.fornecedor.tipo,
          status: "PENDENTE",
        },
        update: {
          idMedicaoExistente: d.idMedicaoExistente,
          documentoNaoMapeado: d.documentoNaoMapeado,
          comparacaoAmbigua: d.comparacaoAmbigua,
          formatoDivergente: d.formatoDivergente,
          a1eqDivergente: d.a1eqDivergente,
          emissaoDivergente: d.emissaoDivergente,
          tipoDivergente: d.tipoDivergente,
          equipeFormato: d.equipe?.formato ?? null,
          equipeA1eqHh: d.equipe?.a1eqHh ?? null,
          equipePercentualEmissao: d.equipe?.percentualEmissao ?? null,
          equipeTipo: d.equipe?.tipo ?? null,
          fornecedorFormato: d.fornecedor.formato,
          fornecedorA1eqHh: d.fornecedor.a1eqHh,
          fornecedorPercentualEmissao: d.fornecedor.percentualEmissao,
          fornecedorTipo: d.fornecedor.tipo,
          status: "PENDENTE",
          resolvidoPorUsuarioId: null,
          resolvidoPorNome: null,
          resolvidoEm: null,
          updatedAt: now,
        },
      });
    }
  });

  await logBmAction({
    sgcId: sgc.id,
    colaboradorCodigo: sgc.colaboradorCodigo,
    ciclo: sgc.ciclo,
    usuarioId: user.id,
    usuarioNome: user.nome,
    acao: "CONFERENCIA_UPLOAD",
    telaOrigem: "Portal do Fornecedor",
    observacao: divergencias.length === 0
      ? "Conferência concluída sem divergências."
      : `Conferência com ${divergencias.length} divergência(s) encontrada(s).`,
  });

  // BM_DIVERGENCE: só dispara quando a comparação real encontrou pelo menos uma divergência
  // (nunca por renderização de tela). Falha de e-mail nunca desfaz a conferência já registrada
  // acima — as divergências continuam persistidas independente do envio.
  if (divergencias.length > 0) {
    await notifyBmDivergence({
      sgcId: sgc.id,
      ciclo: sgc.ciclo,
      fornecedorNome: sgc.colaboradorNome || sgc.colaboradorCodigo,
      quantidade: divergencias.length,
      conferenciaCarregadoAt: now,
    });
  }

  return NextResponse.json({
    ok: true,
    divergencias: divergencias.length,
    statusConferencia: divergencias.length === 0 ? "CONCLUIDA" : "DIVERGENCIA",
  });
}
