import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { prisma } from "@/lib/prisma";

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (user.perfil !== "COLABORADOR") {
    return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });
  }

  const codigo = user.usuario;
  const [profissional, pagamento, documentos, sgc] = await Promise.all([
    prisma.profissional.findUnique({
      where: { codigo },
      select: {
        codigo: true,
        nome: true,
        nomeCompleto: true,
        cpf: true,
        cnpj: true,
        razaoSocial: true,
        email: true,
        funcao: true,
        statusColaborador: true,
      },
    }),
    prisma.mapaPagamentoItem.findFirst({
      where: {
        projetistaCodigo: codigo,
        valor: { gt: 0 },
      },
      orderBy: { ordem: "asc" },
    }),
    prisma.medicao.findMany({
      where: {
        profissional: { codigo },
      },
      select: {
        id: true,
        dataCadastro: true,
        formato: true,
        quantidade: true,
        valorMedicao: true,
        equivalenteA1Horas: true,
        percentualEmissao: true,
        numeroDocumento: true,
        tipo2: true,
        condicao: true,
        obs: true,
        projeto: {
          select: {
            codigoProjeto: true,
            tituloPrimario: true,
            contrato: true,
          },
        },
      },
      orderBy: [{ dataCadastro: "asc" }, { createdAt: "asc" }],
    }),
    prisma.sgcAprovacaoMedicao.findFirst({
      where: { colaboradorCodigo: codigo },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    usuario: {
      codigo,
      nome: profissional?.nomeCompleto || profissional?.nome || user.nome,
      cpf: decryptSensitive(profissional?.cpf),
      cnpj: decryptSensitive(profissional?.cnpj),
      razaoSocial: profissional?.razaoSocial ?? null,
      email: decryptSensitive(profissional?.email),
      funcao: profissional?.funcao ?? null,
      statusColaborador: profissional?.statusColaborador ?? null,
    },
    alocacao: pagamento
      ? {
          ato: pagamento.ato,
          intrSossego: toNumber(pagamento.intrSossego),
          salobo: toNumber(pagamento.salobo),
          acg: toNumber(pagamento.acg),
          escadasAlumar: toNumber(pagamento.escadasAlumar),
        }
      : null,
    pagamento: pagamento ? serializeMapaPagamentoItem(pagamento) : null,
    documentos: documentos.map((documento) => {
      const a1eq  = toNumber(documento.equivalenteA1Horas);
      const pct   = toNumber(documento.percentualEmissao ?? 0);
      const preco = parseFloat(documento.condicao ?? "0") || 0;
      return {
        id: documento.id,
        projetoReferente: documento.projeto.codigoProjeto,
        tituloPrimario: documento.projeto.tituloPrimario,
        contrato: documento.projeto.contrato,
        dataCadastro: dateOnly(documento.dataCadastro),
        formato: documento.formato,
        quantidade: toNumber(documento.quantidade),
        equivalenteA1Horas: a1eq,
        valorMedicao: toNumber(documento.valorMedicao),
        percentualEmissao: pct,
        numeroDocumento: documento.numeroDocumento,
        tipo2: documento.tipo2,
        condicao: documento.condicao,
        obs: documento.obs ?? null,
        precoUnitario: preco,
        valorMedido: a1eq * preco * pct,
      };
    }),
    sgc: sgc
      ? {
          status: sgc.status,
          revisaoNumero: sgc.revisaoNumero,
          revisaoLabel: sgc.revisaoNumero > 0 ? `Rev. ${sgc.revisaoNumero}` : null,
          pontosDiscordancia: sgc.pontosDiscordancia,
          respostaAdmin: sgc.respostaAdmin,
          aprovadoAt: sgc.aprovadoAt?.toISOString() ?? null,
          revisaoSolicitadaAt: sgc.revisaoSolicitadaAt?.toISOString() ?? null,
          reenviadoAt: sgc.reenviadoAt?.toISOString() ?? null,
        }
      : {
          status: "AGUARDANDO_ENVIO",
          revisaoNumero: 0,
          revisaoLabel: null,
          pontosDiscordancia: null,
          respostaAdmin: null,
          aprovadoAt: null,
          revisaoSolicitadaAt: null,
          reenviadoAt: null,
        },
  });
}
