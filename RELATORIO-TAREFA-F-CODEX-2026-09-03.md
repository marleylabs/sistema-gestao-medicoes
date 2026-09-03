# Tarefa F — continuidade controlada e validação local

Data: 03/09/2026. Branch: `layout2.0`. Base: `7cfda1d`.
Este relatório complementa e substitui, para o estado desta entrega, as conclusões desatualizadas de `RELATORIO-EXCLUSAO-DEFINITIVA-FORNECEDORES.md`; o documento anterior foi preservado como histórico.

## 1. Estado inicial do handoff

Foram inspecionados diretório, status, branch, últimos dez commits, diff e diff staged antes da implementação. O worktree estava limpo, sem alterações staged, na base `7cfda1d` (`Realizado correções no ambiente`). O relatório anterior foi lido e confrontado com código, Prisma, SQL e banco local.

O código estava mais avançado que o relato: `deletedAt`, metadados de exclusão, snapshots de Medicao e AdminAuditLog já constavam em Prisma/SQL e em parte do serviço. Não havia diretório de migrations versionado. O banco utilizado inicialmente pelos testes não tinha todas essas colunas.

## 2. Alterações anteriores preservadas

Preservados: autorização ADMIN no servidor, modal destrutivo, confirmação forte em lote, resolução canônica de identidade, tratamento de cadastros redundantes, transação de escrita, snapshots mínimos, auditoria existente, filtro do seletor `/api/profissionais` e filtro de `resolveProjetistaCodigo`. Não foram reescritos os módulos financeiros, cálculos, BM, autenticação geral ou design system.

## 3. Alterações anteriores modificadas e motivo

O caminho sem histórico deixou de apagar fisicamente Profissional: agora mantém tombstone, impedindo recriação silenciosa. O nome vivo é anonimizado. A auditoria ganhou hashes de aliases e identificação do acesso desativado. Leitores históricos passaram a consumir snapshots. Foram fechadas entradas operacionais não cobertas anteriormente e corrigido o reseed que procurava fixtures apenas pelo nome já anonimizado.

## 4. Causa raiz

Limpar dados pessoais não definia por si só um estado operacional confiável. A implementação parcial também não propagava a exclusão a todos os escritores/leitores, e apagava a identidade sem histórico, permitindo sua recriação. Havia divergência entre schema declarado e banco local, além de testes que não exercitavam esses caminhos reais.

## 5. Solução arquitetural final

`deletedAt` é o estado explícito. CadastroFornecedor é removido; Profissional permanece como tombstone; Usuario é desativado sem apagar suas relações de chat. Snapshots necessários são preenchidos antes da anonimização. Todas as escritas críticas da exclusão e a auditoria são feitas na mesma transação; falha crítica provoca rollback. Cadastros redundantes não desativam uma identidade que ainda possui outro cadastro.

## 6. Schema anterior

O HEAD já declarava `Profissional.deletedAt/deletedById/deletedByNome/deletedReason`, `Medicao.profissionalNomeSnapshot/coordenadorNomeSnapshot` e `AdminAuditLog`. A CHECK real de `status_colaborador` aceita ATO, PRODUÇÃO ou NULL; Prisma não representa essa CHECK como enum. O banco local estava defasado em relação às declarações.

## 7. Schema final

Foram preservadas as declarações existentes, sem adicionar campos indiscriminadamente. O banco local recebeu as colunas/tabela/índices já previstos. Nenhuma CHECK foi ampliada. `statusColaborador = "EXCLUIDO"` não é utilizado. Hashes de aliases usam o JSON de metadados da auditoria existente, sem nova tabela de cópia cadastral.

## 8. Migrations

Criada `prisma/migrations/20260903160000_profissional_exclusao_definitiva/migration.sql`, incremental e idempotente, e `migration_lock.toml` para PostgreSQL. Ela adiciona as quatro colunas de exclusão, dois snapshots, tabela de auditoria e índices.

