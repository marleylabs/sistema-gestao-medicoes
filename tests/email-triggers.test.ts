import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

/**
 * Guarda de regressão para o bug corrigido: o gatilho de BM_AVAILABLE (POST /api/sgc/enviar)
 * resolvia o e-mail do fornecedor por `profissional.findUnique({ where: { codigo } })`, que
 * falhava silenciosamente sempre que `Profissional.codigo` estava vazio (caso comum nos
 * registros importados pelo ETL) mesmo quando o Administrativo já tinha o e-mail em
 * CadastroFornecedor. Estes testes leem o código-fonte real da rota (não um mock) para garantir
 * que a correção não seja revertida por engano em uma futura edição.
 */
test("POST /api/sgc/enviar resolve o e-mail via resolveFornecedorEmail (CadastroFornecedor + fallback), não mais por profissional.email direto", () => {
  const source = readRoute("app/api/sgc/enviar/route.ts");
  assert.match(source, /resolveFornecedorEmail\(colaboradorCodigo/);
  assert.doesNotMatch(source, /profissional\??\.email/);
});

test("POST /api/sgc/enviar dispara notifyBmAvailable de forma incondicional após o upsert do workflow ter sucesso, não atrás de uma checagem de status antiga (ex.: PENDENTE)", () => {
  const source = readRoute("app/api/sgc/enviar/route.ts");
  const upsertIndex = source.indexOf("prisma.sgcAprovacaoMedicao.upsert");
  const notifyIndex = source.indexOf("notifyBmAvailable(");
  assert.ok(upsertIndex > -1 && notifyIndex > -1, "esperava encontrar tanto o upsert quanto a chamada de notificação");
  assert.ok(notifyIndex > upsertIndex, "notifyBmAvailable deve vir depois do upsert (nunca antes de persistir o workflow)");
  const between = source.slice(upsertIndex, notifyIndex);
  // Não deve haver um "if (...status === ...)" cercando a notificação — ela é incondicional
  // sobre o sucesso da operação, refletindo a transição real (AGUARDANDO_ENVIO/REVISAO_SOLICITADA
  // → PENDENTE + statusConferencia: AGUARDANDO_UPLOAD), não uma regra antiga de status isolado.
  assert.doesNotMatch(between, /if\s*\(\s*sgc\.status\s*===/);
});

test("POST /api/sgc/enviar registra EMAIL_ENVIADO/ERRO_EMAIL a partir do resultado real de notifyBmAvailable (auditoria não é descartada)", () => {
  const source = readRoute("app/api/sgc/enviar/route.ts");
  assert.match(source, /emailResult\.ok \? "EMAIL_ENVIADO" : "ERRO_EMAIL"/);
});

test("falha de e-mail nunca desfaz o BM já enviado: a resposta HTTP de sucesso não depende de emailResult.ok", () => {
  const source = readRoute("app/api/sgc/enviar/route.ts");
  const returnBlock = source.slice(source.lastIndexOf("return NextResponse.json"));
  assert.doesNotMatch(returnBlock, /status:\s*4\d\d/); // não retorna erro HTTP por causa do e-mail
});

test("BM_DIVERGENCE só dispara quando a comparação real encontrou divergência — nunca incondicionalmente, nunca por renderização de tela", () => {
  const source = readRoute("app/api/colaborador/conferencia/upload/route.ts");
  const notifyIndex = source.indexOf("notifyBmDivergence(");
  assert.ok(notifyIndex > -1, "esperava encontrar a chamada de notifyBmDivergence");
  const before = source.slice(0, notifyIndex);
  const guardIndex = before.lastIndexOf("if (divergencias.length > 0)");
  assert.ok(guardIndex > -1, "notifyBmDivergence deve estar protegido por 'if (divergencias.length > 0)'");
  // Não pode haver nenhum outro "return"/fechamento de bloco entre a guarda e a chamada, senão a
  // guarda não estaria realmente envolvendo a chamada.
  const between = source.slice(guardIndex, notifyIndex);
  assert.doesNotMatch(between, /\n\s*\}\s*\n/, "a chamada parece estar fora do bloco condicional");
});

// ─── Matriz dos demais eventos: confirma que cada rota real ainda dispara o evento certo ───

test("matriz de eventos: os 7 eventos continuam conectados às rotas/transições reais", () => {
  const matrix: Array<{ event: string; file: string; mustContain: RegExp[] }> = [
    {
      event: "PASSWORD_RESET",
      file: "app/api/admin/usuarios/[id]/route.ts",
      mustContain: [/action === "reset_senha"/, /notifyPasswordReset\(/],
    },
    {
      event: "BM_AVAILABLE",
      file: "app/api/sgc/enviar/route.ts",
      mustContain: [/status: "PENDENTE"/, /statusConferencia: "AGUARDANDO_UPLOAD"/, /notifyBmAvailable\(/],
    },
    {
      event: "BM_DIVERGENCE",
      file: "app/api/colaborador/conferencia/upload/route.ts",
      mustContain: [/statusConferencia: "DIVERGENCIA"/, /divergencias\.length > 0/, /notifyBmDivergence\(/],
    },
    {
      event: "BM_APPROVED",
      file: "app/api/colaborador/sgc/route.ts",
      mustContain: [/action === "ENVIAR"/, /status: "AGUARDANDO_NF"/, /notifyBmApproved\(/],
    },
    {
      event: "BM_REVISION_REQUESTED",
      file: "app/api/colaborador/sgc/route.ts",
      mustContain: [/action === "SOLICITAR_REVISAO"/, /status: "REVISAO_SOLICITADA"/, /notifyBmRevisionRequested\(/],
    },
    {
      event: "PAYMENT_READY",
      file: "app/api/colaborador/nf/route.ts",
      mustContain: [/status: "APROVADO"/, /notifyPaymentReady\(/],
    },
    {
      event: "PAYMENT_COMPLETED",
      file: "app/api/admin/financeiro/route.ts",
      mustContain: [/status: "PAGO"/, /notifyPaymentCompleted\(/],
    },
  ];

  for (const entry of matrix) {
    const source = readRoute(entry.file);
    for (const pattern of entry.mustContain) {
      assert.match(source, pattern, `${entry.event} (${entry.file}): esperava encontrar ${pattern}`);
    }
  }
});
