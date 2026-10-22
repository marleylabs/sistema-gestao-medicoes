import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import clsx from "clsx";
import { getCurrentUser } from "@/lib/auth";
import { carregarFolha, hojeSaoPaulo, TimesheetError } from "@/lib/timesheet";
import { formatarData, formatarDuracao } from "@/lib/timesheet-calculo";
import { CONTRATADA } from "@/lib/timesheet-export";
import { exigirUuid, registrarExportacao } from "@/lib/timesheet-medicao";
import { BotaoImprimir } from "@/components/timesheet/botao-imprimir";

/**
 * Folha de Apropriação de Horas para impressão (PDF pelo navegador), A4 retrato em uma página.
 * Visual corporativo sóbrio (neutros em ardósia, linhas finas, acento no verde-petróleo da VALE) com
 * sábado, domingo e feriado em verde — cor + rótulo do dia, para não depender só da cor no P&B.
 * Documento sempre claro, independente do tema; cores com `print-color-adjust: exact`.
 */

export const metadata: Metadata = { title: "Folha de Apropriação de Horas" }; // nome sugerido do PDF ao salvar

// O papel não pode depender da configuração da impressora: A4 retrato, margens fixas e fundo branco
// (o tema pinta o <html>). Única CSS da página: @page não tem utilitário no Tailwind.
const CSS_IMPRESSAO = "@page { size: A4 portrait; margin: 10mm 8mm 10mm 12mm; } @media print { html, body { background: #fff !important; } }";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const exato = "[print-color-adjust:exact]";

function Campo({ rotulo, valor, className }: { rotulo: string; valor: string | null; className?: string }) {
  return (
    <div className={clsx("min-w-0 px-2.5 py-1.5", className)}>
      <dt className="text-[6px] font-semibold uppercase tracking-[0.12em] text-slate-500">{rotulo}</dt>
      <dd className="truncate text-[8.5px] font-semibold text-slate-900">{valor || "—"}</dd>
    </div>
  );
}

function Assinatura({ papel, nome, data }: { papel: string; nome: string; data: string }) {
  return (
    <div className="grid gap-0.5">
      <div className="mb-1 h-6 border-b border-slate-400" />
      <p className="text-[8.5px] font-semibold text-slate-900">{nome || "—"}</p>
      <p className="text-[7px] text-slate-500">{papel} · em {data}</p>
    </div>
  );
}

