import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { validateTipoCondicaoFixaForWrite } from "@/lib/condicao-fixa";
import { validateFonteMedicaoForWrite } from "@/lib/fonte-medicao";
import { isValidEmail } from "@/lib/usuario-email-policy";
import { FornecedorIdentityConflictError, FornecedorIdentityDeletedError, normalizeCnpjDigits, serializeCadastroFornecedor, upsertCadastroFornecedor, type CadastroRow } from "@/lib/cadastro-fornecedor";

function text(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function numberOrNull(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : value;
  if (text === null || text === undefined || text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  // Whitelist explícita — nunca `data: body` direto (mass assignment). Só os campos abaixo chegam
  // ao serviço compartilhado com a importação; qualquer outra chave no payload é ignorada.
  const responsavel = text((body as Record<string, unknown>).responsavel);
  const cnpjNormalizado = normalizeCnpjDigits((body as Record<string, unknown>).cnpj as string | undefined);

  if (!responsavel) {
    return NextResponse.json({ error: "Informe o nome/responsável do fornecedor." }, { status: 400 });
  }
  // Mesma regra da importação por planilha (lib/cadastro-fornecedor.ts:parseCadastroFornecedorWorkbook)
  // — só o formato (14 dígitos) é exigido, nunca dígito verificador; e CNPJ nunca é chave única.
  if (cnpjNormalizado.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido — informe os 14 dígitos." }, { status: 400 });
  }
  const email = text((body as Record<string, unknown>).email)?.toLowerCase() ?? null;
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  // Escrita administrativa: valor desconhecido/mal digitado nunca vira "FIXA" em silêncio — só
  // NULL/undefined/"" (ausência explícita) é um default legítimo. Validado ANTES de
  // upsertCadastroFornecedor — payload inválido nunca chega a persistir nada.
  const tipoCondicaoFixaResult = validateTipoCondicaoFixaForWrite(b.tipoCondicaoFixa);
  if (!tipoCondicaoFixaResult.ok) {
    return NextResponse.json({ error: tipoCondicaoFixaResult.error }, { status: 400 });
  }
  const tipoCondicaoFixa = tipoCondicaoFixaResult.value;
  const valorCondicaoFixaComProducao = numberOrNull(b.valorCondicaoFixaComProducao);
  const valorCondicaoFixaSemProducao = numberOrNull(b.valorCondicaoFixaSemProducao);
  if (
    tipoCondicaoFixa === "CONDICIONAL_PRODUCAO" &&
    (valorCondicaoFixaComProducao === null || valorCondicaoFixaSemProducao === null)
  ) {
    return NextResponse.json(
      { error: "Condição fixa condicional por produção exige os dois valores (com produção e sem produção)." },
      { status: 400 },
    );
  }
  const fonteMedicaoResult = validateFonteMedicaoForWrite(b.fonteMedicao);
  if (!fonteMedicaoResult.ok) {
    return NextResponse.json({ error: fonteMedicaoResult.error }, { status: 400 });
  }
  const row: CadastroRow = {
    responsavel,
    cnpj: text(b.cnpj) ?? cnpjNormalizado,
    cnpjNormalizado,
    razaoSocial: text(b.razaoSocial) ?? responsavel,
    statusContrato: text(b.statusContrato),
    objetoContrato: text(b.objetoContrato),
    cargo: text(b.cargo),
    cpf: text(b.cpf),
    email,
    telefone: text(b.telefone),
    tipoCt: text(b.tipoCt),
    tipoContrato: text(b.tipoContrato),
    valorHora: numberOrNull(b.valorHora),
    valorA1Equivalente: numberOrNull(b.valorA1Equivalente),
    valorDocumento: numberOrNull(b.valorDocumento),
    valorCondicaoFixa: numberOrNull(b.valorCondicaoFixa),
    tipoCondicaoFixa,
    valorCondicaoFixaComProducao,
    valorCondicaoFixaSemProducao,
    fonteMedicao: fonteMedicaoResult.value,
    inicio: dateOrNull(b.inicio),
    final: dateOrNull(b.final),
    // Sem status por padrão — a importação também não força um valor quando a planilha não traz
    // a coluna STATUS; cadastro manual segue a mesma regra (item 27 do pedido).
    statusCadastro: text(b.statusCadastro),
    primeiroAditivo: text(b.primeiroAditivo),
    segundoAditivo: text(b.segundoAditivo),
    rawPayload: { origem: "manual" },
  };

  let resultado: Awaited<ReturnType<typeof upsertCadastroFornecedor>>;
  try {
    resultado = await upsertCadastroFornecedor(row);
  } catch (error) {
    if (error instanceof FornecedorIdentityConflictError) {
      // Mesma regra da importação em lote (lib/cadastro-fornecedor.ts) — nunca escolhe um
      // candidato ambíguo sozinho, nem aqui nem lá. O Administrativo recebe os candidatos para
      // decidir manualmente (ex.: editar o cadastro existente em vez de criar um novo).
      return NextResponse.json(
        {
          error: error.message,
          conflito: error.candidates.map((c) => ({
            cadastroId: c.cadastroId,
            colaboradorCodigo: c.colaboradorCodigo,
            responsavel: c.responsavel,
            email: c.email,
            telefone: c.telefone,
            razaoSocial: c.razaoSocial,
          })),
        },
        { status: 409 },
      );
    }
    if (error instanceof FornecedorIdentityDeletedError) {
      // Identidade excluída definitivamente pelo ADMIN — nunca reativada automaticamente, nem
      // pela importação em lote nem pelo cadastro manual avulso (mesma regra).
      return NextResponse.json({ error: error.message, colaboradorCodigoExcluido: error.colaboradorCodigo }, { status: 409 });
    }
    throw error;
  }
  const cadastro = await prisma.cadastroFornecedor.findUniqueOrThrow({ where: { id: resultado.cadastroId } });

  return NextResponse.json(
    {
      cadastro: serializeCadastroFornecedor(cadastro),
      criado: resultado.created,
      usuarioCriado: resultado.usuarioCriado,
      // Recriação de identidade anteriormente excluída: sinaliza se a configuração administrativa
      // (fonteMedicao/tipoCondicaoFixa) foi restaurada de um snapshot preservado na exclusão, ou se
      // não havia snapshot (config anterior, se existiu, não pôde ser recuperada).
      recreated: resultado.recreated,
      administrativeConfigRestored: resultado.administrativeConfigRestored,
      administrativeConfigUnrecoverable: resultado.administrativeConfigUnrecoverable,
      administrativeConfigSnapshotMalformed: resultado.administrativeConfigSnapshotMalformed,
    },
    { status: resultado.created ? 201 : 200 },
  );
}
