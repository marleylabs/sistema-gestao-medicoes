// Fonte única do comprimento mínimo de senha — usada tanto no backend (lib/auth.ts, geração e
// validação) quanto em componentes client-side (não pode importar lib/auth.ts, que é "server-only").
// Alterar aqui é suficiente para manter frontend e backend sempre de acordo.
export const MIN_PASSWORD_LENGTH = 6;
