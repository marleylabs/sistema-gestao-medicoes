import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Guarda de reuso: "Novo pagamento" e "Editar pagamento" são dois modos do MESMO editor
 * (components/pagamento-editor.tsx). Falha se surgir um segundo formulário de pagamento.
 */
const ROOT = path.join(__dirname, "..");

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTsx(caminho);
    return /\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

const fontes = [...arquivosTsx(path.join(ROOT, "components")), ...arquivosTsx(path.join(ROOT, "app"))]
  .map((arquivo) => ({ arquivo: path.relative(ROOT, arquivo).replace(/\\/g, "/"), codigo: readFileSync(arquivo, "utf8") }));

test("existe uma única definição do formulário de pagamento (PaymentModal) e ela vive no editor compartilhado", () => {
  const definicoes = fontes.filter((f) => /function PaymentModal\(/.test(f.codigo)).map((f) => f.arquivo);
  assert.deepEqual(definicoes, ["components/pagamento-editor.tsx"]);
});

test("os títulos \"Novo pagamento\" e \"Editar pagamento\" do formulário saem só do editor compartilhado", () => {
  const editor = fontes.find((f) => f.arquivo === "components/pagamento-editor.tsx")!.codigo;
  assert.match(editor, /item \? "Editar pagamento" : "Novo pagamento"/);
  const outros = fontes.filter((f) => f.arquivo !== "components/pagamento-editor.tsx" && /["']Novo pagamento["']/.test(f.codigo)).map((f) => f.arquivo);
  assert.deepEqual(outros, [], `outro componente declara um formulário "Novo pagamento": ${outros.join(", ")}`);
});

test("a tela Fornecedores abre criar e editar pelo mesmo MapaPagamentoEditor", () => {
  const tela = fontes.find((f) => f.arquivo === "components/fornecedores/index.tsx")!.codigo;
  assert.equal((tela.match(/<MapaPagamentoEditor\b/g) ?? []).length, 1);
  assert.match(tela, /\(isCreating \|\| editingItem\) && \(\s*<MapaPagamentoEditor/);
});
