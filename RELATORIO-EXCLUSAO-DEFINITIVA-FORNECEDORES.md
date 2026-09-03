# Relatório final — Exclusão definitiva de fornecedores/colaboradores (Painel Administrativo)

**NÃO FOI FEITO DEPLOY.** Tudo abaixo está implementado localmente, testado contra o banco E2E (que espelha o schema real de produção) e contra o banco de produção apenas em modo leitura (auditoria de dados), nunca com escrita.

## 1. Política final

- Só **ADMIN** pode excluir definitivamente um `CadastroFornecedor` — em massa ou individualmente.
- ADMIN pode excluir **mesmo com histórico de medição**. A regra que bloqueava (`BLOCKED_BY_HISTORY`) e a que exigia seleção completa (`DUPLICATE_REQUIRES_SELECTION`) foram **removidas**.
- A exclusão nunca apaga histórico de medição (SGC, BM, Medicao, MapaPagamentoItem, NF, comprovante, DivergenciaMedicao, SgcLog, BmAuxMedicao, EmailLog). Ela separa dado **administrativo/operacional** (sempre removível) de dado **histórico de medição** (sempre preservado).

## 2. O que é fisicamente apagado

- `CadastroFornecedor`: **sempre**, sem exceção — não há nenhuma FK de qualquer outra tabela para `CadastroFornecedor.id` (confirmado no schema), então apagar nunca corrompe nada.
- `Profissional`: apagado fisicamente **somente quando não há nenhum histórico de medição** para aquela identidade (`colaboradorCodigo`) — nesse caso não há nada a preservar.

## 3. O que só é desativado (nunca apagado fisicamente)

- `Usuario`: sempre soft-delete (`ativo:false, excluidoAt:now()`), nunca apagado fisicamente. Motivo: `ChatMensagem.autor` e `ChatParticipante.usuario` têm `onDelete: Cascade` no schema — apagar o Usuario apagaria em cascata mensagens de chat, inclusive em conversas com outras pessoas. `verifySessionToken` já revalida `ativo/excluidoAt` a cada requisição, então a sessão existente para de funcionar na requisição seguinte, sem nenhum mecanismo adicional.

## 4. O que é preservado como histórico

- `SgcAprovacaoMedicao`, `Medicao`, `MapaPagamentoItem`, `DivergenciaMedicao`, `SgcLog`, `BmAuxMedicao`, NF e comprovante (armazenados dentro de `SgcAprovacaoMedicao`), `EmailLog` — nenhum é tocado pela exclusão administrativa. Nenhum `DELETE CASCADE` foi usado.

## 5. Tratamento do Profissional

Reavaliado **apenas quando é o último `CadastroFornecedor` daquela identidade** (enquanto sobrar outro cadastro ativo para o mesmo `colaboradorCodigo`, a pessoa continua fornecedora ativa e nada é tocado — `SKIP_STILL_ACTIVE`).

- **Sem histórico de medição** → `Profissional` apagado fisicamente.
- **Com histórico de medição** → `Profissional` **preservado, nunca apagado**. `codigo`, `nome`, `nomeCompleto` continuam intactos (é a identidade histórica mínima — Opção A da auditoria original, nunca a Opção B/snapshot). Os campos operacionais (`email`, `cnpj`, `cpf`, `razaoSocial`, `funcao`) são limpos (`null`).

  **Correção crítica feita durante a implementação, ANTES de qualquer deploy**: a primeira versão tentava marcar `Profissional.statusColaborador = "EXCLUIDO"`. Essa coluna parece livre (100% NULL em toda a produção hoje), mas na verdade tem uma **CHECK CONSTRAINT real no banco** (`database/schema.sql`, não visível no `prisma/schema.prisma` — Prisma não modela CHECK constraints) que só aceita `'ATO' | 'PRODUÇÃO' | NULL`. Gravar "EXCLUIDO" ali teria violado essa constraint **em produção**. Isso só foi detectado porque a suíte E2E rodou contra um banco que espelha o schema real antes do deploy — nada chegou a ser publicado com esse defeito. Foi corrigido trocando para a limpeza de campos operacionais acima, sem nenhuma alteração de schema.

