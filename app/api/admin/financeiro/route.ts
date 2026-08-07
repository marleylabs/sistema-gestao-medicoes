import { NextRequest, NextResponse } from "next/server";
import { requireFinanceiro } from "@/lib/admin";
import { decryptSensitive } from "@/lib/encryption";
import { toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { logBmAction } from "@/lib/bm-log";
import { cadastroFornecedorOverrideForMapaItem, normalizeCadastroMatch } from "@/lib/mapa-pagamento-cadastro";

export async function GET(request: NextRequest) {
  const fin = await requireFinanceiro();
  if (fin.response) return fin.response;

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim();
  if (!ciclo) return NextResponse.json({ error: "Parâmetro ciclo obrigatório." }, { status: 400 });

  const sgcList = await prisma.sgcAprovacaoMedicao.findMany({
    where: { ciclo, status: { in: ["AGUARDANDO_NF", "APROVADO", "PAGO"] } },
    orderBy: { colaboradorNome: "asc" },
  });

  const pagamentoList = await prisma.mapaPagamentoItem.findMany({
    where: { ciclo },
    select: { projetistaCodigo: true, responsavel: true, valor: true, rev: true, cpfCnpj: true, razaoSocial: true, rawPayload: true },
  });
  const cadastros = await prisma.cadastroFornecedor.findMany({
    select: {
      id: true,
      colaboradorCodigo: true,
      responsavel: true,
      razaoSocial: true,
      cnpjNormalizado: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const findPagamento = (codigo: string | null, nome: string | null) => {
    const codigoNorm = normalizeCadastroMatch(codigo);
    const nomeNorm = normalizeCadastroMatch(nome);
    return pagamentoList.find((p) => {
      const projetistaNorm = normalizeCadastroMatch(p.projetistaCodigo);
      const responsavelNorm = normalizeCadastroMatch(p.responsavel);
      return (!!codigoNorm && (projetistaNorm === codigoNorm || responsavelNorm === codigoNorm)) ||
        (!!nomeNorm && (projetistaNorm === nomeNorm || responsavelNorm === nomeNorm));
    });
  };

  const items = sgcList.map((s) => {
    const pag = findPagamento(s.colaboradorCodigo, s.colaboradorNome);
    const cadastro = cadastroFornecedorOverrideForMapaItem(
      pag ?? { projetistaCodigo: s.colaboradorCodigo, responsavel: s.colaboradorNome, cpfCnpj: null },
      cadastros,
    );
    return {
      id: s.id,
      colaboradorCodigo: s.colaboradorCodigo,
      colaboradorNome: s.colaboradorNome ?? s.colaboradorCodigo,
      status: s.status,
      nfArquivoNome: (s as any).nfArquivoNome ?? null,
      nfCarregadoAt: (s as any).nfCarregadoAt?.toISOString() ?? null,
      pagoAt: (s as any).pagoAt?.toISOString() ?? null,
      comprovanteArquivoNome: (s as any).comprovanteArquivoNome ?? null,
      comprovanteCarregadoAt: (s as any).comprovanteCarregadoAt?.toISOString() ?? null,
      valor: toNumber(pag?.valor ?? 0),
      rev: toNumber(pag?.rev ?? 0),
      cpfCnpj: cadastro?.cpfCnpj ?? decryptSensitive(pag?.cpfCnpj) ?? null,
      razaoSocial: cadastro?.razaoSocial ?? pag?.razaoSocial ?? null,
    };
  });

  return NextResponse.json(items);
}

const MAX_SIZE = 10 * 1024 * 1024;

export async function PATCH(request: NextRequest) {
  const fin = await requireFinanceiro();
  if (fin.response) return fin.response;

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const id = formData.get("id") as string | null;
  const file = formData.get("comprovante") as File | null;

  if (!id) return NextResponse.json({ error: "Parâmetro id obrigatório." }, { status: 400 });
  if (file && file.size > MAX_SIZE) return NextResponse.json({ error: "Arquivo muito grande (máx. 10 MB)." }, { status: 400 });

  const allowed = ["application/pdf", "image/jpeg", "image/png"];
  if (file && !allowed.includes(file.type)) {
    return NextResponse.json({ error: "Formato inválido. Envie PDF, JPG ou PNG." }, { status: 400 });
  }

  const sgc = await prisma.sgcAprovacaoMedicao.findUnique({ where: { id }, select: { status: true } });
  if (!sgc) return NextResponse.json({ error: "Registro não encontrado." }, { status: 404 });
  if (sgc.status !== "APROVADO") {
    return NextResponse.json({ error: "Somente registros com NF enviada podem ser marcados como pagos." }, { status: 409 });
  }

  const buffer = file ? Buffer.from(await file.arrayBuffer()) : null;
  const now = new Date();

  await prisma.sgcAprovacaoMedicao.update({
    where: { id },
    data: {
      status: "PAGO",
      pagoAt: now,
      comprovanteArquivo: buffer,
      comprovanteArquivoNome: file?.name ?? null,
      comprovanteCarregadoAt: file ? now : null,
      updatedAt: now,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const fin = await requireFinanceiro();
  if (fin.response) return fin.response;
  if (!["MEDICAO", "ADMIN"].includes(fin.user?.perfil ?? "")) {
    return NextResponse.json({ error: "Ação restrita à equipe de medição." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const action = payload?.action;
  const id = typeof payload?.id === "string" ? payload.id.trim() : "";

  if (action !== "VOLTAR_BM") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  if (!id) return NextResponse.json({ error: "Parâmetro id obrigatório." }, { status: 400 });

  const sgc = await prisma.sgcAprovacaoMedicao.findUnique({
    where: { id },
    select: { id: true, status: true, nfArquivo: true, colaboradorCodigo: true, ciclo: true },
  });
  if (!sgc) return NextResponse.json({ error: "Registro não encontrado." }, { status: 404 });

  if (!["PENDENTE", "REVISAO_SOLICITADA"].includes(sgc.status)) {
    return NextResponse.json({ error: "Somente BMs em 'Aguardando aprovação' ou 'Revisão' podem ser retornados." }, { status: 409 });
  }

  if (sgc.nfArquivo) {
    await logBmAction({
      sgcId: sgc.id,
      colaboradorCodigo: sgc.colaboradorCodigo,
      ciclo: sgc.ciclo ?? undefined,
      usuarioId: fin.user?.id,
      usuarioNome: fin.user?.nome,
      acao: "TENTATIVA_VOLTAR_COM_NF",
      statusAnterior: sgc.status,
      observacao: "Bloqueado: NF já postada.",
      telaOrigem: "Financeiro",
    });
    return NextResponse.json(
      { error: "Não é possível retornar este BM de forma automática, pois já existe Nota Fiscal postada pelo fornecedor." },
      { status: 409 },
    );
  }

  const now = new Date();
  await prisma.sgcAprovacaoMedicao.update({
    where: { id },
    data: {
      status: "AGUARDANDO_ENVIO",
      pontosDiscordancia: null,
      respostaAdmin: null,
      observacaoColaborador: null,
      aprovadoAt: null,
      revisaoSolicitadaAt: null,
      salvoAt: null,
      reenviadoAt: null,
      resolvidoAt: null,
      voltadoAt: now,
      updatedAt: now,
    },
  });

  await logBmAction({
    sgcId: sgc.id,
    colaboradorCodigo: sgc.colaboradorCodigo,
    ciclo: sgc.ciclo ?? undefined,
    usuarioId: fin.user?.id,
    usuarioNome: fin.user?.nome,
    acao: "VOLTAR_BM",
    statusAnterior: sgc.status,
    statusNovo: "AGUARDANDO_ENVIO",
    telaOrigem: "Pagamentos por fornecedor",
  });

  return NextResponse.json({ ok: true });
}
