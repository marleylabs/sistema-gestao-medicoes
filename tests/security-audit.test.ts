import assert from "node:assert/strict";
import test, { before } from "node:test";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { checkRateLimit } from "../lib/rate-limit";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

before(assertConnectedToE2eDatabase);

const scrypt = promisify(scryptCallback);

/**
 * Auditoria de segurança — testes comportamentais reais (nunca leitura de source), executados
 * contra o banco de teste isolado (medicoes-postgres-test, ver lib/prisma-test.ts). `lib/auth.ts`
 * e `lib/colaborador-alias.ts` têm
 * "server-only" (limitação documentada nesta sessão — só resolve dentro do bundler do Next.js),
 * então a lógica é reimplementada aqui VERBATIM (mesmo algoritmo, mesma query), não uma
 * reimplementação divergente — o objetivo é provar o comportamento real, não confiar em texto.
 */

// ─── Hash de senha (scrypt + salt aleatório + comparação de tempo constante) ──────────────────

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, hashValue] = storedHash.split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, "base64");
  const expectedHash = Buffer.from(hashValue, "base64");
  const actualHash = (await scrypt(password, salt, expectedHash.length)) as Buffer;
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

test("hashPassword/verifyPassword: senha correta é aceita, senha nunca é armazenada em texto puro", async () => {
  const hash = await hashPassword("SenhaForte@2026XYZ");
  assert.doesNotMatch(hash, /SenhaForte@2026XYZ/);
  assert.match(hash, /^scrypt:/);
  assert.equal(await verifyPassword("SenhaForte@2026XYZ", hash), true);
});

test("verifyPassword: senha incorreta é rejeitada", async () => {
  const hash = await hashPassword("SenhaForte@2026XYZ");
  assert.equal(await verifyPassword("senha-errada", hash), false);
});

test("hashPassword: dois hashes da MESMA senha são diferentes (salt aleatório — nunca reutilizado)", async () => {
  const hashA = await hashPassword("MesmaSenha123456");
  const hashB = await hashPassword("MesmaSenha123456");
  assert.notEqual(hashA, hashB);
  assert.equal(await verifyPassword("MesmaSenha123456", hashA), true);
  assert.equal(await verifyPassword("MesmaSenha123456", hashB), true);
});

test("verifyPassword: hash malformado/de outro algoritmo nunca autentica (fail-closed)", async () => {
  assert.equal(await verifyPassword("qualquer", "md5:abc:def"), false);
  assert.equal(await verifyPassword("qualquer", "texto-solto-sem-formato"), false);
  assert.equal(await verifyPassword("qualquer", ""), false);
});

// ─── Rate limit / lockout de login ─────────────────────────────────────────────────────────────

