function onlyDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export const INTERNAL_ACCESS_CODE_PATTERN = /^P0\d{6}$/;

export function isInternalAccessCode(value: string | null | undefined) {
  return INTERNAL_ACCESS_CODE_PATTERN.test((value ?? "").trim().toUpperCase());
}

export function isFornecedorAccessCnpj(value: string | null | undefined) {
  return onlyDigits(value).length === 14;
}

export function normalizeFornecedorAccessCnpj(value: string | null | undefined) {
  const digits = onlyDigits(value);
  return digits.length === 14 ? digits : "";
}

export function normalizeAccessUsername(value: string | null | undefined) {
  const cnpj = normalizeFornecedorAccessCnpj(value);
  if (cnpj) return cnpj;
  const internalCode = (value ?? "").trim().toUpperCase();
  return isInternalAccessCode(internalCode) ? internalCode : "";
}

export function normalizeLoginUsername(value: string | null | undefined) {
  return normalizeAccessUsername(value);
}

export function toColaboradorCodigo(usuario: string | null | undefined) {
  const cnpj = normalizeFornecedorAccessCnpj(usuario);
  if (cnpj) return cnpj;
  return (usuario ?? "")
    .trim()
    .replace(/\.+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}
