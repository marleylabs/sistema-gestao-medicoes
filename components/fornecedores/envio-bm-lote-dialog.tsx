"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Minus, Send } from "lucide-react";
import { money } from "@/components/mapa-pagamento-table";
import type { MapaPagamentoItem } from "@/components/types";
import { Button } from "@/components/ui";
import { LIMITE_ENVIO_BM_LOTE, type ResumoEnvioBmLote, type StatusEnvioBmLote } from "@/lib/bm-envio-lote";

type Fase = "confirmar" | "enviando" | "resultado" | "erro";

export type ItemEnvioBmPrevia = { item: MapaPagamentoItem; elegivel: boolean; motivo?: string };

const STATUS_ICONE: Record<StatusEnvioBmLote, { icone: typeof Check; texto: string; cor: string }> = {
  ENVIADO: { icone: Check, texto: "Enviado", cor: "text-[var(--success)]" },
  IGNORADO: { icone: Minus, texto: "Não enviado", cor: "text-[var(--muted-foreground)]" },
  FALHA: { icone: AlertTriangle, texto: "Falhou", cor: "text-[var(--error)]" },
};

const nomeDe = (item: MapaPagamentoItem) => item.responsavel ?? item.projetistaCodigo ?? "Fornecedor";

/**
 * Confirmação + resultado do "Enviar BMs" em lote (Fornecedores). A prévia usa a mesma regra do
 * botão individual sobre os dados já carregados; o servidor reavalia tudo no envio e o resultado
 * exibido é sempre o devolvido por ele. O total é só a soma da coluna "Valor" da tabela (valor
 * gravado no mapa = Total da medição) dos aptos — nenhum recálculo de BM.
 *
 * `requestId` é gerado uma vez ao abrir: duplo clique e "Tentar novamente" reutilizam o mesmo, e o
 * servidor responde "já enviado nesta operação" sem reenviar nada.
 */
