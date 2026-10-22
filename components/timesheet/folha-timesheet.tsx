"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { CopyPlus, Lock, PencilLine, Send } from "lucide-react";
import clsx from "clsx";
import { Badge, Button, Card, Carregando, Field, Input, Toast } from "@/components/ui";
import { ErroDialogo, PortalDialog } from "@/components/portal-fornecedor";
import { formatCicloLabel } from "@/lib/ciclo";
import type { FolhaTimesheet } from "@/lib/timesheet";
import { formatarData, formatarDuracao } from "@/lib/timesheet-calculo";

type Dia = FolhaTimesheet["dias"][number];
type Horas = FolhaTimesheet["totais"];
type Edicao = { data: string; entrada1: string; saida1: string; entrada2: string; saida2: string; projetoPep: string; descricao: string; solicitante: string };

/** Mensagem de erro da API (`{ error }`), ou o texto padrão. */
export async function erroDaApi(res: Response, padrao: string) {
  const json: unknown = await res.json().catch(() => null);
  return (json as { error?: string } | null)?.error ?? padrao;
}

const paraEdicao = (d: Dia) => ({
  entrada1: d.entrada1 ?? "", saida1: d.saida1 ?? "", entrada2: d.entrada2 ?? "", saida2: d.saida2 ?? "",
  projetoPep: d.projetoPep ?? "", descricao: d.descricao ?? "", solicitante: d.solicitante ?? "",
});

