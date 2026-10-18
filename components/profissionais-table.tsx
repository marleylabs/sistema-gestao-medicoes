"use client";

import { Mail } from "lucide-react";
import type { Profissional } from "@/components/types";

export function ProfissionaisTable({ profissionais }: { profissionais: Profissional[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-lg font-bold text-[var(--foreground)]">Cadastro de profissionais</h2>
        <p className="text-sm text-[var(--foreground)]">Informações consolidadas da planilha principal e do cadastro administrativo.</p>
      </div>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[1180px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--surface-muted)]">
            <tr>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">ID</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">Nome completo</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">CPF</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">Razão social</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">CNPJ</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">E-mail</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">Status</th>
              <th className="border-b border-[var(--border)] px-3 py-3 text-left text-xs font-bold uppercase text-[var(--foreground)]">Função</th>
            </tr>
          </thead>
          <tbody>
            {profissionais.map((profissional) => (
              <tr key={profissional.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-muted)]">
                <td className="px-3 py-3 font-semibold text-[var(--foreground)]">{profissional.codigo ?? profissional.nome}</td>
                <td className="px-3 py-3 text-[var(--foreground)]">{profissional.nomeCompleto ?? "-"}</td>
                <td className="px-3 py-3 text-[var(--foreground)]">{profissional.cpf ?? "-"}</td>
                <td className="px-3 py-3 text-[var(--foreground)]">{profissional.razaoSocial ?? "-"}</td>
                <td className="px-3 py-3 text-[var(--foreground)]">{profissional.cnpj ?? "-"}</td>
                <td className="px-3 py-3 text-[var(--foreground)]">
                  {profissional.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail size={14} />
                      {profissional.email}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-3 text-[var(--foreground)]">
                  {profissional.statusColaborador ? (
                    <span className="inline-flex rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-bold text-[var(--primary)]">
                      {profissional.statusColaborador}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-3 text-[var(--foreground)]">{profissional.funcao ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