Aplicação exclusivamente local: banco de desenvolvimento em 127.0.0.1:15432 e banco E2E em 127.0.0.1:15433. `migrate deploy` encontrou P3005 no banco legado sem baseline. A migration foi aplicada localmente via `prisma db execute` e registrada como aplicada no desenvolvimento via `migrate resolve`. O E2E recebeu o mesmo SQL. Nenhuma migration de produção foi executada.

Esta é uma migration incremental sobre o schema existente, não uma migration de criação inicial de toda a aplicação. A publicação futura exige conferir o baseline do ambiente de destino; não se deve executar `migrate resolve` cegamente.

## 9. database/schema.sql

Já continha os mesmos campos e auditoria; foi preservado. A validação Python consultou o PostgreSQL real e comprovou que a CHECK ainda rejeita EXCLUIDO. Os testes de serviço gravaram ATO sem alteração dessa regra.

## 10. Arquivos alterados

- Serviço: `lib/cadastro-fornecedor.ts`, `lib/auth.ts`, `lib/colaborador-alias.ts`, `lib/email/resolve-recipients.ts`, `lib/format.ts`.
- APIs: fornecedores `[id]` e `bulk-delete`; usuários e usuários `[id]`; BM administrativo; conferência `[id]/incluir`; ciclos; colaborador/me e colaborador/medicoes; dashboard; mapa-pagamento/[id] e mapa-pagamento/documentos; medicoes e medicoes/[id]; sgc/alertas e sgc/enviar.
- ETL: `etl/ingest_medicoes.py`, `etl/server.py`, novo `etl/test_deleted_identity.py`.
- Testes: `e2e/administrativo-fornecedor-dedupe.spec.ts`, `scripts/seed-e2e.ts`, novos `scripts/test-exclusao-services.ts` e `tests/exclusao-services.test.ts`.
- Correções de tipagem de testes: `tests/email-cta-policy.test.ts`, `tests/workflow-e2e.test.ts`.
- Migration e este relatório.
- `tsconfig.tsbuildinfo`: cache rastreado regenerado pela validação TypeScript/build; não contém mudança funcional.

## 11. Endpoints/actions alterados

Exclusão valida UUIDs e mantém ADMIN como fonte de autorização. Criação/alteração de medição, inclusão de documento e envio de BM recusam identidade excluída. Alterações cadastrais não repovoam tombstones. Usuários excluídos não podem receber ações de reset/edição e o cadastro comum não restaura acessos removidos pela Tarefa F. A limpeza de ciclos não elimina tombstones necessários para bloquear reimportação.

## 12. Classificação e filtros operacionais

Operacionais: seletor de profissionais, resolução de pagamento, sincronização de acessos, portal do colaborador, novos documentos/medições, inclusão de divergência e envio de BM usam estado ativo. Históricos: medições, mapa, BM, SGC, dashboard e documentos preservam relações e dados antigos; não receberam filtro global cego. Auditoria/importação: consultam também excluídos, justamente para reconhecer e bloquear a identidade.

## 13. Novo Pagamento

O seletor já filtrava `deletedAt: null` e foi preservado. O resolver utilizado pelo POST de pagamento e pela troca de identidade no PATCH recusa excluídos. O PATCH também recusa escrever em pagamento de fornecedor excluído mesmo sem trocar seu código; a leitura histórica permanece disponível. A E2E verifica ausência na lista, POST e PATCH manuais recusados, contagem de pagamentos e valor histórico inalterados.

## 14. Proteção backend

ADMIN autorizado é aceito; MEDICAO, ADMINISTRATIVO e COLABORADOR não podem excluir; sem sessão recebe 401/403. Campos `perfil`/`role` forjados não concedem acesso. Payload malformado é recusado. Novas medições validam ambos os IDs (profissional e coordenador). Identidades ambíguas de acesso/profissional provocam rollback, sem escolher arbitrariamente uma pessoa.

## 15. Importação

