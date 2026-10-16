---
atualizado: 2026-10-16
tags: [modulo]
---
# Histórico, evidências e dashboard

**O que faz:** consultas internas: histórico de medições, evidências (documentos medidos por fornecedor) e dashboard de valores.

**Onde está:** `app/api/historico/`, `components/historico/`, `components/evidencias/`, `app/api/dashboard/`, `components/dashboard*`

**Arquivos-chave:**
- `lib/documentos-medidos.ts`: consulta usada pelas evidências e pelo portal (código, nome, nomeCompleto e linhas pendentes).
- `app/api/dashboard/route.ts`: agregados em SQL bruto, convertidos para number.

**Regras e armadilhas:**
- Histórico: acesso de ADMIN e MEDICAO, ou de quem tem a permissão extra HISTORICO_MEDICOES (`requireHistorico`).
- Dashboard: `requireAdmin` (MEDICAO + ADMIN).
- Para fornecedor excluído, o histórico mostra `*NomeSnapshot` da `Medicao`.

**Depende de:** [Autenticação](autenticacao.md)
