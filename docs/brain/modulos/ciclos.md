---
atualizado: 2026-10-16
tags: [modulo]
---
# Ciclos

**O que faz:** define, ativa e exclui os ciclos de medição (YYMM) e calcula os períodos ATO e Produção.

**Onde está:** `lib/ciclo*.ts`, `app/api/ciclos/route.ts`

**Arquivos-chave:**
- `lib/ciclo.ts`: valida o formato e calcula os períodos.
- `lib/ciclo-ativo.ts`: escolhe o ciclo ativo (flag `ativoMedicao`, senão o mais recente, senão "2605" fixo no código).
- `lib/ciclo-cleanup.ts`: limpa profissionais e projetos órfãos ao excluir um ciclo.

**Regras e armadilhas:**
- Ativar e excluir rodam em transação. A exclusão é só para ADMIN.
- A limpeza de órfãos considera só os registros coletados antes da exclusão (`tests/ciclo-profissional-invariant.test.ts`).
- O ciclo "2605" é o default fixo também no schema (`SgcAprovacaoMedicao.ciclo`).

**Depende de:** [Mapa de pagamento](mapa-pagamento.md)
