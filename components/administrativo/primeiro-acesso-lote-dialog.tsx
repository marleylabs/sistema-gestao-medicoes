"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Minus, Send } from "lucide-react";
import { Button } from "@/components/ui";
import type { CadastroFornecedor } from "@/components/administrativo/shared";
import { avaliarElegibilidadePrimeiroAcesso } from "@/lib/primeiro-acesso-elegibilidade";
import { LIMITE_PRIMEIRO_ACESSO_LOTE, type ResumoPrimeiroAcessoLote, type StatusPrimeiroAcessoLote } from "@/lib/primeiro-acesso-lote";

type Fase = "confirmar" | "enviando" | "resultado" | "erro";

const STATUS_ICONE: Record<StatusPrimeiroAcessoLote, { icone: typeof Check; texto: string; cor: string }> = {
  ENVIADO: { icone: Check, texto: "Enviado", cor: "text-[var(--success)]" },
  IGNORADO: { icone: Minus, texto: "Não enviado", cor: "text-[var(--muted-foreground)]" },
  FALHA: { icone: AlertTriangle, texto: "Falhou", cor: "text-[var(--error)]" },
};

/**
 * Confirmação + resultado do "Enviar primeiro acesso" em lote. A prévia (aptos × não enviados) usa
 * a MESMA regra da tela individual sobre os dados já carregados; o servidor reavalia tudo no envio
 * e o resultado exibido é sempre o devolvido por ele.
 *
 * `requestId` é gerado uma vez ao abrir: repetir (duplo clique, "Tentar novamente" após falha de
 * rede) reaproveita o mesmo id, e o backend nunca reenvia/rotaciona quem já recebeu nesta operação.
 */
