---
atualizado: 2026-10-19
tags: [modulo]
---
# Chat

**O que faz:** conversas diretas e de equipe entre usuários, com anexos, contagem de não lidas e presença.

**Onde está:** `app/api/chat/`, `lib/chat-*.ts`, `lib/presence.ts`, `components/general-chat-widget.tsx`

**Arquivos-chave:**
- `app/api/chat/_helpers.ts`: quem pode conversar com quem (`canChatWith`).
- `lib/chat-teams.ts`: conversas fixas de equipe (`TEAM:<PERFIL>`). A de FINANCEIRO está desativada (só leitura).
- `lib/presence.ts`: heartbeat de 45 s em `Usuario.onlineAt`; online por 90 s.
- `hooks/use-live-refresh.ts`: polling que pausa em aba oculta.

**Regras e armadilhas:**
- Não há WebSocket nem SSE: tudo é polling ([005](../decisoes/005-polling-para-tempo-real.md)). O widget atualiza a cada 5 s.
- Os anexos ficam em `Bytes` no banco. `ChatMensagem.origem` é único e serve de idempotência para mensagens do sistema.
- Cada fornecedor tem uma única conversa com a equipe interna. Todo caminho que cria conversa com fornecedor (POST de `/api/chat/conversas`, importação do SGC) reusa `findFornecedorConversa` (`lib/chat-teams.ts`), que ignora as equipes desabilitadas.
- Duplicatas antigas: `scripts/mesclar-chat-duplicado.ts` mantém a conversa mais recente de cada fornecedor e move para ela as mensagens e os participantes das outras.
- `GET /api/chat/conversas` roda em paralelo para o mesmo usuário (a tela dispara mais de uma). O `upsert` do Prisma não é atômico: dois pedidos inserem a mesma linha e um cai em P2002 (500). Inserção idempotente usa `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING) ou trata P2002 como sucesso, como em `joinSharedFornecedorChats` e `importSgcChatsForUser`. Testes: `tests/chat-join-shared-concurrency.test.ts`, `tests/chat-import-concurrency.test.ts`.
- Excluir um usuário apagaria o chat em cascata; por isso o fornecedor é só soft-deleted.

**Depende de:** [Autenticação](autenticacao.md)
