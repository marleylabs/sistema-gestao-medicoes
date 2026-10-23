---
atualizado: 2026-10-23
tags: [spec]
---
# Fiscal: cadastro completo e acesso ao portal

Continuação da [aprovação pelo fiscal](timesheet-aprovacao-fiscal.md). Spec e plano juntos.

## Objetivo
O cadastro do fiscal no Administrativo → Fiscais passa a ter mais dados, pode ser editado e ganha a seção "Acesso ao portal" igual à do fornecedor, com a redefinição de senha.

## Regras (aprovadas pelo usuário em 2026-10-23)
1. **Campos novos, todos opcionais:** telefone, empresa/órgão, cargo e matrícula, ao lado de nome e e-mail (obrigatórios). Ficam em `usuarios` (`telefone`, `empresa`, `cargo`, `matricula`); o telefone é cifrado como o e-mail (`encryptSensitive`), como no cadastro do fornecedor.
2. **Edição:** "Editar dados" no painel do fiscal troca o detalhe pelo formulário (nome, e-mail e os campos novos); "Salvar" volta ao detalhe. Quem acessa a aba (Administrativo e ADMIN) edita. Auditoria `FISCAL_ATUALIZADO` com só a lista dos campos alterados, nunca os valores (dados pessoais fora do log).
3. **Acesso ao portal:** seção igual à do fornecedor: linha Login (P0, perfil e situação) e linha Senha ("Primeiro acesso pendente" ou "Definida pelo usuário"). "Redefinir senha" só para ADMIN, pela mesma rota e o mesmo modal do fornecedor (`/api/admin/usuarios/[id]`, `reset_senha`): gera senha temporária exibida uma vez, avisa por e-mail sem a senha e volta o fiscal ao primeiro acesso. "Enviar primeiro acesso" continua com a rota dos fiscais (Administrativo e ADMIN), agora dentro da seção e não no rodapé.

## Fora do escopo
"Esqueci minha senha" no login (link de uso único), vínculo de contratos pelo painel do fiscal.

## Plano
1. Migration `fiscal_cadastro_campos` (só acrescenta 4 colunas nulas em `usuarios`) e schema.
2. `lib/fiscais.ts`: listar com os campos novos; `criarFiscal` aceita os campos; `atualizarFiscal` valida (nome ≥ 3, e-mail válido, até 200 caracteres, telefone com 10 ou 11 dígitos) e audita na mesma transação. Rota `PATCH fiscais/[id]` com `action: "editar"`.
3. Tela (`components/administrativo/fiscais.tsx`): formulário único para criar e editar, seção "Acesso ao portal"; o `AdministrativoPanel` passa o pedido de redefinição (o modal e a credencial já moram nele) e recarrega a lista dos fiscais depois.
4. Testes: unitário de criar/editar/validar/auditar sem valores; E2E: Administrativo edita os dados e o ADMIN redefine a senha do fiscal.
