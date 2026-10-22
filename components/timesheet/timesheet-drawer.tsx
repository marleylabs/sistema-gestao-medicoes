"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Printer, RotateCcw } from "lucide-react";
import { Aba, Badge, Button, Carregando, Field, Input, Select } from "@/components/ui";
import { AdminSidePanel, DataItem, PanelSection } from "@/components/administrativo/admin-side-panel";
import { ErroDialogo, PortalDialog } from "@/components/portal-fornecedor";
import { TabelaDiasTimesheet, TotaisTimesheet, erroDaApi } from "@/components/timesheet/folha-timesheet";
import { formatarData } from "@/lib/timesheet-calculo";
import type { FolhaTimesheet } from "@/lib/timesheet";

type Historico = { id: string; acao: string; por: string; em: string; data: string | null };
type Config = {
  statusColaborador: string | null; habilitadoEfetivo: boolean; habilitado: boolean | null; contratoId: string | null;
  funcao: string | null; itemPq: string | null; local: string | null; area: string | null; numeroSe: string | null; docNumero: string | null;
  atualizadoEm: string | null; atualizadoPor: string | null;
};
type Detalhe = { folha: FolhaTimesheet; historico: Historico[]; config: Config };
export type Contrato = { id: string; nome: string; codigo: string | null; ativo: boolean };
export type AbaDrawer = "folha" | "historico" | "config";

