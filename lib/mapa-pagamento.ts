import { createHash, randomUUID } from "node:crypto";
import { decryptSensitive, encryptSensitive } from "@/lib/encryption";
import { parseDecimal, toNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * Resolve `projetistaCodigo` para a grafia CANÔNICA de um Profissional real antes de gravar
 * MapaPagamentoItem — nunca aceita texto livre como identidade.
 *
 * Bug real encontrado nesta auditoria (BM_AVAILABLE não chegava para fornecedor cadastrado
 * manualmente): o campo "Nome (ID)" do modal "Novo pagamento" permitia submeter qualquer texto
 * digitado (ex.: "Fornecedor Manual Email B") sem exigir clique numa sugestão real — esse texto
 * virava `MapaPagamentoItem.projetistaCodigo` E, ao "Enviar BM", `SgcAprovacaoMedicao.colaboradorCodigo`
 * literalmente. A EXIBIÇÃO (lib/mapa-pagamento-cadastro.ts) já tolera essa divergência (comparação
 * normalizada, sem espaços/caixa), então a tabela mostrava tudo certo — mas
 * `resolveFornecedorEmail`/`/api/sgc/enviar` fazem `findFirst({ where: { colaboradorCodigo } })`
 * por igualdade EXATA, então "Fornecedor Manual Email B" nunca batia com o
 * "FORNECEDOR MANUAL EMAIL B" real gravado por `upsertCadastroFornecedor` — resolução de
 * destinatário sempre vazia, silenciosamente (o e-mail nunca era o problema; a identidade era).
 *
 * Corrigindo na origem (aqui) em vez de tornar toda consulta de colaboradorCodigo case-insensitive
 * — evita a mesma classe de divergência silenciosa se propagar para Portal/NF/Comprovante/
 * Financeiro/Evidências/Chat, que também confiam em `colaboradorCodigo` exato.
 */
export async function resolveProjetistaCodigo(rawValue: unknown): Promise<{ codigo: string | null; error?: string }> {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) return { codigo: null };

  // Busca por codigo/nome/nomeCompleto — os MESMOS três campos que a lista de sugestões do modal
  // já usa para filtrar (ver `suggestions` em components/mapa-pagamento-table.tsx), para que digitar
  // livremente o nome de um fornecedor importado (não só o código canônico) continue funcionando.
  // `codigo` e `nome` são @unique no schema; `nomeCompleto` NÃO é — dois Profissional distintos
  // (ex.: duas pessoas reais homônimas vindas do XLSX) podem legitimamente compartilhar o mesmo
  // nomeCompleto. Nunca escolher um dos dois arbitrariamente: só resolve quando existe EXATAMENTE
  // um `codigo` distinto entre as correspondências.
  const candidatos = await prisma.profissional.findMany({
    where: {
      OR: [
        { codigo: { equals: raw, mode: "insensitive" } },
        { nome: { equals: raw, mode: "insensitive" } },
        { nomeCompleto: { equals: raw, mode: "insensitive" } },
      ],
    },
    select: { codigo: true, nome: true },
  });
  // MUITOS Profissional legados de produção têm `codigo` NULL (import antigo nunca preencheu essa
  // coluna) — `nome` já é a identidade de fato usada nesses casos em todo o resto da aplicação
  // (é literalmente o que `upsertCadastroFornecedor`/`findProfissionalCodigoByName` gravam como
  // colaboradorCodigo quando não existe um `codigo` real). Cair para `codigo` ausente aqui faria
  // NOT_FOUND para fornecedores legítimos e conhecidos.
  const codigosDistintos = Array.from(new Set(candidatos.map((c) => c.codigo ?? c.nome).filter((c): c is string => !!c)));

  if (codigosDistintos.length === 0) {
    return {
      codigo: null,
      error: `Fornecedor "${raw}" não encontrado. Selecione um fornecedor da lista de sugestões antes de salvar.`,
    };
  }
  if (codigosDistintos.length > 1) {
    return {
      codigo: null,
      error: `Mais de um fornecedor corresponde a "${raw}". Selecione o fornecedor correto na lista de sugestões.`,
    };
  }
  // Sempre a grafia canônica armazenada no Profissional — nunca o texto exatamente como digitado.
  return { codigo: codigosDistintos[0] };
}

/**
 * Fórmula única de "Valor Medido" de um Documento Medido — reaproveitada por
 * GET/POST/PATCH de /api/mapa-pagamento/documentos e pelo cálculo de participação
 * por contrato, para nunca existir uma segunda fórmula divergente.
 */
export function calcularValorMedido(doc: {
  equivalenteA1Horas: unknown;
  percentualEmissao: unknown;
  condicao: string | null;
}) {
  const a1eq = toNumber(doc.equivalenteA1Horas as any);
  const pct = toNumber((doc.percentualEmissao ?? 0) as any);
  const preco = parseFloat(doc.condicao ?? "0") || 0;
  return { a1eq, pct, preco, valorMedido: a1eq * preco * pct };
}