export function EnvioBmLoteDialog({
  ciclo,
  cicloLabel,
  previa,
  onClose,
  onProcessado,
}: {
  ciclo: string;
  cicloLabel: string;
  previa: ItemEnvioBmPrevia[];
  onClose: () => void;
  onProcessado: (resumo: ResumoEnvioBmLote) => void;
}) {
  const id = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [fase, setFase] = useState<Fase>("confirmar");
  const [resumo, setResumo] = useState<ResumoEnvioBmLote | null>(null);
  const [erro, setErro] = useState("");
  const [podeRepetir, setPodeRepetir] = useState(false);
  const [verInaptos, setVerInaptos] = useState(false);
  const [verDetalhes, setVerDetalhes] = useState(false);
  const enviandoRef = useRef(false);

  const { aptos, inaptos, total } = useMemo(() => {
    const aptosLista = previa.filter((p) => p.elegivel);
    return {
      aptos: aptosLista,
      inaptos: previa.filter((p) => !p.elegivel),
      total: aptosLista.reduce((soma, p) => soma + (typeof p.item.valor === "number" && Number.isFinite(p.item.valor) ? p.item.valor : 0), 0),
    };
  }, [previa]);
  const acimaDoLimite = previa.length > LIMITE_ENVIO_BM_LOTE;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && fase !== "enviando") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fase, onClose]);

  async function enviar() {
    // Trava síncrona: dois cliques no mesmo frame nunca disparam duas requisições.
    if (enviandoRef.current || aptos.length === 0 || acimaDoLimite) return;
    enviandoRef.current = true;
    setFase("enviando");
    setErro("");
    try {
      const res = await fetch("/api/sgc/enviar/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciclo, ids: previa.map((p) => p.item.id), requestId }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok && payload && Array.isArray(payload.resultados)) {
        const recebido = payload as ResumoEnvioBmLote;
        setResumo(recebido);
        setFase("resultado");
        onProcessado(recebido);
        return;
      }
      // 4xx: recusado ANTES de qualquer envio (permissão/validação) — repetir não ajuda.
      const recusado = res.status >= 400 && res.status < 500;
      setPodeRepetir(!recusado);
      setErro(recusado && typeof payload?.error === "string" ? payload.error : "Não foi possível processar o envio dos BMs.");
      setFase("erro");
    } catch {
      setPodeRepetir(true);
      setErro("Não foi possível processar o envio dos BMs.");
      setFase("erro");
    } finally {
      enviandoRef.current = false;
    }
  }

  const enviando = fase === "enviando";
  const rotuloEnviar = aptos.length === 1 ? "Enviar 1 BM" : `Enviar ${aptos.length} BMs`;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        aria-busy={enviando}
        data-testid="envio-bm-lote-dialog"
        className="ds-dialog flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden sm:w-[480px] sm:max-w-[92vw]"
      >
        {fase === "resultado" && resumo ? (
          <>
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">Envio concluído</h2>
              <div id={`${id}-d`} className="mt-2 grid gap-1 text-[13px] text-[var(--foreground)]" data-testid="envio-bm-lote-resumo">
                <p>{resumo.enviados === 1 ? "1 boletim enviado." : `${resumo.enviados} boletins enviados.`}</p>
                {resumo.ignorados > 0 && <p>{resumo.ignorados === 1 ? "1 não foi enviado." : `${resumo.ignorados} não foram enviados.`}</p>}
                {resumo.falhas > 0 && <p className="text-[var(--error)]">{resumo.falhas === 1 ? "1 envio falhou." : `${resumo.falhas} envios falharam.`}</p>}
                {resumo.semNotificacao > 0 && (
                  <p className="text-[#92400E]">{resumo.semNotificacao === 1 ? "1 fornecedor não recebeu o e-mail de aviso (o BM foi enviado)." : `${resumo.semNotificacao} fornecedores não receberam o e-mail de aviso (os BMs foram enviados).`}</p>
                )}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-3">
              <button
                type="button"
                className="text-[12px] font-semibold text-[var(--primary)] underline underline-offset-2"
                aria-expanded={verDetalhes}
                aria-controls={`${id}-detalhes`}
                onClick={() => setVerDetalhes((v) => !v)}
              >
                {verDetalhes ? "Ocultar detalhes" : "Ver detalhes"}
              </button>
              {verDetalhes && (
                <ul id={`${id}-detalhes`} className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]" data-testid="envio-bm-lote-detalhes">
                  {resumo.resultados.map((r) => {
                    const s = STATUS_ICONE[r.status];
                    const Icone = s.icone;
                    return (
                      <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-[12px]" data-status={r.status}>
                        <Icone size={14} className={`mt-0.5 shrink-0 ${s.cor}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--foreground)]">{r.nome ?? "Pagamento removido"}</p>
                          <p className="text-[var(--muted-foreground)]"><span className="sr-only">{s.texto}: </span>{r.motivo}</p>
                          {r.aviso && <p className="text-[#92400E]">{r.aviso}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button autoFocus onClick={onClose} className="h-10">Fechar</Button>
            </div>
          </>
        ) : fase === "erro" ? (
          <>
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">Enviar BMs</h2>
              <p id={`${id}-d`} role="alert" className="mt-2 rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-3 py-2 text-[13px] font-medium text-[var(--error)]">{erro}</p>
              {podeRepetir && (
                <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">
                  Parte dos BMs pode ter sido enviada. Tentar novamente é seguro: os já enviados nesta operação não são reenviados.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <Button variant="secondary" onClick={onClose} className="h-10">Fechar</Button>
              {podeRepetir && <Button autoFocus onClick={enviar} className="h-10">Tentar novamente</Button>}
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">
                {aptos.length === 1 ? "Enviar 1 boletim?" : `Enviar ${aptos.length} boletins?`}
              </h2>
              <p id={`${id}-d`} className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                Os boletins do ciclo {cicloLabel} serão disponibilizados aos respectivos fornecedores no portal, e cada um receberá o e-mail de aviso.
              </p>
            </div>
            <div className="grid min-h-0 gap-3 overflow-y-auto px-5 py-4 text-[13px]">
              <dl className="grid gap-1.5" data-testid="envio-bm-lote-previa">
                <div className="flex justify-between gap-3"><dt className="text-[var(--muted-foreground)]">Selecionados</dt><dd className="font-semibold">{previa.length}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--muted-foreground)]">Aptos para envio</dt><dd className="font-semibold">{aptos.length}</dd></div>
                {inaptos.length > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-[var(--muted-foreground)]">Não serão enviados</dt><dd className="font-semibold">{inaptos.length}</dd></div>
                )}
                <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-1.5">
                  <dt className="text-[var(--muted-foreground)]">Total da medição (aptos)</dt>
                  <dd className="font-semibold tabular-nums" data-testid="envio-bm-lote-total">{money(total)}</dd>
                </div>
              </dl>
              {acimaDoLimite && (
                <p role="alert" className="rounded-lg border border-[#f2dbb7] bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[#92400E]">
                  No máximo {LIMITE_ENVIO_BM_LOTE} BMs por envio. Reduza a seleção e envie em partes.
                </p>
              )}
              {inaptos.length > 0 && (
                <div>
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-[var(--primary)] underline underline-offset-2"
                    aria-expanded={verInaptos}
                    aria-controls={`${id}-inaptos`}
                    onClick={() => setVerInaptos((v) => !v)}
                  >
                    {verInaptos ? "Ocultar quem não será enviado" : "Ver quem não será enviado"}
                  </button>
                  {verInaptos && (
                    <ul id={`${id}-inaptos`} className="mt-2 max-h-48 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]" data-testid="envio-bm-lote-inaptos">
                      {inaptos.map(({ item, motivo }) => (
                        <li key={item.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                          <Minus size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[var(--foreground)]">{nomeDe(item)}</p>
                            <p className="text-[var(--muted-foreground)]">{motivo}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button variant="secondary" onClick={onClose} disabled={enviando} className="h-10">Cancelar</Button>
              <Button autoFocus onClick={enviar} disabled={enviando || aptos.length === 0 || acimaDoLimite} className="h-10">
                <Send size={14} aria-hidden="true" />
                {enviando ? "Enviando..." : rotuloEnviar}
              </Button>
            </div>
          </>
        )}
        {enviando && <span className="sr-only" role="status">Enviando BMs…</span>}
      </div>
    </div>
  );
}
