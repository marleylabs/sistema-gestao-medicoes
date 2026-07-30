import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildSgcChatMessages } from "@/lib/bm-log";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { prisma } from "@/lib/prisma";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import { toColaboradorCodigo } from "@/lib/usuario-format";

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function avatarUrlByUserId(id: string, updatedAt: Date | null) {
  return updatedAt ? `/api/usuario/avatar?userId=${encodeURIComponent(id)}&v=${updatedAt.getTime()}` : null;
}

function isOnline(onlineAt: Date | null | undefined) {
  return !!onlineAt && Date.now() - onlineAt.getTime() <= 2 * 60 * 1000;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (user.perfil !== "COLABORADOR") {
    return NextResponse.json({ error: "Acesso restrito ao colaborador." }, { status: 403 });
  }

  const codigo = toColaboradorCodigo(user.usuario);
  const cicloAtivo = await getCicloAtivoMedicao();
  const [profissional, pagamento, documentos, sgc, currentUsuario, usuariosMedicaoOnline] = await Promise.all([
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
        ciclo: cicloAtivo,
        projetistaCodigo: codigo,
        valor: { gt: 0 },
      },
      orderBy: { ordem: "asc" },
    }),
    prisma.medicao.findMany({
      where: {
        ciclo: cicloAtivo,
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
      where: { colaboradorCodigo: codigo, ciclo: cicloAtivo },
      orderBy: { createdAt: "desc" },
    }),
    prisma.usuario.findUnique({
      where: { id: user.id },
      select: { id: true, avatarAtualizadoAt: true },
    }),
    prisma.usuario.findMany({
      where: { perfil: { in: ["MEDICAO", "ADMIN"] }, ativo: true },
      select: { onlineAt: true },
    }),
  ]);

  const fornecedorAvatarUrl = currentUsuario ? avatarUrlByUserId(currentUsuario.id, currentUsuario.avatarAtualizadoAt) : null;
  const logs = sgc
    ? await prisma.sgcLog.findMany({
        where: { sgcId: sgc.id },
        select: { id: true, acao: true, observacao: true, usuarioId: true, tipoMensagem: true, audioMime: true, audioNome: true, usuarioNome: true, lidoAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const medicaoUserIds = Array.from(new Set(logs.filter((log) => log.acao === "RESPONDER_REVISAO").map((log) => log.usuarioId).filter((id): id is string => !!id)));
  const medicaoUsuarios = medicaoUserIds.length
    ? await prisma.usuario.findMany({
        where: { id: { in: medicaoUserIds } },
        select: { id: true, avatarAtualizadoAt: true },
      })
    : [];
  const medicaoAvatarUrlsByUsuarioId = Object.fromEntries(
    medicaoUsuarios.map((usuario) => [usuario.id, avatarUrlByUserId(usuario.id, usuario.avatarAtualizadoAt)]),
  );
  const mensagens = sgc ? buildSgcChatMessages(sgc, logs, { fornecedorAvatarUrl, medicaoAvatarUrlsByUsuarioId }) : [];

  return NextResponse.json({
    cicloAtivo,
    usuario: {
      codigo,
      nome: profissional?.nomeCompleto || profissional?.nome || user.nome,
      avatarUrl: fornecedorAvatarUrl,
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
          id: sgc.id,
          status: sgc.status,
          revisaoNumero: sgc.revisaoNumero,
          revisaoLabel: sgc.revisaoNumero > 0 ? `Rev. ${sgc.revisaoNumero}` : null,
          pontosDiscordancia: sgc.pontosDiscordancia,
          respostaAdmin: sgc.respostaAdmin,
          observacaoColaborador: sgc.observacaoColaborador,
          medicaoOnline: usuariosMedicaoOnline.some((usuario) => isOnline(usuario.onlineAt)),
          mensagens,
          aprovadoAt: sgc.aprovadoAt?.toISOString() ?? null,
          revisaoSolicitadaAt: sgc.revisaoSolicitadaAt?.toISOString() ?? null,
          reenviadoAt: sgc.reenviadoAt?.toISOString() ?? null,
        }
      : {
          id: null,
          status: "AGUARDANDO_ENVIO",
          revisaoNumero: 0,
          revisaoLabel: null,
          pontosDiscordancia: null,
          respostaAdmin: null,
          observacaoColaborador: null,
          medicaoOnline: false,
          mensagens: [],
          aprovadoAt: null,
          revisaoSolicitadaAt: null,
          reenviadoAt: null,
        },
  });
}
