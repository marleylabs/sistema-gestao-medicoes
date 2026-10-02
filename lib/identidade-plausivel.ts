/**
 * Heurística de APRESENTAÇÃO (nunca decide identidade): o texto parece nome de pessoa/empresa?
 * Usada para não oferecer "Confirmar como novo fornecedor" nem alias para resíduo de parser —
 * números de documento/GRD/orçamento ("GRD-…", "ORC-…") ou descrições longas
 * ("HORAS DE ESTUDO PARA …"). Sem dependência de servidor: roda no cliente e no backend.
 */
const PREFIXO_DOCUMENTO = /^(GRD|ORC|DOC|MC|RT|LD|MD|PT)[-_./][A-Z0-9]*[-_./]/i;

export function pareceNomeDeFornecedor(valor: string | null | undefined): boolean {
  const texto = String(valor ?? "").trim();
  if (texto.length < 3 || texto.length > 80) return false;
  // Documento/GRD/orçamento/ano: prefixo de documento ou 4+ dígitos seguidos. Um dígito isolado é
  // nome legítimo de empresa ("A1 ENGENHARIA", "3D PROJETOS", "ENGENHARIA 360").
  if (PREFIXO_DOCUMENTO.test(texto) || /\d{4,}/.test(texto)) return false;
  const letras = texto.replace(/[^\p{L}]/gu, "");
  if (letras.length < 3) return false;
  const palavras = texto.split(/\s+/).filter(Boolean);
  return palavras.length <= 8; // descrição de serviço, não nome
}
