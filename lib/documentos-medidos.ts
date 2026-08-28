import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Fonte de verdade única para "Documentos Medidos" de um fornecedor num ciclo — usada tanto por
 * Pagamentos por Fornecedor (Equipe, com permissão de edição) quanto pelo Portal do Fornecedor
 * (leitura). A diferença entre as duas telas deve ser só de permissão/apresentação, nunca de
 * conteúdo: as duas devem enxergar exatamente o mesmo conjunto de `Medicao` para o mesmo
 * fornecedor+ciclo.
 *
 * Resolve o fornecedor por QUALQUER um dos aliases conhecidos (codigo, nome ou nomeCompleto do
 * Profissional vinculado à Medicao) — nunca só por `profissional.codigo`, que fica vazio na
 * maioria dos registros importados pelo ETL (causa raiz comprovada de fornecedores com
 * Documentos Medidos visíveis para a Equipe mas "0 documentos" no Portal). Os aliases devem vir
 * de `getColaboradorCodigoAliases()` (ou, para o fluxo administrativo, do único identificador
 * já digitado/selecionado) — esta função não resolve identidade sozinha, só consulta.
 */
export async function getDocumentosMedidos(params: { aliases: string[]; ciclo: string }) {
  const aliases = Array.from(new Set(params.aliases.map((a) => a?.trim()).filter((a): a is string => !!a)));
  if (!aliases.length || !params.ciclo) return [];

  return prisma.medicao.findMany({
    where: {
      ciclo: params.ciclo,
      profissional: {
        OR: [
          { codigo: { in: aliases, mode: "insensitive" } },
          { nome: { in: aliases, mode: "insensitive" } },
          { nomeCompleto: { in: aliases, mode: "insensitive" } },
        ],
      },
    },
    select: {
      id: true,
      dataCadastro: true,
      createdAt: true,
      formato: true,
      quantidade: true,
      equivalenteA1Horas: true,
      medidoHoras: true,
      valorUnitario: true,
      valorTotal: true,
      valorMedicao: true,
      percentualEmissao: true,
      numeroDocumento: true,
      tipo2: true,
      condicao: true,
      obs: true,
      projeto: { select: { codigoProjeto: true, contrato: true, tituloPrimario: true } },
    },
    orderBy: [{ dataCadastro: "asc" }, { createdAt: "asc" }],
  });
}

export type DocumentoMedidoConsolidado = Awaited<ReturnType<typeof getDocumentosMedidos>>[number];