## 6. Tratamento do Usuario

Ver item 3. Nunca fica com acesso ativo depois da exclusão administrativa da identidade.

## 7. Tratamento do CadastroFornecedor

Sempre removido fisicamente pelo ADMIN, com ou sem histórico — essa é a mudança central de política pedida.

## 8. Tratamento do Chat

Não alterado por esta entrega. `Usuario` nunca é apagado fisicamente exatamente para não arriscar apagar em cascata mensagens de chat (inclusive de terceiros que participaram da mesma conversa).

## 9. Tratamento do EmailLog

Não alterado — nenhuma linha de `email_logs` é tocada pela exclusão. Novos envios operacionais (BM_AVAILABLE, PAYMENT_COMPLETED etc.) param de acontecer naturalmente para a identidade excluída porque `resolveFornecedorEmail` não encontra mais `CadastroFornecedor` nem `Profissional.email` (limpo) — sem precisar de nenhuma condição especial de "excluído" no código de e-mail (a tentativa anterior com `statusColaborador === "EXCLUIDO"` em `lib/email/resolve-recipients.ts` foi revertida por não ser mais necessária).

## 10. Garantia — Pagamentos por Fornecedor

`MapaPagamentoItem` nunca é apagado ou alterado pela exclusão administrativa. Testado explicitamente (CENÁRIO C2, CENÁRIO L): a linha continua existindo, com o mesmo valor, mesmo depois do `CadastroFornecedor` ter sido removido.

## 11. Garantia — SGC / BM

`SgcAprovacaoMedicao` nunca é apagado ou alterado. Testado explicitamente em CENÁRIO C2, I, J, L: status, dados de NF e comprovante continuam intactos.

## 12. Garantia — NF / comprovante

Os bytes de NF (`nfArquivo`) e comprovante (`comprovanteArquivo`), junto com seus nomes de arquivo, vivem dentro de `SgcAprovacaoMedicao` e nunca são tocados. Testado no CENÁRIO L com bytes reais.

## 13. Endpoints alterados

- `app/api/admin/administrativo/fornecedores/bulk-delete/route.ts` (novo) — chama `deleteFornecedoresDefinitivamente`; exige `perfil === "ADMIN"` (403 para qualquer outro perfil, inclusive ADMINISTRATIVO); `MAX_IDS_PER_REQUEST = 100`; valida payload, rejeita vazio/inválido com 400.
- `app/api/profissionais/route.ts` — revertido para `findMany` sem filtro (o filtro por `statusColaborador` foi removido junto com o abandono dessa coluna como sentinela — ver item 17, limitação conhecida).
- `lib/mapa-pagamento.ts` (`resolveProjetistaCodigo`) — revertido pelo mesmo motivo.
- `lib/email/resolve-recipients.ts` (`resolveFornecedorEmail`) — revertido; a limpeza natural do campo `email` já é suficiente.

## 14. Frontend alterado

- `components/administrativo-panel.tsx`: botão de exclusão (ícone de lixeira) e checkboxes de seleção só aparecem para `isAdmin`; modal unificado `DeleteConfirmModal` para exclusão individual e em massa, com confirmação digitada (`EXCLUIR N`) obrigatória para 2+ itens; toast final nunca trata `professionalsPreservedForHistory` como erro.
- `components/medicoes-app.tsx`: passa `isAdmin={isFullAdmin}` para `AdministrativoPanel`.

## 15. Alterações de schema

**Nenhuma.** Toda a implementação usa apenas colunas já existentes (`Usuario.ativo`/`excluidoAt`, campos operacionais de `Profissional`).

