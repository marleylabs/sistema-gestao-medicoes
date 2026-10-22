import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { carregarFolha, hojeSaoPaulo, TimesheetError } from "@/lib/timesheet";
import { formatarData, formatarDuracao } from "@/lib/timesheet-calculo";
import { CONTRATADA } from "@/lib/timesheet-export";
import { exigirUuid, registrarExportacao } from "@/lib/timesheet-medicao";
import { BotaoImprimir } from "@/components/timesheet/botao-imprimir";

/**
 * Folha de Apropriação de Horas para impressão (PDF pelo navegador), no visual do modelo oficial da VALE
 * (app-assets/templates/Timesheet_ATO.xlsx): mesmas colunas A–N e proporções, mesclagens, logos, cinza em
 * sábado/domingo/feriado e rodapé de assinaturas. Documento sempre preto no branco, independente do tema.
 */

// Larguras das colunas A–N do modelo (unidades do Excel), em % da folha.
const LARGURAS = ["w-[5.9%]", "w-[4.1%]", "w-[3.6%]", "w-[3.6%]", "w-[3.6%]", "w-[6.5%]", "w-[6.5%]", "w-[6.5%]", "w-[6.5%]", "w-[15.4%]", "w-[10.3%]", "w-[10.3%]", "w-[10.3%]", "w-[6.9%]"];

