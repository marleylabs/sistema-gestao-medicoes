import type { ResolucaoIdentidade } from "@/lib/profissional-identidade";

/**
 * Escopo do fornecedor (spec docs/brain/specs/p1-escopo-fornecedor-por-identidade.md): um valor só
 * entra na lista se o resolver oficial o liga ao MESMO Profissional da sessão. Nome que resolve para
 * outro, ambíguo ou não resolvido fica fora — nunca semelhança, nunca CNPJ (decisão 003).
 */
export async function filtrarAliasesDaIdentidade(
  candidatos: Array<string | null | undefined>,
  resolver: (valor: string) => Promise<ResolucaoIdentidade>,
  profissionalId: string,
): Promise<string[]> {
  const distintos = Array.from(new Set(candidatos.map((c) => c?.trim()).filter((c): c is string => !!c)));
  const resolvidos = await Promise.all(distintos.map(resolver));
  return distintos.filter((_, i) => {
    const r = resolvidos[i];
    return r.status === "RESOLVIDO" && r.profissionalId === profissionalId;
  });
}
