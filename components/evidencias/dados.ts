"use client";

import { useCallback, useEffect, useState } from "react";
import { getMapaPagamentoStatusMeta, type SgcStatusMeta } from "@/lib/sgc-display-status";

/** Entrada de GET /api/sgc/status — um BM por (colaboradorCodigo, ciclo). */
export type EvidenciaSgc = {
  sgcId: string;
  colaboradorCodigo: string;
  colaboradorNome: string | null;
  ciclo: string;
  status: string;
  revisaoNumero: number;
  statusConferencia: string | null;
  aprovadoAt: string | null;
};

export type Evidencia = EvidenciaSgc & {
  key: string;
  nome: string;
  empresa: string | null;
  /** mapaPagamentoItem.valor do mesmo fornecedor × ciclo (null quando o BM não tem item no mapa). */
  valor: number | null;
  status: string;
  statusMeta: SgcStatusMeta;
};

type RegistroHistorico = { ciclo: string; codigo: string; nome: string; empresa: string | null; valor: number };

/**
 * Evidências representa a EXISTÊNCIA do Boletim de Medição (qualquer status a partir do envio):
 * AGUARDANDO_ENVIO (BM ainda não disponibilizado) e CANCELADO nunca contam como evidência — mesma
 * regra que a tela já aplicava.
 */
export function isEvidenciaVisivel(status: string) {
  return status !== "AGUARDANDO_ENVIO" && status !== "CANCELADO";
}

/**
 * Lista de BMs só com APIs existentes, sem endpoint novo:
 *  - GET /api/sgc/status (fonte da lista; filtros ciclo e colaboradorCodigo independentes);
 *  - GET /api/historico (somente leitura) para o valor do mapa, empresa e nome canônico do mesmo
 *    fornecedor × ciclo — os mesmos dados de Fornecedores/Histórico.
 * Sem ciclo e sem fornecedor não carrega nada (mesma regra de antes: nunca "tudo" à toa).
 */
export function useEvidencias(ciclo: string | null, fornecedorCodigo: string | null) {
  const [itens, setItens] = useState<Evidencia[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    if (!ciclo && !fornecedorCodigo) {
      setItens(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (ciclo) params.set("ciclo", ciclo);
      if (fornecedorCodigo) params.set("colaboradorCodigo", fornecedorCodigo);
      const [sgcRes, histRes] = await Promise.all([
        fetch(`/api/sgc/status?${params.toString()}`),
        fetch(ciclo ? `/api/historico?ciclo=${encodeURIComponent(ciclo)}` : "/api/historico"),
      ]);
      if (!sgcRes.ok) throw new Error("sgc");
      const sgc = (await sgcRes.json()) as EvidenciaSgc[];
      const historico = histRes.ok ? ((await histRes.json()) as { registros: RegistroHistorico[] }).registros : [];
      const porChave = new Map(historico.map((r) => [`${r.ciclo}|${r.codigo}`, r]));
      setItens(
        sgc.filter((s) => isEvidenciaVisivel(s.status)).map((s) => {
          const mapa = porChave.get(`${s.ciclo}|${s.colaboradorCodigo}`);
          return {
            ...s,
            key: s.sgcId,
            nome: mapa?.nome || s.colaboradorNome || s.colaboradorCodigo,
            empresa: mapa?.empresa ?? null,
            valor: mapa ? mapa.valor : null,
            statusMeta: getMapaPagamentoStatusMeta(s.status, s.statusConferencia),
          };
        }),
      );
    } catch {
      setItens([]);
      setErro("Não foi possível carregar as evidências.");
    } finally {
      setLoading(false);
    }
  }, [ciclo, fornecedorCodigo]);

  useEffect(() => { carregar(); }, [carregar]);

  return { itens, loading, erro, recarregar: carregar };
}

/** Fornecedores com pelo menos uma evidência (qualquer ciclo) — alimenta a busca do filtro Fornecedor. */
export function useFornecedoresComEvidencia() {
  const [lista, setLista] = useState<{ codigo: string; nome: string }[]>([]);
  useEffect(() => {
    fetch("/api/sgc/status")
      .then((r) => (r.ok ? (r.json() as Promise<EvidenciaSgc[]>) : []))
      .then((data) => {
        const porCodigo = new Map<string, string>();
        for (const item of data) {
          if (!isEvidenciaVisivel(item.status)) continue;
          if (!porCodigo.has(item.colaboradorCodigo)) porCodigo.set(item.colaboradorCodigo, item.colaboradorNome || item.colaboradorCodigo);
        }
        setLista(Array.from(porCodigo.entries()).map(([codigo, nome]) => ({ codigo, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
      })
      .catch(() => {});
  }, []);
  return lista;
}
