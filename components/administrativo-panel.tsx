"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, FileSpreadsheet, KeyRound, Plus, RefreshCw, Search, Send, Trash2, X } from "lucide-react";
import { Button, Card, FilterButton, FilterChip, IconButton, Input, PageContainer, PageHeader, Select } from "@/components/ui";
import { useViewportAlign } from "@/components/use-viewport-align";
import { normalizeTipoCondicaoFixa } from "@/lib/condicao-fixa";
import { normalizeFonteMedicao } from "@/lib/fonte-medicao";
import { INTERNAL_PERFIL_OPTIONS, PERFIL_LABEL_LOOSE as PERFIL_LABEL, PERFIL_OPTIONS } from "@/lib/perfis";
import { PERMISSAO_OPTIONS, PERMISSAO_LABEL_LOOSE, PERMISSOES_BASE_POR_PERFIL } from "@/lib/permissoes";
import { compactId, digitsOnly, displayText, type CadastroFornecedor, type Funcionario } from "@/components/administrativo/shared";
import { FornecedorEditor, FuncionarioCreatePanel } from "@/components/administrativo/fornecedor-editor";
import { FornecedorDetalhe, FuncionarioDetalhe } from "@/components/administrativo/detalhes";
import { AdministrativoKpis, FornecedoresCadastroTable, FuncionariosTable } from "@/components/administrativo/listagem";
import { ImportarConsultaPanel, type ImportAtencaoDetalhe, type ImportResult } from "@/components/administrativo/importar-panel";
import { PrimeiroAcessoLoteDialog } from "@/components/administrativo/primeiro-acesso-lote-dialog";
import { BulkSelectionBar } from "@/components/bulk-selection-bar";
import { avaliarElegibilidadePrimeiroAcesso } from "@/lib/primeiro-acesso-elegibilidade";

type IdentityCandidateSummary = {
  codigo: string;
  profissionalId: string | null;
  nomeAtual: string | null;
  nomeCompleto: string | null;
  email: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  profissionalStatus: "ATIVO" | "EXCLUIDO" | "INEXISTENTE";
  excluidoEm: string | null;
  usuarioId: string | null;
  usuarioLogin: string | null;
  usuarioStatus: "ATIVO" | "EXCLUIDO" | "INEXISTENTE";
  historico: { sgc: number; mapaPagamento: number; medicao: number; divergencias: number };
};

type AcessoOpcao = "ativo" | "inativo";
const ACESSO_LABELS: Record<AcessoOpcao, string> = { ativo: "Ativo", inativo: "Inativo" };

type SituacaoOpcao = "validos" | "vencidos" | "vencendo" | "pendencias";
const SITUACAO_LABELS: Record<SituacaoOpcao, string> = {
  validos: "Válido",
  vencidos: "Vencido",
  vencendo: "Próximo do vencimento",
  pendencias: "Pendência",
};

type AdminDeletionResult = {
  requested: number;
  administrativeDeleted: number;
  usersDeactivated: number;
  usersDeleted: number;
  professionalsDeleted: number;
  professionalsPreservedForHistory: number;
  measurementHistoryPreserved: number;
  errors: { id: string; error: string }[];
};

