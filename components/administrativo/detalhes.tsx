"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Edit3, KeyRound, Send, ShieldCheck, ShieldOff, SlidersHorizontal, Trash2, UserCog } from "lucide-react";
import { Badge, BlurValue, Button } from "@/components/ui";
import { normalizeTipoCondicaoFixa } from "@/lib/condicao-fixa";
import { normalizeFonteMedicao } from "@/lib/fonte-medicao";
import { PERFIL_LABEL_LOOSE as PERFIL_LABEL } from "@/lib/perfis";
import { PERMISSAO_LABEL_LOOSE, isElegivelParaPermissaoExtra } from "@/lib/permissoes";
import { AdminSidePanel, DataItem, PanelSection, SettingRow } from "@/components/administrativo/admin-side-panel";
import {
  VALIDADE_BADGE,
  fmtDate,
  fonteMedicaoLabel,
  maskCpf,
  maskPhone,
  money,
  normalizeEmail,
  vigenciaLabel,
  type CadastroFornecedor,
  type Funcionario,
} from "@/components/administrativo/shared";

function SmallAction({ onClick, children, disabled, title, tone }: { onClick: () => void; children: ReactNode; disabled?: boolean; title?: string; tone?: "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "danger"
          ? "border-[#efc6c6] text-[var(--error)] hover:bg-[var(--error-soft)]"
          : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-[#f7f7f5]"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ ativo }: { ativo: boolean }) {
  // Inativo não é erro — cinza neutro, nunca vermelho.
  return <Badge variant={ativo ? "success" : "neutral"}>{ativo ? "Ativo" : "Inativo"}</Badge>;
}

const vazio = <span className="text-[var(--muted-foreground)]">–</span>;
const ou = (value: ReactNode | null | undefined) => (value === null || value === undefined || value === "" ? vazio : value);

/**
 * Detalhe administrativo do fornecedor (somente leitura) — Identificação, Empresa, Configuração de
 * medição e Condição fixa em primeiro plano; Contrato, Precificação e Acesso em seguida. As ações são
 * exatamente as que o card antigo oferecia, com os mesmos portões de permissão (isAdmin = ADMIN).
 */
export function FornecedorDetalhe({
  item,
  isAdmin,
  escEnabled,
  onClose,
  onEdit,
  onToggleAtivo,
  onDelete,
  onResetSenha,
  onPrimeiroAcesso,
}: {
  item: CadastroFornecedor;
  isAdmin: boolean;
  escEnabled?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleAtivo: () => void;
  onDelete: () => void;
  onResetSenha: () => void;
  onPrimeiroAcesso: () => void;
}) {
  const condicional = normalizeTipoCondicaoFixa(item.tipoCondicaoFixa) === "CONDICIONAL_PRODUCAO";
  const auxiliares = normalizeFonteMedicao(item.fonteMedicao) === "DOCUMENTOS_AUXILIARES";

  return (
    <AdminSidePanel
      eyebrow="Cadastro do fornecedor"
      title={item.responsavel}
      subtitle={item.razaoSocial || undefined}
      escEnabled={escEnabled}
      onClose={onClose}
      testId="administrativo-detalhe"
      meta={
        <>
          <StatusBadge ativo={item.ativo} />
          <Badge variant={VALIDADE_BADGE[item.validadeTone]}>{item.validadeLabel}</Badge>
          {item.acesso?.primeiroLogin && <Badge variant="warning">Primeiro acesso pendente</Badge>}
          {item.colaboradorCodigo && <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{item.colaboradorCodigo}</span>}
        </>
      }
      footer={
        <>
          {isAdmin && (
            <Button variant="secondary" onClick={onToggleAtivo}>
              {item.ativo ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
              {item.ativo ? "Inativar fornecedor" : "Reativar fornecedor"}
            </Button>
          )}
          <Button onClick={onEdit}>
            <Edit3 size={14} />
            Editar cadastro
          </Button>
        </>
      }
    >
      {item.pendencias.length > 0 && (
        <div className="flex items-start gap-2 border-b border-[#f2dbb7] bg-[var(--warning-soft)] px-5 py-3 text-[13px] text-[#92400E] sm:px-6">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>Pendência: {item.pendencias.join(", ")}</span>
        </div>
      )}

      <PanelSection title="Identificação">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DataItem label="Nome completo" wide>{item.responsavel}</DataItem>
          <DataItem label="Código do colaborador" technical>{ou(item.colaboradorCodigo)}</DataItem>
          {/* Login P0 = Usuario vinculado (perfil COLABORADOR); nunca o colaboradorCodigo. */}
          <DataItem label="Login de acesso" technical>{ou(item.acesso?.usuario)}</DataItem>
          <DataItem label="E-mail">{ou(normalizeEmail(item.email))}</DataItem>
          <DataItem label="Telefone">{ou(maskPhone(item.telefone))}</DataItem>
          <DataItem label="CPF" technical>{ou(item.cpf ? maskCpf(item.cpf) : null)}</DataItem>
          <DataItem label="Função">{ou(item.cargo)}</DataItem>
        </dl>
      </PanelSection>

      <PanelSection title="Empresa">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DataItem label="Razão social" wide>{ou(item.razaoSocial)}</DataItem>
          <DataItem label="CNPJ" technical>{ou(item.cnpj)}</DataItem>
        </dl>
      </PanelSection>

      <PanelSection title="Configuração de medição">
        <div><Badge variant={auxiliares ? "brand" : "neutral"}>{fonteMedicaoLabel(item.fonteMedicao)}</Badge></div>
        <p className="text-[12px] text-[var(--muted-foreground)]">
          {auxiliares
            ? "A produção deste fornecedor é considerada pela aba Documentos Auxiliares (BM AUX)."
            : "A produção deste fornecedor é considerada pela aba Documentos."}
        </p>
      </PanelSection>

      <PanelSection title="Condição fixa">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DataItem label="Tipo">
            {condicional ? "Condicional por produção" : "Fixa"}
          </DataItem>
          {condicional ? (
            <>
              <DataItem label="Com produção"><span className="tabular-nums"><BlurValue>{money(item.valorCondicaoFixaComProducao)}</BlurValue></span></DataItem>
              <DataItem label="Sem produção"><span className="tabular-nums"><BlurValue>{money(item.valorCondicaoFixaSemProducao)}</BlurValue></span></DataItem>
              <DataItem label="Base / fixa"><span className="tabular-nums"><BlurValue>{money(item.valorCondicaoFixa)}</BlurValue></span></DataItem>
            </>
          ) : (
            <DataItem label="Valor fixo"><span className="tabular-nums"><BlurValue>{money(item.valorCondicaoFixa)}</BlurValue></span></DataItem>
          )}
        </dl>
      </PanelSection>

      <PanelSection title="Contrato">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DataItem label="Vigência">{vigenciaLabel(item.inicio, item.final)}</DataItem>
          <DataItem label="Status CT">{ou(item.statusContrato)}</DataItem>
          <DataItem label="Tipo CT">{ou(item.tipoCt)}</DataItem>
          <DataItem label="Tipo contrato">{ou(item.tipoContrato)}</DataItem>
          <DataItem label="1º Adi">{ou(item.primeiroAditivo)}</DataItem>
          <DataItem label="2º Ad">{ou(item.segundoAditivo)}</DataItem>
          <DataItem label="Objeto do contrato" wide>{ou(item.objetoContrato)}</DataItem>
        </dl>
      </PanelSection>

      <PanelSection title="Precificação">
        <dl className="grid grid-cols-3 gap-3">
          <DataItem label="Hora"><span className="tabular-nums"><BlurValue>{money(item.valorHora)}</BlurValue></span></DataItem>
          <DataItem label="Documento"><span className="tabular-nums"><BlurValue>{money(item.valorDocumento)}</BlurValue></span></DataItem>
          <DataItem label="A1 equivalente"><span className="tabular-nums"><BlurValue>{money(item.valorA1Equivalente)}</BlurValue></span></DataItem>
        </dl>
      </PanelSection>

      <PanelSection title="Acesso ao portal">
        {item.acesso ? (
          <div className="grid gap-2">
            <SettingRow
              label="Login"
              value={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-technical text-[12.5px]">{item.acesso.usuario}</span>
                  <span className="text-[12px] text-[var(--muted-foreground)]">{PERFIL_LABEL[item.acesso.perfil] ?? item.acesso.perfil}</span>
                  <StatusBadge ativo={item.acesso.ativo} />
                </span>
              }
            />
            {isAdmin && (
              <SettingRow
                label="Senha"
                value={item.acesso.primeiroLogin ? "Primeiro acesso pendente" : "Definida pelo usuário"}
                action={
                  <>
                    <SmallAction onClick={onResetSenha}><KeyRound size={13} />Redefinir senha</SmallAction>
                    {item.acesso.perfil !== "ADMIN" && item.acesso.primeiroLogin && (
                      <SmallAction
                        onClick={onPrimeiroAcesso}
                        disabled={!item.acesso.email}
                        // E-mail cadastral (CadastroFornecedor) ≠ e-mail de acesso (Usuario, o que o
                        // FIRST_ACCESS usa): aviso específico quando só o de acesso falta.
                        title={!item.acesso.email ? (item.email ? "E-mail de acesso ainda não sincronizado. Reimporte a Consulta PJ para sincronizar." : "Este usuário não possui e-mail cadastrado.") : undefined}
                      >
                        <Send size={13} />Enviar primeiro acesso
                      </SmallAction>
                    )}
                  </>
                }
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">Nenhum usuário de acesso vinculado a este fornecedor.</p>
        )}
      </PanelSection>

      {item.updatedAt && (
        <p className="border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--muted-foreground)] sm:px-6">Última atualização em {fmtDate(item.updatedAt)}</p>
      )}

      {isAdmin && (
        <PanelSection title="Zona de risco" tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-[12px] text-[var(--muted-foreground)]">
              Remove o cadastro administrativo. Identidades com histórico de medição são preservadas.
            </p>
            <SmallAction tone="danger" onClick={onDelete} title="Excluir fornecedor definitivamente"><Trash2 size={13} />Excluir permanentemente</SmallAction>
          </div>
        </PanelSection>
      )}
    </AdminSidePanel>
  );
}

/** Detalhe do funcionário (usuário interno) — mesmas ações do card antigo, só para ADMIN. */
export function FuncionarioDetalhe({
  item,
  isAdmin,
  escEnabled,
  onClose,
  onResetSenha,
  onPrimeiroAcesso,
  onToggleAtivo,
  onSetPerfil,
  onGerenciarPermissoes,
  onExcluir,
}: {
  item: Funcionario;
  isAdmin: boolean;
  escEnabled?: boolean;
  onClose: () => void;
  onResetSenha: () => void;
  onPrimeiroAcesso: () => void;
  onToggleAtivo: () => void;
  onSetPerfil: () => void;
  onGerenciarPermissoes: () => void;
  onExcluir: () => void;
}) {
  const elegivel = isElegivelParaPermissaoExtra(item.perfil);
  return (
    <AdminSidePanel
      eyebrow="Funcionário"
      title={item.nome}
      subtitle={item.email ?? "Sem e-mail cadastrado"}
      escEnabled={escEnabled}
      onClose={onClose}
      testId="administrativo-detalhe"
      meta={
        <>
          <StatusBadge ativo={item.ativo} />
          {item.primeiroLogin && <Badge variant="warning">Primeiro acesso pendente</Badge>}
          <span className="font-technical text-[11px] text-[var(--muted-foreground)]">{item.usuario}</span>
        </>
      }
      footer={
        isAdmin ? (
          <>
            <Button variant="secondary" onClick={onToggleAtivo}>
              {item.ativo ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
              {item.ativo ? "Desativar acesso" : "Ativar acesso"}
            </Button>
            <Button variant="secondary" onClick={onSetPerfil}>
              <UserCog size={14} />
              Alterar perfil
            </Button>
          </>
        ) : undefined
      }
    >
      <PanelSection title="Identificação">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DataItem label="Nome" wide>{item.nome}</DataItem>
          <DataItem label="Login" technical>{item.usuario}</DataItem>
          <DataItem label="Perfil">{PERFIL_LABEL[item.perfil] ?? item.perfil}</DataItem>
          <DataItem label="E-mail">{ou(item.email)}</DataItem>
          <DataItem label="Acesso">{item.ativo ? "Ativo" : "Inativo"}</DataItem>
        </dl>
      </PanelSection>

      {elegivel && (
        <PanelSection
          title="Acessos adicionais"
          action={isAdmin && item.perfil !== "ADMIN" ? <SmallAction onClick={onGerenciarPermissoes}><SlidersHorizontal size={13} />Gerenciar</SmallAction> : undefined}
        >
          <p className="text-sm text-[var(--foreground)]">
            {item.permissoesExtras.length ? item.permissoesExtras.map((p) => PERMISSAO_LABEL_LOOSE[p] ?? p).join(", ") : "Nenhum acesso adicional."}
          </p>
        </PanelSection>
      )}

      {isAdmin && (
        <PanelSection title="Acesso ao sistema">
          <SettingRow
            label="Senha"
            value={item.primeiroLogin ? "Primeiro acesso pendente" : "Definida pelo usuário"}
            action={
              <>
                <SmallAction onClick={onResetSenha}><KeyRound size={13} />Redefinir senha</SmallAction>
                {item.perfil !== "ADMIN" && item.primeiroLogin && (
                  <SmallAction onClick={onPrimeiroAcesso} disabled={!item.email} title={!item.email ? "Este usuário não possui e-mail cadastrado." : undefined}>
                    <Send size={13} />Enviar primeiro acesso
                  </SmallAction>
                )}
              </>
            }
          />
        </PanelSection>
      )}

      {isAdmin && (
        <PanelSection title="Zona de risco" tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-sm text-[12px] text-[var(--muted-foreground)]">O funcionário perde o acesso; o histórico é preservado.</p>
            <SmallAction tone="danger" onClick={onExcluir}><Trash2 size={13} />Excluir funcionário</SmallAction>
          </div>
        </PanelSection>
      )}
    </AdminSidePanel>
  );
}
