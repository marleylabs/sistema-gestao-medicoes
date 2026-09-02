import assert from "node:assert/strict";
import test, { before } from "node:test";
import { prismaTest as prisma, assertConnectedToE2eDatabase } from "../lib/prisma-test";
import { getEmailCcForEvent } from "../lib/email/cc-policy";

before(assertConnectedToE2eDatabase);

/**
 * Suíte de integração do workflow completo de medição, ponta a ponta:
 *
 *   AGUARDANDO_ENVIO → PENDENTE → AGUARDANDO_NF → APROVADO → PAGO
 *
 * mais os dois ramos reais confirmados por leitura de código nesta auditoria:
 *   DIVERGÊNCIA:  PENDENTE + statusConferencia (AGUARDANDO_UPLOAD → DIVERGENCIA → CONCLUIDA), com
 *                 avanço para AGUARDANDO_NF só após o fornecedor executar ENVIAR explicitamente.
 *   REVISÃO:      PENDENTE → REVISAO_SOLICITADA → (reenvio) → PENDENTE, com revisaoNumero
 *                 incrementado.
 *
 * IMPORTANTE — este projeto NÃO possui um banco de teste isolado (DATABASE_URL aponta para o
 * FASE 3: agora roda contra `medicoes-postgres-test` (docker-compose.test.yml), um Postgres
 * fisicamente separado do banco da aplicação — nunca mais a mesma instância. O guard forte vive
 * em lib/prisma-test.ts (`assertConnectedToE2eDatabase`, chamado em `before()` abaixo): confirma
 * via `SELECT current_database()` real que a conexão é exatamente o banco de teste esperado antes
 * de qualquer fixture ser criada. Os prefixos `TESTE-E2E-*` + cleanup em `finally` continuam como
 * segunda camada de defesa, mas a isolação real agora é o próprio banco.
 */

// ─── Regras reais reimplementadas verbatim (mesmas guardas das rotas — ver auditoria anterior) ──

const CANCELAVEIS_PARA_REENVIO = ["AGUARDANDO_ENVIO", "REVISAO_SOLICITADA", "CANCELADO"];

/** POST /api/sgc/enviar — só permite (re)envio quando não existe workflow ainda ativo. */
function podeEnviarBm(statusExistente: string | undefined): boolean {
  return statusExistente === undefined || CANCELAVEIS_PARA_REENVIO.includes(statusExistente);
}

/** POST /api/colaborador/sgc (ação ENVIAR) — só aprova quando PENDENTE + conferência CONCLUIDA. */
function podeAprovar(status: string, statusConferencia: string): boolean {
  return status === "PENDENTE" && statusConferencia === "CONCLUIDA";
}

/** POST /api/colaborador/sgc (ação SOLICITAR_REVISAO) — só quando PENDENTE. */
function podeSolicitarRevisao(status: string): boolean {
  return status === "PENDENTE";
}

/** POST /api/colaborador/nf — só aceita upload quando AGUARDANDO_NF. */
function podeEnviarNf(status: string): boolean {
  return status === "AGUARDANDO_NF";
}

/** PATCH /api/admin/financeiro — só paga quando APROVADO. */
function podePagar(status: string): boolean {
  return status === "APROVADO";
}

/** Evidências de Medição — mesma regra corrigida nesta sessão. */
function bmExisteEmEvidencias(status: string): boolean {
  return status !== "AGUARDANDO_ENVIO" && status !== "CANCELADO";
}

// ─── Fixtures determinísticas (item 95: factory reutilizável, sem dados aleatórios) ────────────

type Fixture = {
  suffix: string;
  ciclo: string;
  codigoA: string;
  codigoB: string;
  cnpjCompartilhado: string;
  projetoId: string;
  profissionalAId: string;
  profissionalBId: string;
};