A importação administrativa devolve resultado controlado em `bloqueados`, separado de `conflitos` por ambiguidade. Não cria/restaura o cadastro. Hashes SHA-256 dos aliases normalizados mantêm a lista de bloqueio mesmo após remoção do nome vivo. CNPJ não virou identificador único.

O ETL verifica códigos e hashes antes de full_refresh ou qualquer escrita da carga. Identidade excluída aborta a carga com `IMPORTACAO_BLOQUEADA`, sem apagar histórico. Não foi criado fluxo de restauração.

## 16. E-mail

O resolver verifica primeiro a lista de bloqueio e `deletedAt`, antes do cadastro administrativo ou fallback. Mesmo um cadastro residual com e-mail não permite envio para o excluído. Reset de senha de usuário excluído também é recusado. O teste de serviços reais comprova destinatário nulo com cadastro residual. Os E2E utilizam provedor fake, sem enviar e-mails reais.

## 17. Preservação histórica

Medicao preserva FKs e recebe snapshots de profissional/coordenador antes da anonimização. O serializador e o dashboard usam os snapshots. BM e alertas priorizam identificação histórica armazenada. SGC, mapa, contexto, valores, NF, comprovantes, logs e documentos históricos não são apagados pela exclusão. A prova combina teste de serviços reais (FKs, snapshots e valores) com cenário L E2E (mapa, SGC PAGO, NF, comprovante e Evidências).

## 18. Dados anonimizados/removidos

Profissional: nome vira `EXCLUIDO-<uuid>`; nomeCompleto, CPF, CNPJ, e-mail, razão social e função ficam nulos. CadastroFornecedor é removido integralmente, incluindo contatos e rawPayload operacionais. Usuario perde e-mail, avatar, senha temporária e presença online; fica inativo/excluído. Não existem campos de endereço, PIX ou dados bancários no model Profissional auditado; documentos históricos de pagamento não foram removidos.

## 19. Dados deliberadamente mantidos

IDs, código canônico, timestamps e estado operacional necessário às constraints permanecem. Em legado, o código pode conter o nome; ele não é descrito como dado anônimo, pois sustenta joins históricos. Quando o código era NULL mas o nome já era a chave efetiva, essa chave é preservada em codigo antes da anonimização. Usuario e nome de autoria permanecem para não apagar/descaracterizar chat. Snapshots, NF e comprovantes permanecem exclusivamente por rastreabilidade histórica. Hashes são pseudônimos para supressão de reimportação, não anonimização criptograficamente irreversível de nomes previsíveis.

## 20. Auditoria

Reutilizada AdminAuditLog: operação, identificador interno/código, administrador, data, motivo opcional, resultado, contagem cadastral e ID do acesso desativado. Nenhum CPF/CNPJ/e-mail é copiado para backup. Também há registro de remoção de cadastro redundante e de cadastro sem profissional vinculado. Hashes de aliases têm finalidade operacional de bloqueio, não exibição do nome original.

## 21. Testes adicionados/alterados

E2E: tombstone sem histórico, bloqueio de reimportação, seletor, POST manual de pagamento, novos documentos/medições, envio de BM, auditoria, anonimização, payload malicioso e autorização sem sessão/MEDICAO/COLABORADOR.

Novo teste de serviços chama a implementação real no Postgres E2E. Apenas o marcador de bundler `server-only` é neutralizado no processo de teste; regras de negócio não são copiadas. Falha injetada em `adminAuditLog.createMany` comprova rollback real de cadastro, profissional e snapshots. Também cobre código legado NULL, nome diferente do código, histórico financeiro e e-mail residual.

Teste Python usa banco real, fixtures transacionais revertidas e CHECK real. O reseed limpa tombstones pelo código e auditorias dos administradores E2E, evitando contaminação entre rodadas.

A asserção antiga de reimportação foi corrigida de `conflitos` para `bloqueados`, pois a API já separava esses resultados. Dois erros TypeScript preexistentes foram corrigidos sem enfraquecer assertions: removida flag `s` desnecessária de regex sem ponto e reordenada a asserção de estado antes do narrowing para null.

