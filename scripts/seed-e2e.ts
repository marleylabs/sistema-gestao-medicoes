/**
 * Seed determinístico do banco E2E isolado (medicoes-postgres-test). NUNCA roda fora do banco de
 * teste — importa `lib/prisma-test.ts`, cujo guard aborta se NODE_ENV/ALLOW_E2E_DATABASE/
 * DATABASE_URL_TEST não baterem exatamente com o ambiente de teste esperado.
 *
 * Idempotente: remove qualquer dado com os identificadores E2E conhecidos antes de recriar, então
 * pode ser rodado quantas vezes for preciso (ex.: antes de cada execução do Playwright).
 *
 * Uso: npx tsx scripts/seed-e2e.ts
 */
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";

const scrypt = promisify(scryptCallback);

// Reimplementação verbatim de lib/auth.ts:hashPassword — esse módulo tem "server-only" e não
// pode ser importado num script standalone (limitação documentada nesta sessão).
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[seed-e2e] ${name} não configurada em .env.test.`);
  return value;
}

async function main() {
  await assertConnectedToE2eDatabase();

  const ciclo = requireEnv("E2E_CICLO");
  const cnpjCompartilhado = "11222333000181";

  const usuarios = [
    { usuario: requireEnv("E2E_ADMIN_USUARIO"), nome: "E2E Admin", perfil: "ADMIN", senha: requireEnv("E2E_ADMIN_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_MEDICAO_USUARIO"), nome: "E2E Medição", perfil: "MEDICAO", senha: requireEnv("E2E_MEDICAO_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_FINANCEIRO_USUARIO"), nome: "E2E Financeiro", perfil: "FINANCEIRO", senha: requireEnv("E2E_FINANCEIRO_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_FORNECEDOR_A_USUARIO"), nome: "E2E Fornecedor A", perfil: "COLABORADOR", senha: requireEnv("E2E_FORNECEDOR_A_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_FORNECEDOR_B_USUARIO"), nome: "E2E Fornecedor B", perfil: "COLABORADOR", senha: requireEnv("E2E_FORNECEDOR_B_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_FORNECEDOR_C_USUARIO"), nome: "E2E Fornecedor C", perfil: "COLABORADOR", senha: requireEnv("E2E_FORNECEDOR_C_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_FORNECEDOR_D_USUARIO"), nome: "E2E Fornecedor D", perfil: "COLABORADOR", senha: requireEnv("E2E_FORNECEDOR_D_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_ADMINISTRATIVO_USUARIO"), nome: "E2E Administrativo", perfil: "ADMINISTRATIVO", senha: requireEnv("E2E_ADMINISTRATIVO_PASSWORD"), ativo: true },
    { usuario: requireEnv("E2E_INATIVO_USUARIO"), nome: "E2E Inativo", perfil: "MEDICAO", senha: requireEnv("E2E_INATIVO_PASSWORD"), ativo: false },
  ];

  console.log("[seed-e2e] Limpando TODO dado E2E anterior (qualquer ciclo — não só o ciclo atual, para nunca deixar lixo de uma execução com E2E_CICLO diferente)...");
  const codigoA = requireEnv("E2E_FORNECEDOR_A_USUARIO");
  const codigoB = requireEnv("E2E_FORNECEDOR_B_USUARIO");
  const codigoC = requireEnv("E2E_FORNECEDOR_C_USUARIO");
  const codigoD = requireEnv("E2E_FORNECEDOR_D_USUARIO");
  // Profissional dedicado ao teste de "Novo pagamento" (e2e/novo-pagamento.spec.ts) — sem
  // CadastroFornecedor nem MapaPagamentoItem prévios, para o cenário nascer limpo a cada rodada.
  const codigoNovoPagamento = "E2E-NP-001";
  const codigos = [codigoA, codigoB, codigoC, codigoD, codigoNovoPagamento];
  // Por Projeto (não por ciclo/profissional): Medicao.idProjeto tem onDelete: Restrict — o Postgres
  // recusa apagar um Projeto enquanto QUALQUER Medicao o referenciar, mesmo de ciclo/profissional
  // já removidos em execução anterior (causa raiz de uma violação de FK encontrada nesta auditoria).
  // Apagar por relação com o Projeto E2E cobre isso incondicionalmente.
  await prisma.divergenciaMedicao.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
  await prisma.medicao.deleteMany({ where: { projeto: { codigoProjeto: { startsWith: "E2E-PROJ" } } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { in: codigos } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: codigos } } });
  await prisma.profissional.deleteMany({ where: { codigo: { in: codigos } } });
  await prisma.projeto.deleteMany({ where: { codigoProjeto: { startsWith: "E2E-PROJ" } } });
  await prisma.usuario.deleteMany({ where: { usuario: { in: usuarios.map((u) => u.usuario) } } });
  await prisma.mapaPagamentoContexto.deleteMany({ where: { OR: [{ ciclo }, { ciclo: { startsWith: "26" }, mesReferencia: "E2E" }] } });

  // Cadastros criados pelos specs de "Novo pagamento" / "Novo fornecedor" (não fazem parte dos
  // fornecedores fixos acima — nascem e morrem dentro do próprio teste, mas limpa aqui também
  // para nunca acumular lixo entre execuções).
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: "E2E-NP-001" } });
  await prisma.profissional.deleteMany({ where: { codigo: "E2E-NP-001" } });
  await prisma.usuario.deleteMany({ where: { nome: { startsWith: "E2E Fornecedor Manual" } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: "E2E Fornecedor Manual" } } });
  await prisma.profissional.deleteMany({ where: { nomeCompleto: { startsWith: "E2E Fornecedor Manual" } } });
  // e2e/bm-available-fornecedor-manual.spec.ts — mesma lógica, prefixo diferente. Cenários de
  // regressão desse spec deliberadamente digitam texto SEM selecionar sugestão, então
  // colaboradorCodigo/projetistaCodigo podem não ter a grafia canônica nem "responsavel"
  // preenchido — limpa por `projetistaCodigo`/`colaboradorCodigo` case-insensitive também, nunca
  // só por "responsavel" (que é exatamente o campo que o bug original deixava vazio).
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { OR: [{ colaboradorNome: { startsWith: "Fornecedor Manual Email" } }, { colaboradorCodigo: { startsWith: "Fornecedor Manual Email", mode: "insensitive" } }] } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { OR: [{ responsavel: { startsWith: "Fornecedor Manual Email" } }, { projetistaCodigo: { startsWith: "Fornecedor Manual Email", mode: "insensitive" } }] } });
  await prisma.usuario.deleteMany({ where: { nome: { startsWith: "Fornecedor Manual Email" } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: "Fornecedor Manual Email" } } });
  await prisma.profissional.deleteMany({ where: { nomeCompleto: { startsWith: "Fornecedor Manual Email" } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { startsWith: "CODIGO-QUE-NUNCA-EXISTIU", mode: "insensitive" } } });
  // e2e/bm-retornar-reenvio.spec.ts — fornecedor dedicado para o ciclo "Enviar BM" → "Retornar BM"
  // → "Enviar BM" de novo (bug: reenvio pós-retorno nunca notificava por e-mail), e o mesmo prefixo
  // para o cenário de concorrência real (duas chamadas simultâneas ao mesmo /api/sgc/enviar).
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { startsWith: "Fornecedor Retorno BM", mode: "insensitive" } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { startsWith: "Fornecedor Retorno BM", mode: "insensitive" } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: "Fornecedor Retorno BM" } } });
  await prisma.profissional.deleteMany({ where: { nomeCompleto: { startsWith: "Fornecedor Retorno BM" } } });
  // e2e/bm-email-lock-failure.spec.ts — injeção proposital de falha do advisory lock (nunca deve
  // cair para envio sem trava).
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { startsWith: "Fornecedor Lock Falha", mode: "insensitive" } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { startsWith: "Fornecedor Lock Falha", mode: "insensitive" } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: "Fornecedor Lock Falha" } } });
  await prisma.profissional.deleteMany({ where: { nomeCompleto: { startsWith: "Fornecedor Lock Falha" } } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { colaboradorCodigo: { startsWith: "Fornecedor Lock Recuperado", mode: "insensitive" } } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { projetistaCodigo: { startsWith: "Fornecedor Lock Recuperado", mode: "insensitive" } } });
  await prisma.cadastroFornecedor.deleteMany({ where: { responsavel: { startsWith: "Fornecedor Lock Recuperado" } } });
  await prisma.profissional.deleteMany({ where: { nomeCompleto: { startsWith: "Fornecedor Lock Recuperado" } } });

  console.log("[seed-e2e] Criando usuários...");
  for (const u of usuarios) {
    await prisma.usuario.create({
      data: { usuario: u.usuario, nome: u.nome, perfil: u.perfil, senhaHash: await hashPassword(u.senha), ativo: u.ativo },
    });
  }

  console.log(`[seed-e2e] Criando ciclo ${ciclo}...`);
  await prisma.mapaPagamentoContexto.create({ data: { ciclo, mesReferencia: "E2E", ativoMedicao: false } });

  console.log("[seed-e2e] Criando fornecedores (CNPJ compartilhado, colaboradorCodigo distintos)...");
  const projeto = await prisma.projeto.create({ data: { codigoProjeto: "E2E-PROJ-001", contrato: "E2E" } });
  const profissionalA = await prisma.profissional.create({ data: { nome: "E2E Fornecedor A", codigo: codigoA, cnpj: cnpjCompartilhado } });
  const profissionalB = await prisma.profissional.create({ data: { nome: "E2E Fornecedor B", codigo: codigoB, cnpj: cnpjCompartilhado } });
  // Fornecedor C: dedicado ao cenário de revisão (independente de A/B, nunca compartilha estado
  // entre specs — item 49 do pedido de Fase 4). Documento igual ao de A (mesmo NR VALE/formato/
  // a1eq/emissão/tipo) para poder reaproveitar mascara-valida.xlsx na segunda rodada pós-revisão.
  const profissionalC = await prisma.profissional.create({ data: { nome: "E2E Fornecedor C", codigo: codigoC, cnpj: cnpjCompartilhado } });
  // Fornecedor D: dedicado aos testes multiusuário de auto-refresh (e2e/realtime-multiuser.spec.ts)
  // — precisa ficar completamente livre de qualquer outra suíte para provar atualização sem F5
  // de forma determinística, sem depender da ordem de execução dos arquivos de spec.
  const profissionalD = await prisma.profissional.create({ data: { nome: "E2E Fornecedor D", codigo: codigoD, cnpj: cnpjCompartilhado } });
  // Sem CadastroFornecedor/MapaPagamentoItem — precisa ser encontrável pelo autocomplete "Nome
  // (ID)" do modal Novo pagamento, mas sem nenhum registro de pagamento pré-existente no ciclo.
  await prisma.profissional.create({ data: { nome: "E2E Novo Pagamento", codigo: codigoNovoPagamento, cnpj: "22333444000155" } });

  // razaoSocial de A precisa bater exatamente com o prestador já embutido em
  // tests/fixtures/nf/valida-b.pdf — reaproveita a fixture de NF existente (item 4 do pedido:
  // nunca duplicar arquivo de teste sem necessidade) em vez de gerar um PDF novo.
  await prisma.cadastroFornecedor.create({
    data: { cnpjNormalizado: cnpjCompartilhado, colaboradorCodigo: codigoA, responsavel: "E2E Fornecedor A", razaoSocial: "TESTE B SERVICOS LTDA", valorHora: 100 },
  });
  await prisma.cadastroFornecedor.create({
    data: { cnpjNormalizado: cnpjCompartilhado, colaboradorCodigo: codigoB, responsavel: "E2E Fornecedor B", razaoSocial: "E2E FORNECEDOR B LTDA", valorHora: 150 },
  });
  await prisma.cadastroFornecedor.create({
    data: { cnpjNormalizado: cnpjCompartilhado, colaboradorCodigo: codigoC, responsavel: "E2E Fornecedor C", razaoSocial: "E2E FORNECEDOR C LTDA", valorHora: 120 },
  });
  await prisma.cadastroFornecedor.create({
    data: { cnpjNormalizado: cnpjCompartilhado, colaboradorCodigo: codigoD, responsavel: "E2E Fornecedor D", razaoSocial: "TESTE B SERVICOS LTDA", valorHora: 130 },
  });

  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 1, projetistaCodigo: codigoA, responsavel: "E2E Fornecedor A", valor: 1000, sourceRowHash: `e2e-mapa-${codigoA}` },
  });
  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 2, projetistaCodigo: codigoB, responsavel: "E2E Fornecedor B", valor: 1500, sourceRowHash: `e2e-mapa-${codigoB}` },
  });
  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 3, projetistaCodigo: codigoC, responsavel: "E2E Fornecedor C", valor: 1200, sourceRowHash: `e2e-mapa-${codigoC}` },
  });
  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 4, projetistaCodigo: codigoD, responsavel: "E2E Fornecedor D", valor: 1300, sourceRowHash: `e2e-mapa-${codigoD}` },
  });

  // formato/tipo2 preenchidos (não só equivalenteA1Horas/percentualEmissao): são os mesmos 5
  // campos que tests/fixtures/e2e/conferencia/mascara-valida.xlsx precisa reproduzir
  // EXATAMENTE para dar 0 divergências (ver lib/conferencia-medicao.ts:compararDocumentos).
  await prisma.medicao.create({
    data: {
      numeroMedicao: `E2E-MED-${codigoA}`, idProjeto: projeto.id, idProfissional: profissionalA.id, ciclo,
      numeroDocumento: "E2E-DOC-001", formato: "PDF", equivalenteA1Horas: 10, percentualEmissao: 1, tipo2: "DOC",
      condicao: "100", sourceRowHash: `e2e-doc-${codigoA}`,
    },
  });
  await prisma.medicao.create({
    data: {
      numeroMedicao: `E2E-MED-${codigoB}`, idProjeto: projeto.id, idProfissional: profissionalB.id, ciclo,
      numeroDocumento: "E2E-DOC-002", formato: "PDF", equivalenteA1Horas: 15, percentualEmissao: 1, tipo2: "DOC",
      condicao: "150", sourceRowHash: `e2e-doc-${codigoB}`,
    },
  });
  await prisma.medicao.create({
    data: {
      numeroMedicao: `E2E-MED-${codigoC}`, idProjeto: projeto.id, idProfissional: profissionalC.id, ciclo,
      numeroDocumento: "E2E-DOC-001", formato: "PDF", equivalenteA1Horas: 10, percentualEmissao: 1, tipo2: "DOC",
      condicao: "120", sourceRowHash: `e2e-doc-${codigoC}`,
    },
  });
  await prisma.medicao.create({
    data: {
      numeroMedicao: `E2E-MED-${codigoD}`, idProjeto: projeto.id, idProfissional: profissionalD.id, ciclo,
      numeroDocumento: "E2E-DOC-001", formato: "PDF", equivalenteA1Horas: 10, percentualEmissao: 1, tipo2: "DOC",
      condicao: "130", sourceRowHash: `e2e-doc-${codigoD}`,
    },
  });

  console.log("[seed-e2e] Concluído.");
  console.log(`  Ciclo: ${ciclo}`);
  console.log(`  Usuários: ${usuarios.map((u) => `${u.usuario} (${u.perfil}${u.ativo ? "" : ", INATIVO"})`).join(", ")}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[seed-e2e] Falhou:", err);
  await prisma.$disconnect();
  process.exit(1);
});
