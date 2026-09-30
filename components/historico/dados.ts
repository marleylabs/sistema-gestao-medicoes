"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContratoResumo } from "@/components/types";
import { consolidarDistribuicaoContratos } from "@/lib/contratos";
import { getMapaPagamentoStatusMeta, type SgcStatusApiEntry, type SgcStatusMeta } from "@/lib/sgc-display-status";

/**
 * "Medição" no Histórico = BM de um fornecedor num ciclo (um MapaPagamentoItem por
 * fornecedor × ciclo — a mesma unidade de /fornecedores, Evidências e do SGC, que é @@unique por
 * (colaboradorCodigo, ciclo)). Linhas de Medicao são documentos DENTRO dessa medição.
 */
/** Status SGC do BM (mesmos campos de GET /api/sgc/status, incluindo aprovadoAt — data real de aprovação pelo fornecedor). */
export type SgcHistorico = SgcStatusApiEntry & { aprovadoAt?: string | null };

export type MedicaoHistorico = {
  key: string;
  ciclo: string;
  codigo: string;
  nome: string;
  empresa: string | null;
  cnpj: string | null;
  /** mapaPagamentoItem.valor — mesmo "Pagamento" de /fornecedores e base do Dashboard. */
  valor: number;
  participacoes: Record<string, number>;
  sgc: SgcHistorico | null;
  status: SgcStatusMeta & { interno: string };
};

export type CicloHistorico = { ciclo: string; mesReferencia: string | null; ativoMedicao?: boolean; updatedAt: string };

function statusDe(sgc: SgcHistorico | null) {
  const interno = sgc?.status ?? "AGUARDANDO_ENVIO";
  return { ...getMapaPagamentoStatusMeta(interno, sgc?.statusConferencia), interno };
}

/** Registro de GET /api/historico — um BM (fornecedor × ciclo), já com ciclo, status SGC e participação. */
type RegistroHistoricoApi = Omit<MedicaoHistorico, "key" | "status"> & { id: string };

/**
 * Carrega o histórico com UMA chamada: GET /api/historico (somente leitura; Medição/ADMIN ou a
 * permissão extra HISTORICO_MEDICOES). Composição do BM, NF e pagamento continuam sob demanda no
 * detalhe da medição.
 */
export function useHistoricoDados(habilitado: boolean) {
  const [medicoes, setMedicoes] = useState<MedicaoHistorico[]>([]);
  const [contratos, setContratos] = useState<ContratoResumo[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    if (!habilitado) return;
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch("/api/historico");
      if (!res.ok) throw new Error("historico");
      const payload = (await res.json()) as { registros: RegistroHistoricoApi[]; contratos: ContratoResumo[] };
      const lista = payload.registros.map<MedicaoHistorico>(({ id, ...r }) => ({
        ...r,
        key: `${r.ciclo}|${id}`,
        status: statusDe(r.sgc),
      }));
      lista.sort((a, b) => b.ciclo.localeCompare(a.ciclo) || a.nome.localeCompare(b.nome, "pt-BR"));
      setMedicoes(lista);
      setContratos(payload.contratos);
      setCarregado(true);
    } catch {
      setErro("Não foi possível carregar o histórico.");
    } finally {
      setLoading(false);
    }
  }, [habilitado]);

  useEffect(() => { carregar(); }, [carregar]);

  return { medicoes, contratos, loading, erro, carregado, recarregar: carregar };
}

export type FornecedorHistorico = {
  codigo: string;
  nome: string;
  empresa: string | null;
  total: number;
  ciclos: string[];
  ultimo: string;
  contratoIds: string[];
  medicoes: MedicaoHistorico[];
};

/** Trajetória por fornecedor — agrupa pelo código canônico já resolvido (aliases consolidados no ETL). */
export function agruparPorFornecedor(medicoes: MedicaoHistorico[]): FornecedorHistorico[] {
  const mapa = new Map<string, MedicaoHistorico[]>();
  for (const m of medicoes) mapa.set(m.codigo, [...(mapa.get(m.codigo) ?? []), m]);
  return Array.from(mapa.entries()).map(([codigo, lista]) => {
    const ordenada = [...lista].sort((a, b) => b.ciclo.localeCompare(a.ciclo));
    const contratoIds = new Set<string>();
    for (const m of lista) for (const [id, p] of Object.entries(m.participacoes)) if (p > 0) contratoIds.add(id);
    return {
      codigo,
      nome: ordenada[0].nome,
      empresa: ordenada[0].empresa,
      total: lista.reduce((s, m) => s + m.valor, 0),
      ciclos: Array.from(new Set(lista.map((m) => m.ciclo))).sort().reverse(),
      ultimo: ordenada[0].ciclo,
      contratoIds: Array.from(contratoIds),
      medicoes: ordenada,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export type ContratoHistorico = {
  id: string;
  nome: string;
  /** Valor atribuído ao contrato — MESMA regra do Dashboard (consolidarDistribuicaoContratos sobre valor > 0). */
  valorAtribuido: number;
  fornecedores: string[];
  ciclos: string[];
  medicoes: MedicaoHistorico[];
};

/** Valor atribuído a um contrato numa lista de medições — mesma função/insumos do Dashboard. */
export function valorAtribuido(medicoes: MedicaoHistorico[], contratoId: string) {
  return consolidarDistribuicaoContratos(
    medicoes.filter((m) => m.valor > 0).map((m) => ({ valorBase: m.valor, participacoes: m.participacoes })),
  ).valorPorContratoId[contratoId] ?? 0;
}

export function agruparPorContrato(medicoes: MedicaoHistorico[], contratos: ContratoResumo[]): ContratoHistorico[] {
  return contratos.map((c) => {
    const lista = medicoes.filter((m) => (m.participacoes[c.id] ?? 0) > 0);
    return {
      id: c.id,
      nome: c.nome,
      valorAtribuido: valorAtribuido(lista, c.id),
      fornecedores: Array.from(new Set(lista.map((m) => m.codigo))),
      ciclos: Array.from(new Set(lista.map((m) => m.ciclo))).sort().reverse(),
      medicoes: lista,
    };
  }).filter((c) => c.medicoes.length > 0);
}

export function useIndices(medicoes: MedicaoHistorico[], contratos: ContratoResumo[]) {
  return useMemo(() => ({
    fornecedores: agruparPorFornecedor(medicoes),
    contratos: agruparPorContrato(medicoes, contratos),
    nomeContrato: new Map(contratos.map((c) => [c.id, c.nome])),
  }), [medicoes, contratos]);
}
