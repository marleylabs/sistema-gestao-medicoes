"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Button, Carregando, Field, Input, Select, classeLinha } from "@/components/ui";
import { AdminSidePanel } from "@/components/administrativo/admin-side-panel";
import { StatusBadge, Th, openOnKey } from "@/components/administrativo/listagem";
import { money } from "@/components/administrativo/shared";
import type { ContratoCadastro } from "@/lib/contratos-cadastro";

type Form = { codigo: string; nome: string; gestor: string; fiscal: string; dataInicio: string; dataFim: string; valorTotal: string };
const VAZIO: Form = { codigo: "", nome: "", gestor: "", fiscal: "", dataInicio: "", dataFim: "", valorTotal: "" };

const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "–");
const vigencia = (c: ContratoCadastro) => (c.dataInicio || c.dataFim ? `${dataBr(c.dataInicio)} → ${dataBr(c.dataFim)}` : "–");
const valor = (v: string | null) => (v === null ? "–" : money(Number(v))); // só exibição; o servidor guarda Decimal

async function erroDaResposta(res: Response, padrao: string) {
  const corpo: unknown = await res.json().catch(() => null);
  return corpo && typeof corpo === "object" && "error" in corpo && typeof corpo.error === "string" ? corpo.error : padrao;
}

/**
 * Aba "Contratos" do Administrativo (spec docs/brain/specs/contratos-cadastro.md): o Nº, o gestor e o
 * fiscal daqui vão para o cabeçalho e a assinatura da folha do timesheet. Sem exclusão: só inativar.
 */
