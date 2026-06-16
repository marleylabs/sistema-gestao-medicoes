"use client";

import { useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Edit, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui";
import type { Medicao } from "@/components/types";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function dateLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

export function MedicoesTable({
  medicoes,
  loading,
  onEdit,
  onDelete,
}: {
  medicoes: Medicao[];
  loading: boolean;
  onEdit: (medicao: Medicao) => void;
  onDelete: (medicao: Medicao) => void;
}) {
  const columns = useMemo<ColumnDef<Medicao>[]>(
    () => [
      {
        accessorKey: "numeroMedicao",
        header: "Medição",
        cell: ({ row }) => <span className="font-semibold text-[#1A1A1A]">{row.original.numeroMedicao}</span>,
      },
      {
        accessorFn: (row) => row.projeto.codigoProjeto,
        id: "projeto",
        header: "Projeto",
        cell: ({ row }) => (
          <div className="min-w-52">
            <div className="font-medium text-[#1A1A1A]">{row.original.projeto.codigoProjeto}</div>
            <div className="text-xs text-[#1A1A1A]">{row.original.projeto.contrato ?? row.original.projeto.centroCusto ?? "-"}</div>
          </div>
        ),
      },
      {
        accessorFn: (row) => row.coordenador?.nome ?? "",
        id: "coordenador",
        header: "Coordenador",
        cell: ({ row }) => row.original.coordenador?.nome ?? "-",
      },
      {
        accessorFn: (row) => row.profissional?.nome ?? "",
        id: "profissional",
        header: "Profissional",
        cell: ({ row }) => (
          <div className="min-w-44">
            <div>{row.original.profissional?.nome ?? "-"}</div>
            <div className="text-xs text-[#1A1A1A]">{row.original.profissional?.nomeCompleto ?? row.original.profissional?.funcao ?? ""}</div>
            {row.original.profissional?.statusColaborador ? (
              <div className="mt-1 inline-flex rounded-md bg-[#F5F5F5] px-2 py-0.5 text-xs font-bold text-[#AF1B1B]">
                {row.original.profissional.statusColaborador}
              </div>
            ) : null}
            {row.original.profissional?.email ? <div className="text-xs text-[#1A1A1A]">{row.original.profissional.email}</div> : null}
          </div>
        ),
      },
      {
        accessorKey: "dataCadastro",
        header: "Cadastro",
        cell: ({ row }) => dateLabel(row.original.dataCadastro),
      },
      {
        accessorKey: "medidoHoras",
        header: "HH",
        cell: ({ row }) => <span className="tabular-nums">{number.format(row.original.medidoHoras)}</span>,
      },
      {
        accessorKey: "valorTotal",
        header: "Valor total",
        cell: ({ row }) => <span className="font-semibold tabular-nums">{currency.format(row.original.valorTotal)}</span>,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <IconButton onClick={() => onEdit(row.original)} title="Editar">
              <Edit size={15} />
            </IconButton>
            <IconButton onClick={() => onDelete(row.original)} title="Excluir" className="text-[#AF1B1B] hover:bg-[#F5F5F5]">
              <Trash2 size={15} />
            </IconButton>
          </div>
        ),
      },
    ],
    [onDelete, onEdit],
  );

  const table = useReactTable({
    data: medicoes,
    columns,
    state: {
      sorting: defaultSorting,
    },
    onSortingChange: () => undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-lg border border-[#d8dee8] bg-white">
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#F5F5F5]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-10 text-center text-[#1A1A1A]" colSpan={columns.length}>
                  Carregando medições...
                </td>
              </tr>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-[#edf1f6] last:border-0 hover:bg-[#F5F5F5]">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-3 align-middle text-[#1A1A1A]">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-10 text-center text-[#1A1A1A]" colSpan={columns.length}>
                  Nenhuma medição encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const defaultSorting: SortingState = [];
