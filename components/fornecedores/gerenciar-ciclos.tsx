"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AdminSidePanel } from "@/components/administrativo/admin-side-panel";
import { Badge, Button, IconButton } from "@/components/ui";
import { formatCicloLabel } from "@/lib/ciclo";

export type CicloGestaoEntry = { ciclo: string; mesReferencia: string | null; ativoMedicao?: boolean; updatedAt?: string };

function mesDoCiclo(c: CicloGestaoEntry) {
  if (c.mesReferencia) return c.mesReferencia;
  try {
    return formatCicloLabel(c.ciclo);
  } catch {
    return "–";
  }
}

/**
 * Gerenciar ciclos (em /fornecedores, junto do contexto de ciclo). Só move a interface — as ações
 * continuam as mesmas de antes, via /api/ciclos:
 *  - Novo ciclo  → POST   (Medição/ADMIN; formato YYMM validado aqui e no backend)
 *  - Selecionar  → só troca o ciclo de TRABALHO desta tela (nenhuma escrita; não publica no portal)
 *  - Excluir     → DELETE (somente ADMIN; confirmação do design system, sem window.confirm)
 * A publicação no portal continua exclusivamente no controle "Ciclo publicado".
 */
export function GerenciarCiclosPanel({
  ciclos,
  cicloSelecionado,
  podeExcluir,
  onSelecionar,
  onCriar,
  onExcluir,
  onClose,
}: {
  ciclos: CicloGestaoEntry[];
  cicloSelecionado: string;
  podeExcluir: boolean;
  onSelecionar: (ciclo: string) => void;
  /** Cria o ciclo (mesma ação de sempre); devolve a mensagem de erro ou null. */
  onCriar: (ciclo: string) => Promise<string | null>;
  /** Exclui o ciclo (mesma ação de sempre); devolve a mensagem de erro ou null. */
  onExcluir: (ciclo: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [novo, setNovo] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  async function criar() {
    const valor = novo.trim();
    if (!/^\d{4}$/.test(valor)) {
      setErro("Digite um ciclo válido no formato YYMM (ex: 2606).");
      return;
    }
    setCriando(true);
    setErro(null);
    const falha = await onCriar(valor);
    setCriando(false);
    if (falha) { setErro(falha); return; }
    setNovo("");
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setConfirmando(true);
    setErroExclusao(null);
    const falha = await onExcluir(excluindo);
    setConfirmando(false);
    if (falha) { setErroExclusao(falha); return; }
    setExcluindo(null);
  }

  return (
    <>
      <AdminSidePanel
        eyebrow="Fornecedores"
        title="Gerenciar ciclos"
        subtitle="Selecione o ciclo de trabalho, crie um novo ciclo ou exclua um ciclo."
        onClose={onClose}
        escEnabled={!excluindo}
        testId="gerenciar-ciclos"
      >
        <div className="grid gap-5 p-5 sm:p-6">
          <div className="grid gap-1.5">
            <span className="text-label text-[var(--muted-foreground)]">Novo ciclo</span>
            <div className="flex gap-2">
              <input
                className="h-9 w-full min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 sm:w-32 sm:flex-none"
                placeholder="Ex: 2606"
                aria-label="Novo ciclo (YYMM)"
                maxLength={4}
                value={novo}
                onChange={(e) => { setNovo(e.target.value.replace(/\D/g, "")); setErro(null); }}
                onKeyDown={(e) => e.key === "Enter" && criar()}
              />
              <Button onClick={criar} disabled={criando || novo.length !== 4}>
                <Plus size={14} />
                {criando ? "Criando…" : "Novo ciclo"}
              </Button>
            </div>
            <span className="text-[11px] text-[var(--muted-foreground)]">Formato YYMM. Criar um ciclo não o publica no portal.</span>
            {erro && <p className="text-xs text-[var(--error)]" role="alert">{erro}</p>}
          </div>

          <ul className="divide-y divide-[#EFEFED] rounded-lg border border-[var(--border)]" data-testid="gerenciar-ciclos-lista">
            {ciclos.length === 0 && <li className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">Nenhum ciclo cadastrado.</li>}
            {ciclos.map((c) => {
              const selecionado = c.ciclo === cicloSelecionado;
              return (
                <li key={c.ciclo} className={`flex min-w-0 items-center gap-3 px-4 py-3 ${selecionado ? "bg-[#FAFAF8]" : ""}`} data-ciclo={c.ciclo}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-technical text-sm font-semibold text-[var(--foreground)]">{c.ciclo}</span>
                      {selecionado && <Badge variant="primary">Selecionado</Badge>}
                      {c.ativoMedicao && <Badge variant="success">Publicado no portal</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-[var(--muted-foreground)]">{mesDoCiclo(c)}</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => onSelecionar(c.ciclo)}
                    disabled={selecionado}
                    aria-label={selecionado ? `Ciclo ${c.ciclo} selecionado` : `Selecionar ciclo ${c.ciclo}`}
                  >
                    {selecionado ? "Selecionado" : "Selecionar"}
                  </Button>
                  {podeExcluir && (
                    <IconButton
                      title={`Excluir ciclo ${c.ciclo}`}
                      onClick={() => { setErroExclusao(null); setExcluindo(c.ciclo); }}
                      className="border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] hover:bg-[#FEE2E2] hover:text-[#991B1B]"
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </AdminSidePanel>

      {excluindo && (
        <ConfirmarExclusao
          ciclo={excluindo}
          confirmando={confirmando}
          erro={erroExclusao}
          onCancel={() => setExcluindo(null)}
          onConfirm={confirmarExclusao}
        />
      )}
    </>
  );
}

/** Mesmo padrão visual dos modais de confirmação do app (ds-dialog, z-[70]). */
function ConfirmarExclusao({
  ciclo,
  confirmando,
  erro,
  onCancel,
  onConfirm,
}: {
  ciclo: string;
  confirmando: boolean;
  erro: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !confirmando) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmando, onCancel]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[440px] sm:max-w-[90vw]" role="alertdialog" aria-modal="true" aria-label="Excluir ciclo">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-bold text-[var(--foreground)]">Excluir o ciclo {ciclo}?</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Esta ação remove os dados vinculados ao ciclo, incluindo medições, pagamentos, aprovações, arquivos e histórico de revisão. Usuários cadastrados serão preservados.
          </p>
          {erro && <p className="mt-2 text-xs text-[var(--error)]" role="alert">{erro}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={confirmando}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirm} disabled={confirmando}>{confirmando ? "Excluindo..." : "Excluir ciclo"}</Button>
        </div>
      </div>
    </div>
  );
}
