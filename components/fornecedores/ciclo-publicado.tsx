"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { formatCicloLabel } from "@/lib/ciclo";

export type CicloPortalEntry = { ciclo: string; mesReferencia: string | null; ativoMedicao?: boolean };

function rotulo(ciclo: string) {
  try {
    return `${ciclo} · ${formatCicloLabel(ciclo)}`;
  } catch {
    return ciclo;
  }
}

/**
 * Ciclo publicado no portal — MESMA regra de lib/ciclo-ativo.ts::getCicloAtivoMedicao: o ciclo com
 * `ativoMedicao = true`; sem nenhum marcado, o mais recente (automático).
 */
export function cicloPublicadoDoPortal(ciclos: CicloPortalEntry[]) {
  const marcado = ciclos.find((c) => c.ativoMedicao);
  if (marcado) return { ciclo: marcado.ciclo, automatico: false };
  const maisRecente = [...ciclos].sort((a, b) => b.ciclo.localeCompare(a.ciclo))[0];
  return maisRecente ? { ciclo: maisRecente.ciclo, automatico: true } : null;
}

/**
 * Controle compacto "Portal dos fornecedores · Ciclo publicado". Separa o CICLO SELECIONADO (o que a
 * equipe está consultando nesta tela) do CICLO PUBLICADO (o que o fornecedor vê no portal): trocar o
 * seletor de ciclo nunca escreve nada; só "Publicar ciclo", depois da confirmação, chama a mesma
 * ação de sempre (PATCH /api/ciclos, action "set_ativo_medicao" — permissão Medição/ADMIN).
 */
export function CicloPublicadoControl({
  ciclos,
  cicloSelecionado,
  podePublicar,
  onPublicar,
}: {
  ciclos: CicloPortalEntry[];
  cicloSelecionado: string;
  podePublicar: boolean;
  onPublicar: (ciclo: string) => Promise<string | null>;
}) {
  const publicado = cicloPublicadoDoPortal(ciclos);
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState("");
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoes = useMemo(() => ciclos.filter((c) => c.ciclo !== publicado?.ciclo || publicado?.automatico), [ciclos, publicado]);
  const selecionadoReal = /^\d{4}$/.test(cicloSelecionado) ? cicloSelecionado : "";
  const divergente = !!selecionadoReal && !!publicado && selecionadoReal !== publicado.ciclo;

  function abrir() {
    const padrao = opcoes.find((c) => c.ciclo === selecionadoReal)?.ciclo ?? opcoes[0]?.ciclo ?? "";
    setNovo(padrao);
    setErro(null);
    setAberto(true);
  }

  useEffect(() => {
    if (!aberto) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !publicando) setAberto(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto, publicando]);

  async function publicar() {
    if (!novo || publicando) return;
    setPublicando(true);
    setErro(null);
    const falha = await onPublicar(novo);
    setPublicando(false);
    if (falha) { setErro(falha); return; }
    setAberto(false);
  }

  return (
    <>
      <div
        className="flex w-fit min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2"
        data-testid="ciclo-publicado"
      >
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]">
          <Globe2 size={14} className="shrink-0" />
          Portal dos fornecedores
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-[var(--foreground)]">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
          Ciclo publicado: <strong className="font-technical font-semibold">{publicado?.ciclo ?? "–"}</strong>
          {publicado?.automatico && <span className="text-[11px] text-[var(--muted-foreground)]">(automático — ciclo mais recente)</span>}
        </span>
        {podePublicar && ciclos.length > 0 && (
          <button type="button" onClick={abrir} className="text-[12px] font-semibold text-[var(--primary)] underline-offset-2 hover:underline">
            Alterar
          </button>
        )}
        {divergente && (
          <span className="basis-full text-[11px] text-[var(--muted-foreground)]" data-testid="ciclo-publicado-aviso">
            Você está consultando o ciclo {selecionadoReal}; o portal continua no ciclo {publicado?.ciclo}.
          </span>
        )}
      </div>

      {aberto && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
          <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[440px] sm:max-w-[90vw]" role="alertdialog" aria-modal="true" aria-label="Publicar ciclo no portal">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 className="text-sm font-bold text-[var(--foreground)]">{novo ? `Publicar ciclo ${novo}?` : "Publicar ciclo"}</h2>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Os fornecedores passarão a visualizar no portal os BMs correspondentes ao ciclo escolhido.
              </p>
            </div>
            <div className="grid gap-3 px-5 py-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-[var(--muted-foreground)]">Ciclo publicado atualmente</span>
                <span className="font-technical font-semibold text-[var(--foreground)]">{publicado ? rotulo(publicado.ciclo) : "–"}</span>
              </div>
              <label className="grid gap-1 text-label text-[var(--muted-foreground)]">
                Novo ciclo
                <Select value={novo} onChange={(e) => setNovo(e.target.value)} aria-label="Novo ciclo publicado">
                  {opcoes.map((c) => <option key={c.ciclo} value={c.ciclo}>{rotulo(c.ciclo)}</option>)}
                </Select>
              </label>
              {erro && <p className="text-xs text-[var(--error)]">{erro}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button variant="secondary" onClick={() => setAberto(false)} disabled={publicando}>Cancelar</Button>
              <Button onClick={publicar} disabled={publicando || !novo}>{publicando ? "Publicando..." : "Publicar ciclo"}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
