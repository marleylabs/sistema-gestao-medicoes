import { NextResponse } from "next/server";

/**
 * Resposta JSON que nunca pode ser guardada em cache (navegador, proxy, CDN) — para as respostas
 * que carregam uma credencial de exibição única (senha temporária gerada agora, mostrada uma vez
 * ao ADMIN e nunca mais recuperável).
 */
export function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
}