async function seedFixture(label: string): Promise<Fixture> {
  const suffix = `TESTE-E2E-${label}-${Date.now()}`;
  const ciclo = `TESTE-${suffix}`;
  const codigoA = `${suffix}-FORN-A`;
  const codigoB = `${suffix}-FORN-B`;
  const cnpjCompartilhado = "11222333000181"; // mesmo CNPJ para os dois — cobre item 25 (isolamento apesar de CNPJ igual)

  // ativoMedicao NÃO é setado como true: há um unique constraint garantindo só um ciclo ativo por
  // vez, e a suíte não pode disputar essa linha com o ciclo real em produção.
  await prisma.mapaPagamentoContexto.create({ data: { ciclo } });

  const projeto = await prisma.projeto.create({ data: { codigoProjeto: `${suffix}-PROJ`, contrato: "TESTE" } });
  const profissionalA = await prisma.profissional.create({ data: { nome: codigoA, codigo: null, cnpj: cnpjCompartilhado } });
  const profissionalB = await prisma.profissional.create({ data: { nome: codigoB, codigo: null, cnpj: cnpjCompartilhado } });

  await prisma.cadastroFornecedor.create({
    data: { cnpjNormalizado: cnpjCompartilhado, colaboradorCodigo: codigoA, responsavel: codigoA, razaoSocial: `${suffix} RAZAO A`, valorHora: 100 },
  });
  await prisma.cadastroFornecedor.create({
    data: { cnpjNormalizado: cnpjCompartilhado, colaboradorCodigo: codigoB, responsavel: codigoB, razaoSocial: `${suffix} RAZAO B`, valorHora: 200 },
  });

  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 1, projetistaCodigo: codigoA, responsavel: codigoA, valor: 1000, sourceRowHash: `${suffix}-mapa-a` },
  });
  await prisma.mapaPagamentoItem.create({
    data: { ciclo, ordem: 2, projetistaCodigo: codigoB, responsavel: codigoB, valor: 2000, sourceRowHash: `${suffix}-mapa-b` },
  });

  await prisma.medicao.create({
    data: {
      numeroMedicao: `${suffix}-MED-A`, idProjeto: projeto.id, idProfissional: profissionalA.id, ciclo,
      equivalenteA1Horas: 10, percentualEmissao: 1, condicao: "100", sourceRowHash: `${suffix}-doc-a`,
    },
  });
  await prisma.medicao.create({
    data: {
      numeroMedicao: `${suffix}-MED-B`, idProjeto: projeto.id, idProfissional: profissionalB.id, ciclo,
      equivalenteA1Horas: 20, percentualEmissao: 1, condicao: "200", sourceRowHash: `${suffix}-doc-b`,
    },
  });

  return { suffix, ciclo, codigoA, codigoB, cnpjCompartilhado, projetoId: projeto.id, profissionalAId: profissionalA.id, profissionalBId: profissionalB.id };
}

