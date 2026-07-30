export function normalizeAccessUsername(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/[.\s]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .toUpperCase();
}

export function normalizeLoginUsername(value: string | null | undefined) {
  const usuario = (value ?? "").trim().toUpperCase();
  if (!usuario || /[\s,]/.test(usuario)) return "";
  const normalized = usuario.replace(/\.{2,}/g, ".").replace(/^\.+|\.+$/g, "");
  return normalized.includes(".") ? normalized : "";
}

export function toColaboradorCodigo(usuario: string | null | undefined) {
  return (usuario ?? "")
    .trim()
    .replace(/\.+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}
