"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { AdminSidePanel, PanelSection } from "@/components/administrativo/admin-side-panel";

export type ImportLinha = {
  responsavel: string;
  cnpj: string;
  cnpjNormalizado: string;
  razaoSocial: string;
  statusContrato: string | null;
  objetoContrato: string | null;
  cargo: string | null;
  cpf: string | null;
  email: string | null;
  telefone: string | null;
  tipoCt: string | null;
  tipoContrato: string | null;
  valorHora: number | null;
  valorA1Equivalente: number | null;
  valorDocumento: number | null;
  valorCondicaoFixa: number | null;
  inicio: string | null;
  final: string | null;
  statusCadastro: string | null;
  primeiroAditivo: string | null;
  segundoAditivo: string | null;
};

export type ImportAtencaoDetalhe = { responsavel: string; cnpj: string; motivo: string; candidateCodigos?: string[]; linha?: ImportLinha };

export type ImportResult = {
  total: number;
  criados: number;
  recriados: number;
  atualizados: number;
  usuariosCriados: number;
  usuariosReativados: number;
  conflitos: number;
  conflitosDetalhe: ImportAtencaoDetalhe[];
  bloqueados: number;
  bloqueadosDetalhe: ImportAtencaoDetalhe[];
  revisao: number;
  revisaoDetalhe: ImportAtencaoDetalhe[];
  senhasTemporarias: { usuario: string; nome: string; senha: string; email: string | null }[];
};

/**
 * Importação da Consulta PJ — mesma máscara, mesmo endpoint (POST /api/admin/administrativo/
 * fornecedores) e mesmos resultados de antes, agora num painel lateral. O resultado vive no
 * componente pai: fechar e reabrir o painel não perde a lista de atenção nem as senhas temporárias
 * (que continuam existindo só nesta sessão da tela, nunca persistidas).
 */
export function ImportarConsultaPanel({
  file,
  onFileChange,
  uploading,
  error,
  result,
  isAdmin,
  escEnabled,
  onUpload,
  onResolver,
  onClose,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  uploading: boolean;
  error: string;
  result: ImportResult | null;
  isAdmin: boolean;
  escEnabled?: boolean;
  onUpload: () => void;
  onResolver: (item: ImportAtencaoDetalhe & { categoria: string }) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [mostrarAtencao, setMostrarAtencao] = useState(false);
  const atencaoTotal = result ? result.conflitos + result.bloqueados + result.revisao : 0;
  const itensAtencao: (ImportAtencaoDetalhe & { categoria: string })[] = result
    ? [
        ...result.conflitosDetalhe.map((d) => ({ ...d, categoria: "Identidade ambígua" })),
        ...result.bloqueadosDetalhe.map((d) => ({ ...d, categoria: "Bloqueado" })),
        ...result.revisaoDetalhe.map((d) => ({ ...d, categoria: "Requer revisão" })),
      ]
    : [];

  return (
    <AdminSidePanel
      eyebrow="Administrativo"
      title="Importar Consulta PJ"
      subtitle="A planilha atualiza os cadastros e cria usuários apenas quando ainda não existem."
      escEnabled={escEnabled}
      closeDisabled={uploading}
      onClose={onClose}
      testId="administrativo-importar"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={uploading}>Fechar</Button>
          <Button onClick={onUpload} disabled={!file || uploading}>
            <Upload size={14} />
            {uploading ? "Importando..." : "Importar cadastros"}
          </Button>
        </>
      }
    >
      <PanelSection
        title="Planilha"
        action={
          <a
            href="/api/admin/templates/administrativo"
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 text-[12px] font-semibold text-[var(--foreground)] transition hover:border-[var(--border-strong)] hover:bg-[#f7f7f5]"
          >
            <Download size={13} />
            Baixar máscara
          </a>
        }
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[#FAFAF8] px-4 text-center transition hover:border-[var(--primary)] hover:bg-[var(--primary-soft)]"
        >
          <Upload size={20} className="text-[var(--primary)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">{file ? file.name : "Clique para selecionar ou trocar a planilha"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">.xlsx ou .xlsm</span>
        </button>
        {error && <div className="rounded-lg border border-[#efc6c6] bg-[var(--error-soft)] px-4 py-3 text-sm font-semibold text-[var(--error)]">{error}</div>}
      </PanelSection>

      {result && (
        <PanelSection title="Resultado">
          <div className="rounded-lg border border-[#cde9d5] bg-[var(--success-soft)] px-4 py-3 text-sm text-[var(--success)]">
            Importação concluída: {result.total} registro(s), {result.criados} novo(s)
            {result.recriados > 0 ? `, ${result.recriados} recriado(s)` : ""}, {result.atualizados} atualizado(s), {result.usuariosCriados} usuário(s) criado(s)
            {result.usuariosReativados > 0 ? `, ${result.usuariosReativados} usuário(s) reativado(s)` : ""}.
          </div>
          {atencaoTotal > 0 && (
            <div className="rounded-lg border border-[#f2dbb7] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[#92400E]">
              <button type="button" onClick={() => setMostrarAtencao((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left font-semibold">
                <span>{atencaoTotal} registro(s) precisam de atenção</span>
                <span className="text-xs underline">{mostrarAtencao ? "Ocultar detalhes" : "Ver detalhes"}</span>
              </button>
              {mostrarAtencao && (
                <div className="mt-2 grid gap-1.5">
                  {itensAtencao.map((item, idx) => (
                    <div key={`${item.responsavel}-${idx}`} className="rounded-md border border-[#f2dbb7] bg-white px-2.5 py-1.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{item.responsavel}</strong>
                        <span className="rounded-md bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[#92400E]">{item.categoria}</span>
                      </div>
                      <p className="mt-0.5 text-[#78350F]">Motivo: {item.motivo}</p>
                      {isAdmin && item.categoria !== "Bloqueado" && item.linha && (
                        <div className="mt-1.5 flex justify-end">
                          <Button variant="secondary" onClick={() => onResolver(item)}>Resolver</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {result.senhasTemporarias.length > 0 && (
            <div className="grid gap-2 rounded-lg border border-[#f2dbb7] bg-[var(--warning-soft)] p-3">
              <p className="text-xs font-bold uppercase text-[#92400E]">
                {result.senhasTemporarias.length} senha(s) temporária(s) — usuário(s) novo(s) ou reativado(s) sem senha anterior recuperável
              </p>
              <div className="grid gap-1.5">
                {result.senhasTemporarias.map((entry) => (
                  <div key={`${entry.usuario}-${entry.nome}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#f2dbb7] bg-white px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-[#92400E]">
                      <strong>{entry.nome}</strong> {entry.email ? `· ${entry.email}` : ""} <span className="font-technical text-[10px] text-[#B45309]">({entry.usuario})</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-technical font-bold text-[#92400E]">{entry.senha}</span>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(entry.senha)}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-[#f2dbb7] bg-white px-1.5 text-[10px] font-semibold text-[#92400E] transition hover:bg-[var(--warning-soft)]"
                      >
                        <Copy size={10} />
                        Copiar
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-[#92400E]">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                Essas senhas serão exibidas somente nesta importação — copie agora antes de sair desta tela.
              </p>
            </div>
          )}
        </PanelSection>
      )}
    </AdminSidePanel>
  );
}
