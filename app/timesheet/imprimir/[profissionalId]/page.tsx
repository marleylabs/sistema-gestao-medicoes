import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { carregarFolha, TimesheetError } from "@/lib/timesheet";
import { formatarData, formatarDuracao } from "@/lib/timesheet-calculo";
import { CONTRATADA, linhasCabecalho } from "@/lib/timesheet-export";
import { exigirUuid, registrarExportacao } from "@/lib/timesheet-medicao";
import { BotaoImprimir } from "@/components/timesheet/botao-imprimir";

/**
 * Folha de Apropriação de Horas para impressão (T9 do plano do Timesheet ATO): a medição usa
 * "Salvar como PDF" do navegador. Documento sempre preto no branco, independente do tema da tela.
 */
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
  const th = "border border-black px-1 py-0.5 font-semibold";
  const td = "border border-black px-1 py-0.5";
  return (
    <main className="min-h-screen bg-white p-6 text-[11px] text-black print:p-0" data-testid="timesheet-impressao">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-neutral-600">No diálogo de impressão, escolha orientação paisagem e &quot;Salvar como PDF&quot;.</p>
        <BotaoImprimir />
      </div>

      <header className="mb-3 grid grid-cols-[1fr_auto] gap-4 border border-black p-2">
        <div>
          <h1 className="text-base font-bold">Folha de Apropriação de Horas</h1>
          <p>Tipo de Serviço: ATO · Contratada: {CONTRATADA}</p>
          <p className="text-[13px] font-semibold">{folha.fornecedor.nome}</p>
          {cab.area && <p className="font-semibold">{cab.area}</p>}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          {linhasCabecalho(folha)
            .filter(([rotulo, valor]) => valor && !["Tipo de Serviço", "Contratada", "Colaborador", "Área"].includes(rotulo))
            .map(([rotulo, valor]) => (
              <div key={rotulo} className="contents">
                <dt className="font-semibold">{rotulo}:</dt>
                <dd>{valor}</dd>
              </div>
            ))}
        </dl>
      </header>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th rowSpan={2} className={th}>DIA-MÊS</th>
            <th colSpan={2} className={th}>MANHÃ</th>
            <th colSpan={2} className={th}>TARDE</th>
            <th rowSpan={2} className={th}>HORA NORMAL</th>
            <th rowSpan={2} className={th}>HORA EXTRA 50%</th>
            <th rowSpan={2} className={th}>HORA EXTRA 100%</th>
            <th rowSpan={2} className={th}>TOTAL DE HORAS</th>
            <th rowSpan={2} className={th}>PROJETO/PEP</th>
            <th rowSpan={2} className={th}>DESCRIÇÃO DOS SERVIÇOS</th>
            <th rowSpan={2} className={th}>SOLICITANTE</th>
          </tr>
          <tr>
            <th className={th}>ENTRADA</th><th className={th}>SAÍDA</th><th className={th}>ENTRADA</th><th className={th}>SAÍDA</th>
          </tr>
        </thead>
        <tbody>
          {folha.dias.map((d) => (
            <tr key={d.data} className={d.tipo !== "UTIL" ? "bg-neutral-100" : undefined}>
              <td className={`${td} whitespace-nowrap`}>{formatarData(d.data)}{d.feriado ? ` · ${d.feriado}` : ""}</td>
              <td className={`${td} text-center`}>{d.entrada1 ?? ""}</td>
              <td className={`${td} text-center`}>{d.saida1 ?? ""}</td>
              <td className={`${td} text-center`}>{d.entrada2 ?? ""}</td>
              <td className={`${td} text-center`}>{d.saida2 ?? ""}</td>
              <td className={`${td} text-right tabular-nums`}>{formatarDuracao(d.horas.hn)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatarDuracao(d.horas.he50)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatarDuracao(d.horas.he100)}</td>
              <td className={`${td} text-right font-semibold tabular-nums`}>{formatarDuracao(d.horas.total)}</td>
              <td className={td}>{d.projetoPep ?? ""}</td>
              <td className={td}>{d.descricao ?? ""}</td>
              <td className={td}>{d.solicitante ?? ""}</td>
            </tr>
          ))}
          <tr className="font-bold" data-testid="timesheet-impressao-total">
            <td colSpan={5} className={td}>TOTAL</td>
            <td className={`${td} text-right tabular-nums`}>{formatarDuracao(folha.totais.hn)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatarDuracao(folha.totais.he50)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatarDuracao(folha.totais.he100)}</td>
            <td className={`${td} text-right tabular-nums`}>{formatarDuracao(folha.totais.total)}</td>
            <td colSpan={3} className={td} />
          </tr>
        </tbody>
      </table>

      <footer className="mt-8 grid grid-cols-2 gap-10 break-inside-avoid">
        <div>
          <p className="border-t border-black pt-1">Ass.: {folha.fornecedor.nome}</p>
          <p className="mt-1">em ____ / ____ / ______</p>
        </div>
        <div>
          <p className="border-t border-black pt-1">Visto fiscalização da VALE: {cab.fiscal ?? ""}</p>
          <p className="mt-1">em ____ / ____ / ______</p>
        </div>
        <p className="col-span-2">Observações:</p>
      </footer>
    </main>
  );
}
