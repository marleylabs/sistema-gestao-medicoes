-- ============================================================
-- Schema definitivo — Projeto CRUD Medição
-- Fonte de verdade: sempre sincronizar com prisma/schema.prisma
-- ============================================================

create extension if not exists pgcrypto;

-- ─── usuarios ────────────────────────────────────────────────
create table if not exists usuarios (
    id               uuid        primary key default gen_random_uuid(),
    usuario          text        not null unique,
    nome             text        not null,
    senha_hash       text        not null,
    senha_temporaria text,
    primeiro_login   boolean     not null default false,
    perfil           text        not null default 'MEDICAO',
    ativo            boolean     not null default true,
    avatar_arquivo   bytea,
    avatar_mime      text,
    avatar_atualizado_at timestamptz,
    tentativas_falhas integer    not null default 0,
    bloqueado_ate    timestamptz,
    ultimo_login_at  timestamptz,
    online_at         timestamptz,
    excluido_at       timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint usuarios_perfil_check check (
        perfil in ('ADMIN','MEDICAO','COLABORADOR','FINANCEIRO','ADMINISTRATIVO')
    )
);

-- Migrações incrementais (idempotentes)
alter table usuarios add column if not exists senha_temporaria text;
alter table usuarios add column if not exists primeiro_login boolean not null default false;
alter table usuarios add column if not exists avatar_arquivo bytea;
alter table usuarios add column if not exists avatar_mime text;
alter table usuarios add column if not exists avatar_atualizado_at timestamptz;
alter table usuarios add column if not exists online_at timestamptz;
alter table usuarios add column if not exists excluido_at timestamptz;
alter table usuarios add column if not exists email text;
update usuarios set perfil = 'ADMINISTRATIVO' where perfil = 'DEPARTAMENTO_PESSOAL';
alter table usuarios drop constraint if exists usuarios_perfil_check;
alter table usuarios add constraint usuarios_perfil_check check (
    perfil in ('ADMIN','MEDICAO','COLABORADOR','FINANCEIRO','ADMINISTRATIVO')
);

