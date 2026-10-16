---
atualizado: 2026-10-16
---
# Pendências

## P1: segurança e perda de dados
- Nenhuma em aberto (última revisão: 2026-10-16).

## P2: integridade e robustez
- Não há vínculo explícito entre o login do fornecedor e o Profissional: a identidade vem do nome exato do usuário igual ao `responsavel` do cadastro (diagnóstico de 2026-10-16 na [spec do escopo](specs/p1-escopo-fornecedor-por-identidade.md)). Homônimo novo bloqueia o acesso (falha fechado), mas o elo é frágil. Solução aprovada: P0 como único ID ([spec](specs/p2-vinculo-login-profissional.md), [decisão 012](decisoes/012-p0-como-id-do-fornecedor.md)).
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

## Decisões pendentes de negócio
- Precisão monetária e auditoria de status (placeholders do CLAUDE.md).