**Limitação conhecida, não corrigida sem aprovação prévia**: sem uma coluna nova (ex.: `Profissional.ativo`/`excluidoAt`, no mesmo padrão já usado em `Usuario`), **não existe forma segura** de remover identidades excluídas do seletor de "Novo pagamento" (`GET /api/profissionais`). Uma alternativa sem schema — filtrar por "Profissional sem nenhum `CadastroFornecedor`" — foi avaliada e descartada: medição direta em produção mostrou que **44 dos 49** `Profissional` com `codigo` hoje não têm nenhum `CadastroFornecedor` (nunca tiveram cadastro administrativo, não foram excluídos), então esse filtro esconderia ~90% dos fornecedores legítimos — uma regressão muito pior que o problema original. Fica registrado como recomendação para uma entrega futura, mediante aprovação.

Também não há tabela de auditoria dedicada — a operação é registrada via `console.log("[audit] ...")` estruturado (ADMIN responsável, timestamp, ids excluídos, colaboradorCodigos, contagens, nunca senha/token/segredo), sem persistência consultável. Registrado como limitação conhecida.

## 16. Testes executados

- `npm run test:targeted` — **240/240 passaram**.
- `npm run test:integration` — **10/10 passaram**.
- `npm run test:security` — **10/10 passaram**.
- Unit tests de `planIdentityCleanup` (21 testes em `tests/cadastro-fornecedor-identity.test.ts`, incluído no targeted acima) cobrem: exclusão sem histórico, exclusão com histórico, exclusão de todos os cadastros de uma identidade de uma vez, identidade ainda ativa (`SKIP_STILL_ACTIVE`), idempotência da limpeza de campos, identidade com histórico mas sem Profissional vinculado.

## 17. Resultado da suíte E2E completa — 2 execuções consecutivas

- **Execução 1/2**: 66/66 passaram.
- **Execução 2/2** (banco resemeado do zero antes de rodar): 66/66 passaram.
- `e2e/administrativo-fornecedor-dedupe.spec.ts` (15 cenários, incluindo os novos: exclusão com histórico sem bloqueio, exclusão de duplicatas de uma vez, exclusão só de acesso vs. histórico completo, restrição a ADMIN, cenário completo fim-a-fim com NF/comprovante/login) passou integralmente nas duas execuções.

Durante a validação, dois problemas foram encontrados e corrigidos **no próprio teste**, não no código de produção:
- CENÁRIO L usava um ciclo (`"9996"`) que nunca era registrado em `MapaPagamentoContexto` — a tela de Evidências lê os ciclos dessa tabela, não de `SgcAprovacaoMedicao`. Corrigido criando o registro de contexto do ciclo no seed do teste.
- Uma reexecução manual do mesmo spec sem reseeding gerou dados residuais de uma tentativa anterior interrompida (o teste anterior falhou antes de rodar sua limpeza) — isso é comportamento esperado de reexecuções sem reseed, não uma falha real; resolvido resemeando o banco E2E antes de cada execução, como o fluxo oficial já prevê.

## 18. Build

`npm run build` — **sucesso**, sem erros de TypeScript, todas as rotas geradas normalmente.

## 19. Riscos residuais

- **Seletor "Novo pagamento" (`GET /api/profissionais`) continua listando identidades preservadas por histórico** — não há como filtrar isso sem uma coluna nova no schema (ver item 15). Um Profissional preservado aparece na lista, mas sem `email`/`cnpj`/`razaoSocial` (campos limpos), o que já reduz bastante o risco de reuso indevido, mas não elimina a possibilidade de ele ser selecionado manualmente para um novo pagamento.
- **Sem tabela de auditoria persistente/consultável** — a trilha de quem excluiu o quê existe apenas em log de aplicação, não em uma tabela queryable no banco. Recomendado para entrega futura.
- Nenhum outro risco identificado nos testes executados: histórico de medição, pagamentos, NF, comprovantes, chat e e-mail permaneceram íntegros em todos os cenários testados, incluindo o cenário fim-a-fim completo (CENÁRIO L) validado duas vezes.

---

**NÃO FOI FEITO DEPLOY**, conforme instrução explícita. Aguardando autorização para deploy e/ou decisão sobre a recomendação de schema do item 15.