## 22. Resultados dos testes

- `npm run test:targeted`: 241/241 aprovados.
- `npm run test:integration`: 10/10 aprovados.
- `npm run test:security`: 10/10 aprovados.
- `npx tsc --noEmit`: aprovado.
- Teste Python de identidade excluída/CHECK: aprovado.
- Teste Python da máscara de importação: aprovado.

As primeiras tentativas de E2E revelaram Chromium ausente, restrições locais de spawn, assertion incorreta e reseed incompleto. Houve também sobreposição inadvertida de runners/servidor; essas rodadas foram descartadas como evidência final. Depois de corrigir o isolamento, uma suíte de 66 e uma ampliada de 67 passaram integralmente. A aceitação final considera apenas as duas rodadas sequenciais abaixo, na versão final.

## 23. E2E primeira execução final

`npm run test:e2e`: **67/67 aprovados**, 2,2 minutos, código de saída 0. Inclui o bloqueio final de PATCH de pagamento após exclusão. Execução precedida por reseed; não houve alteração funcional entre esta rodada e a seguinte.

## 24. E2E após reseed

`npm run test:e2e:seed` concluído com saída 0, seguido de `npm run test:e2e`: **67/67 aprovados**, 2,2 minutos, código de saída 0. Rodada estritamente sequencial e sem alterações funcionais em relação à anterior.

## 25. Build

`npm run build`: **aprovado, código de saída 0**. Prisma Client gerado; compilação otimizada concluída em 6,6 s; TypeScript concluído em 9,7 s; 48/48 páginas geradas. Nenhuma opção para ignorar erros de tipagem foi ativada.

## 26. Git status final

Branch `layout2.0`, HEAD mantido em `7cfda1d`. São 28 arquivos rastreados modificados (incluindo o cache `tsconfig.tsbuildinfo`) e 6 arquivos novos: este relatório, teste Python, migration SQL, migration_lock.toml, script de serviços e teste targeted. Os arquivos funcionais estão relacionados na seção 10. Nenhum conteúdo staged, nenhum commit novo. `git diff --check` concluiu sem erros; os avisos de LF/CRLF refletem a configuração Git do Windows. `next-env.d.ts` voltou ao conteúdo original após o build.

## 27. Limitações e cautelas

- Legado sem código vinculado que ainda tenha possível profissional/acesso correspondente é recusado, exigindo saneamento da identidade canônica; não se infere vínculo arriscado pelo nome.
- Homônimo que colida com alias bloqueado recebe bloqueio conservador, nunca reativação automática. Não existe restauração nesta entrega.
- O baseline da base de destino precisa ser revisado antes de futura publicação. Não houve inspeção mutável nem validação de produção.
- Testes não constituem prova de todas as corridas concorrentes possíveis entre exclusão e novas operações. As transações da exclusão e o rollback crítico foram exercitados.
- A suíte E2E registra avisos de cor do Node e cancelamentos de conexão durante logout/navegação; o resultado final deve ser avaliado pelo resumo e código de saída, sem alegar ausência absoluta de logs.

## 28. Confirmação de não deploy

NÃO houve deploy, publicação, migration em produção nem alteração de container/servidor de produção nesta Tarefa F. Instalações de Chromium/dependências foram apenas locais para validação. Nenhum rebuild/publicação Docker foi executado nesta etapa.

## 29. Confirmação de não push

NÃO houve git push. NÃO foi criado commit automaticamente. A entrega permanece no worktree para revisão do responsável.

## Classificação

TAREFA F: APROVÁVEL PARA DEPLOY

Justificativa: estado explícito, anonimização, bloqueios operacionais, auditoria, preservação histórica e rollback foram implementados e exercitados. Targeted, integração, segurança, testes ETL, duas E2E completas após reseed e build passaram. A classificação habilita revisão/aprovação do responsável; não autoriza publicação automática e não dispensa conferir o baseline de migrations e as cautelas de legado descritas acima.