const ACOES: Record<string, string> = {
  TIMESHEET_DIA_SALVO: "Dia salvo",
  TIMESHEET_ENVIADA: "Folha enviada",
  TIMESHEET_REABERTA: "Folha reaberta",
  TIMESHEET_EXPORTADA: "Folha exportada",
};
// Mesmo visual do Button "secondary" (components/ui.tsx), em <a> para download e nova aba.
const LINK_ACAO = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[12px] font-semibold text-[var(--foreground)] transition-all duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30";
const dataHora = (v: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
const CAMPOS: Array<{ chave: "funcao" | "itemPq" | "local" | "area" | "numeroSe" | "docNumero"; rotulo: string }> = [
  { chave: "funcao", rotulo: "Função" },
  { chave: "itemPq", rotulo: "Item da PQ" },
  { chave: "area", rotulo: "Área / unidade (ex.: MINA DO SALOBO)" },
  { chave: "local", rotulo: "Local (ex.: Parauapebas/PA)" },
  { chave: "numeroSe", rotulo: "Nº da SE" },
  { chave: "docNumero", rotulo: "Doc. Nº" },
];

/** Detalhe da folha de um fornecedor no ciclo: folha só leitura, histórico de auditoria e configuração. */
export function TimesheetDrawer({
  profissionalId,
  nome,
  ciclo,
  feriadoAposEnvio,
  abaInicial = "folha",
  onClose,
  onMudou,
}: {
  profissionalId: string;
  nome: string;
  ciclo: string;
  feriadoAposEnvio: boolean;
  abaInicial?: AbaDrawer;
  onClose: () => void;
  onMudou: () => void;
}) {
  const [aba, setAba] = useState<AbaDrawer>(abaInicial);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarReabrir, setConfirmarReabrir] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [salvoEm, setSalvoEm] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const res = await fetch(`/api/admin/timesheet/${profissionalId}?ciclo=${encodeURIComponent(ciclo)}`, { cache: "no-store" });
    if (!res.ok) { setErro(await erroDaApi(res, "Erro ao carregar a folha.")); return; }
    const d = (await res.json()) as Detalhe;
    setDetalhe(d);
    setForm({
      habilitado: d.config.habilitado === null ? "" : String(d.config.habilitado),
      contratoId: d.config.contratoId ?? "",
      ...Object.fromEntries(CAMPOS.map(({ chave }) => [chave, d.config[chave] ?? ""])),
    });
  }, [profissionalId, ciclo]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (aba !== "config" || contratos.length) return;
    fetch("/api/admin/contratos").then((r) => (r.ok ? r.json() : [])).then((lista: Contrato[]) => setContratos(lista)).catch(() => setContratos([]));
  }, [aba, contratos.length]);

  async function reabrir() {
    setOcupado(true); setErroAcao(null);
    const res = await fetch(`/api/admin/timesheet/${profissionalId}/reabrir`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ciclo }),
    });
    setOcupado(false);
    if (!res.ok) { setErroAcao(await erroDaApi(res, "Não foi possível reabrir.")); return; }
    setConfirmarReabrir(false);
    onMudou();
    await carregar();
  }

  async function salvarConfig() {
    setOcupado(true); setErroAcao(null); setSalvoEm(null);
    const res = await fetch(`/api/admin/timesheet/${profissionalId}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, habilitado: form.habilitado === "" ? null : form.habilitado === "true", contratoId: form.contratoId || null }),
    });
    setOcupado(false);
    if (!res.ok) { setErroAcao(await erroDaApi(res, "Não foi possível salvar.")); return; }
    setSalvoEm(new Date().toISOString());
    onMudou();
    await carregar();
  }

  const folha = detalhe?.folha;
  const enviada = folha?.status === "ENVIADA";
  const statusAto = detalhe?.config.statusColaborador === "ATO";

  return (
    <AdminSidePanel
      size="wide"
      eyebrow={`Timesheet ATO · Ciclo ${ciclo}`}
      title={nome}
      subtitle={folha ? <span className="font-technical text-[12.5px]">{folha.fornecedor.codigo}</span> : undefined}
      meta={folha && (
        <>
          <Badge variant={enviada ? "success" : "warning"}>{enviada ? "Enviada" : "Aberta"}</Badge>
          {detalhe && !detalhe.config.habilitadoEfetivo && <Badge variant="neutral">Desabilitado</Badge>}
        </>
      )}
      escEnabled={!confirmarReabrir}
      onClose={onClose}
      testId="timesheet-drawer"
      footer={aba === "folha" && folha ? (
        <>
          <a className={LINK_ACAO} href={`/api/admin/timesheet/${profissionalId}/xlsx?ciclo=${encodeURIComponent(ciclo)}`} download>
            <FileSpreadsheet size={15} aria-hidden />
            Baixar XLSX
          </a>
          <a className={LINK_ACAO} href={`/timesheet/imprimir/${profissionalId}?ciclo=${encodeURIComponent(ciclo)}`} target="_blank" rel="noopener">
            <Printer size={15} aria-hidden />
            Imprimir / PDF
          </a>
          {enviada && (
            <Button variant="secondary" className="h-10" onClick={() => { setErroAcao(null); setConfirmarReabrir(true); }}>
              <RotateCcw size={15} aria-hidden />
              Reabrir folha
            </Button>
          )}
        </>
      ) : aba === "config" && detalhe ? (
        <Button className="h-10" onClick={() => void salvarConfig()} disabled={ocupado} aria-busy={ocupado}>{ocupado ? "Salvando..." : "Salvar configuração"}</Button>
      ) : undefined}
    >
      <div role="tablist" aria-label="Seções da folha" className="flex gap-5 border-b border-[var(--border)] px-5 pt-3 sm:px-6">
        <Aba grupo="aba-drawer-timesheet" ativa={aba === "folha"} onClick={() => setAba("folha")}>Folha</Aba>
        <Aba grupo="aba-drawer-timesheet" ativa={aba === "historico"} onClick={() => setAba("historico")}>Histórico</Aba>
        <Aba grupo="aba-drawer-timesheet" ativa={aba === "config"} onClick={() => setAba("config")}>Configuração</Aba>
      </div>

      {erro ? (
        <p className="px-6 py-10 text-center text-sm text-[var(--error)]">{erro}</p>
      ) : !detalhe || !folha ? (
        <Carregando texto="Carregando a folha" linhas={6} className="px-5 py-5" />
      ) : aba === "folha" ? (
        <div className="grid gap-4 px-5 py-4 sm:px-6">
          {feriadoAposEnvio && (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-3 py-2 text-[13px] text-[var(--warning)]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
              Um feriado foi cadastrado depois do envio. Os totais abaixo já consideram o feriado e podem diferir do que o fornecedor viu ao enviar.
            </p>
          )}
          <p className="text-[12px] text-[var(--muted-foreground)]">
            {formatarData(folha.periodo.inicio)} a {formatarData(folha.periodo.fim)}
            {folha.enviadaEm && ` · enviada em ${dataHora(folha.enviadaEm)}`}
          </p>
          <TotaisTimesheet totais={folha.totais} />
          <TabelaDiasTimesheet dias={folha.dias} enviada={enviada} />
        </div>
      ) : aba === "historico" ? (
        <PanelSection title="Quem preencheu e quando">
          {detalhe.historico.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Nenhum registro neste ciclo.</p>
          ) : (
            <ol className="grid gap-2" data-testid="timesheet-historico">
              {detalhe.historico.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px]">
                  <span className="font-medium text-[var(--foreground)]">
                    {ACOES[h.acao] ?? h.acao}{h.data && ` · ${formatarData(h.data)}`}
                  </span>
                  <span className="text-[12px] text-[var(--muted-foreground)]">{h.por} · {dataHora(h.em)}</span>
                </li>
              ))}
            </ol>
          )}
        </PanelSection>
      ) : (
        <>
          <PanelSection title="Habilitação">
            <Field label="Timesheet">
              <Select value={form.habilitado} onChange={(e) => setForm({ ...form, habilitado: e.target.value })}>
                <option value="">Seguir o status da importação ({statusAto ? "ATO: habilitado" : "não ATO: desabilitado"})</option>
                <option value="true">Habilitado</option>
                <option value="false">Desabilitado</option>
              </Select>
            </Field>
            <p className="text-[12px] text-[var(--muted-foreground)]">Desabilitar esconde a aba do portal, mas mantém o que já foi preenchido.</p>
          </PanelSection>
          <PanelSection title="Cabeçalho da folha">
            <ErroDialogo erro={erroAcao} />
            {salvoEm && <p role="status" className="text-[13px] font-medium text-[var(--success)]">Configuração salva.</p>}
            <Field label="Contrato (nº e fiscal vêm de Administrativo → Contratos)">
              <Select value={form.contratoId} onChange={(e) => setForm({ ...form, contratoId: e.target.value })}>
                <option value="">Sem contrato</option>
                {contratos.filter((c) => c.ativo || c.id === form.contratoId).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}{c.codigo ? ` · ${c.codigo}` : ""}</option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPOS.map(({ chave, rotulo }) => (
                <Field key={chave} label={rotulo}>
                  <Input maxLength={200} value={form[chave] ?? ""} onChange={(e) => setForm({ ...form, [chave]: e.target.value })} />
                </Field>
              ))}
            </div>
            {detalhe.config.atualizadoEm && (
              <dl className="grid grid-cols-2 gap-3">
                <DataItem label="Última alteração">{dataHora(detalhe.config.atualizadoEm)}</DataItem>
                <DataItem label="Por">{detalhe.config.atualizadoPor ?? "—"}</DataItem>
              </dl>
            )}
          </PanelSection>
        </>
      )}

      <AnimatePresence>
        {confirmarReabrir && (
          <PortalDialog
            key="reabrir"
            role="alertdialog"
            titulo="Reabrir folha"
            descricao={`O fornecedor volta a poder editar a folha do ciclo ${ciclo} e precisará enviá-la de novo.`}
            busy={ocupado}
            onClose={() => setConfirmarReabrir(false)}
            footer={
              <>
                <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={() => setConfirmarReabrir(false)} disabled={ocupado} autoFocus>Cancelar</Button>
                <Button className="h-10 w-full sm:w-auto" onClick={() => void reabrir()} disabled={ocupado} aria-busy={ocupado}>{ocupado ? "Reabrindo..." : "Reabrir folha"}</Button>
              </>
            }
          >
            <ErroDialogo erro={erroAcao} />
          </PortalDialog>
        )}
      </AnimatePresence>
    </AdminSidePanel>
  );
}
