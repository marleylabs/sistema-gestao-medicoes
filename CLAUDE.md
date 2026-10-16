# En Passant

Sistema de gestão de medições de fornecedores. Uma medição registra o que o fornecedor executou em um período e passa por três setores até o pagamento:
Planejamento (lança/confere a execução) → Administrativo (valida documentos e contrato) → Financeiro (aprova e paga).
Usuários: equipe interna dos três setores e fornecedores externos (acesso restrito aos próprios dados).

## Stack
- Next.js 16 (front + API routes em app/api), React 19, TypeScript, HeroUI 3 + Tailwind 4; ETL de planilhas em Python 3.13 (etl/server.py, pandas/SQLAlchemy)
- PostgreSQL 16 via Prisma 6 (prisma/schema.prisma, migrations em prisma/migrations)
- Sessão JWT própria (jose) em cookie (lib/session.ts, proxy.ts); hospedagem via Docker Compose (postgres, etl, web, migrate — docker-compose.prod.yml)

## Comandos
- Instalar: `npm ci` (ETL: `pip install -r etl/requirements.txt`)
- Rodar: `npm run dev` (stack completa: `docker compose up -d`)
- Testar: `npm run test:targeted`; E2E: `npm run test:e2e:seed` e `npm run test:e2e` (Playwright)
- Lint/format: `npm run lint` (sem formatter configurado)

## Cérebro do projeto (docs/brain/)
Antes de explorar o código, consulte o cérebro:
1. Comece por docs/brain/status.md e docs/brain/00-indice.md.
2. Abra só as notas relevantes à tarefa; nunca leia o cérebro inteiro.
3. Explore o código apenas para o que as notas não cobrem.
4. Ao terminar: atualize status.md, as notas afetadas e o índice (se criou nota).
5. Decisão de arquitetura → nova nota em docs/brain/decisoes/.
6. Notas descrevem intenção e regras e apontam caminhos de arquivo; não copiam código.
7. Ignore docs/brain/.obsidian/ e docs/brain/_modelos/.
Se uma nota contradizer o código, o código vale: corrija a nota e avise.

## Regras de negócio sensíveis
- Fornecedor só vê e altera as próprias medições.
- Cada setor só executa as ações da sua etapa do fluxo.
- [Valores monetários: tipo/precisão usados, ex.: decimal, nunca float]
- [Medição aprovada/paga pode ou não ser editada? Como se corrige?]
- [Mudanças de status precisam de registro de quem/quando?]

## Regras de código
- TypeScript estrito: sem `any` (use `unknown` + narrowing), sem `@ts-ignore`. Use os tipos gerados pelo Prisma em vez de redeclarar modelos.
- Server Components por padrão; `"use client"` só quando houver estado, eventos ou APIs do navegador. Busque dados no servidor.
- Toda rota em app/api e toda server action valida a sessão (lib/session.ts) e o setor do usuário no servidor. O proxy.ts e esconder botões na UI não são barreira de segurança.
- O fornecedor é sempre identificado pela sessão, nunca por id vindo do body, query ou URL.
- Valide toda entrada externa na borda (rotas, actions, upload de planilha) com a biblioteca de validação já usada no projeto.
- Valores monetários: `Decimal` de ponta a ponta; nunca `number`/float em cálculos. Formatação de moeda só na UI.
- Mudança de status da medição + registro de auditoria na mesma transação (`prisma.$transaction`).
- Prisma: `select` só dos campos necessários; mudança de schema = nova migration com `prisma migrate dev`; nunca `db push` fora do ambiente local.
- UI: use componentes do HeroUI antes de criar novos; estilo só com classes Tailwind, sem CSS novo nem `style` inline.
- Erros: sem `catch` vazio; respostas de API com status HTTP correto e mensagem sem stack trace nem dados de outros fornecedores.
- Segredos só no servidor; no client, apenas variáveis `NEXT_PUBLIC_`.
- ETL (Python): type hints, SQL sempre parametrizado (nunca concatenado). O schema do Prisma é a fonte da verdade: o ETL não cria nem altera tabelas.
- Nova dependência (npm ou pip) só após perguntar.
- Correção de bug vem com teste que reproduz o bug. Mudança no fluxo entre setores exige teste E2E.
- Antes de concluir uma tarefa: `npm run lint` e `npm run test:targeted` passando.
- Commits no padrão Conventional Commits, mensagem em português.

## Plugins do agente
- agent-skills define o processo (/spec → /plan → /build → /test → /review → /ship). Use o ciclo completo em features novas e mudanças em vários arquivos; correções pequenas não precisam dele.
- Ponytail (modo lite) define o tamanho da solução: antes de criar código, reuse o que já existe no repo, no Next.js, no Prisma e no HeroUI.
- Em conflito, a prioridade é: segurança, permissões e regras de negócio > testes exigidos pelo agent-skills > minimalismo do Ponytail.
- Revisão: /review cobre correção, segurança e performance; /ponytail-review só aponta código desnecessário. Antes de merge, rode os dois.
- Specs e planos do agent-skills vão em docs/brain/specs/; ADRs em docs/brain/decisoes/. Liste-os no índice.
- Se o Caveman estiver ativo, ele vale só para as respostas no chat: notas do cérebro, specs, comentários e mensagens de commit são escritos em português normal e completo.

## Estado atual
- As regras deste arquivo descrevem o alvo. Divergências conhecidas estão em docs/brain/status.md: não corrija fora de uma tarefa dedicada a elas, e não presuma que o código já segue a regra.
- Branch de integração: layout2.0 e release/*. A main está desatualizada: nunca use como base nem abra PR contra ela.
- Não existe biblioteca de validação: a validação de entrada é manual (padronização pendente, ver status.md).

## Não fazer
- Não alterar migrations já aplicadas; criar uma nova.
- Não expor dados de um fornecedor para outro, nem em logs.
- Não remover validações de permissão para "fazer funcionar".