export function ContratosCadastro({ onTotal }: { onTotal?: (total: number) => void }) {
  const [lista, setLista] = useState<ContratoCadastro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("ativos");
  const [painel, setPainel] = useState<{ id: string | null } | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/admin/contratos", { cache: "no-store" });
    if (!res.ok) { setErro(await erroDaResposta(res, "Não foi possível carregar os contratos.")); return; }
    const dados = (await res.json()) as ContratoCadastro[];
    setErro(null);
    setLista(dados);
    onTotal?.(dados.length);
  }, [onTotal]);

  useEffect(() => { void carregar(); }, [carregar]);

  const q = busca.trim().toLowerCase();
  const filtrados = useMemo(() => (lista ?? []).filter((c) =>
    (status === "todos" || c.ativo === (status === "ativos")) &&
    (!q || [c.nome, c.codigo, c.gestor, c.fiscal].some((v) => (v ?? "").toLowerCase().includes(q))),
  ), [lista, status, q]);
  const aberto = painel?.id ? lista?.find((c) => c.id === painel.id) ?? null : null;

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--border)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <span className="relative min-w-0 sm:w-[340px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" size={14} />
            <Input className="pl-8" aria-label="Buscar contratos" placeholder="Buscar por nome, nº, gestor ou fiscal..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </span>
          <div className="w-[130px] shrink-0">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do contrato">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
        </div>
        <Button onClick={() => setPainel({ id: null })}>
          <Plus size={15} />
          Novo contrato
        </Button>
      </div>

      {erro ? (
        <p className="px-6 py-14 text-center text-sm text-[var(--error)]">{erro}</p>
      ) : !lista ? (
        <Carregando texto="Carregando contratos..." className="px-5 py-5" />
      ) : filtrados.length === 0 ? (
        <p className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">{lista.length ? "Nenhum contrato encontrado com os filtros aplicados." : "Nenhum contrato cadastrado."}</p>
      ) : (
        <>
          <div className="hidden max-w-full overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm" data-testid="administrativo-contratos-tabela">
              <thead className="bg-[var(--surface-muted)]">
                <tr><Th>Contrato</Th><Th>Gestor / Fiscal</Th><Th>Vigência</Th><Th className="text-right">Valor contratual</Th><Th>Situação</Th><Th className="w-8" /></tr>
              </thead>
              <tbody>
                {filtrados.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => setPainel({ id: c.id })}
                    onKeyDown={(e) => openOnKey(e, () => setPainel({ id: c.id }))}
                    aria-label={`Abrir contrato ${c.nome}`}
                    data-aberta={c.id === painel?.id || undefined}
                    className={classeLinha(c.id === painel?.id)}
                  >
                    <td className="px-3 py-3 xl:px-4">
                      <p className="max-w-[280px] truncate font-semibold text-[var(--foreground)]">{c.nome}</p>
                      <p className="mt-0.5 font-technical text-[12px] text-[var(--muted-foreground)]">{c.codigo ?? "Sem nº"}</p>
                    </td>
                    <td className="px-3 py-3 xl:px-4">
                      <p className="max-w-[220px] truncate text-[var(--foreground)]">{c.gestor ?? "–"}</p>
                      <p className="mt-0.5 max-w-[220px] truncate text-[12px] text-[var(--muted-foreground)]">{c.fiscal ?? "Sem fiscal"}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-[var(--foreground)] xl:px-4">{vigencia(c)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[var(--foreground)] xl:px-4">{valor(c.valorTotal)}</td>
                    <td className="px-3 py-3 xl:px-4"><StatusBadge ativo={c.ativo} /></td>
                    <td className="px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-[var(--border)] md:hidden">
            {filtrados.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setPainel({ id: c.id })} aria-label={`Abrir contrato ${c.nome}`} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-muted)]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">{c.nome}</p>
                    <p className="truncate text-[12px] text-[var(--muted-foreground)]"><span className="font-technical">{c.codigo ?? "Sem nº"}</span> · {vigencia(c)}</p>
                    <div className="mt-1.5"><StatusBadge ativo={c.ativo} /></div>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-[var(--muted-foreground)]" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted-foreground)]">
        <span>{lista && filtrados.length !== lista.length ? `${filtrados.length} de ${lista.length} contratos` : `${lista?.length ?? 0} contratos`}</span>
      </div>

      <AnimatePresence>
        {painel && (
          <ContratoEditor
            key={painel.id ?? "novo"}
            contrato={aberto}
            onClose={() => setPainel(null)}
            onSalvo={async () => { setPainel(null); await carregar(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ContratoEditor({ contrato, onClose, onSalvo }: { contrato: ContratoCadastro | null; onClose: () => void; onSalvo: () => Promise<void> }) {
  const [form, setForm] = useState<Form>(() => (contrato ? {
    codigo: contrato.codigo ?? "", nome: contrato.nome, gestor: contrato.gestor ?? "", fiscal: contrato.fiscal ?? "",
    dataInicio: contrato.dataInicio ?? "", dataFim: contrato.dataFim ?? "", valorTotal: contrato.valorTotal?.replace(".", ",") ?? "",
  } : VAZIO));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = (nome: keyof Form) => ({ value: form[nome], onChange: (e: { target: { value: string } }) => setForm({ ...form, [nome]: e.target.value }) });

  async function enviar(corpo: object) {
    setSalvando(true); setErro(null);
    const res = await fetch(contrato ? `/api/admin/contratos/${contrato.id}` : "/api/admin/contratos", {
      method: contrato ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
    setSalvando(false);
    if (!res.ok) { setErro(await erroDaResposta(res, "Não foi possível salvar o contrato.")); return; }
    await onSalvo();
  }

  return (
    <AdminSidePanel
      eyebrow="Contrato"
      title={contrato ? contrato.nome : "Novo contrato"}
      meta={contrato ? <StatusBadge ativo={contrato.ativo} /> : undefined}
      onClose={onClose}
      closeDisabled={salvando}
      testId="administrativo-contrato-painel"
      footer={
        <>
          {contrato && (
            <Button variant="secondary" className="mr-auto" onClick={() => void enviar({ ativo: !contrato.ativo })} disabled={salvando}>
              {contrato.ativo ? "Inativar contrato" : "Reativar contrato"}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void enviar(form)} disabled={salvando || !form.nome.trim()} aria-busy={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
        </>
      }
    >
      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
        {erro && <p className="rounded-lg bg-[var(--error-soft)] px-3 py-2 text-xs font-medium text-[var(--error)] sm:col-span-2" role="alert">{erro}</p>}
        <Field label="Nº do contrato"><Input maxLength={200} placeholder="Ex.: 5900128908" {...campo("codigo")} /></Field>
        <Field label="Nome do contrato"><Input maxLength={200} autoFocus {...campo("nome")} /></Field>
        <Field label="Gestor"><Input maxLength={200} {...campo("gestor")} /></Field>
        <Field label="Fiscal (assina a folha do timesheet)"><Input maxLength={200} {...campo("fiscal")} /></Field>
        <Field label="Início"><Input type="date" {...campo("dataInicio")} /></Field>
        <Field label="Término"><Input type="date" min={form.dataInicio || undefined} {...campo("dataFim")} /></Field>
        <Field label="Valor contratual (R$)"><Input inputMode="decimal" placeholder="0,00" {...campo("valorTotal")} /></Field>
        {contrato && !contrato.ativo && <p className="text-[12px] text-[var(--muted-foreground)] sm:col-span-2">Contrato inativo: não aparece para escolha no timesheet, mas mantém o histórico e os feriados.</p>}
      </div>
    </AdminSidePanel>
  );
}