function AlterarPerfilModal({
  target,
  onClose,
  onSaved,
  onError,
}: {
  target: { usuarioId: string; nome: string; perfilAtual: string };
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [perfil, setPerfil] = useState(target.perfilAtual);
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setSaving(true);
    const res = await fetch(`/api/admin/usuarios/${target.usuarioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_perfil", perfil }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      onError(payload.error ?? "Não foi possível alterar o perfil.");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[380px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Alterar perfil</h2>
          <p className="mt-0.5 text-xs text-[#6B7280]">{target.nome}</p>
        </div>
        <div className="p-5">
          <select
            value={perfil}
            onChange={(e) => setPerfil(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#1A1A1A] outline-none transition hover:border-[#D1D5DB] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          >
            {INTERNAL_PERFIL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || perfil === target.perfilAtual}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Gerenciar Acessos adicionais — só ADMIN literal chama isto (menu item só aparece quando
 * isAdmin=isFullAdmin no card, e a rota também exige perfil ADMIN independente do que a UI mostra;
 * conceder/remover permissão extra é ação de segurança, nunca liberada por uma permissão extra em
 * si — item 19 do pedido). Mostra separadamente o que já vem do PERFIL (fixo, informativo) do que
 * é extra e editável.
 */
function PermissoesExtrasModal({
  target,
  onClose,
  onSaved,
  onError,
}: {
  target: { usuarioId: string; nome: string; perfil: string; permissoesAtuais: string[] };
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set(target.permissoesAtuais));
  const [saving, setSaving] = useState(false);
  const basePerfil = PERMISSOES_BASE_POR_PERFIL[target.perfil] ?? [];
  // Nunca oferecer como "extra" algo que o perfil já dá de base (item 11 do pedido).
  const opcoesExtras = PERMISSAO_OPTIONS.filter((o) => !basePerfil.includes(o.value));

  function toggle(value: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function salvar() {
    setSaving(true);
    const res = await fetch(`/api/admin/usuarios/${target.usuarioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_permissoes_extras", permissoes: [...selecionadas] }),
    });
    const payload = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      onError(payload.error ?? "Não foi possível atualizar os acessos adicionais.");
      return;
    }
    onSaved();
  }

  const inalterado = selecionadas.size === target.permissoesAtuais.length && target.permissoesAtuais.every((p) => selecionadas.has(p));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[420px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Acessos adicionais</h2>
          <p className="mt-0.5 text-xs text-[#6B7280]">{target.nome} — perfil {PERFIL_LABEL[target.perfil] ?? target.perfil}</p>
        </div>
        <div className="grid gap-4 p-5">
          {basePerfil.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF]">Acessos do perfil</p>
              <div className="flex flex-wrap gap-1.5">
                {basePerfil.map((p) => (
                  <span key={p} className="rounded-full bg-[#F3F4F6] px-2 py-1 text-[11px] font-semibold text-[#6B7280]">
                    ✓ {PERMISSAO_LABEL_LOOSE[p] ?? p} — incluído pelo perfil
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF]">Acessos adicionais</p>
            {opcoesExtras.length === 0 ? (
              <p className="text-xs text-[#9CA3AF]">Nenhum acesso adicional disponível para este perfil.</p>
            ) : (
              <div className="grid gap-2">
                {opcoesExtras.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-[#1A1A1A]">
                    <input
                      type="checkbox"
                      checked={selecionadas.has(option.value)}
                      onChange={() => toggle(option.value)}
                      className="h-4 w-4 cursor-pointer accent-[#AF1B1B]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || inalterado}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal de credencial — ÚNICO lugar da aplicação onde uma senha temporária em texto puro chega a
 * ser exibida, e só imediatamente após a operação que a gerou (criação de fornecedor/funcionário,
 * ou redefinição de senha). Nunca persiste: `senha` vive só no estado React deste componente,
 * nunca é salva em nenhuma coluna nova, e desaparece ao fechar (`onClose` limpa o state do pai —
 * recarregar a página ou reabrir o card jamais a revela de novo).
 */
function CredencialModal({
  titulo,
  nome,
  email,
  usuario,
  senha,
  onClose,
}: {
  titulo: string;
  nome: string;
  email: string | null;
  usuario?: string;
  senha: string;
  onClose: () => void;
}) {
  // A senha vive só nestas props/estado em memória (vinda da resposta imediata da operação):
  // nunca persistida no navegador nem recuperável pela API depois que o modal fecha.
  const [visivel, setVisivel] = useState(false);
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="credencial-titulo" data-testid="credencial-modal" className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[420px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 id="credencial-titulo" className="text-sm font-bold text-[#1A1A1A]">{titulo}</h2>
        </div>
        <div className="grid gap-3 p-5 text-sm">
          <div>
            <span className="text-xs text-[#64748B]">Nome</span>
            <p className="font-semibold text-[#1F2937]">{nome}</p>
          </div>
          {usuario && (
            <div>
              <span className="text-xs text-[#64748B]">Login</span>
              <p className="font-mono font-semibold text-[#1F2937]">{usuario}</p>
            </div>
          )}
          {email && (
            <div>
              <span className="text-xs text-[#64748B]">E-mail</span>
              <p className="font-semibold text-[#1F2937]">{email}</p>
            </div>
          )}
          <div className="rounded-lg bg-[#FFFBEB] px-3 py-2">
            <span className="text-xs text-[#92400E]">Senha temporária</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="flex-1 truncate rounded-md border border-[#FDE68A] bg-white px-2 py-1 font-mono text-sm font-bold text-[#92400E]">
                {visivel ? senha : "•".repeat(Math.max(senha.length, 8))}
              </span>
              <button
                type="button"
                onClick={() => setVisivel((v) => !v)}
                title={visivel ? "Ocultar senha" : "Mostrar senha"}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#FDE68A] bg-white text-[#92400E] transition hover:bg-[#FFFBEB]"
              >
                {visivel ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(senha); setCopiado(true); }}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[#FDE68A] bg-white px-2 text-[11px] font-semibold text-[#92400E] transition hover:bg-[#FFFBEB]"
              >
                <Copy size={12} />
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-[#92400E]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Copie esta senha agora. Ela não poderá ser visualizada novamente.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmResetSenhaModal({
  nome,
  confirming,
  onCancel,
  onConfirm,
}: {
  nome: string;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[380px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Redefinir senha</h2>
          <p className="mt-1 text-xs text-[#6B7280]">
            Gerar uma nova senha temporária para <strong className="text-[#374151]">{nome}</strong>? A senha atual deixa de funcionar imediatamente.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={confirming}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={confirming}>
            <KeyRound size={14} />
            {confirming ? "Redefinindo..." : "Redefinir senha"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmPrimeiroAcessoModal({
  nome,
  email,
  usuario,
  confirming,
  onCancel,
  onConfirm,
}: {
  nome: string;
  email: string;
  usuario: string;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[420px] sm:max-w-[90vw]">
        <div className="border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Enviar primeiro acesso</h2>
          <p className="mt-1 text-xs text-[#6B7280]">
            Será gerada uma nova senha temporária para este usuário e enviada para o e-mail cadastrado.
          </p>
        </div>
        <div className="space-y-1.5 border-b border-[#E5E7EB] px-5 py-4 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-[#94A3B8]">Nome</span>
            <span className="font-semibold text-[#1F2937]">{nome}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#94A3B8]">E-mail</span>
            <span className="font-semibold text-[#1F2937]">{email}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#94A3B8]">Usuário/Login</span>
            <span className="font-technical font-semibold text-[#1F2937]">{usuario}</span>
          </div>
        </div>
        <div className="border-b border-[#FDE68A] bg-[#FFFBEB] px-5 py-2.5 text-[11px] text-[#92400E]">
          Uma senha temporária anterior, caso exista, deixará de ser válida.
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={confirming}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={confirming}>
            <Send size={14} />
            {confirming ? "Enviando..." : "Enviar acesso"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Confirmação forte por digitação — só exigida para exclusão em massa (2+ itens); exclusão
// individual usa UX mais simples (nome/CNPJ/ID visíveis já é confirmação suficiente).
const BULK_CONFIRM_THRESHOLD = 2;

function DeleteConfirmModal({
  items,
  onClose,
  onDone,
}: {
  items: CadastroFornecedor[];
  onClose: () => void;
  onDone: (result: AdminDeletionResult) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const isBulk = items.length >= BULK_CONFIRM_THRESHOLD;
  const confirmPhrase = `EXCLUIR ${items.length}`;
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = !isBulk || confirmText.trim().toUpperCase() === confirmPhrase;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [deleting, onClose]);

  async function confirmDelete() {
    // Duplo clique/duplo submit não pode disparar duas exclusões em paralelo.
    if (deleting || !canConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/administrativo/fornecedores/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: items.map((item) => item.id) }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) {
        onDone({
          requested: items.length, administrativeDeleted: 0, usersDeactivated: 0, usersDeleted: 0,
          professionalsDeleted: 0, professionalsPreservedForHistory: 0, measurementHistoryPreserved: 0,
          errors: [{ id: "-", error: payload?.error ?? "Não foi possível excluir os fornecedores selecionados." }],
        });
        return;
      }
      onDone(payload as AdminDeletionResult);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[480px] sm:max-w-[90vw]">
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">
            {isBulk ? `Excluir ${items.length} fornecedores definitivamente?` : "Excluir fornecedor definitivamente?"}
          </h2>
          <IconButton onClick={onClose} title="Fechar" disabled={deleting}><X size={16} /></IconButton>
        </div>
        <div className="grid gap-3 p-5 text-sm text-[#374151]">
          <p className="text-xs text-[#6B7280]">
            {isBulk
              ? "Os cadastros administrativos e acessos selecionados serão removidos. Registros históricos da Equipe de Medição serão preservados."
              : "O cadastro administrativo e o acesso deste fornecedor serão removidos. Informações históricas relacionadas a medições, BMs, pagamentos, notas fiscais e comprovantes serão preservadas."}
          </p>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-[#F8FAFC] p-2 ring-1 ring-[#E2E8F0]">
            {items.map((item) => (
              <div key={item.id} className="grid gap-0.5 border-b border-[#E5E7EB] px-1.5 py-1.5 text-xs last:border-0">
                <p className="font-semibold text-[#1F2937]">{displayText(item.responsavel)}</p>
                <p className="font-technical text-[11px] text-[#64748B]">CNPJ {item.cnpj ?? "-"} · ID {compactId(item.id)}</p>
              </div>
            ))}
          </div>
          {isBulk && (
            <label className="grid gap-1 text-xs font-semibold text-[#374151]">
              Digite <span className="font-technical text-[#AF1B1B]">{confirmPhrase}</span> para habilitar a exclusão
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={confirmPhrase} autoFocus />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={deleting}>Cancelar</Button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting || !canConfirm}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#DC2626] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={14} />
            {deleting ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<IdentityCandidateSummary["profissionalStatus"], string> = {
  ATIVO: "Ativo",
  EXCLUIDO: "Excluído",
  INEXISTENTE: "Inexistente",
};
const STATUS_TONE: Record<IdentityCandidateSummary["profissionalStatus"], string> = {
  ATIVO: "bg-[#EAF7ED] text-[#28A745]",
  EXCLUIDO: "bg-[#FFF1F1] text-[#DC3545]",
  INEXISTENTE: "bg-[#F3F4F6] text-[#6B7280]",
};

/**
 * Modal "Resolver identidade" — fluxo de resolução manual para linhas de importação que ficaram em
 * CONFLICT (colisão de hash — 2+ identidades históricas compatíveis) ou REQUIRES_REVIEW (excluída
 * sem nenhum código vinculado). Nunca escolhe um candidato sozinho: o ADMIN decide, com dados
 * reais (código, status de Profissional/Usuario, histórico) carregados do servidor.
 */
function ResolverIdentidadeModal({
  item,
  onClose,
  onResolved,
}: {
  item: ImportAtencaoDetalhe & { categoria: string };
  onClose: () => void;
  onResolved: (resultado: { created: boolean; recreated: boolean; colaboradorCodigo: string; usuarioCriado: unknown; usuarioReativado: { senha: string | null } | null }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [candidatos, setCandidatos] = useState<IdentityCandidateSummary[]>([]);
  const [selecionado, setSelecionado] = useState<{ tipo: "USAR_CANDIDATO"; codigo: string } | { tipo: "NENHUMA_IDENTIDADE" } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const res = await fetch("/api/admin/administrativo/fornecedores/candidatos-identidade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responsavel: item.responsavel }),
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setLoadError(payload.error ?? "Não foi possível carregar os candidatos."); return; }
        setCandidatos(payload.candidatos ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item.responsavel]);

  async function confirmar() {
    if (!selecionado || !item.linha || resolving) return;
    setResolving(true);
    setResolveError("");
    try {
      const res = await fetch("/api/admin/administrativo/fornecedores/resolver-identidade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linha: item.linha, escolha: selecionado }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { setResolveError(payload.error ?? "Não foi possível resolver esta identidade."); setConfirmando(false); return; }
      onResolved(payload);
    } finally {
      setResolving(false);
    }
  }

  const candidatoEscolhido = selecionado?.tipo === "USAR_CANDIDATO" ? candidatos.find((c) => c.codigo === selecionado.codigo) : null;
  const confirmPhraseNenhuma = "NENHUMA IDENTIDADE";
  const podeConfirmarNenhuma = selecionado?.tipo !== "NENHUMA_IDENTIDADE" || confirmText.trim().toUpperCase() === confirmPhraseNenhuma;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex max-h-[90vh] w-full flex-col overflow-hidden sm:w-[640px] sm:max-w-[92vw]">
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-[#1A1A1A]">{confirmando ? "Usar esta identidade?" : "Resolver identidade"}</h2>
            {!confirmando && <p className="mt-0.5 text-xs text-[#6B7280]">Encontramos mais de uma identidade histórica compatível com este registro. Selecione qual pessoa corresponde ao fornecedor importado.</p>}
          </div>
          <IconButton onClick={onClose} title="Fechar" disabled={resolving}><X size={16} /></IconButton>
        </div>

        <div className="grid gap-4 overflow-y-auto p-5 text-sm text-[#374151]">
          {!confirmando && (
            <div className="grid gap-1 rounded-lg bg-[#F8FAFC] p-3 ring-1 ring-[#E2E8F0]">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">Dados importados</p>
              <p><strong>Nome:</strong> {item.responsavel}</p>
              {item.linha?.cnpj && <p><strong>CNPJ:</strong> {item.linha.cnpj}</p>}
              {item.linha?.email && <p><strong>E-mail:</strong> {item.linha.email}</p>}
              {item.linha?.telefone && <p><strong>Telefone:</strong> {item.linha.telefone}</p>}
              {item.linha?.razaoSocial && <p><strong>Razão social:</strong> {item.linha.razaoSocial}</p>}
              {item.linha?.cargo && <p><strong>Função:</strong> {item.linha.cargo}</p>}
            </div>
          )}

          {!confirmando && loading && <p className="text-xs text-[#6B7280]">Carregando candidatos…</p>}
          {!confirmando && loadError && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{loadError}</p>}

          {!confirmando && !loading && !loadError && (
            <div className="grid gap-3">
              {candidatos.map((c, idx) => (
                <div key={c.codigo} className="grid gap-1.5 rounded-lg border border-[#E5E7EB] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">Candidato {String.fromCharCode(65 + idx)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[c.profissionalStatus]}`}>Profissional {STATUS_LABELS[c.profissionalStatus]}</span>
                  </div>
                  <p><strong>Nome:</strong> {c.nomeCompleto || c.nomeAtual || "-"}</p>
                  <p><strong>Código canônico:</strong> <span className="font-technical">{c.codigo}</span></p>
                  {c.email && <p><strong>E-mail:</strong> {c.email}</p>}
                  {c.cnpj && <p><strong>CNPJ:</strong> {c.cnpj}</p>}
                  <p>
                    <strong>Usuario:</strong>{" "}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[c.usuarioStatus]}`}>{STATUS_LABELS[c.usuarioStatus]}</span>
                    {c.usuarioLogin ? ` (${c.usuarioLogin})` : ""}
                  </p>
                  <p className="text-xs text-[#6B7280]">
                    <strong>Histórico:</strong> {c.historico.sgc} SGC · {c.historico.mapaPagamento} pagamento(s) · {c.historico.medicao} medição(ões) · {c.historico.divergencias} divergência(s)
                  </p>
                  <div className="mt-1 flex justify-end">
                    <Button variant="secondary" onClick={() => { setSelecionado({ tipo: "USAR_CANDIDATO", codigo: c.codigo }); setConfirmando(true); }}>
                      Usar esta identidade
                    </Button>
                  </div>
                </div>
              ))}

              <div className="grid gap-1.5 rounded-lg border border-dashed border-[#D1D5DB] p-3">
                <p className="text-xs font-semibold text-[#374151]">Nenhuma dessas identidades</p>
                <p className="text-xs text-[#6B7280]">Esta é uma pessoa diferente dos candidatos históricos acima — cria uma identidade nova, só quando for tecnicamente seguro.</p>
                <div className="mt-1 flex justify-end">
                  <Button variant="secondary" onClick={() => { setSelecionado({ tipo: "NENHUMA_IDENTIDADE" }); setConfirmando(true); }}>
                    Nenhuma dessas identidades
                  </Button>
                </div>
              </div>
            </div>
          )}

          {confirmando && (
            <div className="grid gap-3">
              {resolveError && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C]">{resolveError}</p>}
              <p><strong>Registro importado:</strong> {item.responsavel}</p>
              {selecionado?.tipo === "USAR_CANDIDATO" ? (
                <p>
                  <strong>Será associado a:</strong> {candidatoEscolhido?.nomeCompleto || candidatoEscolhido?.nomeAtual || selecionado.codigo}
                  <br />
                  <strong>Código:</strong> <span className="font-technical">{selecionado.codigo}</span>
                </p>
              ) : (
                <div className="grid gap-2">
                  <p className="rounded-lg bg-[#FFFBEB] px-3 py-2 text-xs font-semibold text-[#92400E]">
                    Uma identidade NOVA será criada para "{item.responsavel}". Esta ação só é permitida quando não colide com nenhum código histórico existente — o servidor valida isso antes de confirmar.
                  </p>
                  <label className="grid gap-1 text-xs font-semibold text-[#374151]">
                    Digite <span className="font-technical text-[#AF1B1B]">{confirmPhraseNenhuma}</span> para confirmar
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={confirmPhraseNenhuma} autoFocus />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
          <Button variant="secondary" onClick={confirmando ? () => { setConfirmando(false); setResolveError(""); } : onClose} disabled={resolving}>
            {confirmando ? "Voltar" : "Cancelar"}
          </Button>
          {confirmando && (
            <button
              type="button"
              onClick={confirmar}
              disabled={resolving || !podeConfirmarNenhuma}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resolving ? "Confirmando..." : "Confirmar identidade"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Dropdown compacto "Filtros" — substitui as antigas linhas de botões (Tipo + Situação cadastral)
 * por um único controle, seguindo o mesmo padrão de painel flutuante já usado no projeto (ref +
 * listener de `mousedown` para fechar ao clicar fora — ver `ComentarioDropdown` em
 * components/mapa-pagamento-table.tsx). Dois grupos lógicos: USUÁRIOS (Tipo/Perfil/Acesso, valem
 * para fornecedor e funcionário) e FORNECEDORES (Situação cadastral, só fornecedor).
 */

/**
 * Confirmação curta no próprio app (substitui o `window.confirm` do navegador) — mesmo padrão
 * visual dos demais modais de confirmação deste arquivo.
 */
function ConfirmAcaoModal({
  titulo,
  mensagem,
  confirmar,
  tone,
  confirming,
  onCancel,
  onConfirm,
}: {
  titulo: string;
  mensagem: ReactNode;
  confirmar: string;
  tone?: "danger";
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !confirming) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, onCancel]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-2 backdrop-blur-[1px] sm:p-4">
      <div className="ds-dialog flex w-full flex-col overflow-hidden sm:w-[420px] sm:max-w-[90vw]" role="alertdialog" aria-modal="true" aria-label={titulo}>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-bold text-[var(--foreground)]">{titulo}</h2>
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">{mensagem}</div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="secondary" onClick={onCancel} disabled={confirming}>Cancelar</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={confirming}>
            {confirming ? "Aguarde..." : confirmar}
          </Button>
        </div>
      </div>
    </div>
  );
}

type Aba = "fornecedores" | "funcionarios";
type StatusFiltro = "ativos" | "inativos" | "todos";

/** Filtros secundários (popover discreto) — a toolbar fica só com busca + status. */
function FiltrosPopover({
  aba,
  fonte,
  onFonte,
  condicao,
  onCondicao,
  situacao,
  onToggleSituacao,
  acesso,
  onToggleAcesso,
  perfil,
  onPerfil,
  activeCount,
  onClear,
}: {
  aba: Aba;
  fonte: string;
  onFonte: (value: string) => void;
  condicao: string;
  onCondicao: (value: string) => void;
  situacao: Set<SituacaoOpcao>;
  onToggleSituacao: (value: SituacaoOpcao) => void;
  acesso: Set<AcessoOpcao>;
  onToggleAcesso: (value: AcessoOpcao) => void;
  perfil: string;
  onPerfil: (value: string) => void;
  activeCount: number;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const posicao = useViewportAlign(ref, painelRef, open, "right");

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div className="relative shrink-0" ref={ref}>
      <FilterButton count={activeCount} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div ref={painelRef} style={posicao} className="absolute right-0 top-10 z-40 grid w-[300px] max-w-[88vw] gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-label text-[var(--muted-foreground)]">Filtros</p>
            <button type="button" onClick={() => setOpen(false)} title="Fechar" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#374151]">
              <X size={12} />
            </button>
          </div>
          {aba === "fornecedores" ? (
            <>
              <label className="grid gap-1 text-xs text-[var(--foreground)]">
                Fonte de medição
                <Select value={fonte} onChange={(e) => onFonte(e.target.value)} aria-label="Fonte de medição">
                  <option value="">Todas</option>
                  <option value="DOCUMENTOS">Documentos</option>
                  <option value="DOCUMENTOS_AUXILIARES">Documentos auxiliares</option>
                </Select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--foreground)]">
                Tipo de condição
                <Select value={condicao} onChange={(e) => onCondicao(e.target.value)} aria-label="Tipo de condição">
                  <option value="">Todas</option>
                  <option value="FIXA">Fixa</option>
                  <option value="CONDICIONAL_PRODUCAO">Condicional por produção</option>
                </Select>
              </label>
              <div>
                <p className="mb-1 text-xs text-[var(--foreground)]">Vigência</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["validos", "vencidos", "vencendo", "pendencias"] as SituacaoOpcao[]).map((value) => (
                    <label key={value} className="flex items-center gap-2 text-xs text-[#374151]">
                      <input type="checkbox" checked={situacao.has(value)} onChange={() => onToggleSituacao(value)} className="accent-[var(--primary)]" />
                      {SITUACAO_LABELS[value]}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-[var(--foreground)]">Acesso ao portal</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(["ativo", "inativo"] as AcessoOpcao[]).map((value) => (
                    <label key={value} className="flex items-center gap-1.5 text-xs text-[#374151]">
                      <input type="checkbox" checked={acesso.has(value)} onChange={() => onToggleAcesso(value)} className="accent-[var(--primary)]" />
                      {ACESSO_LABELS[value]}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <label className="grid gap-1 text-xs text-[var(--foreground)]">
              Perfil
              <Select value={perfil} onChange={(e) => onPerfil(e.target.value)} aria-label="Perfil">
                <option value="todos">Todos os perfis</option>
                {PERFIL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </label>
          )}
          <div className="flex justify-between border-t border-[var(--border)] pt-3">
            <button type="button" onClick={onClear} className="text-xs font-semibold text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]">Limpar filtros</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-[var(--primary)]">Concluído</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Painel =
  | { tipo: "fornecedor"; id: string; modo: "detalhe" | "edicao" }
  | { tipo: "novo-fornecedor" }
  | { tipo: "funcionario"; id: string }
  | { tipo: "novo-funcionario" }
  | { tipo: "importar" };

type Confirmacao = { titulo: string; mensagem: ReactNode; confirmar: string; tone?: "danger"; acao: () => Promise<void> };

/**
 * Administrativo — cadastro mestre e configuração (a operação diária fica em /fornecedores).
 * Listagem limpa (tabela; lista compacta no mobile) → linha abre o painel lateral de detalhe →
 * Editar cadastro troca o MESMO painel para o formulário → Salvar volta ao detalhe. "Novo fornecedor"
 * usa o mesmo editor em modo create. Endpoints, payloads, validações e permissões são os de antes:
 * visualizar/editar/cadastrar fornecedor = quem acessa a tela; inativar/reativar, exclusão
 * definitiva, ações de acesso e gestão de funcionários = ADMIN (isAdmin).
 */
export function AdministrativoPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [items, setItems] = useState<CadastroFornecedor[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resolverItem, setResolverItem] = useState<(ImportAtencaoDetalhe & { categoria: string }) | null>(null);

  const [aba, setAba] = useState<Aba>("fornecedores");
  const [search, setSearch] = useState("");
  // Mesmo padrão de antes: inativos ocultos por padrão entre fornecedores; funcionários todos.
  const [statusFornecedor, setStatusFornecedor] = useState<StatusFiltro>("ativos");
  const [statusFuncionario, setStatusFuncionario] = useState<StatusFiltro>("todos");
  const [fonteFiltro, setFonteFiltro] = useState("");
  const [condicaoFiltro, setCondicaoFiltro] = useState("");
  const [perfilFiltro, setPerfilFiltro] = useState("todos");
  const [acessoFiltro, setAcessoFiltro] = useState<Set<AcessoOpcao>>(new Set());
  const [situacaoFiltro, setSituacaoFiltro] = useState<Set<SituacaoOpcao>>(new Set());

  const [painel, setPainel] = useState<Painel | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // Credencial (senha temporária) exibida SOMENTE logo após criar usuário ou redefinir senha —
  // vive só neste estado em memória, nunca é persistida, e some ao fechar o modal.
  const [credencial, setCredencial] = useState<{ titulo: string; nome: string; email: string | null; usuario?: string; senha: string } | null>(null);
  const [resetSenhaTarget, setResetSenhaTarget] = useState<{ usuarioId: string; nome: string; email: string | null } | null>(null);
  const [resettingSenha, setResettingSenha] = useState(false);
  const [primeiroAcessoTarget, setPrimeiroAcessoTarget] = useState<{ usuarioId: string; nome: string; email: string; usuario: string; requestId: string } | null>(null);
  const [enviandoPrimeiroAcesso, setEnviandoPrimeiroAcesso] = useState(false);
  const [perfilTarget, setPerfilTarget] = useState<{ usuarioId: string; nome: string; perfilAtual: string } | null>(null);
  const [permissoesTarget, setPermissoesTarget] = useState<{ usuarioId: string; nome: string; perfil: string; permissoesAtuais: string[] } | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Exclusão individual (Zona de risco do detalhe) e em massa (seleção) — mesmo modal/endpoint.
  const [deleteTargets, setDeleteTargets] = useState<CadastroFornecedor[] | null>(null);
  // Envio de primeiro acesso em lote: snapshot da seleção no momento da confirmação.
  const [primeiroAcessoLote, setPrimeiroAcessoLote] = useState<CadastroFornecedor[] | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const [resFornecedores, resFuncionarios] = await Promise.all([
      fetch("/api/admin/administrativo/fornecedores?includeInactive=true"),
      fetch("/api/admin/administrativo/funcionarios"),
    ]);
    if (resFornecedores.ok) {
      const data: CadastroFornecedor[] = await resFornecedores.json();
      setItems(data);
      // Nunca mantém selecionado um ID que não existe mais na listagem.
      const validIds = new Set(data.map((item) => item.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => validIds.has(id))));
    }
    if (resFuncionarios.ok) setFuncionarios(await resFuncionarios.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const fornecedorAberto = painel?.tipo === "fornecedor" ? items.find((item) => item.id === painel.id) ?? null : null;
  const funcionarioAberto = painel?.tipo === "funcionario" ? funcionarios.find((item) => item.id === painel.id) ?? null : null;

  // Cadastro removido (exclusão, outra sessão) enquanto o detalhe estava aberto → fecha o painel.
  useEffect(() => {
    if (loading) return;
    if ((painel?.tipo === "fornecedor" && !fornecedorAberto) || (painel?.tipo === "funcionario" && !funcionarioAberto)) setPainel(null);
  }, [loading, painel, fornecedorAberto, funcionarioAberto]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    return items.filter((item) => {
      if (statusFornecedor === "ativos" && !item.ativo) return false;
      if (statusFornecedor === "inativos" && item.ativo) return false;
      const matchesSearch = !q
        || [item.responsavel, item.razaoSocial, item.cnpj, item.colaboradorCodigo, item.email].some((value) => value?.toLowerCase().includes(q))
        || (qDigits.length >= 4 && item.cnpjNormalizado.includes(qDigits));
      const matchesFonte = !fonteFiltro || normalizeFonteMedicao(item.fonteMedicao) === fonteFiltro;
      const matchesCondicao = !condicaoFiltro || normalizeTipoCondicaoFixa(item.tipoCondicaoFixa) === condicaoFiltro;
      const matchesAcesso = acessoFiltro.size === 0
        ? true
        : item.acesso
          ? (acessoFiltro.has("ativo") && item.acesso.ativo) || (acessoFiltro.has("inativo") && !item.acesso.ativo)
          : false;
      // Mesma regra atual (cadastroStatusVisual, baseada em Início/Fim) — "Próximo do vencimento"
      // continua sendo dias<=30, sem nova lógica de datas.
      const matchesSituacao = situacaoFiltro.size === 0 ||
        (situacaoFiltro.has("validos") && item.validadeTone === "success") ||
        (situacaoFiltro.has("vencidos") && item.diasAteVencimento !== null && item.diasAteVencimento < 0) ||
        (situacaoFiltro.has("vencendo") && item.diasAteVencimento !== null && item.diasAteVencimento >= 0 && item.diasAteVencimento <= 30) ||
        (situacaoFiltro.has("pendencias") && item.pendencias.length > 0);
      return matchesSearch && matchesFonte && matchesCondicao && matchesAcesso && matchesSituacao;
    }).sort((a, b) => a.responsavel.localeCompare(b.responsavel, "pt-BR"));
  }, [items, search, statusFornecedor, fonteFiltro, condicaoFiltro, acessoFiltro, situacaoFiltro]);

  const filteredFuncionarios = useMemo(() => {
    const q = search.trim().toLowerCase();
    return funcionarios.filter((f) => {
      if (statusFuncionario === "ativos" && !f.ativo) return false;
      if (statusFuncionario === "inativos" && f.ativo) return false;
      const matchesSearch = !q || [f.nome, f.email, f.usuario].some((value) => value?.toLowerCase().includes(q));
      const matchesPerfil = perfilFiltro === "todos" || f.perfil === perfilFiltro;
      return matchesSearch && matchesPerfil;
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [funcionarios, search, statusFuncionario, perfilFiltro]);

  function toggleAcessoFiltro(value: AcessoOpcao) {
    setAcessoFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleSituacaoFiltro(value: SituacaoOpcao) {
    setSituacaoFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function limparFiltros() {
    setFonteFiltro("");
    setCondicaoFiltro("");
    setPerfilFiltro("todos");
    setAcessoFiltro(new Set());
    setSituacaoFiltro(new Set());
  }

  const filtroChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (aba === "fornecedores") {
      if (fonteFiltro) chips.push({ key: "fonte", label: fonteFiltro === "DOCUMENTOS_AUXILIARES" ? "Documentos auxiliares" : "Documentos", onRemove: () => setFonteFiltro("") });
      if (condicaoFiltro) chips.push({ key: "condicao", label: condicaoFiltro === "CONDICIONAL_PRODUCAO" ? "Condicional" : "Fixa", onRemove: () => setCondicaoFiltro("") });
      for (const value of situacaoFiltro) chips.push({ key: `situacao-${value}`, label: SITUACAO_LABELS[value], onRemove: () => toggleSituacaoFiltro(value) });
      for (const value of acessoFiltro) chips.push({ key: `acesso-${value}`, label: `Acesso: ${ACESSO_LABELS[value]}`, onRemove: () => toggleAcessoFiltro(value) });
    } else if (perfilFiltro !== "todos") {
      chips.push({ key: "perfil", label: PERFIL_LABEL[perfilFiltro] ?? perfilFiltro, onRemove: () => setPerfilFiltro("todos") });
    }
    return chips;
  }, [aba, fonteFiltro, condicaoFiltro, situacaoFiltro, acessoFiltro, perfilFiltro]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));
  // A seleção sobrevive à troca de filtro/busca; ações em massa operam sobre TODA a seleção real.
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const someFilteredSelected = filtered.some((item) => selectedIds.has(item.id));
  // A seleção sobrevive a filtro/busca — a barra diz quantos selecionados estão fora da visualização.
  const filteredIds = new Set(filtered.map((item) => item.id));
  const selecionadosOcultos = selectedItems.filter((item) => !filteredIds.has(item.id)).length;
  const aptosPrimeiroAcesso = selectedItems.filter((item) => avaliarElegibilidadePrimeiroAcesso(item.acesso, item.email).elegivel).length;
  const pendencias = items.filter((item) => item.pendencias.length > 0);

  const algumModalAberto = Boolean(
    confirmacao || credencial || resetSenhaTarget || primeiroAcessoTarget || perfilTarget || permissoesTarget || deleteTargets || resolverItem || primeiroAcessoLote,
  );

  function pedirResetSenha(usuarioId: string, nome: string, email: string | null) {
    setResetSenhaTarget({ usuarioId, nome, email });
  }

  async function confirmarResetSenha() {
    if (!resetSenhaTarget) return;
    const { usuarioId, nome, email } = resetSenhaTarget;
    setResettingSenha(true);
    try {
      const res = await fetch(`/api/admin/usuarios/${usuarioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_senha" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetSenhaTarget(null);
        setToast({ tone: "error", message: payload.error ?? "Não foi possível redefinir a senha." });
        return;
      }
      // A senha só existe nesta resposta — mostrada no CredencialModal, nunca persistida.
      setResetSenhaTarget(null);
      setCredencial({ titulo: "Senha redefinida com sucesso", nome, email, senha: payload.senhaTemporaria });
      await load();
    } finally {
      setResettingSenha(false);
    }
  }

  function pedirPrimeiroAcesso(usuarioId: string, nome: string, email: string | null, usuario: string) {
    if (!email) {
      setToast({ tone: "error", message: "Este usuário não possui e-mail cadastrado." });
      return;
    }
    // requestId gerado UMA VEZ ao abrir a confirmação (o backend serializa por usuarioId+requestId).
    setPrimeiroAcessoTarget({ usuarioId, nome, email, usuario, requestId: crypto.randomUUID() });
  }

  async function confirmarPrimeiroAcesso() {
    if (!primeiroAcessoTarget) return;
    const { usuarioId, email, requestId } = primeiroAcessoTarget;
    setEnviandoPrimeiroAcesso(true);
    try {
      const res = await fetch(`/api/admin/usuarios/${usuarioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enviar_primeiro_acesso", requestId }),
      });
      const payload = await res.json().catch(() => ({}));
      setPrimeiroAcessoTarget(null);
      if (!res.ok) {
        setToast({ tone: "error", message: payload.error ?? "Não foi possível enviar o primeiro acesso." });
        await load();
        return;
      }
      setToast({ tone: "success", message: `Acesso enviado para ${email}.` });
      await load();
    } finally {
      setEnviandoPrimeiroAcesso(false);
    }
  }

  async function toggleAtivoUsuario(usuarioId: string, ativoAtual: boolean) {
    const res = await fetch(`/api/admin/usuarios/${usuarioId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_ativo" }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setToast({ tone: "error", message: payload.error ?? "Não foi possível alterar o acesso." });
      return;
    }
    setToast({ tone: "success", message: ativoAtual ? "Acesso desativado." : "Acesso ativado." });
    await load();
  }

  function pedirSetCadastroAtivo(item: CadastroFornecedor) {
    const acao = item.ativo ? "inativar" : "reativar";
    setConfirmacao({
      titulo: item.ativo ? "Inativar fornecedor" : "Reativar fornecedor",
      mensagem: item.ativo
        ? <>Deseja inativar <strong className="text-[var(--foreground)]">{item.responsavel}</strong>? O cadastro e o acesso ao portal ficam inativos; o histórico e a identidade operacional são preservados.</>
        : <>Deseja reativar <strong className="text-[var(--foreground)]">{item.responsavel}</strong>? O cadastro e o acesso ao portal voltam a ficar ativos.</>,
      confirmar: item.ativo ? "Inativar fornecedor" : "Reativar fornecedor",
      acao: async () => {
        const res = await fetch("/api/admin/administrativo/fornecedores/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [item.id], ativo: !item.ativo }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToast({ tone: "error", message: payload.error ?? `Não foi possível ${acao} o fornecedor.` });
          return;
        }
        setToast({ tone: "success", message: item.ativo ? "Fornecedor inativado." : "Fornecedor reativado." });
        await load();
      },
    });
  }

  function pedirExcluirFuncionario(usuarioId: string, nome: string) {
    setConfirmacao({
      titulo: "Excluir funcionário",
      mensagem: <>Excluir o funcionário <strong className="text-[var(--foreground)]">{nome}</strong>? Ele perderá acesso, mas o histórico será preservado.</>,
      confirmar: "Excluir funcionário",
      tone: "danger",
      acao: async () => {
        const res = await fetch(`/api/admin/usuarios/${usuarioId}`, { method: "DELETE" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToast({ tone: "error", message: payload.error ?? "Não foi possível excluir o funcionário." });
          return;
        }
        setToast({ tone: "success", message: "Funcionário excluído." });
        setPainel(null);
        await load();
      },
    });
  }

  async function executarConfirmacao() {
    if (!confirmacao) return;
    setConfirmando(true);
    try {
      await confirmacao.acao();
    } finally {
      setConfirmando(false);
      setConfirmacao(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filtered) {
        if (allFilteredSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function handleDeletionDone(resultado: AdminDeletionResult) {
    setDeleteTargets(null);
    clearSelection();
    // Identidade histórica preservada NUNCA é apresentada como erro — é o resultado esperado.
    const partes: string[] = [];
    if (resultado.administrativeDeleted > 0) partes.push(`${resultado.administrativeDeleted} cadastro(s) administrativo(s) removido(s)`);
    if (resultado.professionalsPreservedForHistory > 0) {
      partes.push(`${resultado.professionalsPreservedForHistory} identidade(s) histórica(s) preservada(s) por possuírem registros de medição`);
    }
    if (resultado.errors.length > 0) partes.push(`${resultado.errors.length} falharam por erro técnico`);
    const mensagem = partes.length > 0 ? `${partes.join(". ")}.` : "Nenhum fornecedor foi excluído.";
    setToast({ tone: resultado.errors.length === 0 ? "success" : "error", message: mensagem });
    load();
  }

  function handleIdentidadeResolvida(resultado: { created: boolean; recreated: boolean; colaboradorCodigo: string; usuarioCriado: unknown; usuarioReativado: { senha: string | null } | null }) {
    const resolvido = resolverItem;
    setResolverItem(null);
    setResult((prev) => {
      if (!prev || !resolvido) return prev;
      const removerPorResponsavel = (lista: ImportAtencaoDetalhe[]) => lista.filter((d) => d.responsavel !== resolvido.responsavel);
      return {
        ...prev,
        conflitos: resolvido.categoria === "Identidade ambígua" ? Math.max(0, prev.conflitos - 1) : prev.conflitos,
        conflitosDetalhe: resolvido.categoria === "Identidade ambígua" ? removerPorResponsavel(prev.conflitosDetalhe) : prev.conflitosDetalhe,
        revisao: resolvido.categoria === "Requer revisão" ? Math.max(0, prev.revisao - 1) : prev.revisao,
        revisaoDetalhe: resolvido.categoria === "Requer revisão" ? removerPorResponsavel(prev.revisaoDetalhe) : prev.revisaoDetalhe,
        recriados: resultado.recreated ? prev.recriados + 1 : prev.recriados,
        criados: resultado.created && !resultado.recreated ? prev.criados + 1 : prev.criados,
        atualizados: !resultado.created ? prev.atualizados + 1 : prev.atualizados,
        usuariosCriados: resultado.usuarioCriado ? prev.usuariosCriados + 1 : prev.usuariosCriados,
        usuariosReativados: resultado.usuarioReativado ? prev.usuariosReativados + 1 : prev.usuariosReativados,
        senhasTemporarias: resultado.usuarioReativado?.senha
          ? [...prev.senhasTemporarias, { usuario: "", nome: resolvido.responsavel, senha: resultado.usuarioReativado.senha, email: null }]
          : prev.senhasTemporarias,
      };
    });
    setToast({ tone: "success", message: `Identidade de "${resolvido?.responsavel}" resolvida — código ${resultado.colaboradorCodigo}.` });
    load();
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/administrativo/fornecedores", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) {
      setError(payload.error ?? "Não foi possível importar a planilha.");
      return;
    }
    setResult(payload);
    setFile(null);
    await load();
  }

  const criarFuncionario = aba === "funcionarios" && isAdmin;
  const totalAba = aba === "fornecedores" ? items.length : funcionarios.length;
  const visiveisAba = aba === "fornecedores" ? filtered.length : filteredFuncionarios.length;
  const status = aba === "fornecedores" ? statusFornecedor : statusFuncionario;
  const setStatus = aba === "fornecedores" ? setStatusFornecedor : setStatusFuncionario;

  return (
    <PageContainer className="grid w-full gap-6 pb-24">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end">
        <PageHeader eyebrow="Cadastro" title="Administrativo" description="Gerencie cadastros e configurações dos fornecedores." />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <IconButton onClick={load} title="Atualizar" disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </IconButton>
          <Button variant="secondary" onClick={() => setPainel({ tipo: "importar" })}>
            <FileSpreadsheet size={15} />
            Importar Consulta PJ
          </Button>
          <Button onClick={() => setPainel({ tipo: criarFuncionario ? "novo-funcionario" : "novo-fornecedor" })}>
            <Plus size={15} />
            {criarFuncionario ? "Novo funcionário" : "Novo fornecedor"}
          </Button>
        </div>
      </div>

      <AdministrativoKpis items={items} loading={loading} />

      {pendencias.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#f2dbb7] bg-[var(--warning-soft)] px-4 py-2.5 text-[13px] text-[#92400E]">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {pendencias.length === 1 ? "1 fornecedor com pendência cadastral (bloqueia envio de NF)." : `${pendencias.length} fornecedores com pendências cadastrais (bloqueiam envio de NF).`}
          </span>
          <button
            type="button"
            onClick={() => { setAba("fornecedores"); setStatusFornecedor("todos"); setSituacaoFiltro(new Set(["pendencias"])); }}
            className="text-[12px] font-semibold underline underline-offset-2"
          >
            Ver pendências
          </button>
        </div>
      )}

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div role="tablist" aria-label="Tipo de cadastro" className="flex gap-5">
            {([
              ["fornecedores", "Fornecedores", items.length],
              ["funcionarios", "Funcionários", funcionarios.length],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={aba === value}
                onClick={() => { setAba(value); clearSelection(); }}
                className={`border-b-2 pb-2.5 pt-1 text-sm transition xl:-mb-3 ${aba === value ? "border-[var(--primary)] font-semibold text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >
                {label} <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{count}</span>
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <span className="relative min-w-0 sm:w-[340px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#9CA3AF]" size={14} />
              <Input
                className="pl-8"
                aria-label="Buscar cadastros"
                placeholder={aba === "fornecedores" ? "Buscar por nome, e-mail, razão social ou CNPJ..." : "Buscar por nome, e-mail ou login..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </span>
            <div className="flex items-center gap-2">
              <div className="w-[130px] shrink-0">
                <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFiltro)} aria-label="Status">
                  <option value="ativos">Ativos</option>
                  <option value="inativos">Inativos</option>
                  <option value="todos">Todos</option>
                </Select>
              </div>
              <FiltrosPopover
              aba={aba}
              fonte={fonteFiltro}
              onFonte={setFonteFiltro}
              condicao={condicaoFiltro}
              onCondicao={setCondicaoFiltro}
              situacao={situacaoFiltro}
              onToggleSituacao={toggleSituacaoFiltro}
              acesso={acessoFiltro}
              onToggleAcesso={toggleAcessoFiltro}
              perfil={perfilFiltro}
              onPerfil={setPerfilFiltro}
              activeCount={filtroChips.length}
              onClear={limparFiltros}
            />
            </div>
          </div>
        </div>

        {filtroChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-5 py-2.5">
            {filtroChips.map((chip) => <FilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />)}
          </div>
        )}

        {isAdmin && aba === "fornecedores" && (
          <BulkSelectionBar
            count={selectedItems.length}
            singular="fornecedor selecionado"
            plural="fornecedores selecionados"
            onClear={clearSelection}
            detail={
              <>
                <span data-testid="bulk-aptos-primeiro-acesso">
                  {aptosPrimeiroAcesso === 1 ? "1 apto ao primeiro acesso" : `${aptosPrimeiroAcesso} aptos ao primeiro acesso`}
                </span>
                {selecionadosOcultos > 0 && (
                  <span> · {selecionadosOcultos === 1 ? "1 selecionado fora da visualização atual" : `${selecionadosOcultos} selecionados fora da visualização atual`}</span>
                )}
              </>
            }
          >
            <Button variant="danger" onClick={() => setDeleteTargets(selectedItems)}>
              <Trash2 size={13} />
              Excluir definitivamente
            </Button>
            <Button onClick={() => setPrimeiroAcessoLote(selectedItems)}>
              <Send size={13} />
              Enviar primeiro acesso
            </Button>
          </BulkSelectionBar>
        )}

        {loading && totalAba === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Carregando cadastros...</div>
        ) : totalAba === 0 ? (
          <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">{aba === "fornecedores" ? "Nenhum fornecedor cadastrado." : "Nenhum funcionário cadastrado."}</p>
            {(aba === "fornecedores" || isAdmin) && (
              <Button onClick={() => setPainel({ tipo: aba === "fornecedores" ? "novo-fornecedor" : "novo-funcionario" })}>
                <Plus size={15} />
                {aba === "fornecedores" ? "Novo fornecedor" : "Novo funcionário"}
              </Button>
            )}
          </div>
        ) : visiveisAba === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">Nenhum cadastro encontrado com os filtros aplicados.</div>
        ) : aba === "fornecedores" ? (
          <FornecedoresCadastroTable
            itens={filtered}
            isAdmin={isAdmin}
            selectedIds={selectedIds}
            allSelected={allFilteredSelected}
            someSelected={someFilteredSelected}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleSelectAllFiltered}
            onOpen={(item) => setPainel({ tipo: "fornecedor", id: item.id, modo: "detalhe" })}
          />
        ) : (
          <FuncionariosTable itens={filteredFuncionarios} onOpen={(item) => setPainel({ tipo: "funcionario", id: item.id })} />
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted-foreground)]">
          <span>
            {visiveisAba === totalAba ? `${totalAba} ${aba === "fornecedores" ? "fornecedores" : "funcionários"}` : `${visiveisAba} de ${totalAba} ${aba === "fornecedores" ? "fornecedores" : "funcionários"}`}
          </span>
          {loading && totalAba > 0 && <span>Atualizando…</span>}
        </div>
      </Card>

      {painel?.tipo === "fornecedor" && fornecedorAberto && painel.modo === "detalhe" && (
        <FornecedorDetalhe
          item={fornecedorAberto}
          isAdmin={isAdmin}
          escEnabled={!algumModalAberto}
          onClose={() => setPainel(null)}
          onEdit={() => setPainel({ tipo: "fornecedor", id: fornecedorAberto.id, modo: "edicao" })}
          onToggleAtivo={() => pedirSetCadastroAtivo(fornecedorAberto)}
          onDelete={() => setDeleteTargets([fornecedorAberto])}
          onResetSenha={() => fornecedorAberto.acesso && pedirResetSenha(fornecedorAberto.acesso.id, fornecedorAberto.responsavel, fornecedorAberto.acesso.email)}
          onPrimeiroAcesso={() => fornecedorAberto.acesso && pedirPrimeiroAcesso(fornecedorAberto.acesso.id, fornecedorAberto.responsavel, fornecedorAberto.acesso.email, fornecedorAberto.acesso.usuario)}
        />
      )}

      {painel?.tipo === "fornecedor" && fornecedorAberto && painel.modo === "edicao" && (
        <FornecedorEditor
          key={fornecedorAberto.id}
          mode="edit"
          item={fornecedorAberto}
          escEnabled={!algumModalAberto}
          onClose={() => setPainel(null)}
          onBack={() => setPainel({ tipo: "fornecedor", id: fornecedorAberto.id, modo: "detalhe" })}
          onSaved={async () => {
            setPainel({ tipo: "fornecedor", id: fornecedorAberto.id, modo: "detalhe" });
            setToast({ tone: "success", message: "Fornecedor atualizado com sucesso." });
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {painel?.tipo === "novo-fornecedor" && (
        <FornecedorEditor
          mode="create"
          escEnabled={!algumModalAberto}
          onClose={() => setPainel(null)}
          onCreated={async (usuarioCriado) => {
            setPainel(null);
            if (usuarioCriado) {
              // Usuario novo (COLABORADOR) criado junto do cadastro — senha automática exibida uma vez.
              setCredencial({ titulo: "Fornecedor cadastrado com sucesso", nome: usuarioCriado.nome, email: usuarioCriado.email, usuario: usuarioCriado.usuario, senha: usuarioCriado.senha });
            } else {
              setToast({ tone: "success", message: "Fornecedor cadastrado com sucesso." });
            }
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {painel?.tipo === "funcionario" && funcionarioAberto && (
        <FuncionarioDetalhe
          item={funcionarioAberto}
          isAdmin={isAdmin}
          escEnabled={!algumModalAberto}
          onClose={() => setPainel(null)}
          onResetSenha={() => pedirResetSenha(funcionarioAberto.id, funcionarioAberto.nome, funcionarioAberto.email)}
          onPrimeiroAcesso={() => pedirPrimeiroAcesso(funcionarioAberto.id, funcionarioAberto.nome, funcionarioAberto.email, funcionarioAberto.usuario)}
          onToggleAtivo={() => toggleAtivoUsuario(funcionarioAberto.id, funcionarioAberto.ativo)}
          onSetPerfil={() => setPerfilTarget({ usuarioId: funcionarioAberto.id, nome: funcionarioAberto.nome, perfilAtual: funcionarioAberto.perfil })}
          onGerenciarPermissoes={() => setPermissoesTarget({ usuarioId: funcionarioAberto.id, nome: funcionarioAberto.nome, perfil: funcionarioAberto.perfil, permissoesAtuais: funcionarioAberto.permissoesExtras })}
          onExcluir={() => pedirExcluirFuncionario(funcionarioAberto.id, funcionarioAberto.nome)}
        />
      )}

      {painel?.tipo === "novo-funcionario" && isAdmin && (
        <FuncionarioCreatePanel
          escEnabled={!algumModalAberto}
          onClose={() => setPainel(null)}
          onCreated={async (usuario) => {
            setPainel(null);
            if (usuario.senhaTemporaria) {
              setCredencial({ titulo: "Funcionário criado com sucesso", nome: usuario.nome, email: usuario.email, usuario: usuario.usuario, senha: usuario.senhaTemporaria });
            } else {
              setToast({ tone: "success", message: "Funcionário cadastrado com sucesso." });
            }
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {painel?.tipo === "importar" && (
        <ImportarConsultaPanel
          file={file}
          onFileChange={setFile}
          uploading={uploading}
          error={error}
          result={result}
          isAdmin={isAdmin}
          escEnabled={!algumModalAberto}
          onUpload={upload}
          onResolver={setResolverItem}
          onClose={() => setPainel(null)}
        />
      )}

      {confirmacao && (
        <ConfirmAcaoModal
          titulo={confirmacao.titulo}
          mensagem={confirmacao.mensagem}
          confirmar={confirmacao.confirmar}
          tone={confirmacao.tone}
          confirming={confirmando}
          onCancel={() => setConfirmacao(null)}
          onConfirm={executarConfirmacao}
        />
      )}

      {credencial && (
        <CredencialModal
          titulo={credencial.titulo}
          nome={credencial.nome}
          email={credencial.email}
          usuario={credencial.usuario}
          senha={credencial.senha}
          onClose={() => setCredencial(null)}
        />
      )}

      {resetSenhaTarget && (
        <ConfirmResetSenhaModal nome={resetSenhaTarget.nome} confirming={resettingSenha} onCancel={() => setResetSenhaTarget(null)} onConfirm={confirmarResetSenha} />
      )}

      {primeiroAcessoTarget && (
        <ConfirmPrimeiroAcessoModal
          nome={primeiroAcessoTarget.nome}
          email={primeiroAcessoTarget.email}
          usuario={primeiroAcessoTarget.usuario}
          confirming={enviandoPrimeiroAcesso}
          onCancel={() => setPrimeiroAcessoTarget(null)}
          onConfirm={confirmarPrimeiroAcesso}
        />
      )}

      {perfilTarget && (
        <AlterarPerfilModal
          target={perfilTarget}
          onClose={() => setPerfilTarget(null)}
          onSaved={async () => {
            setPerfilTarget(null);
            setToast({ tone: "success", message: "Perfil atualizado." });
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {permissoesTarget && (
        <PermissoesExtrasModal
          target={permissoesTarget}
          onClose={() => setPermissoesTarget(null)}
          onSaved={async () => {
            setPermissoesTarget(null);
            setToast({ tone: "success", message: "Acessos adicionais atualizados." });
            await load();
          }}
          onError={(message) => setToast({ tone: "error", message })}
        />
      )}

      {deleteTargets && <DeleteConfirmModal items={deleteTargets} onClose={() => setDeleteTargets(null)} onDone={handleDeletionDone} />}

      {primeiroAcessoLote && (
        <PrimeiroAcessoLoteDialog
          itens={primeiroAcessoLote}
          onClose={() => setPrimeiroAcessoLote(null)}
          onProcessado={() => {
            // Seleção processada sai; busca/filtros/aba ficam como estavam (só os dados recarregam).
            const processados = new Set(primeiroAcessoLote.map((item) => item.id));
            setSelectedIds((prev) => new Set([...prev].filter((id) => !processados.has(id))));
            load();
          }}
        />
      )}

      {resolverItem && <ResolverIdentidadeModal item={resolverItem} onClose={() => setResolverItem(null)} onResolved={handleIdentidadeResolvida} />}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-[80] rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg ${toast.tone === "success" ? "bg-[#16A34A]" : "bg-[#DC2626]"}`}>
          {toast.message}
        </div>
      )}
    </PageContainer>
  );
}
