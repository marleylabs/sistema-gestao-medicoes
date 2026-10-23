---
data: 2026-10-23
status: aceita
tags: [decisao]
---
# 014 A folha de timesheet é assinada dentro da plataforma

**Contexto:**
- O usuário quis que o fiscal assinasse a folha de timesheet, com transparência, e sugeriu o gov.br. Depois estendeu a assinatura ao colaborador, no envio da folha.
- A folha muda durante o ciclo: o fornecedor corrige dias, a medição reabre, o fiscal reprova e um feriado novo altera as horas. O usuário pediu que a assinatura do fiscal continue registrada na folha durante todo o ciclo.

**Decisão:**
- Usar uma assinatura eletrônica avançada própria, presa à folha (fornecedor + ciclo) e não a um arquivo.
- O que a assinatura grava: quem assinou, com o nome congelado; quando; o IP; o desenho ou o nome digitado (PNG); o SHA-256 do conteúdo da folha; um resumo do momento; e um código de verificação `TS-XXXX-XXXX`.
- Ao assinar, o usuário confirma a senha da sessão.
- A validade vem dessa trilha, não do desenho. É uma assinatura válida entre as partes que aceitam este meio (MP 2.200-2/2001, art. 10, § 2º). O texto de aceite tem versão (`ACEITE_VERSAO`) e ainda precisa ser validado com a VALE.
- Se a folha mudar depois de assinada, a assinatura continua e aparece o aviso "Folha alterada após a assinatura" (o hash atual difere do gravado).
- Regras completas na [spec](../specs/timesheet-assinatura.md).

**Alternativas descartadas:**
- **API de assinatura do gov.br:** é oferecida a órgãos públicos. Para uma empresa privada sobra o caminho manual (`assinador.iti.br`), que assina um PDF fixo e se perde a cada nova exportação.
- **Provedores** (Clicksign, ZapSign, D4Sign, DocuSign): têm custo por documento, trazem uma dependência e um contrato novos e também assinam um arquivo fixo.
- **Certificado ICP-Brasil (A1/A3):** é a forma de maior força jurídica, mas exige que cada fiscal tenha certificado, a integração é pesada e o arquivo também é fixo.

**Consequências:**
- Nova tabela `timesheet_assinaturas` (migration `20261023150000_timesheet_assinatura`), com uma assinatura ativa por folha e papel; as encerradas (`REVOGADA`, `REABERTURA`) ficam como histórico.
- Se a VALE exigir assinatura qualificada, uma camada ICP-Brasil ou um provedor pode ser acrescentado depois, sobre o mesmo registro.
- O XLSX leva só o texto da assinatura (o gerador próprio não escreve imagens). A imagem aparece na tela e no PDF.