type PaymentPayload = {
  ciclo?: unknown;
  ordem?: unknown;
  ato?: unknown;
  projetistaCodigo?: unknown;
  responsavel?: unknown;
  cpfCnpj?: unknown;
  razaoSocial?: unknown;
  intrSossego?: unknown;
  salobo?: unknown;
  acg?: unknown;
  escadasAlumar?: unknown;
  horas?: unknown;
  valor?: unknown;
  rev?: unknown;
  status?: unknown;
  valorFixo?: unknown;
  tipoContratacao?: unknown;
  adicionaisFixos?: unknown;
  observacoesContrato?: unknown;
};

type CadastroOverride = {
  id?: string | null;
  responsavel?: string | null;
  cpfCnpj?: string | null;
  razaoSocial?: string | null;
  tipoCt?: string | null;
};

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function manualHash(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function serializeMapaPagamentoItem(item: any, cadastro?: CadastroOverride | null) {
  const rawPayload = typeof item.rawPayload === "object" && item.rawPayload !== null ? item.rawPayload : {};
  const condicoesFixas = typeof rawPayload.condicoesFixas === "object" && rawPayload.condicoesFixas !== null
    ? rawPayload.condicoesFixas as Record<string, unknown>
    : {};

  return {
    id: item.id,
    ordem: item.ordem,
    ato: item.ato,
    projetistaCodigo: item.projetistaCodigo,
    responsavel: cadastro?.responsavel ?? item.responsavel,
    cpfCnpj: cadastro?.cpfCnpj ?? decryptSensitive(item.cpfCnpj),
    razaoSocial: cadastro?.razaoSocial ?? item.razaoSocial,
    // Alocação: fonte oficial é o Tipo CT do cadastro administrativo do fornecedor, nunca o status
    // derivado da medição/mapa. Sem cadastro correspondente ou com Tipo CT vazio, fica null (—).
    alocacao: cadastro?.tipoCt ?? null,
    fornecedor: cadastro
      ? {
          id: cadastro.id ?? null,
          cpfCnpj: cadastro.cpfCnpj ?? null,
          razaoSocial: cadastro.razaoSocial ?? null,
          responsavel: cadastro.responsavel ?? null,
          tipoCt: cadastro.tipoCt ?? null,
        }
      : null,
    intrSossego: toNumber(item.intrSossego),
    salobo: toNumber(item.salobo),
    acg: toNumber(item.acg),
    escadasAlumar: toNumber(item.escadasAlumar),
    horas: toNumber(item.horas),
    valor: toNumber(item.valor),
    rev: toNumber(item.rev),
    status: item.status,
    condicoesFixas: {
      valorFixo: text(condicoesFixas.valorFixo),
      tipoContratacao: text(condicoesFixas.tipoContratacao),
      adicionaisFixos: text(condicoesFixas.adicionaisFixos),
      observacoesContrato: text(condicoesFixas.observacoesContrato),
    },
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? null),
  };
}

export function mapaPagamentoData(payload: PaymentPayload, sourceRowHash?: string) {
  const rawPayload = {
    origem: "manual",
    ato: text(payload.ato),
    projetistaCodigo: text(payload.projetistaCodigo),
    responsavel: text(payload.responsavel),
    razaoSocial: text(payload.razaoSocial),
    intrSossego: parseDecimal(payload.intrSossego),
    salobo: parseDecimal(payload.salobo),
    acg: parseDecimal(payload.acg),
    escadasAlumar: parseDecimal(payload.escadasAlumar),
    valor: parseDecimal(payload.valor),
    rev: parseDecimal(payload.rev),
    status: text(payload.status),
    condicoesFixas: {
      valorFixo: text(payload.valorFixo),
      tipoContratacao: text(payload.tipoContratacao),
      adicionaisFixos: text(payload.adicionaisFixos),
      observacoesContrato: text(payload.observacoesContrato),
    },
  };

  return {
    ciclo: text(payload.ciclo) ?? "2605",
    ordem: Number(payload.ordem ?? 0),
    ato: text(payload.ato),
    projetistaCodigo: text(payload.projetistaCodigo),
    responsavel: text(payload.responsavel),
    cpfCnpj: encryptSensitive(text(payload.cpfCnpj)),
    razaoSocial: text(payload.razaoSocial),
    intrSossego: parseDecimal(payload.intrSossego),
    salobo: parseDecimal(payload.salobo),
    acg: parseDecimal(payload.acg),
    escadasAlumar: parseDecimal(payload.escadasAlumar),
    horas: parseDecimal(payload.horas),
    valor: parseDecimal(payload.valor),
    rev: parseDecimal(payload.rev),
    status: text(payload.status),
    rawPayload,
    sourceRowHash: sourceRowHash ?? manualHash({ id: randomUUID(), rawPayload }),
  };
}
