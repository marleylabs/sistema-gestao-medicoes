---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 006 E-mail via Resend, fail-safe e fora da transação

**Contexto:** um envio indevido a fornecedores em ambiente de teste seria grave.

**Decisão:** enviar via Resend (`lib/email/`). O envio é desligado por padrão e o modo teste fica ligado salvo `EMAIL_TEST_MODE=false`. Há idempotência por chave com advisory lock e registro em `EmailLog`. O e-mail é disparado depois da mudança de status e uma falha não a desfaz. Registrada retroativamente.

**Alternativas descartadas:** SMTP/nodemailer (resquícios no `package.json` e no `docker-compose.prod.yml`).

**Consequências:** um status pode mudar sem o e-mail sair; consulte o `EmailLog`. As variáveis de produção precisam incluir as do Resend.
