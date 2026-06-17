import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const codigo = user.usuario;

  const aprovacoes = await prisma.sgcAprovacaoMedicao.findMany({
    where: { colaboradorCodigo: codigo, status: "APROVADO" },
    orderBy: { aprovadoAt: "desc" },
  });

  if (!aprovacoes.length) return NextResponse.json({ medicoes: [] });

  const profissional = await prisma.profissional.findFirst({
    where: { codigo },
    select: { nomeCompleto: true, nome: true, cpf: true, cnpj: true, razaoSocial: true, funcao: true },
  });

  const medicoes = await Promise.all(
    aprovacoes.map(async (sgc) => {
      const [pagamento, contexto, documentos] = await Promise.all([
        prisma.mapaPagamentoItem.findFirst({
          where: { ciclo: sgc.ciclo, projetistaCodigo: codigo },
          orderBy: { ordem: "asc" },
        }),
        prisma.mapaPagamentoContexto.findUnique({ where: { ciclo: sgc.ciclo } }),
        prisma.medicao.findMany({
          where: { profissional: { codigo }, ciclo: sgc.ciclo },
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

      return {
        id: sgc.id,
        ciclo: sgc.ciclo,
        revisaoNumero: sgc.revisaoNumero,
        revisaoLabel: sgc.revisaoNumero > 0 ? `Rev. ${sgc.revisaoNumero}` : null,
        aprovadoAt: sgc.aprovadoAt?.toISOString() ?? null,
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
          horas: toNumber(pagamento.horas),
          intrSossego: toNumber(pagamento.intrSossego),
          salobo: toNumber(pagamento.salobo),
          acg: toNumber(pagamento.acg),
          escadasAlumar: toNumber(pagamento.escadasAlumar),
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
      };
    }),
  );

  return NextResponse.json({ medicoes });
}
