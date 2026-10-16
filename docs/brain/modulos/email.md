---
atualizado: 2026-10-16
tags: [modulo]
---
# E-mail

**O que faz:** envia as notificações do fluxo (BM disponível, divergência, aprovado, revisão, pagamento, primeiro acesso) via Resend e registra cada envio em `EmailLog`.

**Onde está:** `lib/email/`

**Arquivos-chave:**
- `lib/email/send-email.ts`: guardas de ambiente e idempotência (`pg_advisory_xact_lock` por chave).
- `lib/email/events.ts`: funções `notify*` chamadas pelas rotas e por `lib/bm-envio.ts` / `lib/first-access.ts`.
- `lib/email/recipient-policy.ts`, `cc-policy.ts`, `cta-policy.ts`: destinatários, cópias (`EMAIL_BM_CC`, `EMAIL_FINANCE_CC`) e links.
- `lib/email/templates/`: 8 templates.
- `scripts/preflight-email-production.ts`: checagem antes de ligar em produção.

**Regras e armadilhas:**
- O envio só acontece com `EMAIL_ENABLED=true`. `EMAIL_TEST_MODE` fica ligado, a menos que seja exatamente "false"; em modo teste, tudo vai para `EMAIL_TEST_RECIPIENT`.
- O e-mail roda fora da transação de status: uma falha não desfaz a mudança ([006](../decisoes/006-email-resend-com-guardas.md)).
- O e-mail de senha nunca contém a senha.
- `docker-compose.prod.yml` ainda tem variáveis SMTP e não tem as do Resend.

**Depende de:** —
