"use client";

import { Mail } from "lucide-react";
import type { Profissional } from "@/components/types";

export function ProfissionaisTable({ profissionais }: { profissionais: Profissional[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#d8dee8] bg-white">
      <div className="border-b border-[#d8dee8] px-4 py-3">
        <h2 className="text-lg font-bold text-[#1A1A1A]">Cadastro de profissionais</h2>
        <p className="text-sm text-[#1A1A1A]">Informações consolidadas da planilha principal e do cadastro administrativo.</p>
      </div>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#F5F5F5]">
            <tr>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">ID</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Nome completo</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">CPF</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Razão social</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">CNPJ</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">E-mail</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Status</th>
              <th className="border-b border-[#d8dee8] px-3 py-3 text-left text-xs font-bold uppercase text-[#1A1A1A]">Função</th>
            </tr>
          </thead>
          <tbody>
            {profissionais.map((profissional) => (
              <tr key={profissional.id} className="border-b border-[#edf1f6] last:border-0 hover:bg-[#F5F5F5]">
                <td className="px-3 py-3 font-semibold text-[#1A1A1A]">{profissional.codigo ?? profissional.nome}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">{profissional.nomeCompleto ?? "-"}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">{profissional.cpf ?? "-"}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">{profissional.razaoSocial ?? "-"}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">{profissional.cnpj ?? "-"}</td>
                <td className="px-3 py-3 text-[#1A1A1A]">
                  {profissional.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail size={14} />
                      {profissional.email}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-3 text-[#1A1A1A]">
                  {profissional.statusColaborador ? (
                    <span className="inline-flex rounded-md bg-[#F5F5F5] px-2 py-1 text-xs font-bold text-[#AF1B1B]">
                      {profissional.statusColaborador}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-3 text-[#1A1A1A]">{profissional.funcao ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
