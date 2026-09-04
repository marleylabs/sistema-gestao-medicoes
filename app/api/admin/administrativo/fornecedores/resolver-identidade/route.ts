import { NextRequest, NextResponse } from "next/server";
import { requireAdministrativo } from "@/lib/admin";
import {
  FornecedorResolucaoInvalidaError,
  resolverIdentidadeManualmente,
  type CadastroRow,
  type IdentityManualChoice,
} from "@/lib/cadastro-fornecedor";

function text(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Passo 2 do fluxo "Resolver identidade": conclui SÓ a linha pendente escolhida pelo ADMIN (nunca
 * reimporta a planilha inteira). `linha` vem do frontend (a mesma linha devolvida no resultado da
 * importação — nunca persistida no servidor), mas é sempre revalidada/whitelisted aqui, nunca
 * usada como `data` direto (mass assignment). `escolha` é validada contra os candidatos REAIS
 * recalculados dentro de `resolverIdentidadeManualmente` — nunca confia em nada vindo do cliente
 * além do nome da linha e do código escolhido. Restrito a ADMIN.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdministrativo();
  if (auth.response) return auth.response;
  if (auth.user?.perfil !== "ADMIN") {
    return NextResponse.json({ error: "Resolução de identidade restrita ao perfil ADMIN." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const linhaRaw = b.linha && typeof b.linha === "object" ? (b.linha as Record<string, unknown>) : null;
  const responsavel = text(linhaRaw?.responsavel);
  if (!linhaRaw || !responsavel) {
    return NextResponse.json({ error: "Informe a linha (\"linha\") com pelo menos o nome (\"responsavel\")." }, { status: 400 });
  }

  const row: CadastroRow = {
    responsavel,
    cnpj: text(linhaRaw.cnpj) ?? "",
    cnpjNormalizado: text(linhaRaw.cnpjNormalizado) ?? "",
    razaoSocial: text(linhaRaw.razaoSocial) ?? responsavel,
    statusContrato: text(linhaRaw.statusContrato),
    objetoContrato: text(linhaRaw.objetoContrato),
    cargo: text(linhaRaw.cargo),
    cpf: text(linhaRaw.cpf),
    email: text(linhaRaw.email)?.toLowerCase() ?? null,
    telefone: text(linhaRaw.telefone),
    tipoCt: text(linhaRaw.tipoCt),
    tipoContrato: text(linhaRaw.tipoContrato),
    valorHora: numberOrNull(linhaRaw.valorHora),
    valorA1Equivalente: numberOrNull(linhaRaw.valorA1Equivalente),
    valorDocumento: numberOrNull(linhaRaw.valorDocumento),
    valorCondicaoFixa: numberOrNull(linhaRaw.valorCondicaoFixa),
    inicio: dateOrNull(linhaRaw.inicio),
    final: dateOrNull(linhaRaw.final),
    statusCadastro: text(linhaRaw.statusCadastro),
    primeiroAditivo: text(linhaRaw.primeiroAditivo),
    segundoAditivo: text(linhaRaw.segundoAditivo),
    rawPayload: { origem: "resolucao-manual" },
  };

  const escolhaRaw = b.escolha && typeof b.escolha === "object" ? (b.escolha as Record<string, unknown>) : null;
  let escolha: IdentityManualChoice;
  if (escolhaRaw?.tipo === "USAR_CANDIDATO" && typeof escolhaRaw.codigo === "string" && escolhaRaw.codigo.trim()) {
    escolha = { tipo: "USAR_CANDIDATO", codigo: escolhaRaw.codigo.trim() };
  } else if (escolhaRaw?.tipo === "NENHUMA_IDENTIDADE") {
    escolha = { tipo: "NENHUMA_IDENTIDADE" };
  } else {
    return NextResponse.json({ error: "Informe \"escolha\": { tipo: \"USAR_CANDIDATO\", codigo } ou { tipo: \"NENHUMA_IDENTIDADE\" }." }, { status: 400 });
  }

  try {
    const resultado = await resolverIdentidadeManualmente(row, escolha, {
      id: auth.user.id,
      usuario: auth.user.usuario,
      nome: auth.user.nome,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof FornecedorResolucaoInvalidaError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
