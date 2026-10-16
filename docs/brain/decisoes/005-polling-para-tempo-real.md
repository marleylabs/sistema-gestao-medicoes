---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 005 Polling em vez de WebSocket/SSE

**Contexto:** o chat, a presença e as telas multiusuário precisam se atualizar sem recarregar.

**Decisão:** usar polling com `hooks/use-live-refresh.ts` (pausa em aba oculta e recarrega no foco). Registrada retroativamente.

**Alternativas descartadas:** WebSocket/SSE (mais infra no deploy standalone em Docker).

**Consequências:** a latência é de alguns segundos e há carga proporcional ao número de abas abertas.
