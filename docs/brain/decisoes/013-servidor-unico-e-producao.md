---
data: 2026-10-19
status: aceita
tags: [decisao]
---
# 013 O servidor 192.168.15.101 é a produção

**Contexto:**
- Até 2026-10-19 o cérebro chamava de "pré-produção" o servidor `192.168.15.101` (hostname `projetachatwoot`, diretório `/opt/sistema-gestao-medicoes`, projeto compose `projetocrud-medio`, web na porta 3020). Também esperava uma "produção" separada.
- Em 2026-10-19 o usuário confirmou que esse servidor é a produção. Não existe outro ambiente do En Passant: o servidor tem uma única instalação, e o único acesso SSH configurado (`medicoes-preprod` em `~/.ssh/config`) aponta para ele.

**Decisão:**
- Os ambientes são três: o local de desenvolvimento (Docker na porta 3000, banco `medicoes`), os bancos de teste locais (`medicoes_e2e_bm`, `dev-banco-teste` na porta 3100, container `medicoes-web-layout` na porta 3200) e a produção (`192.168.15.101:3020`).
- Nas notas anteriores a 2026-10-19, "pré-produção" quer dizer esta produção. O histórico não foi reescrito.
- O nome do host SSH (`medicoes-preprod`), o runbook `docs/runbook-p0-pre-producao.md` e as pastas `~/backups-medicoes/` mantêm o nome antigo. Só o nome está errado: eles apontam para a produção.

**Alternativas descartadas:**
- Renomear "pré-produção" para "produção" em todas as notas: reescreveria o histórico das specs e dos planos, que registram o que foi feito e quando.
- Renomear agora o host SSH e o runbook: muda comandos já documentados sem ganho imediato; fica como melhoria.

**Consequências:**
- A migração de códigos P0 (P2, T6) já está aplicada na produção desde 2026-10-18 (UTC). Não há uma segunda migração a fazer.
- Todo deploy nesse servidor é deploy de produção. Ele exige:
  - backup do banco (`pg_dump`) e imagens de rollback antes;
  - pedido explícito do usuário;
  - aviso à equipe quando o web ou o ETL param.
- Não há ambiente intermediário para ensaiar com dados reais. O ensaio é feito numa cópia local de um backup da produção, como na T6.