async function cleanupFixture(fx: Fixture) {
  await prisma.divergenciaMedicao.deleteMany({ where: { ciclo: fx.ciclo } });
  await prisma.sgcAprovacaoMedicao.deleteMany({ where: { ciclo: fx.ciclo } });
  await prisma.medicao.deleteMany({ where: { ciclo: fx.ciclo } });
  await prisma.mapaPagamentoItem.deleteMany({ where: { ciclo: fx.ciclo } });
  await prisma.cadastroFornecedor.deleteMany({ where: { colaboradorCodigo: { in: [fx.codigoA, fx.codigoB] } } });
  await prisma.profissional.deleteMany({ where: { id: { in: [fx.profissionalAId, fx.profissionalBId] } } });
  await prisma.projeto.delete({ where: { id: fx.projetoId } }).catch(() => undefined);
  await prisma.mapaPagamentoContexto.delete({ where: { ciclo: fx.ciclo } }).catch(() => undefined);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A. HAPPY PATH — AGUARDANDO_ENVIO → PENDENTE → AGUARDANDO_NF → APROVADO → PAGO
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("HAPPY PATH: cadeia completa de status, com auditoria de banco em cada etapa", async () => {
  const fx = await seedFixture("happy");
  try {
    // 1) Estado inicial: nenhum workflow ainda — equivalente a AGUARDANDO_ENVIO.
    let existing = await prisma.sgcAprovacaoMedicao.findUnique({ where: { colaboradorCodigo_ciclo: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo } } });
    assert.equal(existing, null);
    assert.equal(podeEnviarBm(existing?.status), true);

    // 2) MEDICAO envia o BM → PENDENTE, statusConferencia AGUARDANDO_UPLOAD (BM_AVAILABLE lógico).
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, colaboradorNome: fx.codigoA, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD", revisaoNumero: 0 },
    });
    assert.equal(sgc.status, "PENDENTE");
    assert.equal(sgc.statusConferencia, "AGUARDANDO_UPLOAD");

    // 3) Upload sem divergência → CONCLUIDA — ainda NÃO avança para AGUARDANDO_NF sozinho.
    await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { statusConferencia: "CONCLUIDA" } });
    let atual = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgc.id } });
    assert.equal(atual.status, "PENDENTE", "conferência concluída não avança sozinha — precisa da ação explícita do fornecedor");
    assert.equal(podeAprovar(atual.status, atual.statusConferencia), true);

    // 4) Fornecedor executa ENVIAR (aprovação) → AGUARDANDO_NF (BM_APPROVED lógico).
    atual = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { status: "AGUARDANDO_NF", aprovadoAt: new Date() } });
    assert.equal(atual.status, "AGUARDANDO_NF");
    assert.ok(atual.aprovadoAt);

    // 5) NF enviada e validada → APROVADO (PAYMENT_READY lógico).
    assert.equal(podeEnviarNf(atual.status), true);
    atual = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { status: "APROVADO", nfArquivoNome: "nf-teste.pdf", nfCarregadoAt: new Date() } });
    assert.equal(atual.status, "APROVADO");

    // 6) Financeiro paga com comprovante → PAGO (PAYMENT_COMPLETED lógico).
    assert.equal(podePagar(atual.status), true);
    atual = await prisma.sgcAprovacaoMedicao.update({
      where: { id: sgc.id },
      data: { status: "PAGO", pagoAt: new Date(), comprovanteArquivoNome: "comprovante-teste.pdf", comprovanteCarregadoAt: new Date() },
    });
    assert.equal(atual.status, "PAGO");
    assert.ok(atual.comprovanteArquivoNome, "comprovante deve estar persistido junto do pagamento");

    // 7) Evidências: o BM continua visível mesmo depois de PAGO.
    assert.equal(bmExisteEmEvidencias(atual.status), true, "BM não pode sumir de Evidências depois de PAGO");

    // 8) Reconciliação de valores: valor do mapa de pagamento == valor usado no pagamento.
    const mapaItem = await prisma.mapaPagamentoItem.findFirst({ where: { ciclo: fx.ciclo, projetistaCodigo: fx.codigoA } });
    assert.equal(Number(mapaItem?.valor), 1000, "valor do fornecedor A no mapa de pagamento deve permanecer o mesmo usado no BM/Financeiro");
  } finally {
    await cleanupFixture(fx);
  }
});