export function PrimeiroAcessoLoteDialog({
  itens,
  onClose,
  onProcessado,
}: {
  itens: CadastroFornecedor[];
  onClose: () => void;
  /** Chamado assim que o servidor devolve o resumo (para recarregar a listagem e limpar a seleção). */
  onProcessado: (resumo: ResumoPrimeiroAcessoLote) => void;
}) {
  const id = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [fase, setFase] = useState<Fase>("confirmar");
  const [resumo, setResumo] = useState<ResumoPrimeiroAcessoLote | null>(null);
  const [erro, setErro] = useState("");
  const [podeRepetir, setPodeRepetir] = useState(false);
  const [verInaptos, setVerInaptos] = useState(false);
  const [verDetalhes, setVerDetalhes] = useState(false);
  const enviandoRef = useRef(false);

  const previa = useMemo(() => {
    const aptos: CadastroFornecedor[] = [];
    const inaptos: { item: CadastroFornecedor; motivo: string }[] = [];
    for (const item of itens) {
      const avaliacao = avaliarElegibilidadePrimeiroAcesso(item.acesso, item.email);
      if (avaliacao.elegivel) aptos.push(item);
      else inaptos.push({ item, motivo: avaliacao.mensagem });
    }
    return { aptos, inaptos };
  }, [itens]);
  const acimaDoLimite = itens.length > LIMITE_PRIMEIRO_ACESSO_LOTE;

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
    if (enviandoRef.current || previa.aptos.length === 0 || acimaDoLimite) return;
    enviandoRef.current = true;
    setFase("enviando");
    setErro("");
    try {
      const res = await fetch("/api/admin/administrativo/fornecedores/primeiro-acesso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: itens.map((item) => item.id), requestId }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok && payload && Array.isArray(payload.resultados)) {
        const recebido = payload as ResumoPrimeiroAcessoLote;
        setResumo(recebido);
        setFase("resultado");
        onProcessado(recebido);
        return;
      }
      // 4xx: o servidor recusou ANTES de enviar qualquer coisa (permissão/validação) — repetir não ajuda.
      const recusado = res.status >= 400 && res.status < 500;
      setPodeRepetir(!recusado);
      setErro(recusado && typeof payload?.error === "string" ? payload.error : "Não foi possível processar os primeiros acessos.");
      setFase("erro");
    } catch {
      setPodeRepetir(true);
      setErro("Não foi possível processar os primeiros acessos.");
      setFase("erro");
    } finally {
      enviandoRef.current = false;
    }
  }

  const enviando = fase === "enviando";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        aria-busy={enviando}
        data-testid="primeiro-acesso-lote-dialog"
        className="ds-dialog flex max-h-[calc(100dvh-16px)] w-full flex-col overflow-hidden sm:w-[480px] sm:max-w-[92vw]"
      >
        {fase === "resultado" && resumo ? (
          <>
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">Envio concluído</h2>
              <div id={`${id}-d`} className="mt-2 grid gap-1 text-[13px] text-[var(--foreground)]" data-testid="primeiro-acesso-lote-resumo">
                <p>{resumo.enviados === 1 ? "1 primeiro acesso enviado." : `${resumo.enviados} primeiros acessos enviados.`}</p>
                {resumo.ignorados > 0 && <p>{resumo.ignorados === 1 ? "1 fornecedor não foi enviado." : `${resumo.ignorados} fornecedores não foram enviados.`}</p>}
                {resumo.falhas > 0 && <p className="text-[var(--error)]">{resumo.falhas === 1 ? "1 envio falhou." : `${resumo.falhas} envios falharam.`}</p>}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 py-3">
              {resumo.falhas > 0 && (
                <p className="mb-2 text-[12px] text-[var(--muted-foreground)]">Quem falhou não recebeu o e-mail: selecione novamente e envie de novo.</p>
              )}
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
                <ul id={`${id}-detalhes`} className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]" data-testid="primeiro-acesso-lote-detalhes">
                  {resumo.resultados.map((r) => {
                    const s = STATUS_ICONE[r.status];
                    const Icone = s.icone;
                    return (
                      <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-[12px]" data-status={r.status}>
                        <Icone size={14} className={`mt-0.5 shrink-0 ${s.cor}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--foreground)]">{r.nome ?? "Fornecedor removido"}</p>
                          <p className="text-[var(--muted-foreground)]"><span className="sr-only">{s.texto}: </span>{r.motivo}</p>
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
              <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">Enviar primeiro acesso</h2>
              <p id={`${id}-d`} role="alert" className="mt-2 rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-3 py-2 text-[13px] font-medium text-[var(--error)]">{erro}</p>
              {podeRepetir && (
                <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">
                  Parte dos acessos pode ter sido enviada. Tentar novamente é seguro: quem já recebeu nesta operação não recebe outra senha.
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
              <h2 id={`${id}-t`} className="text-section-title text-[var(--foreground)]">Enviar primeiro acesso</h2>
              <p id={`${id}-d`} className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                Cada fornecedor apto receberá, no e-mail de acesso, uma nova senha temporária. Uma senha temporária anterior, caso exista, deixará de ser válida.
              </p>
            </div>
            <div className="grid min-h-0 gap-3 overflow-y-auto px-5 py-4 text-[13px]">
              <dl className="grid gap-1.5" data-testid="primeiro-acesso-lote-previa">
                <div className="flex justify-between gap-3"><dt className="text-[var(--muted-foreground)]">Selecionados</dt><dd className="font-semibold">{itens.length}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--muted-foreground)]">Aptos para envio</dt><dd className="font-semibold">{previa.aptos.length}</dd></div>
                {previa.inaptos.length > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-[var(--muted-foreground)]">Não serão enviados</dt><dd className="font-semibold">{previa.inaptos.length}</dd></div>
                )}
              </dl>
              {acimaDoLimite && (
                <p role="alert" className="rounded-lg border border-[#f2dbb7] bg-[var(--warning-soft)] px-3 py-2 text-[12px] text-[#92400E]">
                  No máximo {LIMITE_PRIMEIRO_ACESSO_LOTE} fornecedores por envio. Reduza a seleção e envie em partes.
                </p>
              )}
              {previa.inaptos.length > 0 && (
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
                    <ul id={`${id}-inaptos`} className="mt-2 max-h-48 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]" data-testid="primeiro-acesso-lote-inaptos">
                      {previa.inaptos.map(({ item, motivo }) => (
                        <li key={item.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                          <Minus size={14} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[var(--foreground)]">{item.responsavel}</p>
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
              <Button autoFocus onClick={enviar} disabled={enviando || previa.aptos.length === 0 || acimaDoLimite} className="h-10">
                <Send size={14} aria-hidden="true" />
                {enviando ? "Enviando..." : previa.aptos.length === 1 ? "Enviar 1 acesso" : `Enviar ${previa.aptos.length} acessos`}
              </Button>
            </div>
          </>
        )}
        {enviando && <span className="sr-only" role="status">Enviando primeiros acessos…</span>}
      </div>
    </div>
  );
}
