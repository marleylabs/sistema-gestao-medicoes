---
atualizado: 2026-10-16
---
# Pendências

## P1: segurança e perda de dados
- Limpeza da reimportação casa por nome aproximado (`same_person_name` em `clear_imported_collaborators`): fornecedor não bloqueado, ausente da planilha e com nome parecido com um presente pode ter as medições do ciclo apagadas.
- Escopo do fornecedor inclui nomes do mapa casados por nome (`lib/colaborador-alias.ts`): risco de um fornecedor ver dados de outro em caso de homônimos.
- ENVIAR do fornecedor não verifica `statusConferencia` no servidor (`app/api/colaborador/sgc/route.ts`).
- `tests/documentos-medidos.test.ts` usa `DATABASE_URL` sem guarda e pode gravar no banco DEV.

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

## Decisões pendentes de negócio
- Precisão monetária e auditoria de status (placeholders do CLAUDE.md).