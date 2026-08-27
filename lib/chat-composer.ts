/**
 * Decide se um keydown no composer do chat deve enviar a mensagem: ENTER sem SHIFT e fora de
 * composição de IME envia; SHIFT+ENTER quebra linha (deixa o textarea tratar normalmente);
 * mensagem vazia (após trim) ou já enviando nunca dispara.
 */
export function shouldSendOnEnter(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  draft: string;
  sending: boolean;
  hasSelected: boolean;
}) {
  if (input.key !== "Enter" || input.shiftKey || input.isComposing) return false;
  if (input.sending || !input.hasSelected) return false;
  return input.draft.trim().length > 0;
}
