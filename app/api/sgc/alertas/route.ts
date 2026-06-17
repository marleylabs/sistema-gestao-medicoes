import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito ao perfil Medição." }, { status: 403 });
  }

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";

  const alertas = await prisma.sgcAprovacaoMedicao.findMany({
    where: { status: "REVISAO_SOLICITADA", ciclo },
    orderBy: { revisaoSolicitadaAt: "desc" },
    take: 20,
  });

  const payload = await Promise.all(
    alertas.map(async (alerta) => {
      const [profissional, pagamento, documentos] = await Promise.all([
        prisma.profissional.findUnique({
          where: { codigo: alerta.colaboradorCodigo },
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
            ciclo,
            projetistaCodigo: alerta.colaboradorCodigo,
            valor: { gt: 0 },
          },
          orderBy: { ordem: "asc" },
        }),
        prisma.medicao.findMany({
          where: { profissional: { codigo: alerta.colaboradorCodigo } },
          select: {
            id: true,
            dataCadastro: true,
            formato: true,
            valorMedicao: true,
            equivalenteA1Horas: true,
            projeto: { select: { codigoProjeto: true, tituloPrimario: true } },
          },
          orderBy: [{ dataCadastro: "desc" }, { createdAt: "desc" }],
          take: 8,
        }),
      ]);

      const totalMedido = documentos.reduce((total, documento) => total + toNumber(documento.valorMedicao), 0);
      const totalHoras = documentos.reduce((total, documento) => total + toNumber(documento.equivalenteA1Horas), 0);

      return {
        id: alerta.id,
        colaboradorCodigo: alerta.colaboradorCodigo,
        colaboradorNome: alerta.colaboradorNome,
        status: alerta.status,
        revisaoNumero: alerta.revisaoNumero,
        proximaRevisaoLabel: `Rev. ${alerta.revisaoNumero + 1}`,
        pontosDiscordancia: alerta.pontosDiscordancia,
        respostaAdmin: alerta.respostaAdmin,
        revisaoSolicitadaAt: alerta.revisaoSolicitadaAt?.toISOString() ?? null,
        colaborador: {
          codigo: profissional?.codigo ?? alerta.colaboradorCodigo,
          nome: profissional?.nomeCompleto || profissional?.nome || alerta.colaboradorNome,
          cpf: decryptSensitive(profissional?.cpf),
          cnpj: decryptSensitive(profissional?.cnpj),
          razaoSocial: profissional?.razaoSocial ?? null,
          email: decryptSensitive(profissional?.email),
          funcao: profissional?.funcao ?? null,
          statusColaborador: profissional?.statusColaborador ?? null,
        },
        pagamento: pagamento ? serializeMapaPagamentoItem(pagamento) : null,
        medicao: {
          totalDocumentos: documentos.length,
          totalMedido,
          totalHoras,
          documentos: documentos.map((documento) => ({
            id: documento.id,
            projetoReferente: documento.projeto.codigoProjeto,
            tituloPrimario: documento.projeto.tituloPrimario,
            dataCadastro: documento.dataCadastro?.toISOString().slice(0, 10) ?? null,
            formato: documento.formato,
            valorMedicao: toNumber(documento.valorMedicao),
            equivalenteA1Horas: toNumber(documento.equivalenteA1Horas),
          })),
        },
      };
    }),
  );

  return NextResponse.json(payload);
}
