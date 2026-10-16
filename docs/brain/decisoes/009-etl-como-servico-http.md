---
data: 2026-10-16
status: aceita
tags: [decisao]
---
# 009 ETL Python como serviço HTTP atrás de proxy autenticado

**Contexto:** a carga das planilhas usa pandas e roda por vários minutos, mas precisa ser disparada pela equipe na interface web.

**Decisão:** manter o ETL como container separado (`etl/server.py`, porta 4000) com uma execução por vez. A web repassa o upload por `pages/api/admin/etl.ts`, que autentica (MEDICAO/ADMIN) e desliga o bodyParser para até 100 MB. Registrada retroativamente.

**Alternativas descartadas:** reescrever o ETL em TS (perde a base pandas e os testes existentes).

**Consequências:** há duas linguagens com regras de identidade espelhadas. O ETL não deve ser exposto fora da rede interna. Existe um diretório `pages/` só por causa desse proxy.
