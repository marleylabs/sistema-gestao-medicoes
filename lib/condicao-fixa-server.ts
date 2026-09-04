import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Definição canônica de "existem documentos medidos no ciclo": soma de `Medicao.valorMedicao`
 * agrupada por `coalesce(profissional.codigo, profissional.nome)` (a mesma chave que
 * `CadastroFornecedor.colaboradorCodigo` recebe quando o profissional não tem `codigo`), excluindo
 * linhas de desconto (`tipo2` = "desconto", case/trim-insensitive) ou valor negativo — auditada a
 * partir da semântica exata de `item["documentos"]` em
 * `etl/ingest_medicoes.py::generate_payment_map_from_measurements` (mecanismo pré-existente que já
 * gravava esse total no `raw_payload`). TypeScript e Python devem produzir o MESMO resultado para o
 * mesmo fornecedor/ciclo — nunca duas fórmulas divergentes. Usada como fonte de verdade
 * server-side (auditoria/checagem); a tela de Novo Pagamento usa o mesmo critério a partir dos
 * "Documentos Medidos" já carregados no formulário (`lib/documentos-medidos.ts`, mesma tabela
 * `Medicao`), sem round-trip extra.
 */
export async function getDocumentosMedidosTotal(colaboradorCodigo: string, ciclo: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: unknown }>>`
    select coalesce(sum(m.valor_medicao), 0) as total
    from medicoes m
    left join profissionais p on p.id = m.id_profissional
    where m.ciclo = ${ciclo}
      and coalesce(p.codigo, p.nome) = ${colaboradorCodigo}
      and not (
        lower(trim(coalesce(m.tipo2, ''))) = 'desconto'
        or m.valor_medicao < 0
      )
  `;
  return Number(rows[0]?.total ?? 0);
}

export async function hasMeasuredDocuments(colaboradorCodigo: string, ciclo: string): Promise<boolean> {
  const total = await getDocumentosMedidosTotal(colaboradorCodigo, ciclo);
  return total > 0;
}