export default async function ImprimirTimesheet({
  params,
  searchParams,
}: {
  params: Promise<{ profissionalId: string }>;
  searchParams: Promise<{ ciclo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) notFound();

  let folha;
  try {
    const profissionalId = exigirUuid((await params).profissionalId, "Fornecedor");
    folha = await carregarFolha(profissionalId, (await searchParams).ciclo, undefined, { paraMedicao: true });
    await registrarExportacao({ profissionalId, ciclo: folha.ciclo, formato: "PDF", ator: user });
  } catch (e) {
    if (e instanceof TimesheetError) notFound();
    throw e;
  }

  const cab = folha.cabecalho;
  const hoje = formatarData(hojeSaoPaulo());
  const periodo = `${formatarData(folha.periodo.inicio)} a ${formatarData(folha.periodo.fim)}`;
  const horas = (min: number) => (min ? formatarDuracao(min) : "–");
  const th = "border-b border-slate-300 px-1 py-1 text-[6px] font-semibold uppercase tracking-[0.08em] text-slate-600";
  const td = "border-b border-slate-200 px-1 text-center";
  const totais = [
    ["Hora normal", folha.totais.hn],
    ["Hora extra 50%", folha.totais.he50],
    ["Hora extra 100%", folha.totais.he100],
  ] as const;

  return (
    <main className="min-h-screen bg-white p-6 text-slate-900 print:min-h-0 print:p-0" data-testid="timesheet-impressao">
      <style>{CSS_IMPRESSAO}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-neutral-600">A folha já sai em A4 retrato. No diálogo de impressão, escolha &quot;Salvar como PDF&quot; e deixe a escala no padrão (100%).</p>
        <BotaoImprimir />
      </div>

      <article className="mx-auto grid w-full max-w-[760px] gap-3">
        {/* Cabeçalho: marcas e título */}
        <header className="flex items-end justify-between gap-4 border-b-2 border-[#007E7A] pb-2.5">
          <div className="flex items-center gap-3">
            <Image src="/timesheet/vale.png" alt="VALE" width={197} height={73} loading="eager" className="h-9 w-auto" />
            <span className="h-8 w-px bg-slate-300" aria-hidden />
            <Image src="/timesheet/projeta.png" alt="Projeta Soluções em Engenharia" width={311} height={86} loading="eager" className="h-8 w-auto" />
          </div>
          <div className="text-right">
            <p className="text-[6.5px] font-bold uppercase tracking-[0.16em] text-[#007E7A]">Timesheet ATO · Ciclo {folha.ciclo}</p>
            <h1 className="text-[15px] font-bold leading-tight tracking-[-0.01em] text-slate-900">Folha de Apropriação de Horas</h1>
            <p className="text-[7px] text-slate-500">Emitida em {hoje} · Período {periodo}</p>
          </div>
        </header>

        {/* Identificação */}
        <dl className="grid grid-cols-4 divide-x divide-y divide-slate-200 rounded-md border border-slate-200 [&>div:nth-child(-n+4)]:border-t-0">
          <Campo rotulo="Funcionário" valor={folha.fornecedor.nome} className="col-span-2" />
          <Campo rotulo="Função" valor={cab.funcao} />
          <Campo rotulo="Contratada" valor={CONTRATADA} />
          <Campo rotulo="Contrato N.º" valor={cab.contratoNumero ?? cab.contratoNome} />
          <Campo rotulo="Doc. N.º" valor={cab.docNumero} />
          <Campo rotulo="Item da PQ" valor={cab.itemPq} />
          <Campo rotulo="Nº da SE" valor={cab.numeroSe} />
          <Campo rotulo="Área" valor={cab.area} />
          <Campo rotulo="Local" valor={cab.local} />
          <Campo rotulo="Tipo de serviço" valor="ATO" />
          <Campo rotulo="Período" valor={periodo} />
        </dl>

        {/* Dias. Tamanho nas células: o `table { font-size: 12px }` do globals.css fica fora das camadas do Tailwind. */}
        <table className="w-full table-fixed border-collapse [&_td]:text-[8px] [&_th]:leading-tight">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[6%]" /><col className="w-[6%]" /><col className="w-[6%]" /><col className="w-[6%]" />
            <col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[7%]" /><col className="w-[7%]" />
            <col className="w-[12%]" /><col className="w-[19%]" /><col className="w-[8%]" />
          </colgroup>
          <thead className={`bg-slate-100 ${exato}`}>
            <tr>
              <th rowSpan={2} className={`${th} text-left`}>Dia</th>
              <th colSpan={2} className={`${th} border-l border-slate-200`}>Manhã</th>
              <th colSpan={2} className={`${th} border-l border-slate-200`}>Tarde</th>
              <th rowSpan={2} className={`${th} border-l border-slate-200`}>Normal</th>
              <th rowSpan={2} className={th}>HE 50%</th>
              <th rowSpan={2} className={th}>HE 100%</th>
              <th rowSpan={2} className={th}>Total</th>
              <th rowSpan={2} className={`${th} border-l border-slate-200 text-left`}>Projeto/PEP</th>
              <th rowSpan={2} className={`${th} text-left`}>Descrição dos serviços</th>
              <th rowSpan={2} className={`${th} text-left`}>Solicitante</th>
            </tr>
            <tr>
              <th className={`${th} border-l border-slate-200`}>Entrada</th><th className={th}>Saída</th>
              <th className={`${th} border-l border-slate-200`}>Entrada</th><th className={th}>Saída</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {folha.dias.map((d) => {
              const destaque = d.tipo !== "UTIL";
              const semana = SEMANA[new Date(`${d.data}T00:00:00Z`).getUTCDay()];
              return (
                <tr
                  key={d.data}
                  className={clsx("h-[18px]", destaque && `bg-[#E6F4EA] ${exato}`)}
                  data-testid={destaque ? "timesheet-impressao-dia-destaque" : undefined}
                >
                  <td className={clsx(td, "border-l-[3px] text-left", destaque ? "border-l-[#15803D]" : "border-l-transparent")}>
                    <span className="font-semibold">{d.data.slice(8, 10)}/{d.data.slice(5, 7)}</span>{" "}
                    <span className={clsx("text-[6.5px] uppercase", destaque ? "font-bold text-[#15803D]" : "text-slate-400")}>{d.feriado ? "fer" : semana}</span>
                  </td>
                  <td className={clsx(td, "border-l border-l-slate-200")}>{d.entrada1 ?? ""}</td>
                  <td className={td}>{d.saida1 ?? ""}</td>
                  <td className={clsx(td, "border-l border-l-slate-200")}>{d.entrada2 ?? ""}</td>
                  <td className={td}>{d.saida2 ?? ""}</td>
                  <td className={clsx(td, "border-l border-l-slate-200", !d.horas.hn && "text-slate-300")}>{horas(d.horas.hn)}</td>
                  <td className={clsx(td, !d.horas.he50 && "text-slate-300")}>{horas(d.horas.he50)}</td>
                  <td className={clsx(td, !d.horas.he100 && "text-slate-300")}>{horas(d.horas.he100)}</td>
                  <td className={clsx(td, "font-bold", !d.horas.total && "text-slate-300")}>{horas(d.horas.total)}</td>
                  <td className={clsx(td, "truncate border-l border-l-slate-200 text-left")}>
                    {d.projetoPep ?? (d.feriado ? <span className="font-semibold text-[#15803D]">{d.feriado}</span> : "")}
                  </td>
                  <td className={clsx(td, "truncate text-left")}>{d.descricao ?? ""}</td>
                  <td className={clsx(td, "truncate text-left")}>{d.solicitante ?? ""}</td>
                </tr>
              );
            })}
            <tr className={`h-[20px] bg-slate-50 font-bold ${exato}`} data-testid="timesheet-impressao-total">
              <td className="border-t-2 border-slate-800 px-1 text-left uppercase tracking-[0.08em]" colSpan={5}>Total do período</td>
              <td className="border-t-2 border-slate-800 px-1 text-center">{formatarDuracao(folha.totais.hn)}</td>
              <td className="border-t-2 border-slate-800 px-1 text-center">{formatarDuracao(folha.totais.he50)}</td>
              <td className="border-t-2 border-slate-800 px-1 text-center">{formatarDuracao(folha.totais.he100)}</td>
              <td className="border-t-2 border-slate-800 px-1 text-center text-[#007E7A]">{formatarDuracao(folha.totais.total)}</td>
              <td className="border-t-2 border-slate-800" colSpan={3} />
            </tr>
          </tbody>
        </table>

        {/* Resumo e legenda */}
        <section className="flex items-stretch justify-between gap-3">
          <p className="flex items-center gap-1.5 self-center text-[7px] text-slate-500">
            <span className={`inline-block h-2.5 w-3.5 border-l-[3px] border-l-[#15803D] bg-[#E6F4EA] ${exato}`} aria-hidden />
            Sábado, domingo e feriado (HE 50% no sábado; HE 100% no domingo e no feriado)
          </p>
          <dl className="flex gap-2">
            {totais.map(([rotulo, min]) => (
              <div key={rotulo} className="min-w-[78px] rounded-md border border-slate-200 px-2.5 py-1.5">
                <dt className="text-[6px] font-semibold uppercase tracking-[0.1em] text-slate-500">{rotulo}</dt>
                <dd className="text-[11px] font-bold tabular-nums text-slate-900">{formatarDuracao(min)}</dd>
              </div>
            ))}
            <div className={`min-w-[78px] rounded-md bg-[#007E7A] px-2.5 py-1.5 text-white ${exato}`}>
              <dt className="text-[6px] font-semibold uppercase tracking-[0.1em] text-white/80">Total de horas</dt>
              <dd className="text-[11px] font-bold tabular-nums">{formatarDuracao(folha.totais.total)}</dd>
            </div>
          </dl>
        </section>

        {/* Assinaturas e observações */}
        <section className="grid grid-cols-2 gap-10 pt-1">
          <Assinatura papel="Colaborador" nome={folha.fornecedor.nome} data={hoje} />
          <Assinatura papel="Visto fiscalização da VALE" nome={cab.fiscal ?? ""} data={hoje} />
        </section>
        <section className="rounded-md border border-slate-200 px-2.5 py-1.5">
          <p className="text-[6px] font-semibold uppercase tracking-[0.12em] text-slate-500">Observações</p>
          <div className="h-6" />
        </section>
        <p className="text-right text-[6px] text-slate-400">Documento gerado pela plataforma em {hoje} · {CONTRATADA}</p>
      </article>
    </main>
  );
}
