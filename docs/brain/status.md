---
atualizado: 2026-10-16
---
# Status

## Em andamento
- Branch atual `release/2026-10-02-import-identities` (HEAD 7482a2d, identidades pendentes na importação). `layout2.0` aponta para o mesmo commit.
- `main` (13b7cd7) está 83 commits atrás: a integração real acontece em `layout2.0`/`release/*`, não em `main`.
- Só `tooling/prod-identity-reconciliation` tem commit (1) que não está no HEAD; as demais branches locais já estão contidas nele.
- ecf5477: implementação da [decisão 010](decisoes/010-reimportacao-preserva-bm.md), junto com o `CLAUDE.md` e o cérebro. Ainda não foi enviado ao remoto.
- As correções da revisão do ecf5477 (`/review` + `/ponytail-review`) ainda não foram commitadas:
  - um BM aprovado durante a importação passa a abortar a carga, em vez de ser apagado;
  - a linha de import em `components/medicoes-app.tsx` foi separada;
  - os testes de MAPA PAGTO e Documentos Auxiliares foram criados.

## Próximos passos
1. Definir o fluxo manual para corrigir valores de BM já aprovado ou pago. Pela decisão 010, a planilha não corrige mais esses BMs: ela só reporta a divergência.
2. Fechar os itens abertos de `docs/plano-pre-deploy-producao.md` §7: validação de negócio, backup de produção, ensaio do baseline e dos aliases, regressão completa, homologação, revisão do rollback e janela de deploy. Os checkboxes de §4 estão desatualizados: a auditoria e o ensaio já foram feitos em 2026-09-30.
3. Criar uma rotina de backup automática. Hoje só existe `pg_dump` manual nos runbooks (`docs/deploy-linux-docker.md`, `docs/plano-pre-deploy-producao.md`, `docs/reset-pre-producao.md`).
4. Atualizar `docker-compose.prod.yml` para as variáveis do Resend (`EMAIL_*`, `RESEND_*`); hoje ele ainda tem SMTP.
5. Atualizar `docs/database-source-of-truth.md` e `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`: os dois estão defasados em relação ao código.
6. Trazer `main` para o estado de release, ou registrar a política de branches.

## Bloqueios e dúvidas abertas
- **`npm run lint` não roda:** o repositório não tem `eslint.config.*` (ESLint 9) e nunca teve. A checagem substituta usada é `npx tsc --noEmit`.
- **`tests/documentos-medidos.test.ts` usa `DATABASE_URL` sem guarda:** sem esse env apontado para o banco de teste, ele cai no `.env`, que é o banco DEV, e grava fixtures lá (que ele mesmo limpa). Para rodar `test:targeted`, exporte `DATABASE_URL`, `DATABASE_URL_TEST` e `E2E_DATABASE_NAME` para um banco de teste migrado.
- **O banco `medicoes_e2e` do container de teste está sem as migrations** de 2026-09-28 em diante. Os testes de 2026-10-16 rodaram num banco novo, `medicoes_e2e_bm`.
- **Limpeza da reimportação, o que ainda casa por nome aproximado:** `clear_imported_collaborators` usa `same_person_name`, e um fornecedor **não bloqueado** ausente da planilha, com nome parecido com um presente, ainda pode ter as medições do ciclo apagadas. Os BMs bloqueados ficam protegidos por identidade exata.
- **BM aprovado com a importação em andamento:** se o fornecedor aprovar no meio da carga, depois que a limpeza já travou o BM, a requisição dele espera o commit da importação e então falha, porque o BM foi apagado. Não há perda de dados, mas a requisição pode ficar presa pelo tempo da carga.
- Divergências entre o código e as regras do CLAUDE.md:
  - o boletim calcula com `number`, não com `Decimal` (`lib/boletim-calculo.ts`);
  - `logBmAction` grava a auditoria fora da transação e engole erros (`lib/bm-log.ts`);
  - não há biblioteca de validação: a validação é manual;
  - "cada setor só a sua etapa" não vale à risca: `requireFinanceiro` também libera MEDICAO, ADMIN e ADMINISTRATIVO.
- A ação ENVIAR do fornecedor não verifica `statusConferencia` no servidor (`app/api/colaborador/sgc/route.ts`).
- As ações de NF, pagamento e do fornecedor não têm lock nem compare-and-swap (só o envio do BM tem).
- `primeiroLogin` é imposto só na UI. `generateTempPassword` usa `Math.random`.
- O escopo do fornecedor inclui nomes do mapa casados por nome, o que traz risco com homônimos (`lib/colaborador-alias.ts`).
- `nodemailer` é uma dependência sem uso. `etl_execucoes` não tem quem grave nela.
- Os placeholders do CLAUDE.md seguem sem resposta: precisão monetária, edição de medição aprovada/paga e auditoria de status.
- O mapeamento setor → perfil não está documentado no código (Planejamento = MEDICAO?).
- Não há TODO/FIXME no código-fonte.

## Últimas mudanças (máx. 5, mais recente primeiro)
- 2026-10-16: reimportação preserva BMs em AGUARDANDO_NF, APROVADO e PAGO ([decisão 010](decisoes/010-reimportacao-preserva-bm.md)).
  - **Antes:** a reimportação apagava BM, NF, comprovante, trilha e REV desses fornecedores, inclusive de fornecedor ausente com nome parecido.
  - **Agora:** a diferença entre a planilha e o BM é reportada em `divergencias_bm_bloqueado`.
  - **Testes:** `etl/test_reimport_preserves_bm.py` passa; os 11 `etl/test_*.py` e `test:targeted` (464/464) também.
- 2026-10-16: cérebro do projeto criado (arquitetura, glossário, 14 módulos, 9 decisões).
- 7482a2d: feat(import): identidades de fornecedor pendentes.
- f1855ae: fix(import): fluxo de resolução de identidade.
- 3830ba4: fix(measurements): elegibilidade do detalhe do BM.
