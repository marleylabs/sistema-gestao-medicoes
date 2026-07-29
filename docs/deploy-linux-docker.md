# Deploy em VM Linux com Docker

Este projeto já possui imagens Docker para `web`, `etl` e `postgres`. Para servidor Linux, use o arquivo `docker-compose.prod.yml`.

## 1. Preparar a VM

Instale Docker e o plugin Compose:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Saia e entre novamente no SSH depois do `usermod`.

## 2. Enviar o projeto

Opção com Git:

```bash
git clone <URL_DO_REPOSITORIO> medicoes
cd medicoes
```

Opção sem Git: compacte a pasta do projeto, envie para a VM e extraia em `/opt/medicoes`.

## 3. Criar variáveis de produção

```bash
cp .env.production.example .env
nano .env
```

Gere segredos fortes:

```bash
openssl rand -base64 48
openssl rand -base64 32
```

Use um valor para `AUTH_SESSION_SECRET` e outro para `DATA_ENCRYPTION_KEY`.

Pontos importantes:

- `POSTGRES_PASSWORD`: senha forte do banco. Prefira letras, números e símbolos simples. Se usar caracteres como `@`, `/`, `:`, `#`, `?` ou `&`, será necessário escapar/encodar a senha na URL do banco.
- `APP_URL`: URL final da aplicação, por exemplo `https://medicoes.seudominio.com.br`.
- `AUTH_COOKIE_SECURE=true`: use quando acessar via HTTPS.
- `BM_EMAIL_TEST_TO`: deixe vazio em produção real; preencha apenas se quiser redirecionar todos os testes para um e-mail fixo.
- `AUTH_BOOTSTRAP_USERNAME` e `AUTH_BOOTSTRAP_PASSWORD`: criam o primeiro administrador quando o banco estiver vazio.

## 4. Subir a aplicação

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Verifique:

```bash
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3000/api/health
```

Resposta esperada:

```json
{"status":"ok"}
```

## 5. Acessar

Sem proxy reverso:

```text
http://IP_DA_VM:3000
```

Com domínio e HTTPS, coloque Nginx/Caddy/Traefik na frente apontando para `127.0.0.1:3000`.

## 6. Atualizar versão

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 7. Backup do banco

Criar backup:

```bash
docker exec medicoes-postgres pg_dump -U medicoes_app -d medicoes -Fc > backup-medicoes.dump
```

Restaurar backup:

```bash
cat backup-medicoes.dump | docker exec -i medicoes-postgres pg_restore -U medicoes_app -d medicoes --clean --if-exists
```

## 8. Logs úteis

```bash
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f etl
docker compose -f docker-compose.prod.yml logs -f postgres
```
