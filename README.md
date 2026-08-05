# Sistema de Gestão de Medições

Base inicial para ingestão relacional das medições da planilha `Geral` e modelagem PostgreSQL.

## Estrutura

- `etl/ingest_medicoes.py`: lê a planilha Excel, normaliza projetos/profissionais e carrega a tabela fato `medicoes`.
- `database/schema.sql`: cria as tabelas `projetos`, `profissionais`, `medicoes` e a view `vw_dashboard_medicoes`.
- `database/schema.prisma`: modelo Prisma equivalente para iniciar a camada Next.js.
- `etl/requirements.txt`: dependências Python do ETL.

## Execução via Docker

O ambiente completo roda em Docker:

- `postgres`: banco PostgreSQL.
- `etl`: recarrega a planilha e encerra após concluir.
- `web`: aplicação Next.js em modo de produção.

### Subir todo o projeto

Confirme em `.env` o caminho da planilha e execute:

```powershell
.\scripts\docker.ps1 up
```

O serviço `web` aguarda o PostgreSQL ficar saudável e a carga do ETL terminar. Depois, acesse:

```text
http://127.0.0.1:3000
```

Não é necessário executar `npm run dev`.

### Atualizar após alterar a planilha

Salve a planilha no caminho configurado e execute novamente:

```powershell
.\scripts\docker.ps1 refresh
```

### Consultar estado e logs

```powershell
.\scripts\docker.ps1 status
.\scripts\docker.ps1 logs
```

### Desligar

```powershell
.\scripts\docker.ps1 down
```

Para desligar e apagar também todos os dados do PostgreSQL:

```powershell
docker compose -f C:\docker\medicoes-crud\docker-compose.yml down -v
```

O script usa internamente `C:\docker\medicoes-crud`, um junction para a pasta real do projeto. Isso contorna uma limitação do Docker Desktop ao construir projetos em caminhos Windows com caracteres acentuados.

## Credenciais locais

- Banco: `medicoes`
- Usuário: `medicoes_app`
- Senha: `medicoes_app_dev`
- Porta PostgreSQL no Windows: `15432`
- Porta da aplicação: `3000`

## Autenticação e segurança

A plataforma exige login antes de liberar páginas e APIs.

- O usuário administrador inicial é criado automaticamente no primeiro login.
- As credenciais iniciais ficam no arquivo local `.auth-bootstrap.txt`.
- Senhas são armazenadas com `scrypt`, salt aleatório e comparação resistente a timing attacks.
- Após 5 tentativas inválidas, a conta fica bloqueada por 15 minutos.
- A sessão expira após 8 horas e usa cookie `HttpOnly` com `SameSite=Lax`.
- Em ambiente HTTPS, configure `AUTH_COOKIE_SECURE=true`.

Dados sensíveis são cifrados em repouso com AES-256-GCM:

- CPF
- CNPJ
- E-mail
- CPF/CNPJ do mapa de pagamento

A chave está em `DATA_ENCRYPTION_KEY` no arquivo `.env`. Faça backup seguro dessa chave. Se ela for perdida, os dados criptografados não poderão ser recuperados.

Os campos sensíveis também são removidos dos objetos `raw_payload` antes da gravação no PostgreSQL.

## Normalização aplicada

O ETL cria ou atualiza os cadastros normalizados e recarrega as tabelas importadas como um snapshot da fonte atual:

- `projetos`: cadastro único por `codigo_projeto`.
- `profissionais`: cadastro único por nome/ID.
- `medicoes`: tabela fato vinculada por chaves estrangeiras.
- `mapa_pagamento_itens`: linhas da `Tabela5`.
- `bm_aux_medicoes`: dados revisados da aba `BM AUX`.

## Funcionalidades disponíveis

- Dashboard administrativo com Total Medido, Total de Horas, Projetos Ativos e Registros.
- Gráfico de evolução mensal das medições.
- Gráfico de ranking de projetos por valor medido.
- CRUD de medições com filtros por número da medição, projeto e coordenador.
- Modal para criar e editar medições manualmente.
- Dropdowns de Projeto, Coordenador e Profissional alimentados pelas tabelas relacionais.