function rotuloDia(dia: Dia) {
  const semana = new Date(`${dia.data}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return { curto: `${dia.data.slice(8, 10)}/${dia.data.slice(5, 7)}`, semana };
}

function periodo(inicio: string | null, fim: string | null) {
  return inicio && fim ? `${inicio}–${fim}` : "—";
}

const vazio = (dia: Dia) => !dia.entrada1 && !dia.entrada2;

const TOTAIS: Array<{ chave: keyof Horas; rotulo: string }> = [
  { chave: "hn", rotulo: "Hora normal" },
  { chave: "he50", rotulo: "HE 50%" },
  { chave: "he100", rotulo: "HE 100%" },
  { chave: "total", rotulo: "Total de horas" },
];

export function FolhaTimesheetFornecedor() {
  const [folha, setFolha] = useState<FolhaTimesheet | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const res = await fetch("/api/colaborador/timesheet", { cache: "no-store" });
    if (!res.ok) {
      setErro(await erroDaApi(res, "Não foi possível carregar o timesheet."));
      return;
    }
    setFolha((await res.json()) as FolhaTimesheet);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function abrir(dia: Dia) {
    setErroEdicao(null);
    setEdicao({ data: dia.data, ...paraEdicao(dia) });
  }

  /** Repete horários e textos do último dia preenchido antes deste (WCAG 3.3.7, entrada redundante). */
  function copiarAnterior() {
    if (!folha || !edicao) return;
    const anterior = [...folha.dias].reverse().find((d) => d.data < edicao.data && !vazio(d));
    if (!anterior) return;
    setEdicao({ data: edicao.data, ...paraEdicao(anterior) });
  }

  async function salvar() {
    if (!folha || !edicao) return;
    setSalvando(true);
    setErroEdicao(null);
    const res = await fetch("/api/colaborador/timesheet/dia", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ciclo: folha.ciclo, ...edicao }),
    });
    setSalvando(false);
    if (!res.ok) {
      setErroEdicao(await erroDaApi(res, "Não foi possível salvar o dia."));
      return;
    }
    setEdicao(null);
    setToast(`Dia ${formatarData(edicao.data)} salvo.`);
    await carregar();
  }

  async function enviar() {
    if (!folha) return;
    setSalvando(true);
    setErroEnvio(null);
    const res = await fetch("/api/colaborador/timesheet/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ciclo: folha.ciclo }),
    });
    setSalvando(false);
    if (!res.ok) {
      setErroEnvio(await erroDaApi(res, "Não foi possível enviar a folha."));
      return;
    }
    setConfirmarEnvio(false);
    setToast("Folha enviada para a medição.");
    await carregar();
  }

  if (erro) {
    return (
      <Card className="grid justify-items-center gap-3 p-8 text-center">
        <p className="text-[13px] text-[var(--muted-foreground)]">{erro}</p>
        <Button variant="secondary" onClick={() => void carregar()}>Tentar novamente</Button>
      </Card>
    );
  }
  if (!folha) return <Carregando texto="Carregando o timesheet" linhas={6} />;

  const enviada = folha.status === "ENVIADA";
  const preenchidos = folha.dias.filter((d) => !vazio(d)).length;
  const cab = folha.cabecalho;
  const infos = [
    ["Contrato", cab.contratoNumero ?? cab.contratoNome],
    ["Função", cab.funcao],
    ["Item da PQ", cab.itemPq],
    ["Local", [cab.area, cab.local].filter(Boolean).join(" · ") || null],
    ["Nº da SE", cab.numeroSe],
  ].filter((par): par is [string, string] => !!par[1]);

  return (
    <div className="grid gap-4" data-testid="timesheet-fornecedor">
      <Card className="grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label text-[var(--muted-foreground)]">Folha de Apropriação de Horas · ATO</p>
            <h2 className="text-section-title text-[var(--foreground)]">
              Ciclo {formatCicloLabel(folha.ciclo)} · {formatarData(folha.periodo.inicio)} a {formatarData(folha.periodo.fim)}
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted-foreground)]">
              {enviada
                ? "Folha enviada. Para corrigir algum dia, peça à equipe de medição para reabrir."
                : folha.liberacao === "CICLO"
                  ? "Todos os dias do ciclo estão liberados para preenchimento."
                  : "Você pode preencher o dia de hoje e os dias anteriores do ciclo."}
            </p>
          </div>
          <Badge variant={enviada ? "success" : "warning"}>{enviada ? "Enviada" : "Em preenchimento"}</Badge>
        </div>
        {infos.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3 sm:grid-cols-5">
            {infos.map(([rotulo, valor]) => (
              <div key={rotulo} className="min-w-0">
                <dt className="text-[11px] text-[var(--muted-foreground)]">{rotulo}</dt>
                <dd className="truncate text-[13px] font-medium text-[var(--foreground)]">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <TotaisTimesheet totais={folha.totais} />
      <TabelaDiasTimesheet dias={folha.dias} enviada={enviada} onEditar={abrir} />

      {!enviada && (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <p className="text-[12px] text-[var(--muted-foreground)] sm:mr-auto">{preenchidos} de {folha.dias.length} dias preenchidos.</p>
          <Button className="h-10" disabled={preenchidos === 0} onClick={() => { setErroEnvio(null); setConfirmarEnvio(true); }}>
            <Send size={15} aria-hidden />
            Enviar folha
          </Button>
        </div>
      )}

      <AnimatePresence>
        {edicao && (
          <PortalDialog
            key="editar-dia"
            titulo={`Horários de ${formatarData(edicao.data)}`}
            descricao="Preencha a entrada e a saída de cada período. Deixe a tarde em branco se trabalhou só de manhã."
            busy={salvando}
            onClose={() => setEdicao(null)}
            footer={
              <>
                <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={() => setEdicao(null)} disabled={salvando}>Cancelar</Button>
                <Button className="h-10 w-full sm:w-auto" onClick={() => void salvar()} disabled={salvando} aria-busy={salvando}>
                  {salvando ? "Salvando..." : "Salvar dia"}
                </Button>
              </>
            }
          >
            <ErroDialogo erro={erroEdicao} />
            <Button variant="ghost" className="h-9 justify-self-start px-2" onClick={copiarAnterior} disabled={!folha.dias.some((d) => d.data < edicao.data && !vazio(d))}>
              <CopyPlus size={15} aria-hidden />
              Copiar do último dia preenchido
            </Button>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="text-label mb-1.5 text-[var(--foreground)]">Manhã</legend>
              <Field label="Entrada"><Input type="time" value={edicao.entrada1} onChange={(e) => setEdicao({ ...edicao, entrada1: e.target.value })} /></Field>
              <Field label="Saída para o almoço"><Input type="time" value={edicao.saida1} onChange={(e) => setEdicao({ ...edicao, saida1: e.target.value })} /></Field>
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="text-label mb-1.5 text-[var(--foreground)]">Tarde</legend>
              <Field label="Volta do almoço"><Input type="time" value={edicao.entrada2} onChange={(e) => setEdicao({ ...edicao, entrada2: e.target.value })} /></Field>
              <Field label="Saída final"><Input type="time" value={edicao.saida2} onChange={(e) => setEdicao({ ...edicao, saida2: e.target.value })} /></Field>
            </fieldset>
            <Field label="Projeto/PEP"><Input maxLength={200} value={edicao.projetoPep} onChange={(e) => setEdicao({ ...edicao, projetoPep: e.target.value })} /></Field>
            <Field label="Descrição dos serviços"><Input maxLength={200} value={edicao.descricao} onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })} /></Field>
            <Field label="Solicitante"><Input maxLength={200} value={edicao.solicitante} onChange={(e) => setEdicao({ ...edicao, solicitante: e.target.value })} /></Field>
          </PortalDialog>
        )}
        {confirmarEnvio && (
          <PortalDialog
            key="enviar-folha"
            role="alertdialog"
            titulo="Enviar folha"
            descricao="Depois de enviada, a folha fica só para leitura. Para corrigir, a equipe de medição precisa reabrir."
            busy={salvando}
            onClose={() => setConfirmarEnvio(false)}
            footer={
              <>
                <Button variant="secondary" className="h-10 w-full sm:w-auto" onClick={() => setConfirmarEnvio(false)} disabled={salvando} autoFocus>Cancelar</Button>
                <Button className="h-10 w-full sm:w-auto" onClick={() => void enviar()} disabled={salvando} aria-busy={salvando}>
                  <Send size={15} aria-hidden />
                  {salvando ? "Enviando..." : "Enviar folha"}
                </Button>
              </>
            }
          >
            <ErroDialogo erro={erroEnvio} />
            <p className="text-[13px] text-[var(--foreground)]">
              {preenchidos} de {folha.dias.length} dias preenchidos · total de <strong className="tabular-nums">{formatarDuracao(folha.totais.total)}</strong> horas
              {" "}(normal {formatarDuracao(folha.totais.hn)}, HE 50% {formatarDuracao(folha.totais.he50)}, HE 100% {formatarDuracao(folha.totais.he100)}).
            </p>
          </PortalDialog>
        )}
      </AnimatePresence>
      <Toast mensagem={toast} />
    </div>
  );
}

export function TotaisTimesheet({ totais }: { totais: Horas }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totais do ciclo">
      {TOTAIS.map(({ chave, rotulo }) => (
        <Card key={chave} className={clsx("p-4", chave === "total" && "border-[var(--primary)]/40")}>
          <dt className="text-[11px] text-[var(--muted-foreground)]">{rotulo}</dt>
          <dd className="text-xl font-bold tabular-nums text-[var(--foreground)]" data-testid={`timesheet-total-${chave}`}>{formatarDuracao(totais[chave])}</dd>
        </Card>
      ))}
    </dl>
  );
}

/** Tabela dos dias do ciclo. Sem `onEditar` (painel da medição) é só leitura e mostra a descrição e o solicitante. */
export function TabelaDiasTimesheet({ dias, enviada, onEditar }: { dias: Dia[]; enviada: boolean; onEditar?: (dia: Dia) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <caption className="sr-only">Dias do ciclo com horários e horas calculadas</caption>
          <thead className="bg-[var(--surface-muted)] text-[11px] uppercase tracking-[0.02em] text-[var(--muted-foreground)]">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-semibold">Dia</th>
              {onEditar && <th scope="col" className="px-1 py-2.5"><span className="sr-only">Ação</span></th>}
              <th scope="col" className="px-3 py-2.5 font-semibold">Manhã</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Tarde</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Normal</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">HE 50%</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">HE 100%</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Projeto/PEP</th>
              {!onEditar && <th scope="col" className="px-3 py-2.5 font-semibold">Descrição</th>}
              {!onEditar && <th scope="col" className="px-3 py-2.5 font-semibold">Solicitante</th>}
            </tr>
          </thead>
          <tbody>
            {dias.map((dia) => {
              const { curto, semana } = rotuloDia(dia);
              return (
                <tr key={dia.data} data-testid={`timesheet-dia-${dia.data}`} className={clsx("border-t border-[var(--border)]", dia.tipo !== "UTIL" && "bg-[var(--surface-muted)]")}>
                  <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-[var(--foreground)]">
                    <span className="tabular-nums">{curto}</span>{" "}
                    <span className="text-[12px] font-normal capitalize text-[var(--muted-foreground)]">{semana}</span>
                    {dia.feriado && <Badge variant="danger" className="ml-2">{dia.feriado}</Badge>}
                  </th>
                  {onEditar && (
                    <td className="px-1 py-1.5">
                      {dia.editavel ? (
                        <Button variant="ghost" className="h-9 px-2.5" onClick={() => onEditar(dia)} aria-label={`${vazio(dia) ? "Preencher" : "Editar"} ${formatarData(dia.data)}`}>
                          <PencilLine size={15} aria-hidden />
                          <span className="hidden sm:inline">{vazio(dia) ? "Preencher" : "Editar"}</span>
                        </Button>
                      ) : (
                        <span className="inline-flex h-9 items-center px-2.5 text-[var(--muted-foreground)]/70" title={enviada ? "Folha enviada" : "Dia ainda não liberado"}>
                          <Lock size={14} aria-label={enviada ? "Folha enviada" : "Dia ainda não liberado"} />
                        </span>
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--foreground)]">{periodo(dia.entrada1, dia.saida1)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--foreground)]">{periodo(dia.entrada2, dia.saida2)}</td>
                  {(["hn", "he50", "he100", "total"] as const).map((k) => (
                    <td key={k} className={clsx("px-3 py-2 text-right tabular-nums", dia.horas[k] ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]/60", k === "total" && "font-semibold")}>
                      {formatarDuracao(dia.horas[k])}
                    </td>
                  ))}
                  <td className="max-w-[160px] truncate px-3 py-2 text-[var(--muted-foreground)]" title={dia.projetoPep ?? undefined}>{dia.projetoPep ?? "—"}</td>
                  {!onEditar && <td className="max-w-[200px] truncate px-3 py-2 text-[var(--muted-foreground)]" title={dia.descricao ?? undefined}>{dia.descricao ?? "—"}</td>}
                  {!onEditar && <td className="max-w-[140px] truncate px-3 py-2 text-[var(--muted-foreground)]" title={dia.solicitante ?? undefined}>{dia.solicitante ?? "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
