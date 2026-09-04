/**
 * DIAGNÓSTICO READ-ONLY da validação de Nota Fiscal (`lib/nf-document-validation.ts` +
 * `app/api/colaborador/nf/route.ts`).
 *
 * NUNCA escreve no banco, nunca faz upload, nunca aprova/rejeita uma NF de verdade — só SELECT
 * (via Prisma) e chamadas às MESMAS funções puras que a rota real usa (importadas diretamente de
 * `lib/nf-document-validation.ts` e `lib/cadastro-identity.ts`, nunca reimplementadas). As únicas
 * duplicações neste arquivo são a descriptografia (`lib/encryption.ts`) e o `onlyDigits`
 * (`lib/cadastro-fornecedor.ts`) — ambos os módulos originais importam `"server-only"`, que não
 * existe fora do bundler do Next.js, então não podem ser importados por um script `tsx` solto.
 * O algoritmo duplicado é copiado literalmente (AES-256-GCM com o mesmo `DATA_ENCRYPTION_KEY`),
 * não reescrito.
 *
 * Uso:
 *   npx tsx scripts/inspect-nf-validation.ts --colaborador-codigo "ANDERSON MARLEY" --nome "Anderson Marley"
 *   npx tsx scripts/inspect-nf-validation.ts --sgc-id <uuid-da-SgcAprovacaoMedicao>
 *   npx tsx scripts/inspect-nf-validation.ts --colaborador-codigo "ANDERSON MARLEY" --pdf ./teste-nf/minha-nf.pdf
 *
 * O parâmetro opcional --pdf roda a validação REAL (`validateNfDocumentAgainstCadastro`) contra um
 * arquivo local, só para diagnóstico — o resultado é impresso, nunca persistido.
 */
import { readFile } from "node:fs/promises";
import { createDecipheriv } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  EXPECTED_TOMADOR_CNPJ,
  EXPECTED_TOMADOR_RAZAO_SOCIAL,
  extractPrestador,
  extractTomador,
  extractCnpj,
  companyMatches,
  normalizeCompany,
  validateNfDocumentAgainstCadastro,
} from "../lib/nf-document-validation";
import { selectCadastroForAuthenticatedUser } from "../lib/cadastro-identity";

const prisma = new PrismaClient();

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function onlyDigits(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value).replace(/\D/g, "");
}

function formatCnpj(digits: string) {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

// Duplicado de lib/encryption.ts::decryptSensitive (esse módulo importa "server-only", que não
// existe fora do Next.js — não pode ser importado por um script tsx solto). Mesmo algoritmo, mesma
// variável de ambiente, sem reescrever a lógica.
const ENC_PREFIX = "enc:v1";
function decryptSensitive(value: string | null | undefined) {
  if (!value || !value.startsWith(`${ENC_PREFIX}:`)) return value ?? null;
  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) return null;
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error("DATA_ENCRYPTION_KEY não configurada.");
  const key = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}

