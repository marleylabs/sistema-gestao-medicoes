"use client";

import { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { cicloToDates } from "@/lib/ciclo";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

function fmt(v: number) { return v ? brl.format(v) : "R$0,00"; }
function fmtN(v: number) { return v ? num.format(v) : "0,000"; }
function fmtP(v: number) { return v ? pct.format(v) : "0%"; }

function dateLabel(v: string | null) {
  if (!v) return "–";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${v}T00:00:00`));
}

function mesLabel(v: string | null) {
  if (!v) return "–";
  // "Maio de 2026" → "mai/26"
  const meses: Record<string, string> = {
    janeiro: "jan", fevereiro: "fev", março: "mar", marco: "mar",
    abril: "abr", maio: "mai", junho: "jun",
    julho: "jul", agosto: "ago", setembro: "set",
    outubro: "out", novembro: "nov", dezembro: "dez",
  };
  const lower = v.toLowerCase();
  const mes = Object.keys(meses).find((k) => lower.includes(k));
  const ano = v.match(/\d{4}/)?.[0]?.slice(2);
  if (mes && ano) return `${meses[mes]}/${ano}`;
  return v;
}

export type BmData = {
  ciclo: string;
  revisaoNumero: number;
  revisaoLabel: string | null;
  aprovadoAt: string | null;
  colaborador: {
    nome: string; cpf: string | null; cnpj: string | null;
    razaoSocial: string | null; funcao: string | null;
  };
  contexto: {
    mesReferencia: string | null;
    producaoInicio: string | null;
    producaoFim: string | null;
    atoCiclo: string | null;
  } | null;
  pagamento: {
    ato: string | null; valor: number; rev: number; horas: number;
    intrSossego: number; salobo: number; acg: number; escadasAlumar: number;
    razaoSocial: string | null; cpfCnpj: string | null;
  } | null;
  documentos: Array<{
    id: string; projetoReferente: string; tituloPrimario: string | null;
    contrato: string | null; dataCadastro: string | null; formato: string | null;
    quantidade: number; equivalenteA1Horas: number; medidoHoras: number;
    valorMedicao: number; valorUnitario: number; valorTotal: number; percentualEmissao: number;
    numeroDocumento: string | null; tipo2: string | null; condicao: string | null;
    precoUnitario: number; valorMedido: number; obs: string | null;
  }>;
};

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function Th({ children, colSpan, rowSpan, className = "" }: {
  children?: React.ReactNode; colSpan?: number; rowSpan?: number; className?: string;
}) {
  return (
    <th
      colSpan={colSpan} rowSpan={rowSpan}
      className={`border border-[#555] bg-[#D9D9D9] px-1.5 py-1 text-center text-[10px] font-bold uppercase leading-tight ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, colSpan, rowSpan, className = "", bold = false }: {
  children?: React.ReactNode; colSpan?: number; rowSpan?: number; className?: string; bold?: boolean;
}) {
  return (
    <td
      colSpan={colSpan} rowSpan={rowSpan}
      className={`border border-[#555] px-1.5 py-1 text-[10px] leading-tight ${bold ? "font-bold" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

// ─── BoletimMedicao ───────────────────────────────────────────────────────────

export function BoletimMedicao({ data }: { data: BmData }) {
  const printRef = useRef<HTMLDivElement>(null);

  const rev = `_Rev_${String(data.revisaoNumero).padStart(2, "0")}`;
  const cpfCnpj = data.colaborador.cnpj || data.colaborador.cpf || data.pagamento?.cpfCnpj || "–";
  const razaoSocial = data.colaborador.razaoSocial || data.pagamento?.razaoSocial || "–";
  const funcao = data.colaborador.funcao || data.pagamento?.ato || "–";
  const pagamento = data.pagamento;
  const ctx = data.contexto;

  // Datas derivadas automaticamente do ciclo como fallback
  const datas = cicloToDates(data.ciclo);
  const producaoInicio = ctx?.producaoInicio || datas.producaoInicio;
  const producaoFim    = ctx?.producaoFim    || datas.producaoFim;
  const atoInicio      = datas.atoInicio;
  const atoFim         = datas.atoFim;

  const totalHorasDocs = data.documentos.reduce((s, d) => s + d.equivalenteA1Horas, 0);
  const totalHoras = totalHorasDocs || pagamento?.horas || 0;
  const totalValor = pagamento?.valor ?? 0;
  const totalRev   = pagamento?.rev ?? 0;
  const totalMedicao = totalValor + totalRev;

  // rateio por contrato
  const totalPart = (pagamento?.intrSossego ?? 0) + (pagamento?.salobo ?? 0) + (pagamento?.acg ?? 0) + (pagamento?.escadasAlumar ?? 0);
  const pctSossego = totalPart > 0 ? (pagamento?.intrSossego ?? 0) / totalPart : 0;
  const pctSalobo  = totalPart > 0 ? (pagamento?.salobo  ?? 0) / totalPart : 0;
  const pctAcg     = totalPart > 0 ? (pagamento?.acg     ?? 0) / totalPart : 0;
  const pctEscadas = totalPart > 0 ? (pagamento?.escadasAlumar ?? 0) / totalPart : 0;

  const valorSossego = totalMedicao * pctSossego;
  const valorSalobo  = totalMedicao * pctSalobo;
  const valorAcg     = totalMedicao * pctAcg;
  const valorEscadas = totalMedicao * pctEscadas;

  function handlePrint() {
    const content = printRef.current;
    if (!content) return;
    const win = window.open("", "_blank", "width=1100,height=900");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Boletim de Medição – ${data.colaborador.nome} – Ciclo ${data.ciclo}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 10px; padding: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #555; padding: 3px 5px; font-size: 10px; }
        th { background: #D9D9D9; font-weight: bold; text-transform: uppercase; }
        .total-box { background: #FFD966; font-size: 16px; font-weight: bold; }
        @media print { body { padding: 0; } }
      </style>
      </head><body>${content.innerHTML}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 300);
  }

  return (
    <div>
      {/* Print button */}
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" onClick={handlePrint}>
          <Printer size={14} />
          Gerar PDF / Imprimir
        </Button>
      </div>

      {/* BM content */}
      <div ref={printRef} className="overflow-auto">
        <table className="w-full min-w-[800px] border-collapse text-[10px]" style={{ fontFamily: "Arial, sans-serif" }}>

          {/* ── Linha 1: Título ── */}
          <tbody>
            <tr>
              <Td colSpan={10} bold className="bg-[#1F3864] text-white text-[13px] py-2 text-left pl-3">
                BOLETIM DE MEDIÇÃO
              </Td>
              <Td colSpan={2} className="text-right font-bold text-[11px]">{rev}</Td>
            </tr>

            {/* ── Linha 2: Nome / Função / CNPJ / Pagamento ── */}
            <tr>
              <Th colSpan={1}>Nome</Th>
              <Td colSpan={5} bold>{data.colaborador.nome}</Td>
              <Th colSpan={1}>Função</Th>
              <Td colSpan={1}>{funcao}</Td>
              <Th colSpan={1}>CNPJ</Th>
              <Td colSpan={1}>{cpfCnpj}</Td>
              <Th colSpan={1}>Pagamento</Th>
              <Td bold className="text-center">{mesLabel(ctx?.mesReferencia ?? null)}</Td>
            </tr>

            {/* ── Linha 3: Razão Social / Ciclo / Datas ── */}
            <tr>
              <Th>Razão Social</Th>
              <Td colSpan={5}>{razaoSocial}</Td>
              <Th colSpan={1}>Início do Ciclo</Th>
              <Td className="text-center">{dateLabel(atoInicio)}</Td>
              <Th colSpan={1}>Fim do Ciclo</Th>
              <Td className="text-center">{dateLabel(atoFim)}</Td>
              <Th>Ciclo</Th>
              <Td bold className="text-center">{data.ciclo}</Td>
            </tr>

            {/* ── Linha 4: separador ── */}
            <tr><Td colSpan={12} className="bg-[#1F3864] py-0.5" /></tr>

            {/* ── Linhas 5-12: OBSERVAÇÕES + CONDIÇÕES COMERCIAIS ── */}
            <tr>
              <Th rowSpan={4} colSpan={2} className="text-left pl-2 align-top">
                <div>OBSERVAÇÕES</div>
                <div className="mt-2 text-[9px] font-normal normal-case text-[#555]">
                  <div>Produção: {dateLabel(producaoInicio)} a {dateLabel(producaoFim)}</div>
                  <div>ATO: {dateLabel(atoInicio)} a {dateLabel(atoFim)}</div>
                </div>
              </Th>
              <Th colSpan={7}>CONDIÇÕES COMERCIAIS</Th>
              <Td rowSpan={4} colSpan={3} className="bg-[#FFD966] text-center align-middle">
                <div className="text-[10px] font-bold uppercase">TOTAL DA MEDIÇÃO</div>
                <div className="text-[18px] font-bold mt-1">{fmt(totalMedicao)}</div>
              </Td>
            </tr>
            <tr>
              <Th>Cond. Fiza (CLT)</Th>
              <Th>Cond. Fiza (PJ)</Th>
              <Th>Garantia (CLT)</Th>
              <Th>Garantia (PJ)</Th>
              <Th>Desenhos ou MC</Th>
              <Th>DOC</Th>
              <Th>HH</Th>
            </tr>
            <tr>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center font-bold">{fmt(totalValor)}</Td>
            </tr>
            <tr>
              <Th colSpan={3}>INICIAL</Th>
              <Th colSpan={2}>ARQ</Th>
              <Th>HH</Th>
              <Th>VERIFICAÇÃO</Th>
            </tr>

            <tr>
              <Td colSpan={2} className="bg-[#F3F3F3]" />
              <Th>DG</Th>
              <Th>DOC</Th>
              <Th>DG</Th>
              <Th>DOC</Th>
              <Th>HH</Th>
              <Th>A1</Th>
              <Td colSpan={4} className="text-center font-bold">{fmtN(totalHoras)}</Td>
            </tr>
            <tr>
              <Td colSpan={2} className="bg-[#F3F3F3]" />
              <Td className="text-center">0,000</Td>
              <Td className="text-center">0,000</Td>
              <Td className="text-center">0,000</Td>
              <Td className="text-center">0,000</Td>
              <Td className="text-center font-bold">{fmtN(totalHoras)}</Td>
              <Td className="text-center">0,000</Td>
              <Td colSpan={4} />
            </tr>

            {/* ── Linha separador ── */}
            <tr><Td colSpan={12} className="bg-[#1F3864] py-0.5" /></tr>

            {/* ── Medição por contrato + Rateio ── */}
            <tr>
              <Th colSpan={6}>MEDIÇÃO POR CONTRATO</Th>
              <Th colSpan={6}>RATEIO DO CUSTO</Th>
            </tr>
            <tr>
              <Th>Intr. Sossego</Th>
              <Th>Salobo</Th>
              <Th>ACG</Th>
              <Th>Escadas</Th>
              <Th>Outros</Th>
              <Th>Total</Th>
              <Th>Integridade SS</Th>
              <Th>Salobo</Th>
              <Th>ACG</Th>
              <Th>Escadas Alumar</Th>
              <Th colSpan={2}>Descontos</Th>
            </tr>
            <tr>
              <Td className="text-center">{fmt(valorSossego)}</Td>
              <Td className="text-center">{fmt(valorSalobo)}</Td>
              <Td className="text-center">{fmt(valorAcg)}</Td>
              <Td className="text-center">{fmt(valorEscadas)}</Td>
              <Td className="text-center">R$0,00</Td>
              <Td className="text-center font-bold">{fmt(totalMedicao)}</Td>
              <Td className="text-center">{fmtP(pctSossego)}</Td>
              <Td className="text-center">{fmtP(pctSalobo)}</Td>
              <Td className="text-center">{fmtP(pctAcg)}</Td>
              <Td className="text-center">{fmtP(pctEscadas)}</Td>
              <Td colSpan={2} className="text-center">–</Td>
            </tr>

            {/* ── Linha separador ── */}
            <tr><Td colSpan={12} className="bg-[#1F3864] py-0.5" /></tr>

            {/* ── Cabeçalho da tabela de documentos ── */}
            {(() => {
              const hasObs = data.documentos.some((d) => d.obs);
              const totalDocMedido = data.documentos.reduce((s, d) => s + d.valorMedido, 0);
              return (
                <>
                  <tr>
                    <Th>SE</Th>
                    <Th colSpan={2}>NR VALE / Projeto</Th>
                    <Th>CTO</Th>
                    <Th>Formato</Th>
                    <Th>A1eq / HH</Th>
                    <Th>% Emissão</Th>
                    <Th colSpan={2}>TIPO DG/DOC/HH</Th>
                    <Th>Preço Unit.</Th>
                    <Th>Valor Medido</Th>
                    <Th>Total</Th>
                    {hasObs && <Th>Observação</Th>}
                  </tr>

                  {/* ── Linhas de documentos ── */}
                  {data.documentos.length === 0 ? (
                    <tr>
                      <Td colSpan={hasObs ? 13 : 12} className="text-center text-[#9CA3AF] py-3">Nenhum documento vinculado a este ciclo.</Td>
                    </tr>
                  ) : (
                    data.documentos.map((doc) => (
                      <tr key={doc.id}>
                        <Td className="text-center">{doc.projetoReferente}</Td>
                        <Td colSpan={2}>{doc.numeroDocumento ?? "–"}</Td>
                        <Td>{doc.contrato ?? "–"}</Td>
                        <Td className="text-center">{doc.formato ?? "–"}</Td>
                        <Td className="text-center">{fmtN(doc.equivalenteA1Horas)}</Td>
                        <Td className="text-center">{doc.percentualEmissao ? fmtP(doc.percentualEmissao) : "100%"}</Td>
                        <Td colSpan={2} className="text-[9px]">{doc.tipo2 ?? "–"}</Td>
                        <Td className="text-right">{doc.precoUnitario ? fmt(doc.precoUnitario) : (doc.condicao ?? "–")}</Td>
                        <Td className="text-right">{fmt(doc.valorMedido)}</Td>
                        <Td className="text-right font-bold">{fmt(doc.valorMedido)}</Td>
                        {hasObs && <Td className="text-[9px] text-[#555555]">{doc.obs ?? ""}</Td>}
                      </tr>
                    ))
                  )}

                  {/* ── Totais finais ── */}
                  <tr>
                    <Td colSpan={5} className="bg-[#F3F3F3]" />
                    <Td className="text-center font-bold bg-[#D9D9D9]">{fmtN(totalHoras)}</Td>
                    <Td className="bg-[#F3F3F3]" />
                    <Td colSpan={3} className="bg-[#F3F3F3]" />
                    <Td className="text-right font-bold bg-[#FFD966]">{fmt(totalDocMedido || totalMedicao)}</Td>
                    <Td className="text-right font-bold bg-[#FFD966]">{fmt(totalDocMedido || totalMedicao)}</Td>
                    {hasObs && <Td className="bg-[#F3F3F3]" />}
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
