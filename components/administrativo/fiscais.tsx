"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Search, Send } from "lucide-react";
import { Badge, Button, Carregando, Field, Input, Select, classeLinha } from "@/components/ui";
import { AdminSidePanel, DataItem, PanelSection } from "@/components/administrativo/admin-side-panel";
import { StatusBadge, Th, openOnKey } from "@/components/administrativo/listagem";
import type { FiscalCadastro } from "@/lib/fiscais";

async function erroDaResposta(res: Response, padrao: string) {
  const corpo: unknown = await res.json().catch(() => null);
  return corpo && typeof corpo === "object" && "error" in corpo && typeof corpo.error === "string" ? corpo.error : padrao;
}

/**
 * Aba "Fiscais" do Administrativo (spec docs/brain/specs/timesheet-aprovacao-fiscal.md): o fiscal do contrato
 * entra com login P0 e só aprova as horas do timesheet. Cadastro com nome e e-mail; o acesso vai pelo
 * mesmo primeiro acesso dos funcionários. O vínculo com os contratos é feito na aba Contratos.
 */
export function FiscaisCadastro({ onTotal }: { onTotal?: (total: number) => void }) {
  const [lista, setLista] = useState<FiscalCadastro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("ativos");
  const [painel, setPainel] = useState<{ id: string | null } | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/admin/administrativo/fiscais", { cache: "no-store" });
    if (!res.ok) { setErro(await erroDaResposta(res, "Não foi possível carregar os fiscais.")); return; }
    const dados = (await res.json()) as FiscalCadastro[];
    setErro(null);
    setLista(dados);
    onTotal?.(dados.length);
  }, [onTotal]);
  useEffect(() => { void carregar(); }, [carregar]);

  const q = busca.trim().toLowerCase();
  const filtrados = useMemo(() => (lista ?? []).filter((f) =>
    (status === "todos" || f.ativo === (status === "ativos")) &&
    (!q || [f.nome, f.usuario, f.email, ...f.contratos].some((v) => (v ?? "").toLowerCase().includes(q))),
  ), [lista, status, q]);
  const aberto = painel?.id ? lista?.find((f) => f.id === painel.id) ?? null : null;

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--border)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <span className="relative min-w-0 sm:w-[340px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--muted-foreground)]" size={14} />
            <Input className="pl-8" aria-label="Buscar fiscais" placeholder="Buscar por nome, login, e-mail ou contrato..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </span>
          <div className="w-[130px] shrink-0">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do fiscal">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
        </div>
        <Button onClick={() => setPainel({ id: null })}>
          <Plus size={15} />
          Novo fiscal
        </Button>
      </div>

      {erro ? (
        <p className="px-6 py-14 text-center text-sm text-[var(--error)]">{erro}</p>
      ) : !lista ? (
        <Carregando texto="Carregando fiscais..." className="px-5 py-5" />
      ) : filtrados.length === 0 ? (
        <p className="px-6 py-14 text-center text-sm text-[var(--muted-foreground)]">{lista.length ? "Nenhum fiscal encontrado com os filtros aplicados." : "Nenhum fiscal cadastrado."}</p>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm" data-testid="administrativo-fiscais-tabela">
            <thead className="bg-[var(--surface-muted)]">
              <tr><Th>Fiscal</Th><Th>Login</Th><Th>Contratos</Th><Th>Acesso</Th><Th className="w-8" /></tr>
            </thead>
            <tbody>
              {filtrados.map((f) => (
                <tr
                  key={f.id}
                  tabIndex={0}
                  onClick={() => setPainel({ id: f.id })}
                  onKeyDown={(e) => openOnKey(e, () => setPainel({ id: f.id }))}
                  aria-label={`Abrir fiscal ${f.nome}`}
                  data-aberta={f.id === painel?.id || undefined}
                  className={classeLinha(f.id === painel?.id)}
                >
                  <td className="px-3 py-3 xl:px-4">
                    <p className="max-w-[260px] truncate font-semibold text-[var(--foreground)]">{f.nome}</p>
                    <p className="mt-0.5 max-w-[260px] truncate text-[12px] text-[var(--muted-foreground)]">{f.email ?? "Sem e-mail"}</p>
                  </td>
                  <td className="px-3 py-3 font-technical text-[12px] xl:px-4">{f.usuario}</td>
                  <td className="max-w-[260px] truncate px-3 py-3 text-[var(--foreground)] xl:px-4" title={f.contratos.join(", ")}>{f.contratos.join(", ") || "—"}</td>
                  <td className="px-3 py-3 xl:px-4">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge ativo={f.ativo} />
                      {f.primeiroLogin && <span className="text-[10px] text-[var(--warning)]">1º acesso pendente</span>}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-[var(--muted-foreground)]"><ChevronRight size={15} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--muted-foreground)]">
        <span>{lista && filtrados.length !== lista.length ? `${filtrados.length} de ${lista.length} fiscais` : `${lista?.length ?? 0} fiscais`}</span>
      </div>

      <AnimatePresence>
        {painel && (
          <FiscalPainel key={painel.id ?? "novo"} fiscal={aberto} onClose={() => setPainel(null)} onMudou={async (id) => { await carregar(); setPainel(id ? { id } : null); }} />
        )}
      </AnimatePresence>
    </>
  );
}

function FiscalPainel({ fiscal, onClose, onMudou }: { fiscal: FiscalCadastro | null; onClose: () => void; onMudou: (id: string | null) => Promise<void> }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function chamar(url: string, method: string, corpo: object, padrao: string) {
    setOcupado(true); setErro(null); setAviso(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    setOcupado(false);
    if (!res.ok) { setErro(await erroDaResposta(res, padrao)); return null; }
    return (await res.json()) as { id?: string };
  }

  async function criar() {
    const r = await chamar("/api/admin/administrativo/fiscais", "POST", { nome, email }, "Não foi possível cadastrar o fiscal.");
    if (r?.id) await onMudou(r.id);
  }
  async function enviarAcesso() {
    if (!fiscal) return;
    const r = await chamar(`/api/admin/administrativo/fiscais/${fiscal.id}`, "PATCH", { action: "enviar_primeiro_acesso", requestId: crypto.randomUUID() }, "Não foi possível enviar o acesso.");
    if (r) setAviso(`Acesso enviado para ${fiscal.email}.`);
  }
  async function alternarAtivo() {
    if (!fiscal) return;
    const r = await chamar(`/api/admin/administrativo/fiscais/${fiscal.id}`, "PATCH", { ativo: !fiscal.ativo }, "Não foi possível alterar a situação.");
    if (r) await onMudou(fiscal.id);
  }

  return (
    <AdminSidePanel
      eyebrow="Fiscal"
      title={fiscal ? fiscal.nome : "Novo fiscal"}
      subtitle={fiscal ? <span className="font-technical text-[12.5px]">{fiscal.usuario}</span> : undefined}
      meta={fiscal ? <><StatusBadge ativo={fiscal.ativo} />{fiscal.primeiroLogin && <Badge variant="warning">1º acesso pendente</Badge>}</> : undefined}
      onClose={onClose}
      closeDisabled={ocupado}
      testId="administrativo-fiscal-painel"
      footer={fiscal ? (
        <>
          <Button variant="secondary" className="mr-auto" onClick={() => void alternarAtivo()} disabled={ocupado}>{fiscal.ativo ? "Inativar fiscal" : "Reativar fiscal"}</Button>
          {fiscal.ativo && fiscal.primeiroLogin && (
            <Button onClick={() => void enviarAcesso()} disabled={ocupado} aria-busy={ocupado}>
              <Send size={14} />
              Enviar primeiro acesso
            </Button>
          )}
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button onClick={() => void criar()} disabled={ocupado || nome.trim().length < 3 || !email.trim()} aria-busy={ocupado}>{ocupado ? "Salvando..." : "Cadastrar fiscal"}</Button>
        </>
      )}
    >
      {erro && <p role="alert" className="mx-5 mt-4 rounded-lg bg-[var(--error-soft)] px-3 py-2 text-xs font-medium text-[var(--error)] sm:mx-6">{erro}</p>}
      {aviso && <p role="status" className="mx-5 mt-4 rounded-lg bg-[var(--success-soft)] px-3 py-2 text-xs font-medium text-[var(--success)] sm:mx-6">{aviso}</p>}
      {fiscal ? (
        <>
          <PanelSection title="Dados">
            <dl className="grid gap-3 sm:grid-cols-2">
              <DataItem label="Nome">{fiscal.nome}</DataItem>
              <DataItem label="Login" technical>{fiscal.usuario}</DataItem>
              <DataItem label="E-mail" wide>{fiscal.email ?? "—"}</DataItem>
            </dl>
          </PanelSection>
          <PanelSection title="Contratos">
            <p className="text-sm text-[var(--foreground)]">{fiscal.contratos.join(", ") || "Nenhum contrato. Vincule em Administrativo → Contratos."}</p>
          </PanelSection>
        </>
      ) : (
        <div className="grid gap-4 px-5 py-5 sm:px-6">
          <p className="text-[12.5px] text-[var(--muted-foreground)]">O login P0 é gerado automaticamente. Depois de cadastrar, envie o primeiro acesso: a senha temporária vai para o e-mail.</p>
          <Field label="Nome"><Input autoFocus maxLength={200} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field label="E-mail"><Input type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
      )}
    </AdminSidePanel>
  );
}