const hora = (hhmm: string | null) => (hhmm ? hhmm.replace(/^0(\d)/, "$1") : "");
const comSegundos = (min: number) => `${formatarDuracao(min)}:00`; // [h]:mm:ss do total no modelo

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
  const b = "border border-black";
  const cinzaTitulo = "bg-[#c0c0c0] [print-color-adjust:exact]";
  const cabecalhoDias = `${b} ${cinzaTitulo} px-0.5 text-center font-bold leading-tight`;
  const th = `${cabecalhoDias} text-[6.5px]`;
  const sub = `${cabecalhoDias} text-[5px]`; // colunas B–E são estreitas no modelo
  const td = `${b} h-[22px] px-0.5 text-center`;

  return (
    <main className="min-h-screen bg-white p-6 font-[Arial,Helvetica,sans-serif] text-black print:min-h-0 print:p-0" data-testid="timesheet-impressao">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-neutral-600">No diálogo de impressão, escolha A4 retrato, margens padrão e &quot;Salvar como PDF&quot;.</p>
        <BotaoImprimir />
      </div>

      {/* Tamanho nas células: o `table { font-size: 12px }` do globals.css fica fora das camadas e vence classe na tabela. */}
      <table className="mx-auto w-full max-w-[760px] table-fixed border-collapse leading-tight [&_td]:text-[8px]">
        <colgroup>{LARGURAS.map((w, i) => <col key={i} className={w} />)}</colgroup>
        <tbody>
          {/* Linhas 1–2: logos, data */}
          <tr className="h-[34px]">
            <td colSpan={3} rowSpan={2} className={b}>
              <Image src="/timesheet/vale.png" alt="VALE" width={197} height={73} className="mx-auto h-[46px] w-auto" />
            </td>
            <td colSpan={6} rowSpan={2} className={b}>
              <Image src="/timesheet/projeta.png" alt="Projeta Soluções em Engenharia" width={311} height={86} className="mx-auto h-[46px] w-auto" />
            </td>
            <td rowSpan={2} className={b} />
            <td colSpan={2} rowSpan={2} className={b} />
            <td colSpan={2} className="border-x border-t border-black px-0.5 align-top text-[6px]!">Data:</td>
          </tr>
          <tr className="h-[34px]">
            <td colSpan={2} className="border-x border-b border-black text-center text-[11px]! font-bold">{hoje}</td>
          </tr>

          {/* Linhas 3–4: título, contrato, documento */}
          <tr className="h-[14px]">
            <td colSpan={10} rowSpan={2} className={`${b} ${cinzaTitulo} text-center text-[11px]! font-bold`}>Folha de Apropriação de Horas</td>
            <td colSpan={2} className="border-x border-t border-black text-center text-[6px]!">Contrato N.º:</td>
            <td colSpan={2} className="border-x border-t border-black px-0.5 text-[6px]!">Doc. N.º: {cab.docNumero ?? ""}</td>
          </tr>
          <tr className="h-[14px]">
            <td colSpan={2} className="border-x border-b border-black text-center font-bold">{cab.contratoNumero ?? cab.contratoNome ?? ""}</td>
            <td colSpan={2} className="border-x border-b border-black" />
          </tr>

          {/* Linhas 5–9: identificação */}
          <tr className="h-[13px]">
            <td colSpan={12} className="border-l border-black px-0.5"><b>Tipo de Serviço</b>: ATO</td>
            <td colSpan={2} className={`${b} px-0.5`}>Local: {cab.local ?? ""}</td>
          </tr>
          <tr className="h-[13px]">
            <td colSpan={9} className="border-l border-black px-0.5"><b>Contratada:</b> {CONTRATADA}</td>
            <td colSpan={3} className="border-l border-black px-0.5"><b>Nº da SE:</b> {cab.numeroSe ?? ""}</td>
            <td colSpan={2} className={`${b} px-0.5 font-bold`}>Período:</td>
          </tr>
          <tr className="h-[13px]">
            <td colSpan={9} className="border-l border-black px-0.5 font-bold">Funcionário: {folha.fornecedor.nome}</td>
            <td colSpan={3} className="border-l border-black px-0.5">Função: {cab.funcao ?? ""}</td>
            <td colSpan={2} className={`${b} px-0.5`}>{formatarData(folha.periodo.inicio)} a {formatarData(folha.periodo.fim)}</td>
          </tr>
          <tr className="h-[13px]">
            <td colSpan={9} className="border-b border-l border-black" />
            <td colSpan={3} className="border-b border-l border-black" />
            <td colSpan={2} className={`${b} px-0.5`}>Item da PQ:  {cab.itemPq ?? ""}</td>
          </tr>
          <tr className="h-[13px]">
            <td colSpan={14} className={`${b} px-0.5 text-[7px]! font-bold`}>{cab.area ?? ""}</td>
          </tr>

          {/* Linhas 10–11: cabeçalho dos dias */}
          <tr>
            <th rowSpan={2} className={th}>DIA-MÊS</th>
            <th colSpan={2} className={th}>MANHÃ</th>
            <th colSpan={2} className={th}>TARDE</th>
            <th rowSpan={2} className={th}>HORA NORMAL</th>
            <th rowSpan={2} className={th}>HORA EXTRA 50%</th>
            <th rowSpan={2} className={th}>HORA EXTRA 100%</th>
            <th rowSpan={2} className={th}>TOTAL DE HORAS</th>
            <th rowSpan={2} className={th}>PROJETO/PEP</th>
            <th colSpan={3} rowSpan={2} className={th}>DESCRIÇÃO DOS SERVIÇOS</th>
            <th rowSpan={2} className={th}>SOLICITANTE</th>
          </tr>
          <tr>
            <th className={sub}>ENTRADA</th><th className={sub}>SAÍDA</th><th className={sub}>ENTRADA</th><th className={sub}>SAÍDA</th>
          </tr>

          {/* Linhas 12–42: dias (sábado, domingo e feriado em cinza, como no modelo) */}
          {folha.dias.map((d) => {
            const cinza = d.tipo !== "UTIL";
            return (
              <tr key={d.data} className={cinza ? "bg-[#808080] font-bold text-white [print-color-adjust:exact]" : undefined} data-testid={cinza ? "timesheet-impressao-dia-cinza" : undefined}>
                <td className={td}>{formatarData(d.data)}</td>
                <td className={td}>{hora(d.entrada1)}</td>
                <td className={td}>{hora(d.saida1)}</td>
                <td className={td}>{hora(d.entrada2)}</td>
                <td className={td}>{hora(d.saida2)}</td>
                <td className={`${td} tabular-nums`}>{formatarDuracao(d.horas.hn)}</td>
                <td className={`${td} tabular-nums`}>{formatarDuracao(d.horas.he50)}</td>
                <td className={`${td} tabular-nums`}>{formatarDuracao(d.horas.he100)}</td>
                <td className={`${td} font-bold tabular-nums`}>{formatarDuracao(d.horas.total)}</td>
                <td className={`${td} font-bold`}>{d.projetoPep ?? (d.feriado ? `Feriado: ${d.feriado}` : "")}</td>
                <td colSpan={3} className={td}>{d.descricao ?? ""}</td>
                <td className={td}>{d.solicitante ?? ""}</td>
              </tr>
            );
          })}

          {/* Linha 43: total */}
          <tr data-testid="timesheet-impressao-total">
            <td className={`${td} font-bold`}>TOTAL</td>
            <td className={td} /><td className={td} /><td className={td} /><td className={td} />
            <td className={`${td} tabular-nums`}>{comSegundos(folha.totais.hn)}</td>
            <td className={`${td} tabular-nums`}>{comSegundos(folha.totais.he50)}</td>
            <td className={`${td} tabular-nums`}>{comSegundos(folha.totais.he100)}</td>
            <td className={`${td} font-bold tabular-nums`}>{formatarDuracao(folha.totais.total)}</td>
            <td className={td} />
            <td colSpan={3} className={td} />
            <td className={td} />
          </tr>

          {/* Linhas 44–50: assinaturas e observações */}
          <tr className="h-[14px]"><td colSpan={14} className="border-x border-black" /></tr>
          <tr className="h-[16px] align-bottom">
            <td className="border-l border-black px-0.5">Ass.:</td>
            <td colSpan={9} className="border-b border-black px-0.5 font-bold">{folha.fornecedor.nome}</td>
            <td colSpan={4} className="border-b border-r border-black text-center">Visto fiscalização da VALE:  {cab.fiscal ?? ""}</td>
          </tr>
          <tr className="h-[16px]">
            <td colSpan={8} className="border-l border-black" />
            <td className="pr-1 text-right">em</td>
            <td className="border-r border-black pr-1 text-right">{hoje}</td>
            <td colSpan={4} className="border-r border-black pr-1 text-right">em {hoje}</td>
          </tr>
          <tr className="h-[14px]"><td colSpan={14} className="border-x border-b border-black px-0.5">Observações:</td></tr>
        </tbody>
      </table>
    </main>
  );
}
