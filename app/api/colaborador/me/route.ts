import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildSgcChatMessages } from "@/lib/bm-log";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { serializeMapaPagamentoItem } from "@/lib/mapa-pagamento";
import { prisma } from "@/lib/prisma";
import { getCicloAtivoMedicao } from "@/lib/ciclo-ativo";
import { toColaboradorCodigo } from "@/lib/usuario-format";
import { getColaboradorCodigoAliases } from "@/lib/colaborador-alias";
import { onlyDigits } from "@/lib/cadastro-fornecedor";
import { getDocumentosMedidos } from "@/lib/documentos-medidos";

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
    return NextResponse.json({ error: "Acesso restrito ao fornecedor." }, { status: 403 });
  }

  const codigo = toColaboradorCodigo(user.usuario);
  const cicloAtivo = await getCicloAtivoMedicao();
  const codigoAliases = await getColaboradorCodigoAliases(user.usuario, cicloAtivo);
  const [profissional, pagamento, documentos, sgc, currentUsuario, usuariosMedicaoOnline] = await Promise.all([
    prisma.profissional.findFirst({
      where: { codigo: { in: codigoAliases }, deletedAt: null },
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
        projetistaCodigo: { in: codigoAliases },
        valor: { gt: 0 },
      },
      orderBy: { ordem: "asc" },
    }),
    getDocumentosMedidos({ aliases: codigoAliases, ciclo: cicloAtivo }),
    prisma.sgcAprovacaoMedicao.findFirst({
      where: { colaboradorCodigo: { in: codigoAliases }, ciclo: cicloAtivo },
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
  // Isolamento: escopado por sgc.id (já filtrado por colaboradorCodigo em codigoAliases + ciclo
  // acima) — nunca por CNPJ, que pode ser compartilhado entre colaboradorCodigo distintos.
  const divergenciasDescartadas = sgc
    ? await prisma.divergenciaMedicao.findMany({
        where: { sgcId: sgc.id, status: "DESCARTADA" },
        select: { id: true, nrVale: true, fornecedorFormato: true, fornecedorTipo: true, observacao: true },
        orderBy: { resolvidoEm: "asc" },
      })
    : [];
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
  const profissionalCpf = decryptSensitive(profissional?.cpf);
  const profissionalCnpj = decryptSensitive(profissional?.cnpj);
  const cadastroLookupKeys = Array.from(
    new Set(
      [
        ...codigoAliases,
        codigo,
        user.usuario,
        user.nome,
        profissional?.codigo,
        profissional?.nome,
        profissional?.nomeCompleto,
        pagamento?.projetistaCodigo,
        pagamento?.responsavel,
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => !!value),
    ),
  );
  const cadastroFornecedorDireto = cadastroLookupKeys.length
    ? await prisma.cadastroFornecedor.findFirst({
        where: {
          OR: [
            { colaboradorCodigo: { in: cadastroLookupKeys } },
            ...cadastroLookupKeys.map((key) => ({ responsavel: { equals: key, mode: "insensitive" as const } })),
          ],
        },
        select: {
          responsavel: true,
          razaoSocial: true,
          cargo: true,
          cpf: true,
          cnpj: true,
          email: true,
        },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  const cadastroCnpj = onlyDigits(profissionalCnpj || user.usuario);
  const cadastroFornecedorPorCnpj = !cadastroFornecedorDireto && cadastroCnpj.length === 14
    ? await prisma.cadastroFornecedor.findFirst({
        where: {
          cnpjNormalizado: cadastroCnpj,
          responsavel: { equals: user.nome, mode: "insensitive" },
        },
        select: {
          responsavel: true,
          razaoSocial: true,
          cargo: true,
          cpf: true,
          cnpj: true,
          email: true,
        },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  const cadastroFornecedor = cadastroFornecedorDireto ?? cadastroFornecedorPorCnpj;
  const cadastroCpf = decryptSensitive(cadastroFornecedor?.cpf);
  const cadastroCnpjFormatado = decryptSensitive(cadastroFornecedor?.cnpj);
  const cadastroEmail = decryptSensitive(cadastroFornecedor?.email);

  return NextResponse.json({
    cicloAtivo,
    usuario: {
      codigo,
      nome: profissional?.nomeCompleto || cadastroFornecedor?.responsavel || profissional?.nome || user.nome,
      avatarUrl: fornecedorAvatarUrl,
      cpf: cadastroCpf || profissionalCpf,
      cnpj: cadastroCnpjFormatado || profissionalCnpj,
      razaoSocial: cadastroFornecedor?.razaoSocial || profissional?.razaoSocial || pagamento?.razaoSocial || null,
      email: cadastroEmail || decryptSensitive(profissional?.email),
      funcao: cadastroFornecedor?.cargo || profissional?.funcao || null,
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
    documentosDescartados: divergenciasDescartadas.map((d) => ({
      id: d.id,
      nrVale: d.nrVale,
      formato: d.fornecedorFormato,
      tipo: d.fornecedorTipo,
      motivo: d.observacao ?? "",
    })),
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
          statusConferencia: sgc.statusConferencia,
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
          statusConferencia: "CONCLUIDA",
        },
  });
}
