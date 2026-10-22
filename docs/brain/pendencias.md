---
atualizado: 2026-10-21
---
# Pendências

## P1: segurança e perda de dados
- Nenhuma em aberto (última revisão: 2026-10-16).

## P2: integridade e robustez
- Ações de NF, pagamento e do fornecedor sem lock nem compare-and-swap (só o envio do BM tem).
- `logBmAction` grava a auditoria fora da transação e engole erros (`lib/bm-log.ts`).
- Boletim calcula com `number`, não `Decimal` (`lib/boletim-calculo.ts`).
- `generateTempPassword` usa `Math.random`; `primeiroLogin` é imposto só na UI.
- `requireFinanceiro` também libera MEDICAO, ADMIN e ADMINISTRATIVO; o mapeamento setor → perfil não está documentado (Planejamento = MEDICAO?).
- Aprovação feita durante a importação espera o commit da carga e falha (sem perda de dados, mas a requisição fica presa).

## P3: dívida técnica
- Não há biblioteca de validação: a validação é manual.
- Não há configuração de ESLint 9.
- `scripts/test-identidade-importacao.ts` (rodado por `tests/identidade-importacao.test.ts`) depende do ADMIN do seed E2E e compara o total **global** de `sgc_logs`. Num banco sem seed, ou com outro teste gravando logs em paralelo, ele falha de forma intermitente.
- `nodemailer` sem uso; `etl_execucoes` sem quem grave nela.
- Testes intermitentes conhecidos (não investigados): `tests/identidade-importacao.test.ts` e `tests/migrar-codigo-p0.test.ts` falham de vez em quando no `test:targeted` (arquivos em paralelo no mesmo banco) e passam isolados. No E2E, os casos raros são:
  - `ECONNRESET` em `hotfix-mascara-grafico-filtros`;
  - `portal-fornecedor-redesign:162` e `importacao-identidades:128`;
  - `uncaughtException: aborted` no `next dev` sob carga.

  Rodar o E2E contra `next build` + `next start` provavelmente resolveria esses casos.

## Decisões pendentes de negócio
- Precisão monetária e auditoria de status (placeholders do CLAUDE.md).