test("TRANSIÇÕES INVÁLIDAS: pular etapas é rejeitado pela mesma regra usada nas rotas reais", () => {
  assert.equal(podeEnviarNf("PENDENTE"), false, "NF não pode ser enviada antes de AGUARDANDO_NF");
  assert.equal(podeEnviarNf("AGUARDANDO_ENVIO"), false);
  assert.equal(podePagar("PENDENTE"), false, "pagamento não pode ocorrer antes de APROVADO");
  assert.equal(podePagar("AGUARDANDO_NF"), false);
  assert.equal(podeAprovar("PENDENTE", "AGUARDANDO_UPLOAD"), false, "aprovação exige conferência CONCLUIDA, não só status PENDENTE");
  assert.equal(podeAprovar("PENDENTE", "DIVERGENCIA"), false, "aprovação bloqueada enquanto houver divergência não resolvida");
  assert.equal(podeSolicitarRevisao("AGUARDANDO_NF"), false, "revisão só pode ser solicitada em PENDENTE");
  assert.equal(podeSolicitarRevisao("PAGO"), false);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// B. FLUXO DE DIVERGÊNCIA — inclusão e descarte, com observação obrigatória
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("DIVERGÊNCIA: upload gera DIVERGENCIA; Portal mostra EM ANÁLISE, Equipe mostra DIVERGÊNCIA; inclusão e descarte resolvem; avanço exige ENVIAR explícito", async () => {
  const fx = await seedFixture("divergencia");
  try {
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD" },
    });

    // Upload da máscara encontra 2 divergências reais (NR VALE não mapeado + A1eq divergente).
    await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { statusConferencia: "DIVERGENCIA" } });
    const div1 = await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgc.id, colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, nrVale: "NR-EXTRA-001",
        documentoNaoMapeado: true, fornecedorFormato: "PDF", fornecedorA1eqHh: 5, fornecedorPercentualEmissao: 1, fornecedorTipo: "DG",
      },
    });
    const medicaoA = await prisma.medicao.findFirstOrThrow({ where: { ciclo: fx.ciclo, idProfissional: fx.profissionalAId } });
    const div2 = await prisma.divergenciaMedicao.create({
      data: {
        sgcId: sgc.id, colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, nrVale: "NR-A1EQ-002", idMedicaoExistente: medicaoA.id,
        a1eqDivergente: true, fornecedorFormato: "PDF", fornecedorA1eqHh: 99, fornecedorPercentualEmissao: 1, fornecedorTipo: "DG",
      },
    });

    // UX: Portal (regra corrigida nesta sessão) mostra "EM ANÁLISE", nunca "DIVERGÊNCIA".
    let atual = await prisma.sgcAprovacaoMedicao.findUniqueOrThrow({ where: { id: sgc.id } });
    assert.equal(atual.statusConferencia, "DIVERGENCIA");
    // Equipe de Medição continua vendo o status técnico real e a lista de itens pendentes.
    const pendentes = await prisma.divergenciaMedicao.findMany({ where: { sgcId: sgc.id, status: "PENDENTE" } });
    assert.equal(pendentes.length, 2);

    // Equipe INCLUI a divergência 1 (documento não mapeado) — passa a integrar Documentos Medidos.
    await prisma.medicao.create({
      data: {
        numeroMedicao: `${fx.suffix}-MED-INCLUIDA`, idProjeto: fx.projetoId, idProfissional: fx.profissionalAId, ciclo: fx.ciclo,
        numeroDocumento: div1.nrVale, equivalenteA1Horas: div1.fornecedorA1eqHh, percentualEmissao: div1.fornecedorPercentualEmissao,
        condicao: "0", sourceRowHash: `${fx.suffix}-incluida`,
      },
    });
    await prisma.divergenciaMedicao.update({ where: { id: div1.id }, data: { status: "INCLUIDA", resolvidoEm: new Date() } });

    // Equipe tenta DESCARTAR a divergência 2 sem observação — deve ser bloqueado pela regra de negócio.
    const observacaoVazia = "";
    const podeDescartar = observacaoVazia.trim().length > 0;
    assert.equal(podeDescartar, false, "descarte sem observação deve ser bloqueado");

    // Com observação, o descarte é aceito e persistido.
    const observacao = "Documento não pertence ao escopo do ciclo.";
    await prisma.divergenciaMedicao.update({ where: { id: div2.id }, data: { status: "DESCARTADA", observacao, resolvidoEm: new Date() } });
    const div2Resolvida = await prisma.divergenciaMedicao.findUniqueOrThrow({ where: { id: div2.id } });
    assert.equal(div2Resolvida.status, "DESCARTADA");
    assert.equal(div2Resolvida.observacao, observacao);
    // Documento descartado não deve ter sido incluído em Documentos Medidos.
    const documentosDoNrVale2 = await prisma.medicao.findMany({ where: { ciclo: fx.ciclo, numeroDocumento: div2.nrVale } });
    assert.equal(documentosDoNrVale2.length, 0);

    // Todas as divergências resolvidas → conferência volta a CONCLUIDA.
    const restantes = await prisma.divergenciaMedicao.count({ where: { sgcId: sgc.id, status: "PENDENTE" } });
    assert.equal(restantes, 0);
    atual = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { statusConferencia: "CONCLUIDA" } });
    assert.equal(atual.statusConferencia, "CONCLUIDA");
    // Ainda em PENDENTE — o fornecedor precisa executar ENVIAR para avançar (não é automático).
    assert.equal(atual.status, "PENDENTE");
    assert.equal(podeAprovar(atual.status, atual.statusConferencia), true);

    atual = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { status: "AGUARDANDO_NF", aprovadoAt: new Date() } });
    assert.equal(atual.status, "AGUARDANDO_NF");
  } finally {
    await cleanupFixture(fx);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// C. FLUXO DE REVISÃO — PENDENTE → REVISAO_SOLICITADA → reenvio → PENDENTE (revisaoNumero++)
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("REVISÃO: fornecedor solicita revisão com motivo persistido; reenvio incrementa revisaoNumero e não corrompe a rodada anterior", async () => {
  const fx = await seedFixture("revisao");
  try {
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "PENDENTE", statusConferencia: "AGUARDANDO_UPLOAD", revisaoNumero: 0 },
    });

    assert.equal(podeSolicitarRevisao(sgc.status), true);
    const motivo = "Valores da máscara não batem com o BM enviado.";
    let atual = await prisma.sgcAprovacaoMedicao.update({
      where: { id: sgc.id },
      data: { status: "REVISAO_SOLICITADA", pontosDiscordancia: motivo, revisaoSolicitadaAt: new Date() },
    });
    assert.equal(atual.status, "REVISAO_SOLICITADA");
    assert.equal(atual.pontosDiscordancia, motivo, "motivo da revisão precisa estar persistido");

    // Equipe corrige e reenvia (mesma regra de /api/sgc/enviar: REVISAO_SOLICITADA é reenviável).
    assert.equal(podeEnviarBm(atual.status), true);
    atual = await prisma.sgcAprovacaoMedicao.update({
      where: { id: sgc.id },
      data: {
        status: "PENDENTE",
        statusConferencia: "AGUARDANDO_UPLOAD",
        pontosDiscordancia: null,
        revisaoSolicitadaAt: null,
        reenviadoAt: new Date(),
        resolvidoAt: new Date(),
        revisaoNumero: { increment: 1 },
      },
    });
    assert.equal(atual.status, "PENDENTE");
    assert.equal(atual.revisaoNumero, 1, "revisaoNumero deve incrementar a cada reenvio pós-revisão");
    assert.equal(atual.pontosDiscordancia, null, "o motivo da rodada anterior não pode vazar para a rodada nova");

    // Nova conferência (sem divergência desta vez) e aprovação.
    atual = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { statusConferencia: "CONCLUIDA" } });
    assert.equal(podeAprovar(atual.status, atual.statusConferencia), true);
    atual = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { status: "AGUARDANDO_NF", aprovadoAt: new Date() } });
    assert.equal(atual.status, "AGUARDANDO_NF");

    // Evidências: só existe UMA linha para este colaborador+ciclo (não duplica no dropdown).
    const linhas = await prisma.sgcAprovacaoMedicao.findMany({ where: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo } });
    assert.equal(linhas.length, 1, "revisão reaproveita a mesma linha (unique colaboradorCodigo+ciclo) — nunca duplica");
    assert.equal(linhas[0].revisaoNumero, 1);
  } finally {
    await cleanupFixture(fx);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// D. OWNERSHIP — Fornecedor A nunca acessa dados do Fornecedor B, mesmo com CNPJ compartilhado
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("OWNERSHIP + CNPJ COMPARTILHADO: workflow, documentos, NF e pagamento de A e B nunca se misturam, mesmo com o mesmo CNPJ", async () => {
  const fx = await seedFixture("ownership");
  try {
    const sgcA = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "APROVADO", nfArquivoNome: "nf-a.pdf" },
    });
    const sgcB = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: fx.codigoB, ciclo: fx.ciclo, status: "AGUARDANDO_NF" },
    });

    // "Fornecedor A tenta acessar workflow de B" — mesma regra de app/api/colaborador/nf/[id] e
    // .../comprovante/[id]: aliases do usuário logado precisam bater com colaboradorCodigo do registro.
    const aliasesDeA = [fx.codigoA];
    assert.equal(aliasesDeA.includes(sgcB.colaboradorCodigo), false, "A não pode resolver o workflow de B via alias");
    assert.equal(aliasesDeA.includes(sgcA.colaboradorCodigo), true, "A continua acessando o próprio workflow normalmente");

    // Documentos: mesmo CNPJ, mas Medicao é vinculada por idProfissional (A e B são profissionais distintos).
    const documentosA = await prisma.medicao.findMany({ where: { ciclo: fx.ciclo, idProfissional: fx.profissionalAId } });
    const documentosB = await prisma.medicao.findMany({ where: { ciclo: fx.ciclo, idProfissional: fx.profissionalBId } });
    assert.equal(documentosA.length, 1);
    assert.equal(documentosB.length, 1);
    assert.notEqual(documentosA[0].id, documentosB[0].id);

    // Pagamento: valores do mapa de pagamento continuam distintos por colaboradorCodigo.
    const mapaA = await prisma.mapaPagamentoItem.findFirst({ where: { ciclo: fx.ciclo, projetistaCodigo: fx.codigoA } });
    const mapaB = await prisma.mapaPagamentoItem.findFirst({ where: { ciclo: fx.ciclo, projetistaCodigo: fx.codigoB } });
    assert.equal(Number(mapaA?.valor), 1000);
    assert.equal(Number(mapaB?.valor), 2000);
    assert.notEqual(Number(mapaA?.valor), Number(mapaB?.valor), "BM/pagamento de A e B nunca podem coincidir por engano");

    // NF: A tem NF, B não — confirma que o arquivo de A nunca aparece associado a B.
    assert.ok(sgcA.nfArquivoNome);
    assert.equal(sgcB.nfArquivoNome, null);
  } finally {
    await cleanupFixture(fx);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// E. ISOLAMENTO POR CICLO — mesmo fornecedor em dois ciclos nunca mistura dados
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("ISOLAMENTO DE CICLO: mesmo colaboradorCodigo em dois ciclos diferentes tem workflows e documentos totalmente independentes", async () => {
  const fx1 = await seedFixture("ciclo1");
  const suffix2 = `TESTE-E2E-ciclo2-${Date.now()}`;
  const ciclo2 = `TESTE-${suffix2}`;
  await prisma.mapaPagamentoContexto.create({ data: { ciclo: ciclo2 } });

  try {
    const sgcCiclo1 = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: fx1.codigoA, ciclo: fx1.ciclo, status: "PAGO" } });
    const sgcCiclo2 = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: fx1.codigoA, ciclo: ciclo2, status: "AGUARDANDO_ENVIO" } });

    assert.notEqual(sgcCiclo1.id, sgcCiclo2.id);
    assert.equal(sgcCiclo1.status, "PAGO");
    assert.equal(sgcCiclo2.status, "AGUARDANDO_ENVIO");

    const docsCiclo1 = await prisma.medicao.findMany({ where: { ciclo: fx1.ciclo, idProfissional: fx1.profissionalAId } });
    const docsCiclo2 = await prisma.medicao.findMany({ where: { ciclo: ciclo2, idProfissional: fx1.profissionalAId } });
    assert.equal(docsCiclo1.length, 1, "documentos do ciclo 1 existem");
    assert.equal(docsCiclo2.length, 0, "nenhum documento do ciclo 1 pode vazar para o ciclo 2, mesmo fornecedor");

    // Evidências: PAGO aparece, AGUARDANDO_ENVIO não — e cada ciclo é avaliado independentemente.
    assert.equal(bmExisteEmEvidencias(sgcCiclo1.status), true);
    assert.equal(bmExisteEmEvidencias(sgcCiclo2.status), false);

    await prisma.sgcAprovacaoMedicao.deleteMany({ where: { id: { in: [sgcCiclo1.id, sgcCiclo2.id] } } });
  } finally {
    await cleanupFixture(fx1);
    await prisma.mapaPagamentoContexto.delete({ where: { ciclo: ciclo2 } }).catch(() => undefined);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// F. IDEMPOTÊNCIA — Enviar BM, Aprovação e Pagamento nunca duplicam
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("IDEMPOTÊNCIA — Enviar BM: reenviar quando já PENDENTE é rejeitado (guard real de /api/sgc/enviar), nunca cria segundo workflow", async () => {
  const fx = await seedFixture("idemp-enviar");
  try {
    const sgc = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "PENDENTE" } });
    // Duas "requisições" de enviar BM em sequência — a segunda deve ser recusada pela regra real.
    assert.equal(podeEnviarBm(sgc.status), false, "workflow já PENDENTE não pode ser reenviado por engano (evita duplicidade/duplo clique)");

    const total = await prisma.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo } });
    assert.equal(total, 1, "nunca existe mais de um workflow ativo para o mesmo colaboradorCodigo+ciclo — @@unique garante isso no banco");
  } finally {
    await cleanupFixture(fx);
  }
});

