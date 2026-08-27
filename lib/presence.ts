/**
 * Presença de chat: baseada em atividade real (heartbeat periódico atualizando
 * `Usuario.onlineAt`), nunca em "possui sessão válida" — uma sessão pode ficar válida por horas
 * depois que o usuário fechou a aplicação. Constantes centralizadas aqui para nunca divergirem
 * entre o intervalo de heartbeat do cliente e a janela de corte usada para decidir online/offline.
 */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 45_000;
export const PRESENCE_ONLINE_WINDOW_MS = 90_000;

export function isOnline(onlineAt: Date | null | undefined) {
  return !!onlineAt && Date.now() - onlineAt.getTime() <= PRESENCE_ONLINE_WINDOW_MS;
}
