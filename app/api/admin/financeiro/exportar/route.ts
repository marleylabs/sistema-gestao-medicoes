import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiro } from "@/lib/admin";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { createWorkbookXlsx } from "@/lib/xlsx";
import { cadastroFornecedorOverrideForMapaItem, normalizeCadastroMatch } from "@/lib/mapa-pagamento-cadastro";

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

  const pagamentos = await prisma.mapaPagamentoItem.findMany({
    where: { ciclo },
    select: {
      projetistaCodigo: true,
      responsavel: true,
      cpfCnpj: true,
      razaoSocial: true,
      valor: true,
      rawPayload: true,
    },
  });
  const cadastros = await prisma.cadastroFornecedor.findMany({
    select: {
      id: true,
      colaboradorCodigo: true,
      responsavel: true,
      razaoSocial: true,
      cnpjNormalizado: true,
      tipoCt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const findPagamento = (codigo: string | null, nome: string | null) => {
    const codigoNorm = normalizeCadastroMatch(codigo);
    const nomeNorm = normalizeCadastroMatch(nome);
    return pagamentos.find((p) => {
      const projetistaNorm = normalizeCadastroMatch(p.projetistaCodigo);
      const responsavelNorm = normalizeCadastroMatch(p.responsavel);
      return (!!codigoNorm && (projetistaNorm === codigoNorm || responsavelNorm === codigoNorm)) ||
        (!!nomeNorm && (projetistaNorm === nomeNorm || responsavelNorm === nomeNorm));
    });
  };
  const headers = [
    "Ciclo",
    "ID",
    "Fornecedor",
    "CPF / CNPJ",
    "Razão Social",
    "Valor total",
    "Status financeiro",
    "NF",
    "NF recebida em",
    "Data e hora do pagamento",
    "Comprovante",
  ];

  const rows = sgcList.map((sgc) => {
    const pagamento = findPagamento(sgc.colaboradorCodigo, sgc.colaboradorNome);
    const cadastro = cadastroFornecedorOverrideForMapaItem(
      pagamento ?? { projetistaCodigo: sgc.colaboradorCodigo, responsavel: sgc.colaboradorNome, cpfCnpj: null },
      cadastros,
    );
    const valor = toNumber(pagamento?.valor ?? 0);
    return [
      ciclo,
      sgc.colaboradorCodigo,
      sgc.colaboradorNome ?? sgc.colaboradorCodigo,
      cadastro?.cpfCnpj ?? decryptSensitive(pagamento?.cpfCnpj) ?? "",
      cadastro?.razaoSocial ?? pagamento?.razaoSocial ?? "",
      valor,
      "Concluído",
      sgc.nfArquivoNome ?? "",
      sgc.nfCarregadoAt ?? null,
      sgc.pagoAt ?? sgc.comprovanteCarregadoAt ?? null,
      sgc.comprovanteArquivoNome ?? "",
    ];
  });

  const workbook = createWorkbookXlsx([{
    name: "Pagamentos concluídos",
    headers,
    rows,
    columnWidths: [18, 18, 34, 18, 34, 18, 18, 24, 18, 26, 18],
  }]);
  const filename = `pagamentos_concluidos_${safeFilename(ciclo)}.xlsx`;

  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