async function main() {
  const sgcId = arg("sgc-id");
  let colaboradorCodigo = arg("colaborador-codigo");
  let nome = arg("nome");
  const pdfPath = arg("pdf");

  console.log("=== DIAGNÓSTICO READ-ONLY — VALIDAÇÃO DE NF ===\n");

  if (sgcId) {
    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({
      where: { id: sgcId },
      select: { id: true, status: true, ciclo: true, colaboradorCodigo: true, colaboradorNome: true },
    });
    if (!sgc) {
      console.error(`[erro] SgcAprovacaoMedicao ${sgcId} não encontrado.`);
      process.exit(1);
    }
    console.log(`SgcAprovacaoMedicao encontrado: status=${sgc.status}, ciclo=${sgc.ciclo}`);
    colaboradorCodigo = sgc.colaboradorCodigo;
    nome = sgc.colaboradorNome;
  }

  if (!colaboradorCodigo) {
    console.error("[erro] Informe --colaborador-codigo (ou --sgc-id).");
    process.exit(1);
  }

  // Mesma consulta e mesma resolução de identidade de `validateFornecedorForNfUpload`
  // (lib/cadastro-fornecedor.ts) — `selectCadastroForAuthenticatedUser` é importado real, não
  // reimplementado.
  const loginCnpj = onlyDigits(colaboradorCodigo);
  const cadastros = await prisma.cadastroFornecedor.findMany({
    where: {
      OR: [
        { colaboradorCodigo },
        ...(nome ? [{ responsavel: { equals: nome, mode: "insensitive" as const } }] : []),
        ...(loginCnpj.length === 14 && nome
          ? [{ cnpjNormalizado: loginCnpj, responsavel: { equals: nome, mode: "insensitive" as const } }]
          : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  const selected = selectCadastroForAuthenticatedUser(cadastros, colaboradorCodigo, nome);
  if (!selected.cadastro) {
    console.error(`[erro] ${selected.error}`);
    process.exit(1);
  }
  const cadastro = selected.cadastro;

  const profissional = cadastro.colaboradorCodigo
    ? await prisma.profissional.findUnique({
        where: { codigo: cadastro.colaboradorCodigo, deletedAt: null },
        select: { cnpj: true, nome: true, nomeCompleto: true },
      })
    : null;
  const profissionalCnpjDigits = onlyDigits(decryptSensitive(profissional?.cnpj ?? null));
  const cnpjConsistente = profissionalCnpjDigits.length === 14 && profissionalCnpjDigits === cadastro.cnpjNormalizado;

  const diagnostico = {
    prestador: {
      nomeEsperado: cadastro.responsavel,
      razaoSocialEsperada: cadastro.razaoSocial,
      cnpjEsperado: formatCnpj(cadastro.cnpjNormalizado),
    },
    tomador: {
      nomeEsperado: EXPECTED_TOMADOR_RAZAO_SOCIAL,
      cnpjEsperado: formatCnpj(EXPECTED_TOMADOR_CNPJ),
    },
    valor: {
      valorEsperado: null,
      observacao: "A validação de NF (lib/nf-document-validation.ts) NÃO verifica valor total, valor líquido, valor dos serviços nem tolerância de centavos — nenhuma comparação de valor existe no fluxo de upload (app/api/colaborador/nf/route.ts). O valor do Mapa de Pagamento só é lido DEPOIS da NF aprovada, apenas para o corpo do e-mail de aviso ao Financeiro (notifyPaymentReady), nunca como critério de aceite/rejeição.",
    },
    profissionalVinculado: profissional
      ? { encontrado: true, cnpjConsistenteComCadastro: cnpjConsistente, cnpjProfissional: profissionalCnpjDigits ? formatCnpj(profissionalCnpjDigits) : null }
      : { encontrado: false, observacao: "Sem Profissional correspondente — upload real seria bloqueado antes mesmo de ler o PDF (\"cadastro administrativo sem profissional correspondente\")." },
    parser: {
      bibliotecaExtracaoTexto: "pdf-parse (classe PDFParse, método getText())",
      labelsTomador: ["TOMADOR DO SERVI[CÇ]O (regex, com/sem acento)", "DADOS DO TOMADOR"],
      labelsFimSecaoTomador: ["INTERMEDI[AÁ]RIO DO SERVI[CÇ]O", "SERVI[CÇ]O PRESTADO", "DISCRIMINA[CÇ][AÃ]O", "VALOR TOTAL"],
      labelsPrestador: ["EMITENTE DA NFS?-?E (regex)", "PRESTADOR DO SERVI[CÇ]O"],
      labelsFimSecaoPrestador: ["TOMADOR DO SERVI[CÇ]O", "INTERMEDI[AÁ]RIO DO SERVI[CÇ]O", "SERVI[CÇ]O PRESTADO"],
      labelsRazaoSocial: ["nome\\s*/\\s*nome\\s*empresarial", "razao\\s*social", "razão\\s*social", "prestador"],
      regexCnpjFormatado: "\\b\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2}\\b",
      regexCnpjSoDigitos: "\\b\\d{14}\\b (fallback, se o formatado não for encontrado)",
      comoLeValor: "extractRazaoSocial() lê a PRÓXIMA linha não-vazia/não-'-' após o rótulo; se essa linha for ela mesma outro rótulo (CNPJ/RAZÃO SOCIAL/NOME.../PRESTADOR), continua pulando até achar um valor real; rejeita o valor se ele parecer um CNPJ.",
    },
  };

  console.log(JSON.stringify(diagnostico, null, 2));

  // Autoteste: monta o texto no MESMO layout comprovado pelas fixtures reais que passam na
  // validação (tests/generate_nf_fixtures.py::make_pdf, usado por valida-a.pdf/valida-b.pdf) e
  // roda as FUNÇÕES REAIS de extração/comparação contra ele — não é suposição, é execução do
  // código atual.
  const textoCompativel = [
    "PRESTADOR DO SERVICO",
    "Nome / Nome Empresarial",
    cadastro.razaoSocial,
    "CNPJ",
    formatCnpj(cadastro.cnpjNormalizado),
    "TOMADOR DO SERVICO",
    "Nome / Nome Empresarial",
    EXPECTED_TOMADOR_RAZAO_SOCIAL,
    "CNPJ",
    formatCnpj(EXPECTED_TOMADOR_CNPJ),
    "SERVICO PRESTADO",
    "Documento sintetico sem valor fiscal para diagnostico.",
  ].join("\n");

  console.log("\n=== FORMATO DE TEXTO COMPATÍVEL COM O PARSER ATUAL ===");
  console.log("(mesmo layout usado pelas fixtures reais que hoje passam na validação — tests/fixtures/nf/valida-b.pdf)\n");
  console.log(textoCompativel);

  const detectedPrestador = extractPrestador(textoCompativel);
  const detectedTomador = extractTomador(textoCompativel);
  console.log("\n=== AUTOTESTE — extractPrestador()/extractTomador() reais contra o texto acima ===");
  console.log("Prestador detectado:", detectedPrestador);
  console.log("  CNPJ bate com esperado?", detectedPrestador.cnpj === cadastro.cnpjNormalizado);
  console.log("  Razão social bate (companyMatches real)?", companyMatches(detectedPrestador.razaoSocial, cadastro.razaoSocial));
  console.log("Tomador detectado:", detectedTomador);
  console.log("  CNPJ bate com esperado?", detectedTomador.cnpj === EXPECTED_TOMADOR_CNPJ);
  console.log("  Razão social bate (companyMatches real)?", companyMatches(detectedTomador.razaoSocial, EXPECTED_TOMADOR_RAZAO_SOCIAL));

  if (pdfPath) {
    console.log(`\n=== TESTE CONTRA PDF REAL: ${pdfPath} ===`);
    const buffer = await readFile(pdfPath);
    const result = await validateNfDocumentAgainstCadastro({
      buffer,
      mimeType: "application/pdf",
      expectedCnpj: cadastro.cnpjNormalizado,
      expectedRazaoSocial: cadastro.razaoSocial,
    });
    console.log(JSON.stringify(result, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
