/** Tooltip dos gráficos do dashboard no tema (substitui o padrão do recharts, que é branco e usa estilo inline). */
export function GraficoTooltip({ titulo, rotulo, valor }: { titulo: string; rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] shadow-[var(--shadow-popover)]">
      <p className="font-semibold text-[var(--foreground)]">{titulo}</p>
      <p className="mt-0.5 text-[var(--muted-foreground)]">
        {rotulo}: <span className="font-technical font-semibold text-[var(--foreground)]">{valor}</span>
      </p>
    </div>
  );
}