-- ─── chat geral da plataforma ───────────────────────────────
create table if not exists chat_conversas (
    id         uuid        primary key default gen_random_uuid(),
    chave      text        not null unique,
    tipo       text        not null default 'DIRETA',
    titulo     text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists chat_participantes (
    id            uuid        primary key default gen_random_uuid(),
    conversa_id   uuid        not null references chat_conversas(id) on delete cascade,
    usuario_id    uuid        not null references usuarios(id) on delete cascade,
    ultimo_lido_at timestamptz,
    created_at    timestamptz not null default now(),
    unique (conversa_id, usuario_id)
);

create table if not exists chat_mensagens (
    id          uuid        primary key default gen_random_uuid(),
    conversa_id uuid        not null references chat_conversas(id) on delete cascade,
    autor_id    uuid        not null references usuarios(id) on delete cascade,
    texto       text        not null,
    tipo_mensagem text      not null default 'TEXTO',
    arquivo     bytea,
    arquivo_nome text,
    arquivo_mime text,
    arquivo_tamanho integer,
    origem      text        unique,
    created_at  timestamptz not null default now()
);

alter table chat_mensagens add column if not exists origem text;
alter table chat_mensagens add column if not exists tipo_mensagem text not null default 'TEXTO';
alter table chat_mensagens add column if not exists arquivo bytea;
alter table chat_mensagens add column if not exists arquivo_nome text;
alter table chat_mensagens add column if not exists arquivo_mime text;
alter table chat_mensagens add column if not exists arquivo_tamanho integer;
create unique index if not exists chat_mensagens_origem_key on chat_mensagens(origem) where origem is not null;
create index if not exists idx_chat_conversas_updated_at on chat_conversas(updated_at desc);
create index if not exists idx_chat_participantes_usuario_id on chat_participantes(usuario_id);
create index if not exists idx_chat_mensagens_conversa_created on chat_mensagens(conversa_id, created_at);

-- ─── projetos ────────────────────────────────────────────────
create table if not exists projetos (
    id              uuid        primary key default gen_random_uuid(),
    codigo_projeto  text        not null unique,
    titulo_primario text,
    centro_custo    text,
    localizacao     text,
    contrato        text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ─── profissionais ───────────────────────────────────────────
create table if not exists profissionais (
    id                 uuid        primary key default gen_random_uuid(),
    nome               text        not null unique,
    codigo             text        unique,
    nome_completo      text,
    cpf                text,
    razao_social       text,
    cnpj               text,
    email              text,
    status_colaborador text        check (status_colaborador in ('ATO','PRODUÇÃO') or status_colaborador is null),
    funcao             text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

alter table profissionais add column if not exists codigo text;
alter table profissionais add column if not exists nome_completo text;
alter table profissionais add column if not exists cpf text;
alter table profissionais add column if not exists razao_social text;
alter table profissionais add column if not exists cnpj text;
alter table profissionais add column if not exists email text;
alter table profissionais add column if not exists status_colaborador text;
alter table profissionais add column if not exists funcao text;

-- Exclusão administrativa definitiva (Painel Administrativo) — estado explícito, nunca deduzido
-- de campos vazios. NULL = ativo. Ver prisma/schema.prisma:Profissional para a justificativa
-- completa (preserva a linha fisicamente para não quebrar medicoes.id_profissional/id_coordenador,
-- que usam "on delete set null").
alter table profissionais add column if not exists deleted_at timestamptz;
alter table profissionais add column if not exists deleted_by_id uuid;
alter table profissionais add column if not exists deleted_by_nome text;
alter table profissionais add column if not exists deleted_reason text;

create unique index if not exists idx_profissionais_codigo_unique
    on profissionais(codigo) where codigo is not null;

create index if not exists idx_profissionais_deleted_at on profissionais(deleted_at);

-- ─── cadastros administrativos de fornecedores ───────────────
create table if not exists cadastros_fornecedores (
    id                   uuid        primary key default gen_random_uuid(),
    cnpj_normalizado      text        not null,
    colaborador_codigo    text,
    responsavel           text        not null,
    razao_social          text        not null,
    status_contrato       text,
    objeto_contrato       text,
    cargo                 text,
    cpf                   text,
    cnpj                  text,
    email                 text,
    telefone              text,
    tipo_ct               text,
    tipo_contrato         text,
    valor_hora            numeric(16,4),
    valor_a1_equivalente  numeric(16,4),
    valor_documento       numeric(16,4),
    valor_condicao_fixa   numeric(16,4),
    inicio                date,
    final                 date,
    status_cadastro       text,
    primeiro_aditivo      text,
    segundo_aditivo       text,
    raw_payload           jsonb       not null default '{}'::jsonb,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

alter table cadastros_fornecedores drop constraint if exists cadastros_fornecedores_cnpj_normalizado_key;
drop index if exists cadastros_fornecedores_cnpj_normalizado_key;
create index if not exists idx_cadastros_fornecedores_colaborador_codigo on cadastros_fornecedores(colaborador_codigo);
create index if not exists idx_cadastros_fornecedores_cnpj_normalizado on cadastros_fornecedores(cnpj_normalizado);
create index if not exists idx_cadastros_fornecedores_final on cadastros_fornecedores(final);
alter table cadastros_fornecedores add column if not exists valor_condicao_fixa numeric(16,4);

-- ─── sgc_aprovacoes_medicao ──────────────────────────────────
create table if not exists sgc_aprovacoes_medicao (
    id                        uuid        primary key default gen_random_uuid(),
    colaborador_codigo        text        not null,
    ciclo                     text        not null default '2605',
    colaborador_nome          text,
    status                    text        not null default 'PENDENTE',
    revisao_numero            integer     not null default 0,
    pontos_discordancia       text,
    resposta_admin            text,
    aprovado_at               timestamptz,
    revisao_solicitada_at     timestamptz,
    reenviado_at              timestamptz,
    resolvido_at              timestamptz,
    nf_arquivo                bytea,
    nf_arquivo_nome           text,
    nf_carregado_at           timestamptz,
    pago_at                   timestamptz,
    comprovante_arquivo       bytea,
    comprovante_arquivo_nome  text,
    comprovante_carregado_at  timestamptz,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    constraint sgc_aprovacoes_status_check check (
        status in ('PENDENTE','APROVADO','REVISAO_SOLICITADA','RESOLVIDO','AGUARDANDO_NF','PAGO')
    ),
    constraint sgc_aprovacoes_medicao_codigo_ciclo_key unique (colaborador_codigo, ciclo)
);

-- Migrações incrementais
alter table sgc_aprovacoes_medicao drop constraint if exists sgc_aprovacoes_medicao_colaborador_codigo_key;
alter table sgc_aprovacoes_medicao add column if not exists ciclo text not null default '2605';
alter table sgc_aprovacoes_medicao add column if not exists revisao_numero integer not null default 0;
alter table sgc_aprovacoes_medicao add column if not exists reenviado_at timestamptz;
alter table sgc_aprovacoes_medicao add column if not exists resposta_admin text;
alter table sgc_aprovacoes_medicao add column if not exists nf_arquivo bytea;
alter table sgc_aprovacoes_medicao add column if not exists nf_arquivo_nome text;
alter table sgc_aprovacoes_medicao add column if not exists nf_carregado_at timestamptz;
alter table sgc_aprovacoes_medicao add column if not exists pago_at timestamptz;
alter table sgc_aprovacoes_medicao add column if not exists comprovante_arquivo bytea;
alter table sgc_aprovacoes_medicao add column if not exists comprovante_arquivo_nome text;
alter table sgc_aprovacoes_medicao add column if not exists comprovante_carregado_at timestamptz;
alter table sgc_aprovacoes_medicao drop constraint if exists sgc_aprovacoes_status_check;
alter table sgc_aprovacoes_medicao add constraint sgc_aprovacoes_status_check check (
    status in ('PENDENTE','APROVADO','REVISAO_SOLICITADA','RESOLVIDO','AGUARDANDO_NF','PAGO')
);
create unique index if not exists sgc_aprovacoes_medicao_codigo_ciclo_key
    on sgc_aprovacoes_medicao(colaborador_codigo, ciclo);

-- Novas colunas Portal do Colaborador (fluxo Salvar/Enviar/Voltar/Cancelar)
alter table sgc_aprovacoes_medicao add column if not exists salvo_at timestamptz;
alter table sgc_aprovacoes_medicao add column if not exists observacao_colaborador text;
alter table sgc_aprovacoes_medicao add column if not exists voltado_at timestamptz;
alter table sgc_aprovacoes_medicao drop constraint if exists sgc_aprovacoes_status_check;
alter table sgc_aprovacoes_medicao add constraint sgc_aprovacoes_status_check check (
    status in ('AGUARDANDO_ENVIO','PENDENTE','REVISAO_SOLICITADA','AGUARDANDO_NF','APROVADO','PAGO','CANCELADO')
);

-- Conferência prévia de documentos pelo fornecedor, anterior à liberação do PENDENTE de aprovação.
-- Campo independente de status: não altera o significado nem os valores permitidos de "status".
alter table sgc_aprovacoes_medicao add column if not exists status_conferencia text not null default 'CONCLUIDA';
alter table sgc_aprovacoes_medicao add column if not exists conferencia_arquivo bytea;
alter table sgc_aprovacoes_medicao add column if not exists conferencia_arquivo_nome text;
alter table sgc_aprovacoes_medicao add column if not exists conferencia_carregado_at timestamptz;
alter table sgc_aprovacoes_medicao drop constraint if exists sgc_aprovacoes_status_conferencia_check;
alter table sgc_aprovacoes_medicao add constraint sgc_aprovacoes_status_conferencia_check check (
    status_conferencia in ('AGUARDANDO_UPLOAD','DIVERGENCIA','CONCLUIDA')
);

-- ─── divergencias_medicao ───────────────────────────────────────
create table if not exists divergencias_medicao (
    id                             uuid        primary key default gen_random_uuid(),
    sgc_id                         uuid        not null references sgc_aprovacoes_medicao(id) on delete cascade,
    colaborador_codigo             text        not null,
    ciclo                          text        not null,
    id_medicao_existente           uuid,
    nr_vale                        text        not null,
    documento_nao_mapeado          boolean     not null default false,
    comparacao_ambigua             boolean     not null default false,
    formato_divergente             boolean     not null default false,
    a1eq_divergente                boolean     not null default false,
    emissao_divergente             boolean     not null default false,
    tipo_divergente                boolean     not null default false,
    equipe_formato                 text,
    equipe_a1eq_hh                 numeric(14,4),
    equipe_percentual_emissao      numeric(8,4),
    equipe_tipo                    text,
    fornecedor_formato             text        not null,
    fornecedor_a1eq_hh             numeric(14,4) not null,
    fornecedor_percentual_emissao  numeric(8,4)  not null,
    fornecedor_tipo                text        not null,
    status                         text        not null default 'PENDENTE',
    observacao                     text,
    resolvido_por_usuario_id       uuid        references usuarios(id) on delete set null,
    resolvido_por_nome             text,
    resolvido_em                   timestamptz,
    created_at                     timestamptz not null default now(),
    updated_at                     timestamptz not null default now(),
    constraint divergencias_medicao_status_check check (status in ('PENDENTE','INCLUIDA','DESCARTADA')),
    constraint divergencias_medicao_sgc_nrvale_key unique (sgc_id, nr_vale)
);

-- ─── sgc_logs ─────────────────────────────────────────────────
create table if not exists sgc_logs (
    id                 uuid        primary key default gen_random_uuid(),
    sgc_id             uuid        references sgc_aprovacoes_medicao(id) on delete set null,
    colaborador_codigo text        not null,
    ciclo              text,
    usuario_id         uuid        references usuarios(id) on delete set null,
    usuario_nome       text,
    acao               text        not null,
    status_anterior    text,
    status_novo        text,
    tela_origem        text,
    observacao         text,
    tipo_mensagem      text        not null default 'TEXTO',
    audio_arquivo      bytea,
    audio_mime         text,
    audio_nome         text,
    lido_at            timestamptz,
    created_at         timestamptz not null default now()
);

alter table sgc_logs add column if not exists lido_at timestamptz;
alter table sgc_logs add column if not exists tipo_mensagem text not null default 'TEXTO';
alter table sgc_logs add column if not exists audio_arquivo bytea;
alter table sgc_logs add column if not exists audio_mime text;
alter table sgc_logs add column if not exists audio_nome text;

create index if not exists idx_sgc_logs_sgc_id on sgc_logs(sgc_id);
create index if not exists idx_sgc_logs_colaborador_ciclo on sgc_logs(colaborador_codigo, ciclo);
create index if not exists idx_sgc_logs_created_at on sgc_logs(created_at desc);

-- ─── mapa_pagamento_contexto ─────────────────────────────────
-- Multi-ciclo: ciclo é a PK. Substitui o modelo singleton (id=1).
create table if not exists mapa_pagamento_contexto (
    ciclo           text        primary key,
    mes_referencia  text,
    producao_label  text,
    producao_inicio date,
    producao_fim    date,
    ato_label       text,
    ato_ciclo       text,
    ativo_medicao   boolean     not null default false,
    contratos       jsonb       not null default '[]'::jsonb,
    rateio          jsonb       not null default '[]'::jsonb,
    updated_at      timestamptz not null default now()
);

alter table mapa_pagamento_contexto add column if not exists ativo_medicao boolean not null default false;
create unique index if not exists mapa_pagamento_contexto_ativo_medicao_key
    on mapa_pagamento_contexto(ativo_medicao)
    where ativo_medicao = true;

-- ─── mapa_pagamento_itens ────────────────────────────────────
create table if not exists mapa_pagamento_itens (
    id               uuid        primary key default gen_random_uuid(),
    ciclo            text        not null default '2605',
    ordem            integer     not null,
    ato              text,
    projetista_codigo text,
    responsavel      text,
    cpf_cnpj         text,
    razao_social     text,
    intr_sossego     numeric(18,8) not null default 0,
    salobo           numeric(18,8) not null default 0,
    acg              numeric(18,8) not null default 0,
    escadas_alumar   numeric(18,8) not null default 0,
    horas            numeric(14,4) not null default 0,
    valor            numeric(16,4) not null default 0,
    rev              numeric(16,4) not null default 0,
    status           text,
    source_row_hash  text        not null unique,
    raw_payload      jsonb       not null default '{}'::jsonb,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- Migrações incrementais
alter table mapa_pagamento_itens add column if not exists ciclo text not null default '2605';
alter table mapa_pagamento_itens add column if not exists horas numeric(14,4) not null default 0;
alter table mapa_pagamento_itens
    alter column intr_sossego type numeric(18,8),
    alter column salobo type numeric(18,8),
    alter column acg type numeric(18,8),
    alter column escadas_alumar type numeric(18,8);

-- ─── medicoes ────────────────────────────────────────────────
create table if not exists medicoes (
    id                   uuid          primary key default gen_random_uuid(),
    numero_medicao       text          not null,
    id_projeto           uuid          not null references projetos(id) on update cascade on delete restrict,
    id_coordenador       uuid          references profissionais(id) on update cascade on delete set null,
    id_profissional      uuid          references profissionais(id) on update cascade on delete set null,
    ciclo                text,
    mesclado             text,
    numero_documento     text,
    evidencia            text,
    data_cadastro        date,
    formato              text,
    quantidade           numeric(14,4) not null default 0,
    multiplicador        numeric(14,4) not null default 0,
    equivalente_a1_horas numeric(14,4) not null default 0,
    porcentagem_revisao  numeric(8,4),
    emissao_inicial      numeric(8,4),
    retorno_vale         numeric(8,4),
    encerramento         numeric(8,4),
    arquivamento         numeric(8,4),
    medido_horas         numeric(14,4) not null default 0,
    item_qqp             text,
    valor_unitario       numeric(16,4) not null default 0,
    valor_bruto          numeric(16,4) not null default 0,
    valor_total          numeric(16,4) not null default 0,
    obs                  text,
    valor_reajuste       numeric(16,4) not null default 0,
    referencia           text,
    percentual_emissao   numeric(8,4),
    tipo2                text,
    condicao             text,
    valor_medicao        numeric(16,4) not null default 0,
    source_row_hash      text          not null unique,
    raw_payload          jsonb         not null default '{}'::jsonb,
    created_at           timestamptz   not null default now(),
    updated_at           timestamptz   not null default now(),
    constraint medicoes_quantidade_nn   check (quantidade >= 0),
    constraint medicoes_valor_total_nn  check (valor_total >= 0),
    constraint medicoes_valor_medicao_nn check (valor_medicao >= 0)
);

-- Snapshot do nome exibido no momento em que o profissional/coordenador referenciado foi excluído
-- administrativamente — preenchido só nesse momento (ver profissionais.deleted_at), nunca na
-- criação normal da medição. Garante que o histórico continue mostrando quem mediu mesmo depois
-- do cadastro operacional ter sido anonimizado.
alter table medicoes add column if not exists coordenador_nome_snapshot text;
alter table medicoes add column if not exists profissional_nome_snapshot text;

-- ─── admin_audit_logs ────────────────────────────────────────
-- Trilha de auditoria persistente para operações administrativas destrutivas (hoje: exclusão
-- definitiva de fornecedor/colaborador). Nunca grava senha/token/segredo, nem CPF/CNPJ/e-mail
-- completos — só o suficiente para responder quem/quando/o quê.
create table if not exists admin_audit_logs (
    id             uuid        primary key default gen_random_uuid(),
    action         text        not null,
    admin_id       uuid        not null,
    admin_usuario  text        not null,
    admin_nome     text        not null,
    target_type    text        not null,
    target_id      uuid,
    target_codigo  text,
    reason         text,
    metadata       jsonb,
    created_at     timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_action        on admin_audit_logs(action);
create index if not exists idx_admin_audit_logs_target_codigo on admin_audit_logs(target_codigo);
create index if not exists idx_admin_audit_logs_created_at    on admin_audit_logs(created_at desc);

-- ─── bm_aux_medicoes ─────────────────────────────────────────
create table if not exists bm_aux_medicoes (
    id                   uuid          primary key default gen_random_uuid(),
    responsavel_codigo   text          not null,
    ciclo                text,
    equivalente_revisado numeric(14,4) not null default 0,
    valor_medicao        numeric(16,4) not null default 0,
    source_row_hash      text          not null unique,
    raw_payload          jsonb         not null default '{}'::jsonb,
    created_at           timestamptz   not null default now(),
    updated_at           timestamptz   not null default now()
);

alter table bm_aux_medicoes add column if not exists equivalente_revisado numeric(14,4) not null default 0;

-- ─── contratos ───────────────────────────────────────────────
create table if not exists contratos (
    id          uuid          primary key default gen_random_uuid(),
    nome        text          not null unique,
    codigo      text,
    descricao   text,
    gestor      text,
    fiscal      text,
    data_inicio date,
    data_fim    date,
    valor_total numeric(18,2),
    coluna_mapa text,
    ativo       boolean       not null default true,
    created_at  timestamptz   not null default now(),
    updated_at  timestamptz   not null default now()
);

alter table contratos add column if not exists gestor text;
alter table contratos add column if not exists fiscal text;
alter table contratos add column if not exists data_inicio date;
alter table contratos add column if not exists data_fim date;
alter table contratos add column if not exists valor_total numeric(18,2);
alter table contratos add column if not exists coluna_mapa text;

-- ─── etl_execucoes (audit de importações) ────────────────────
create table if not exists etl_execucoes (
    id             uuid        primary key default gen_random_uuid(),
    ciclo          text,
    iniciado_at    timestamptz not null default now(),
    finalizado_at  timestamptz,
    status         text        not null default 'RUNNING',
    rows_processed integer,
    resultado      jsonb,
    erro           text,
    constraint etl_execucoes_status_check check (status in ('RUNNING','SUCCESS','FAILURE'))
);

-- ─── Índices ─────────────────────────────────────────────────
create index if not exists idx_usuarios_ativo                       on usuarios(ativo);
create index if not exists idx_sgc_aprovacoes_medicao_status        on sgc_aprovacoes_medicao(status);
create index if not exists idx_sgc_aprovacoes_medicao_ciclo         on sgc_aprovacoes_medicao(ciclo);
create index if not exists idx_sgc_aprovacoes_medicao_revisao       on sgc_aprovacoes_medicao(revisao_solicitada_at);
create index if not exists idx_profissionais_codigo                 on profissionais(codigo);
create index if not exists idx_profissionais_status_colaborador     on profissionais(status_colaborador);
create index if not exists idx_medicoes_numero_medicao              on medicoes(numero_medicao);
create index if not exists idx_medicoes_data_cadastro               on medicoes(data_cadastro);
create index if not exists idx_medicoes_id_projeto                  on medicoes(id_projeto);
create index if not exists idx_medicoes_id_coordenador              on medicoes(id_coordenador);
create index if not exists idx_medicoes_id_profissional             on medicoes(id_profissional);
create index if not exists idx_medicoes_ciclo                       on medicoes(ciclo);
create index if not exists idx_mapa_pagamento_itens_ciclo           on mapa_pagamento_itens(ciclo);
create index if not exists idx_mapa_pagamento_itens_projetista      on mapa_pagamento_itens(projetista_codigo);
create index if not exists idx_mapa_pagamento_itens_ato             on mapa_pagamento_itens(ato);
create index if not exists idx_bm_aux_medicoes_responsavel_codigo   on bm_aux_medicoes(responsavel_codigo);
create index if not exists idx_bm_aux_medicoes_ciclo                on bm_aux_medicoes(ciclo);
create index if not exists idx_contratos_ativo                      on contratos(ativo);
create index if not exists idx_etl_execucoes_ciclo                  on etl_execucoes(ciclo);
create index if not exists idx_sgc_aprovacoes_medicao_status_conf   on sgc_aprovacoes_medicao(status_conferencia);
create index if not exists idx_divergencias_medicao_colaborador     on divergencias_medicao(colaborador_codigo, ciclo);
create index if not exists idx_divergencias_medicao_status          on divergencias_medicao(status);
create index if not exists idx_divergencias_medicao_sgc             on divergencias_medicao(sgc_id);

-- ─── View dashboard ──────────────────────────────────────────
create or replace view vw_dashboard_medicoes as
select
    p.codigo_projeto,
    p.centro_custo,
    p.localizacao,
    p.contrato,
    m.ciclo,
    date_trunc('month', m.data_cadastro)::date as mes,
    count(*)                as total_registros,
    sum(m.medido_horas)     as total_horas,
    sum(m.valor_total)      as total_medido
from medicoes m
join projetos p on p.id = m.id_projeto
group by
    p.codigo_projeto,
    p.centro_custo,
    p.localizacao,
    p.contrato,
    m.ciclo,
    date_trunc('month', m.data_cadastro)::date;

-- ─── e-mails transacionais (Resend) ─────────────────────────
create table if not exists email_logs (
    id                     uuid        primary key default gen_random_uuid(),
    event                  text        not null,
    entity_type            text,
    entity_id              text,
    intended_recipients    text[]      not null default '{}',
    actual_recipients      text[]      not null default '{}',
    test_mode              boolean     not null,
    subject                text        not null,
    provider               text        not null default 'resend',
    provider_message_id    text,
    status                 text        not null,
    error_message          text,
    idempotency_key        text        not null,
    metadata               jsonb,
    created_at             timestamptz not null default now()
);
create index if not exists email_logs_event_idx on email_logs(event);
create index if not exists email_logs_created_at_idx on email_logs(created_at desc);
create index if not exists email_logs_idempotency_key_idx on email_logs(idempotency_key);
