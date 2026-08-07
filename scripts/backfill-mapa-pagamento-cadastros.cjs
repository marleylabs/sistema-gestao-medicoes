const { PrismaClient } = require("@prisma/client");
const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");

const prisma = new PrismaClient();
const PREFIX = "enc:v1";

function encryptionKey() {
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error("DATA_ENCRYPTION_KEY não configurada.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64.");
  return key;
}

function decryptSensitive(value) {
  if (!value || !String(value).startsWith(`${PREFIX}:`)) return value ?? null;
  const [, , ivValue, tagValue, encryptedValue] = String(value).split(":");
  if (!ivValue || !tagValue || !encryptedValue) return null;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function encryptSensitive(value) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return null;
  if (cleaned.startsWith(`${PREFIX}:`)) return cleaned;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(cleaned, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

function onlyDigits(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
}

function formatCnpj(value) {
  const digits = onlyDigits(value).padStart(14, "0").slice(-14);
  if (!digits) return "";
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

const STOP_WORDS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "LTDA", "ME", "EIRELI"]);

function tokenList(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .match(/[A-Z0-9]{2,}/g)
    ?.filter((token) => !STOP_WORDS.has(token)) ?? [];
}

function editDistance(left, right) {
  const matrix = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = left[i - 1] === right[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[left.length][right.length];
}

function similarToken(left, right) {
  if (left === right) return true;
  const minLength = Math.min(left.length, right.length);
  if (minLength < 4) return false;
  return editDistance(left, right) <= (minLength >= 8 ? 2 : 1);
}

function fuzzyName(left, right) {
  const leftTokens = tokenList(left);
  const rightTokens = tokenList(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const matches = leftTokens.filter((leftToken) => rightTokens.some((rightToken) => similarToken(leftToken, rightToken))).length;
  const required = Math.min(leftTokens.length, rightTokens.length) >= 2 ? 2 : 1;
  return matches >= required && matches / Math.min(leftTokens.length, rightTokens.length) >= 0.5;
}

function samePerson(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 8 && (a.startsWith(b) || b.startsWith(a))) return true;
  return fuzzyName(left, right);
}

function matchCadastro(item, cadastros) {
  const raw = typeof item.rawPayload === "object" && item.rawPayload !== null ? item.rawPayload : {};
  const codigoCandidates = [item.projetistaCodigo, raw.projetistaCodigo];
  const nomeCandidates = [item.responsavel, item.projetistaCodigo, raw.responsavel, raw.projetistaCodigo];
  const cpfCnpj = onlyDigits(decryptSensitive(item.cpfCnpj));

  const byCodigo = cadastros.find((cadastro) => codigoCandidates.some((value) => samePerson(cadastro.colaboradorCodigo, value)));
  if (byCodigo) return byCodigo;

  const byResponsavel = cadastros.find((cadastro) => nomeCandidates.some((value) => samePerson(cadastro.responsavel, value)));
  if (byResponsavel) return byResponsavel;

  const byRazaoSocialForte = cadastros.filter((cadastro) => {
    const razao = normalize(cadastro.razaoSocial);
    return nomeCandidates.some((value) => {
      const candidate = normalize(value);
      return razao && candidate && (razao === candidate || razao.startsWith(candidate) || candidate.startsWith(razao));
    });
  });
  if (byRazaoSocialForte.length === 1) return byRazaoSocialForte[0];

  const byRazaoSocial = cadastros.filter((cadastro) => nomeCandidates.some((value) => samePerson(cadastro.razaoSocial, value)));
  if (byRazaoSocial.length === 1) return byRazaoSocial[0];

  const byCnpj = cadastros.filter((cadastro) => cadastro.cnpjNormalizado && cadastro.cnpjNormalizado === cpfCnpj);
  return byCnpj.length === 1 ? byCnpj[0] : null;
}

async function main() {
  const cicloArg = process.argv.find((arg) => arg.startsWith("--ciclo="));
  const ciclo = cicloArg ? cicloArg.split("=")[1]?.trim() : null;
  const [itens, cadastros] = await Promise.all([
    prisma.mapaPagamentoItem.findMany({
      where: ciclo ? { ciclo } : undefined,
      select: { id: true, ciclo: true, projetistaCodigo: true, responsavel: true, cpfCnpj: true, razaoSocial: true, rawPayload: true },
    }),
    prisma.cadastroFornecedor.findMany({
      select: { colaboradorCodigo: true, responsavel: true, razaoSocial: true, cnpjNormalizado: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  let updated = 0;
  let skipped = 0;

  for (const item of itens) {
    const cadastro = matchCadastro(item, cadastros);
    if (!cadastro) {
      skipped += 1;
      continue;
    }

    const nextCpfCnpj = formatCnpj(cadastro.cnpjNormalizado);
    const currentCpfCnpj = decryptSensitive(item.cpfCnpj);
    const data = {};

    if (!currentCpfCnpj && nextCpfCnpj) data.cpfCnpj = encryptSensitive(nextCpfCnpj);
    if (!item.razaoSocial && cadastro.razaoSocial) data.razaoSocial = cadastro.razaoSocial;

    if (Object.keys(data).length === 0) {
      skipped += 1;
      continue;
    }

    await prisma.mapaPagamentoItem.update({ where: { id: item.id }, data });
    updated += 1;
  }

  console.log(`Backfill concluído. Atualizados: ${updated}. Ignorados: ${skipped}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
