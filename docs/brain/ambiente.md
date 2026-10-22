---
atualizado: 2026-10-21
tags: [ambiente]
---
# Ambiente de desenvolvimento (máquina nova)

Passo a passo para continuar o projeto em outro notebook com o Claude Code. Os segredos não estão no git: copie-os por um canal seguro, nunca por esta nota.

## 1. Código
- Clone `https://github.com/marleylabs/sistema-gestao-medicoes.git` e use a branch `release/2026-10-02-import-identities`. Nunca use a `main` (desatualizada).
- Instale: `npm ci`; para o ETL, `pip install -r etl/requirements.txt` (Python 3.13).

## 2. Arquivos fora do git (copiar da máquina atual)
- `.env`: segredos do Docker de desenvolvimento (`AUTH_SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, bootstrap do ADMIN, Resend). A `DATA_ENCRYPTION_KEY` precisa ser **a mesma** da máquina de origem, senão os dados cifrados (CPF, CNPJ, e-mail) de um backup restaurado não abrem.
- `.env.test`: `DATABASE_URL_TEST` (banco `medicoes_e2e_bm` no Postgres do Docker, porta 15432), `E2E_DATABASE_NAME`, usuários e senhas do E2E e `E2E_CICLO`.
- `.claude/launch.json`: configuração `dev-banco-teste` do preview (app na porta 3100 contra o banco de teste). A pasta `.claude/` nunca vai para o git. Conteúdo: um `node -e` que roda `process.loadEnvFile('.env.test')`, troca `DATABASE_URL` por `DATABASE_URL_TEST` e sobe `next dev -p 3100`.
- `~/.ssh/config` com um host para a produção (`192.168.15.101`; ver [decisão 013](decisoes/013-servidor-unico-e-producao.md)), se for fazer deploy desta máquina. O alias muda de um notebook para outro (`medicoes-preprod` ou `medicoes-prod`), e fora da rede local o servidor só é alcançado pela VPN.
- Opcional: `~/backups-medicoes/` (dumps de dev e de deploy), para restaurar o banco de desenvolvimento com dados.

## 3. Docker de desenvolvimento
1. Docker Desktop ligado. Depois, `docker compose up -d`, que sobe `medicoes-postgres` (15432), `medicoes-etl` e `medicoes-web` (3000).
2. Banco `medicoes` novo, vazio: aplique o histórico com `docker compose --profile migrate run --build --rm migrate`. Sem o `--build`, a imagem fica em cache com migrations antigas.
3. Para ter dados, restaure um dump: `docker exec -i medicoes-postgres pg_restore -U medicoes_app -d medicoes --clean --if-exists < arquivo.dump`. Depois rode o passo 2 de novo.
4. Para atualizar com código novo: faça o backup (`pg_dump -Fc`) e marque a imagem de rollback (`docker tag projetocrud-medio-web local/medicoes-web-rollback:<UTC>`). Em seguida, migrate com `--build` e `docker compose up -d --build web`.
5. Nunca use `docker compose down -v`, `docker volume rm` nem `prune`: apagam o banco.

## 4. Banco de teste e testes
1. Crie o banco: `docker exec medicoes-postgres createdb -U medicoes_app medicoes_e2e_bm`.
2. Exporte o ambiente de teste (Git Bash): `export $(grep -E "^[A-Z0-9_]+=" .env.test | tr -d '"' | xargs) && export DATABASE_URL="$DATABASE_URL_TEST"`.
3. Aplique o schema com `npx prisma migrate deploy` e rode `npm run test:e2e:seed`.
4. Rode `npx tsc --noEmit`, `npm run test:targeted` (cerca de 1 min) e `npm run test:e2e` (cerca de 10 min; sobe `next dev -p 3011` sozinho). Rode o seed antes de cada suíte.
5. Nunca rode testes contra o `.env`. Depois de qualquer `next dev`, use `git checkout -- tsconfig.json`. Nunca commite `next-env.d.ts`, `tsconfig.tsbuildinfo` nem `.claude/`.
6. `pytest etl/` precisa de uma `DATA_ENCRYPTION_KEY` qualquer, só para o pytest (ver [status](status.md), Bloqueios).

## 5. Claude Code
- Plugins usados pelo projeto: **agent-skills** (ciclo /spec → /plan → /build → /test → /review → /ship), **ponytail** (tamanho da solução e `/ponytail-review`) e **ui-ux-pro-max** (toda tarefa de interface). Instale-os na máquina nova.
- Preferência do usuário guardada só na memória local da máquina antiga, não no repositório: em tarefa de UI, usar a skill UI/UX Pro Max (e a Taste-Skill, se instalada).
- Para começar: leia o `CLAUDE.md` da raiz, depois [status](status.md) e [índice](00-indice.md).
