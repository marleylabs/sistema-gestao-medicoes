import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createWorkbookXlsx } from "@/lib/xlsx";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.perfil !== "COLABORADOR") {
    return NextResponse.json({ error: "Acesso restrito ao fornecedor." }, { status: 403 });
  }

  const buffer = createWorkbookXlsx([
    {
      name: "Documentos",
      headers: ["NR VALE", "Formato", "A1eq/HH", "% Emissão", "TIPO DG/DOC/HH"],
      rows: [],
      columnWidths: [22, 16, 14, 14, 20],
    },
    {
      name: "INSTRUÇÕES",
      headers: ["Instruções de preenchimento"],
      rows: [
        ["Preencha uma linha para cada documento medido que você possui neste ciclo."],
        ["NR VALE: número/referência do documento, exatamente como consta no seu controle."],
        ["Formato: o formato do documento (ex.: PDF, DWG)."],
        ["A1eq/HH: valor numérico de equivalência A1/HH do documento."],
        ["% Emissão: percentual de emissão do documento (aceita 100 ou 100%)."],
        ["TIPO DG/DOC/HH: o tipo do item medido (DG, DOC ou HH)."],
        ["Não é necessário informar preço, valor, fornecedor, CNPJ ou ciclo — esses dados já estão no sistema."],
        ["Salve o arquivo em formato .xlsx e envie na tela de Conferência da Medição."],
      ],
      columnWidths: [70],
    },
  ]);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Mascara_Conferencia_Medicao.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
