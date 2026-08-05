import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiro } from "@/lib/admin";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { createSimpleXlsx } from "@/lib/xlsx";

function safeFilename(value: string) {
  return value.replace(/[^\w.-]+/g, "_");
}

export async function GET(request: NextRequest) {
  const fin = await requireFinanceiro();
  if (fin.response) return fin.response;

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim();
  if (!ciclo) return NextResponse.json({ error: "Parâmetro ciclo obrigatório." }, { status: 400 });

  const sgcList = await prisma.sgcAprovacaoMedicao.findMany({
    where: { ciclo, status: "PAGO" },
    orderBy: { colaboradorNome: "asc" },
    select: {
      colaboradorCodigo: true,
      colaboradorNome: true,
      nfArquivoNome: true,
      nfCarregadoAt: true,
      pagoAt: true,
      comprovanteArquivoNome: true,
      comprovanteCarregadoAt: true,
    },
  });

  const codigos = sgcList.map((item) => item.colaboradorCodigo);
  const pagamentos = await prisma.mapaPagamentoItem.findMany({
    where: { ciclo, projetistaCodigo: { in: codigos } },
    select: {
      projetistaCodigo: true,
      ato: true,
      cpfCnpj: true,
      razaoSocial: true,
      intrSossego: true,
      salobo: true,
      acg: true,
      escadasAlumar: true,
      valor: true,
      rev: true,
      status: true,
    },
  });

  const pagamentoPorCodigo = new Map(pagamentos.map((item) => [item.projetistaCodigo, item]));
  const headers = [
    "Ciclo",
    "ID",
    "Fornecedor",
    "CPF / CNPJ",
    "Razão Social",
    "Atuação",
    "Intr. Sossego",
    "Salobo",
    "ACG",
    "Escadas Alumar",
    "Valor",
    "Revisão",
    "Valor total",
    "Status financeiro",
    "NF",
    "NF recebida em",
    "Data e hora do pagamento",
    "Comprovante",
  ];

  const rows = sgcList.map((sgc) => {
    const pagamento = pagamentoPorCodigo.get(sgc.colaboradorCodigo);
    const valor = toNumber(pagamento?.valor ?? 0);
    const rev = toNumber(pagamento?.rev ?? 0);
    return [
      ciclo,
      sgc.colaboradorCodigo,
      sgc.colaboradorNome ?? sgc.colaboradorCodigo,
      decryptSensitive(pagamento?.cpfCnpj) ?? "",
      decryptSensitive(pagamento?.razaoSocial) ?? "",
      pagamento?.ato ?? "",
      toNumber(pagamento?.intrSossego ?? 0),
      toNumber(pagamento?.salobo ?? 0),
      toNumber(pagamento?.acg ?? 0),
      toNumber(pagamento?.escadasAlumar ?? 0),
      valor,
      rev,
      valor + rev,
      "Concluído",
      sgc.nfArquivoNome ?? "",
      sgc.nfCarregadoAt ?? null,
      sgc.pagoAt ?? sgc.comprovanteCarregadoAt ?? null,
      sgc.comprovanteArquivoNome ?? "",
    ];
  });

  const workbook = createSimpleXlsx(headers, rows);
  const filename = `pagamentos_concluidos_${safeFilename(ciclo)}.xlsx`;

  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
