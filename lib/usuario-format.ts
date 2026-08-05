export const INTERNAL_ACCESS_CODE_PATTERN = /^P0\d{6}$/;

export function isInternalAccessCode(value: string | null | undefined) {
  return INTERNAL_ACCESS_CODE_PATTERN.test((value ?? "").trim().toUpperCase());
}

export function normalizeAccessUsername(value: string | null | undefined) {
  const internalCode = (value ?? "").trim().toUpperCase();
  return isInternalAccessCode(internalCode) ? internalCode : "";
}

export function normalizeLoginUsername(value: string | null | undefined) {
  return normalizeAccessUsername(value);
}

export function toColaboradorCodigo(usuario: string | null | undefined) {
  return (usuario ?? "")
    .trim()
    .replace(/\.+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}
