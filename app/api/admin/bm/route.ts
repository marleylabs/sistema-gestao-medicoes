import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const codigo = request.nextUrl.searchParams.get("codigo")?.trim();
  const ciclo  = request.nextUrl.searchParams.get("ciclo")?.trim();

  if (!codigo || !ciclo) {
    return NextResponse.json({ error: "Parâmetros obrigatórios: codigo, ciclo." }, { status: 400 });
  }

  const [profissional, sgc, pagamento, contexto, documentos] = await Promise.all([
    prisma.profissional.findFirst({
      where: { codigo },
      select: { nomeCompleto: true, nome: true, cpf: true, cnpj: true, razaoSocial: true, funcao: true },
    }),
    prisma.sgcAprovacaoMedicao.findFirst({
      where: { colaboradorCodigo: codigo, ciclo },
    }),
    prisma.mapaPagamentoItem.findFirst({
      where: { ciclo, projetistaCodigo: codigo },
      orderBy: { ordem: "asc" },
    }),
    prisma.mapaPagamentoContexto.findUnique({ where: { ciclo } }),
    prisma.medicao.findMany({
      where: { profissional: { codigo }, ciclo },
      select: {
        id: true, dataCadastro: true, formato: true, quantidade: true, obs: true,
        equivalenteA1Horas: true, valorMedicao: true, medidoHoras: true,
        valorTotal: true, valorUnitario: true, percentualEmissao: true,
        numeroDocumento: true, tipo2: true, condicao: true,
        projeto: { select: { codigoProjeto: true, tituloPrimario: true, contrato: true } },
      },
      orderBy: [{ dataCadastro: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const revisaoNumero = sgc?.revisaoNumero ?? 0;

  return NextResponse.json({
    ciclo,
    revisaoNumero,
    revisaoLabel: revisaoNumero > 0 ? `Rev. ${revisaoNumero}` : null,
    aprovadoAt: sgc?.aprovadoAt?.toISOString() ?? null,
    status: sgc?.status ?? null,
    sgcId: sgc?.id ?? null,
    nfArquivoNome: (sgc as any)?.nfArquivoNome ?? null,
    colaborador: {
      nome: profissional?.nomeCompleto || profissional?.nome || codigo,
      cpf: decryptSensitive(profissional?.cpf),
      cnpj: decryptSensitive(profissional?.cnpj),
      razaoSocial: profissional?.razaoSocial ?? null,
      funcao: profissional?.funcao ?? null,
    },
    contexto: contexto ? {
      mesReferencia: contexto.mesReferencia,
      producaoInicio: dateOnly(contexto.producaoInicio),
      producaoFim: dateOnly(contexto.producaoFim),
      atoCiclo: contexto.atoCiclo,
    } : null,
    pagamento: pagamento ? {
      ato: pagamento.ato,
      valor: toNumber(pagamento.valor),
      rev: toNumber(pagamento.rev),
      horas: toNumber((pagamento as any).horas),
      intrSossego: toNumber((pagamento as any).intrSossego),
      salobo: toNumber((pagamento as any).salobo),
      acg: toNumber((pagamento as any).acg),
      escadasAlumar: toNumber((pagamento as any).escadasAlumar),
      razaoSocial: decryptSensitive(pagamento.razaoSocial),
      cpfCnpj: decryptSensitive(pagamento.cpfCnpj),
    } : null,
    documentos: documentos.map((d) => {
      const a1eq = toNumber(d.equivalenteA1Horas);
      const pct  = toNumber(d.percentualEmissao ?? 0);
      const preco = parseFloat(d.condicao ?? "0") || 0;
      const valorMedido = a1eq * preco * pct;
      return {
        id: d.id,
        projetoReferente: d.projeto.codigoProjeto,
        tituloPrimario: d.projeto.tituloPrimario,
        contrato: d.projeto.contrato,
        dataCadastro: dateOnly(d.dataCadastro),
        formato: d.formato,
        quantidade: toNumber(d.quantidade),
        equivalenteA1Horas: a1eq,
        medidoHoras: toNumber(d.medidoHoras),
        valorMedicao: toNumber(d.valorMedicao),
        valorUnitario: toNumber(d.valorUnitario),
        valorTotal: toNumber(d.valorTotal),
        percentualEmissao: pct,
        numeroDocumento: d.numeroDocumento,
        tipo2: d.tipo2,
        condicao: d.condicao,
        precoUnitario: preco,
        valorMedido,
        obs: d.obs ?? null,
      };
    }),
  });
}