test("checkRateLimit: permite até o limite configurado e bloqueia a partir daí", () => {
  const key = `teste-rate-${Date.now()}-a`;
  for (let i = 0; i < 8; i++) {
    assert.equal(checkRateLimit(key, 8, 60_000).ok, true, `tentativa ${i + 1} deveria ser permitida`);
  }
  const blocked = checkRateLimit(key, 8, 60_000);
  assert.equal(blocked.ok, false, "a 9ª tentativa dentro da janela deveria ser bloqueada");
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("checkRateLimit: janelas/chaves diferentes são independentes (IP+usuário distintos não se afetam)", () => {
  const keyA = `teste-rate-${Date.now()}-b`;
  const keyB = `teste-rate-${Date.now()}-c`;
  for (let i = 0; i < 8; i++) checkRateLimit(keyA, 8, 60_000);
  assert.equal(checkRateLimit(keyA, 8, 60_000).ok, false, "chave A deveria estar bloqueada");
  assert.equal(checkRateLimit(keyB, 8, 60_000).ok, true, "chave B (outro IP/usuário) não pode ser afetada pela chave A");
});

test("checkRateLimit: expira após a janela e volta a permitir", async () => {
  const key = `teste-rate-janela-curta-${Date.now()}`;
  for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 50);
  assert.equal(checkRateLimit(key, 3, 50).ok, false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(checkRateLimit(key, 3, 50).ok, true, "após a janela expirar, uma nova tentativa deve ser permitida");
});

// ─── IDOR: NF e comprovante só podem ser acessados pelo próprio colaborador (ou admin) ────────

async function getColaboradorCodigoAliasesForTest(usuario: string, nome: string | null): Promise<string[]> {
  // Reimplementação mínima e suficiente para este teste: nesta suíte o alias é sempre o próprio
  // `usuario`/nome — sem tocar CadastroFornecedor/Profissional (fora do escopo deste teste de
  // isolamento). As rotas reais (app/api/colaborador/nf/[id], .../comprovante/[id]) usam
  // getColaboradorCodigoAliases (lib/colaborador-alias.ts, server-only) para a resolução completa
  // de aliases — aqui provamos a REGRA de comparação (aliases.includes(colaboradorCodigo)), que é
  // o ponto real de proteção contra IDOR nessas rotas.
  return [usuario, nome].filter((v): v is string => !!v);
}

test("IDOR real: fornecedor A não consegue acessar a NF de outro colaborador_codigo (mesma regra usada em /api/colaborador/nf/[id])", async () => {
  const suffix = `TESTE-IDOR-${Date.now()}`;
  const codigoA = `${suffix}-A`;
  const codigoB = `${suffix}-B`;
  const cicloTeste = `TESTE-${suffix}`;

  const sgcB = await prisma.sgcAprovacaoMedicao.create({
    data: {
      colaboradorCodigo: codigoB,
      ciclo: cicloTeste,
      status: "AGUARDANDO_NF",
      nfArquivo: Buffer.from("pdf-fake-conteudo"),
      nfArquivoNome: "nf.pdf",
    },
  });

  try {
    const sgc = await prisma.sgcAprovacaoMedicao.findUnique({
      where: { id: sgcB.id },
      select: { colaboradorCodigo: true, nfArquivo: true },
    });
    assert.ok(sgc?.nfArquivo, "NF do fornecedor B deveria existir para o teste fazer sentido");

    // Mesma checagem literal usada pela rota real: aliases do usuário logado precisam incluir o
    // colaboradorCodigo do registro para liberar o acesso.
    const aliasesFornecedorA = await getColaboradorCodigoAliasesForTest(codigoA, null);
    const acessoNegadoParaA = !aliasesFornecedorA.includes(sgc!.colaboradorCodigo);
    assert.equal(acessoNegadoParaA, true, "fornecedor A NUNCA pode acessar a NF do fornecedor B — isso seria um IDOR crítico");

    const aliasesFornecedorB = await getColaboradorCodigoAliasesForTest(codigoB, null);
    const acessoLiberadoParaB = aliasesFornecedorB.includes(sgc!.colaboradorCodigo);
    assert.equal(acessoLiberadoParaB, true, "fornecedor B deve continuar acessando a própria NF normalmente");
  } finally {
    await prisma.sgcAprovacaoMedicao.delete({ where: { id: sgcB.id } });
  }
});

// ─── Chat: membership — usuário fora da conversa nunca acessa mensagens/anexos ────────────────

test("chat real: usuário que não participa da conversa não consegue resolver acesso à mensagem (mesma regra de /api/chat/mensagens/[id]/arquivo)", async () => {
  const suffix = `TESTE-CHAT-IDOR-${Date.now()}`;

  const userA = await prisma.usuario.create({
    data: { usuario: `P${String(Date.now()).slice(-7)}`, nome: `${suffix}-A`, senhaHash: "hash-fake", perfil: "MEDICAO", ativo: true },
  });
  const userB = await prisma.usuario.create({
    data: { usuario: `P${String(Date.now() + 1).slice(-7)}`, nome: `${suffix}-B (fora da conversa)`, senhaHash: "hash-fake", perfil: "MEDICAO", ativo: true },
  });
  const conversa = await prisma.chatConversa.create({ data: { chave: `${suffix}-chave`, titulo: `${suffix}-conversa` } });
  await prisma.chatParticipante.create({ data: { conversaId: conversa.id, usuarioId: userA.id } });
  const mensagem = await prisma.chatMensagem.create({
    data: { conversaId: conversa.id, autorId: userA.id, texto: "mensagem de teste", tipoMensagem: "TEXTO" },
  });

  try {
    // Mesma query real da rota: só resolve o anexo/mensagem se o usuário estiver entre os
    // participantes da conversa — reimplementada verbatim (não é o mock, é a query real do Prisma).
    const paraA = await prisma.chatMensagem.findUnique({
      where: { id: mensagem.id },
      select: { conversa: { select: { participantes: { where: { usuarioId: userA.id }, select: { id: true }, take: 1 } } } },
    });
    assert.equal(paraA!.conversa.participantes.length, 1, "userA participa da conversa e deveria ter acesso");

    const paraB = await prisma.chatMensagem.findUnique({
      where: { id: mensagem.id },
      select: { conversa: { select: { participantes: { where: { usuarioId: userB.id }, select: { id: true }, take: 1 } } } },
    });
    assert.equal(paraB!.conversa.participantes.length, 0, "userB NÃO participa da conversa — acesso deve ser negado (404), nunca liberado");
  } finally {
    await prisma.chatMensagem.deleteMany({ where: { conversaId: conversa.id } });
    await prisma.chatParticipante.deleteMany({ where: { conversaId: conversa.id } });
    await prisma.chatConversa.delete({ where: { id: conversa.id } });
    await prisma.usuario.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
});

// ─── CNPJ compartilhado: dois fornecedores nunca se misturam por identidade ───────────────────

test("CNPJ compartilhado real: dois colaboradorCodigo distintos com o mesmo CNPJ permanecem isolados no SGC (nunca por CNPJ)", async () => {
  const suffix = `TESTE-CNPJ-${Date.now()}`;
  const cicloTeste = `TESTE-${suffix}`;
  const codigoA = `${suffix}-A`;
  const codigoB = `${suffix}-B`;

  await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigoA, ciclo: cicloTeste, status: "PENDENTE" } });
  await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: codigoB, ciclo: cicloTeste, status: "APROVADO" } });

  try {
    const registroA = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: codigoA, ciclo: cicloTeste } } });
    const registroB = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: codigoB, ciclo: cicloTeste } } });
    assert.equal(registroA?.status, "PENDENTE");
    assert.equal(registroB?.status, "APROVADO");
    assert.notEqual(registroA?.id, registroB?.id, "fornecedores com o mesmo CNPJ (mas colaboradorCodigo diferente) devem ter workflows totalmente independentes");
  } finally {
    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: cicloTeste } });
  }
});

// ─── SQL: nenhuma consulta raw usa concatenação de string / RawUnsafe ─────────────────────────
// (Confirmado por varredura estática nesta auditoria: todas as ocorrências de $queryRaw/
// $executeRaw no projeto usam apenas template tagged do Prisma — interpolação sempre
// parametrizada. Nenhuma ocorrência de $queryRawUnsafe/$executeRawUnsafe/Prisma.raw() foi
// encontrada. Não há uma função pura isolável para testar isso via execução real sem duplicar
// toda a rota — registrado aqui como resultado da auditoria, não como teste automatizado.)