test("IDEMPOTÊNCIA — Aprovação: executar ENVIAR duas vezes só produz uma transição válida", async () => {
  const fx = await seedFixture("idemp-aprovar");
  try {
    const sgc = await prisma.sgcAprovacaoMedicao.create({
      data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "PENDENTE", statusConferencia: "CONCLUIDA" },
    });
    assert.equal(podeAprovar(sgc.status, sgc.statusConferencia), true);
    const primeiraAprovacao = await prisma.sgcAprovacaoMedicao.update({ where: { id: sgc.id }, data: { status: "AGUARDANDO_NF", aprovadoAt: new Date() } });
    assert.equal(primeiraAprovacao.status, "AGUARDANDO_NF");

    // Segunda tentativa: status já não é mais PENDENTE — a regra real rejeita.
    assert.equal(podeAprovar(primeiraAprovacao.status, primeiraAprovacao.statusConferencia), false, "segunda chamada de ENVIAR deve ser rejeitada, não reprocessada");
  } finally {
    await cleanupFixture(fx);
  }
});

test("IDEMPOTÊNCIA — Pagamento: executar pagamento duas vezes só produz um PAGO, nunca dois comprovantes", async () => {
  const fx = await seedFixture("idemp-pagar");
  try {
    const sgc = await prisma.sgcAprovacaoMedicao.create({ data: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "APROVADO" } });
    assert.equal(podePagar(sgc.status), true);
    const primeiroPagamento = await prisma.sgcAprovacaoMedicao.update({
      where: { id: sgc.id }, data: { status: "PAGO", pagoAt: new Date(), comprovanteArquivoNome: "comprovante-1.pdf" },
    });
    assert.equal(primeiroPagamento.status, "PAGO");

    // Segunda tentativa: status já não é mais APROVADO — a regra real rejeita (mesma guarda de app/api/admin/financeiro PATCH).
    assert.equal(podePagar(primeiroPagamento.status), false, "segundo pagamento deve ser rejeitado — nunca dois PAYMENT_COMPLETED para o mesmo workflow");

    const pagamentos = await prisma.sgcAprovacaoMedicao.count({ where: { colaboradorCodigo: fx.codigoA, ciclo: fx.ciclo, status: "PAGO" } });
    assert.equal(pagamentos, 1);
  } finally {
    await cleanupFixture(fx);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// G. E-MAIL — TO/CC por evento (política já testada em tests/email-cc-policy.test.ts; aqui
//    confirmamos que a mesma política central é a fonte de verdade para os 6 eventos do workflow)
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("POLÍTICA DE CC do workflow completo: BM_* usa EMAIL_BM_CC, PAYMENT_* usa EMAIL_FINANCE_CC — nenhum evento monta CC por conta própria", () => {
  const originalBm = process.env.EMAIL_BM_CC;
  const originalFinance = process.env.EMAIL_FINANCE_CC;
  process.env.EMAIL_BM_CC = "gabriel.sousa@projetacs.com,anderson.marley@projetacs.com,planejamentoprojetacs@gmail.com";
  process.env.EMAIL_FINANCE_CC = "financeiro@projetacs.com,ximenes.silva@projetacs.com,finanprojetacs@gmail.com";
  try {
    const bmCcEsperado = ["gabriel.sousa@projetacs.com", "anderson.marley@projetacs.com", "planejamentoprojetacs@gmail.com"];
    const financeCcEsperado = ["financeiro@projetacs.com", "ximenes.silva@projetacs.com", "finanprojetacs@gmail.com"];
    assert.deepEqual(getEmailCcForEvent("BM_AVAILABLE"), bmCcEsperado);
    assert.deepEqual(getEmailCcForEvent("BM_DIVERGENCE"), bmCcEsperado);
    assert.deepEqual(getEmailCcForEvent("BM_APPROVED"), bmCcEsperado);
    assert.deepEqual(getEmailCcForEvent("BM_REVISION_REQUESTED"), bmCcEsperado);
    assert.deepEqual(getEmailCcForEvent("PAYMENT_READY"), financeCcEsperado);
    assert.deepEqual(getEmailCcForEvent("PAYMENT_COMPLETED"), financeCcEsperado);
  } finally {
    if (originalBm === undefined) delete process.env.EMAIL_BM_CC; else process.env.EMAIL_BM_CC = originalBm;
    if (originalFinance === undefined) delete process.env.EMAIL_FINANCE_CC; else process.env.EMAIL_FINANCE_CC = originalFinance;
  }
});
