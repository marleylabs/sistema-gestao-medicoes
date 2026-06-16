create extension if not exists pgcrypto;

create table if not exists usuarios (
    id uuid primary key default gen_random_uuid(),
    usuario text not null unique,
    nome text not null,
    senha_hash text not null,
    perfil text not null default 'USUARIO',
    ativo boolean not null default true,
    tentativas_falhas integer not null default 0,
    bloqueado_ate timestamptz,
    ultimo_login_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint usuarios_perfil_check check (perfil in ('ADMIN', 'MEDICAO', 'COLABORADOR', 'USUARIO'))
);

alter table usuarios drop constraint if exists usuarios_perfil_check;
alter table usuarios add constraint usuarios_perfil_check check (perfil in ('ADMIN', 'MEDICAO', 'COLABORADOR', 'USUARIO'));

create table if not exists projetos (
    id uuid primary key default gen_random_uuid(),
    codigo_projeto text not null unique,
    titulo_primario text,
    centro_custo text,
    localizacao text,
    contrato text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists sgc_aprovacoes_medicao (
    id uuid primary key default gen_random_uuid(),
    colaborador_codigo text not null unique,
    colaborador_nome text,
    status text not null default 'PENDENTE',
    revisao_numero integer not null default 0,
    pontos_discordancia text,
    aprovado_at timestamptz,
    revisao_solicitada_at timestamptz,
    reenviado_at timestamptz,
    resolvido_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint sgc_aprovacoes_status_check check (status in ('PENDENTE', 'APROVADO', 'REVISAO_SOLICITADA', 'RESOLVIDO'))
);

alter table sgc_aprovacoes_medicao add column if not exists revisao_numero integer not null default 0;
alter table sgc_aprovacoes_medicao add column if not exists reenviado_at timestamptz;

create table if not exists profissionais (
    id uuid primary key default gen_random_uuid(),
    nome text not null unique,
    codigo text unique,
    nome_completo text,
    cpf text,
    razao_social text,
    cnpj text,
    email text,
    status_colaborador text,
    funcao text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table profissionais add column if not exists codigo text;
alter table profissionais add column if not exists nome_completo text;
alter table profissionais add column if not exists cpf text;
alter table profissionais add column if not exists razao_social text;
alter table profissionais add column if not exists cnpj text;
alter table profissionais add column if not exists email text;
alter table profissionais add column if not exists status_colaborador text;

create unique index if not exists idx_profissionais_codigo_unique
    on profissionais(codigo)
    where codigo is not null;

create table if not exists medicoes (
    id uuid primary key default gen_random_uuid(),
    numero_medicao text not null,
    id_projeto uuid not null references projetos(id) on update cascade on delete restrict,
    id_coordenador uuid references profissionais(id) on update cascade on delete set null,
    id_profissional uuid references profissionais(id) on update cascade on delete set null,
    mesclado text,
    numero_documento text,
    evidencia text,
    data_cadastro date,
    formato text,
    quantidade numeric(14, 4) not null default 0,
    multiplicador numeric(14, 4) not null default 0,
    equivalente_a1_horas numeric(14, 4) not null default 0,
    porcentagem_revisao numeric(8, 4),
    emissao_inicial numeric(8, 4),
    retorno_vale numeric(8, 4),
    encerramento numeric(8, 4),
    arquivamento numeric(8, 4),
    medido_horas numeric(14, 4) not null default 0,
    item_qqp text,
    valor_unitario numeric(16, 4) not null default 0,
    valor_bruto numeric(16, 4) not null default 0,
    valor_total numeric(16, 4) not null default 0,
    obs text,
    valor_reajuste numeric(16, 4) not null default 0,
    ciclo text,
    referencia text,
    percentual_emissao numeric(8, 4),
    tipo2 text,
    condicao text,
    valor_medicao numeric(16, 4) not null default 0,
    source_row_hash text not null unique,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists mapa_pagamento_contexto (
    id integer primary key default 1,
    mes_referencia text,
    producao_label text,
    producao_inicio date,
    producao_fim date,
    ato_label text,
    ato_ciclo text,
    contratos jsonb not null default '[]'::jsonb,
    rateio jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    constraint mapa_pagamento_contexto_singleton check (id = 1)
);

create table if not exists mapa_pagamento_itens (
    id uuid primary key default gen_random_uuid(),
    ordem integer not null,
    ato text,
    projetista_codigo text,
    responsavel text,
    cpf_cnpj text,
    razao_social text,
    intr_sossego numeric(16, 4) not null default 0,
    salobo numeric(16, 4) not null default 0,
    acg numeric(16, 4) not null default 0,
    escadas_alumar numeric(16, 4) not null default 0,
    valor numeric(16, 4) not null default 0,
    rev numeric(16, 4) not null default 0,
    status text,
    source_row_hash text not null unique,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists bm_aux_medicoes (
    id uuid primary key default gen_random_uuid(),
    responsavel_codigo text not null,
    ciclo text,
    equivalente_revisado numeric(14, 4) not null default 0,
    valor_medicao numeric(16, 4) not null default 0,
    source_row_hash text not null unique,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table bm_aux_medicoes add column if not exists equivalente_revisado numeric(14, 4) not null default 0;

create index if not exists idx_medicoes_numero_medicao on medicoes(numero_medicao);
create index if not exists idx_usuarios_ativo on usuarios(ativo);
create index if not exists idx_sgc_aprovacoes_medicao_status on sgc_aprovacoes_medicao(status);
create index if not exists idx_sgc_aprovacoes_medicao_revisao on sgc_aprovacoes_medicao(revisao_solicitada_at);
create index if not exists idx_medicoes_data_cadastro on medicoes(data_cadastro);
create index if not exists idx_medicoes_id_projeto on medicoes(id_projeto);
create index if not exists idx_medicoes_id_coordenador on medicoes(id_coordenador);
create index if not exists idx_medicoes_id_profissional on medicoes(id_profissional);
create index if not exists idx_profissionais_codigo on profissionais(codigo);
create index if not exists idx_profissionais_status_colaborador on profissionais(status_colaborador);
create index if not exists idx_mapa_pagamento_itens_projetista_codigo on mapa_pagamento_itens(projetista_codigo);
create index if not exists idx_mapa_pagamento_itens_ato on mapa_pagamento_itens(ato);
create index if not exists idx_bm_aux_medicoes_responsavel_codigo on bm_aux_medicoes(responsavel_codigo);
create index if not exists idx_bm_aux_medicoes_ciclo on bm_aux_medicoes(ciclo);

create or replace view vw_dashboard_medicoes as
select
    p.codigo_projeto,
    p.centro_custo,
    p.localizacao,
    p.contrato,
    date_trunc('month', m.data_cadastro)::date as mes,
    count(*) as total_registros,
    sum(m.medido_horas) as total_horas,
    sum(m.valor_total) as total_medido
from medicoes m
join projetos p on p.id = m.id_projeto
group by
    p.codigo_projeto,
    p.centro_custo,
    p.localizacao,
    p.contrato,
    date_trunc('month', m.data_cadastro)::date;
