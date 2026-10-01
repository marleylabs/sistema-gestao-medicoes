-- Migration BASE do schema legado (anterior a 20260903160000_profissional_exclusao_definitiva).
--
-- O schema original foi criado fora do Prisma (database/schema.sql, mantido atualizado a cada
-- mudança), então o histórico não tinha como reconstruir um banco vazio (P3006 no banco-sombra).
-- Este arquivo é o schema físico real de produção (pg_dump --schema-only de 2026-09-30) SEM os
-- objetos criados pelas 6 migrations seguintes — elas são aplicadas por cima, em ordem:
--   20260903160000_profissional_exclusao_definitiva, 20260904120000_condicao_fixa_condicional,
--   20260904140000_fonte_medicao, 20260909150000_usuario_permissao_extra,
--   20260928173000_cadastro_fornecedor_inativacao, 20260930090000_profissional_alias.
-- Inclui o que o Prisma não gera: extensão pgcrypto, CHECKs e a view vw_dashboard_medicoes.
--
-- Bancos que já existiam antes desta migration (DEV, E2E, produção legada) a registram com
-- `prisma migrate resolve --applied 20260902000000_baseline_legado` — nunca a executam.
--




--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--





--
-- Name: bm_aux_medicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bm_aux_medicoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    responsavel_codigo text NOT NULL,
    ciclo text,
    equivalente_revisado numeric(14,4) DEFAULT 0 NOT NULL,
    valor_medicao numeric(16,4) DEFAULT 0 NOT NULL,
    source_row_hash text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cadastros_fornecedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cadastros_fornecedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cnpj_normalizado text NOT NULL,
    colaborador_codigo text,
    responsavel text NOT NULL,
    razao_social text NOT NULL,
    status_contrato text,
    objeto_contrato text,
    cargo text,
    cpf text,
    cnpj text,
    email text,
    telefone text,
    tipo_ct text,
    tipo_contrato text,
    valor_hora numeric(16,4),
    valor_a1_equivalente numeric(16,4),
    valor_documento numeric(16,4),
    valor_condicao_fixa numeric(16,4),
    inicio date,
    final date,
    status_cadastro text,
    primeiro_aditivo text,
    segundo_aditivo text,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_conversas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_conversas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chave text NOT NULL,
    tipo text DEFAULT 'DIRETA'::text NOT NULL,
    titulo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_mensagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_mensagens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversa_id uuid NOT NULL,
    autor_id uuid NOT NULL,
    texto text NOT NULL,
    tipo_mensagem text DEFAULT 'TEXTO'::text NOT NULL,
    arquivo bytea,
    arquivo_nome text,
    arquivo_mime text,
    arquivo_tamanho integer,
    origem text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_participantes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_participantes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversa_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    ultimo_lido_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contratos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    codigo text,
    descricao text,
    gestor text,
    fiscal text,
    data_inicio date,
    data_fim date,
    valor_total numeric(18,2),
    coluna_mapa text,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: divergencias_medicao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.divergencias_medicao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sgc_id uuid NOT NULL,
    colaborador_codigo text NOT NULL,
    ciclo text NOT NULL,
    id_medicao_existente uuid,
    nr_vale text NOT NULL,
    documento_nao_mapeado boolean DEFAULT false NOT NULL,
    comparacao_ambigua boolean DEFAULT false NOT NULL,
    formato_divergente boolean DEFAULT false NOT NULL,
    a1eq_divergente boolean DEFAULT false NOT NULL,
    emissao_divergente boolean DEFAULT false NOT NULL,
    tipo_divergente boolean DEFAULT false NOT NULL,
    equipe_formato text,
    equipe_a1eq_hh numeric(14,4),
    equipe_percentual_emissao numeric(8,4),
    equipe_tipo text,
    fornecedor_formato text NOT NULL,
    fornecedor_a1eq_hh numeric(14,4) NOT NULL,
    fornecedor_percentual_emissao numeric(8,4) NOT NULL,
    fornecedor_tipo text NOT NULL,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    observacao text,
    resolvido_por_usuario_id uuid,
    resolvido_por_nome text,
    resolvido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT divergencias_medicao_status_check CHECK ((status = ANY (ARRAY['PENDENTE'::text, 'INCLUIDA'::text, 'DESCARTADA'::text])))
);


--
-- Name: email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event text NOT NULL,
    entity_type text,
    entity_id text,
    intended_recipients text[] DEFAULT '{}'::text[] NOT NULL,
    actual_recipients text[] DEFAULT '{}'::text[] NOT NULL,
    test_mode boolean NOT NULL,
    subject text NOT NULL,
    provider text DEFAULT 'resend'::text NOT NULL,
    provider_message_id text,
    status text NOT NULL,
    error_message text,
    idempotency_key text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: etl_execucoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etl_execucoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ciclo text,
    iniciado_at timestamp with time zone DEFAULT now() NOT NULL,
    finalizado_at timestamp with time zone,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    rows_processed integer,
    resultado jsonb,
    erro text,
    CONSTRAINT etl_execucoes_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCESS'::text, 'FAILURE'::text])))
);


--
-- Name: mapa_pagamento_contexto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mapa_pagamento_contexto (
    ciclo text NOT NULL,
    mes_referencia text,
    producao_label text,
    producao_inicio date,
    producao_fim date,
    ato_label text,
    ato_ciclo text,
    ativo_medicao boolean DEFAULT false NOT NULL,
    contratos jsonb DEFAULT '[]'::jsonb NOT NULL,
    rateio jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mapa_pagamento_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mapa_pagamento_itens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ciclo text DEFAULT '2605'::text NOT NULL,
    ordem integer NOT NULL,
    ato text,
    projetista_codigo text,
    responsavel text,
    cpf_cnpj text,
    razao_social text,
    intr_sossego numeric(18,8) DEFAULT 0 NOT NULL,
    salobo numeric(18,8) DEFAULT 0 NOT NULL,
    acg numeric(18,8) DEFAULT 0 NOT NULL,
    escadas_alumar numeric(18,8) DEFAULT 0 NOT NULL,
    horas numeric(14,4) DEFAULT 0 NOT NULL,
    valor numeric(16,4) DEFAULT 0 NOT NULL,
    rev numeric(16,4) DEFAULT 0 NOT NULL,
    status text,
    source_row_hash text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: medicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medicoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_medicao text NOT NULL,
    id_projeto uuid NOT NULL,
    id_coordenador uuid,
    id_profissional uuid,
    ciclo text,
    mesclado text,
    numero_documento text,
    evidencia text,
    data_cadastro date,
    formato text,
    quantidade numeric(14,4) DEFAULT 0 NOT NULL,
    multiplicador numeric(14,4) DEFAULT 0 NOT NULL,
    equivalente_a1_horas numeric(14,4) DEFAULT 0 NOT NULL,
    porcentagem_revisao numeric(8,4),
    emissao_inicial numeric(8,4),
    retorno_vale numeric(8,4),
    encerramento numeric(8,4),
    arquivamento numeric(8,4),
    medido_horas numeric(14,4) DEFAULT 0 NOT NULL,
    item_qqp text,
    valor_unitario numeric(16,4) DEFAULT 0 NOT NULL,
    valor_bruto numeric(16,4) DEFAULT 0 NOT NULL,
    valor_total numeric(16,4) DEFAULT 0 NOT NULL,
    obs text,
    valor_reajuste numeric(16,4) DEFAULT 0 NOT NULL,
    referencia text,
    percentual_emissao numeric(8,4),
    tipo2 text,
    condicao text,
    valor_medicao numeric(16,4) DEFAULT 0 NOT NULL,
    source_row_hash text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT medicoes_quantidade_nn CHECK ((quantidade >= (0)::numeric)),
    CONSTRAINT medicoes_valor_medicao_nn CHECK ((valor_medicao >= (0)::numeric)),
    CONSTRAINT medicoes_valor_total_nn CHECK ((valor_total >= (0)::numeric))
);


--
-- Name: profissionais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profissionais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    codigo text,
    nome_completo text,
    cpf text,
    razao_social text,
    cnpj text,
    email text,
    status_colaborador text,
    funcao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profissionais_status_colaborador_check CHECK (((status_colaborador = ANY (ARRAY['ATO'::text, 'PRODUÇÃO'::text])) OR (status_colaborador IS NULL)))
);


--
-- Name: projetos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projetos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo_projeto text NOT NULL,
    titulo_primario text,
    centro_custo text,
    localizacao text,
    contrato text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sgc_aprovacoes_medicao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sgc_aprovacoes_medicao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    colaborador_codigo text NOT NULL,
    ciclo text DEFAULT '2605'::text NOT NULL,
    colaborador_nome text,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    revisao_numero integer DEFAULT 0 NOT NULL,
    pontos_discordancia text,
    resposta_admin text,
    aprovado_at timestamp with time zone,
    revisao_solicitada_at timestamp with time zone,
    reenviado_at timestamp with time zone,
    resolvido_at timestamp with time zone,
    nf_arquivo bytea,
    nf_arquivo_nome text,
    nf_carregado_at timestamp with time zone,
    pago_at timestamp with time zone,
    comprovante_arquivo bytea,
    comprovante_arquivo_nome text,
    comprovante_carregado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    salvo_at timestamp with time zone,
    observacao_colaborador text,
    voltado_at timestamp with time zone,
    status_conferencia text DEFAULT 'CONCLUIDA'::text NOT NULL,
    conferencia_arquivo bytea,
    conferencia_arquivo_nome text,
    conferencia_carregado_at timestamp with time zone,
    CONSTRAINT sgc_aprovacoes_status_check CHECK ((status = ANY (ARRAY['AGUARDANDO_ENVIO'::text, 'PENDENTE'::text, 'REVISAO_SOLICITADA'::text, 'AGUARDANDO_NF'::text, 'APROVADO'::text, 'PAGO'::text, 'CANCELADO'::text]))),
    CONSTRAINT sgc_aprovacoes_status_conferencia_check CHECK ((status_conferencia = ANY (ARRAY['AGUARDANDO_UPLOAD'::text, 'DIVERGENCIA'::text, 'CONCLUIDA'::text])))
);


--
-- Name: sgc_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sgc_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sgc_id uuid,
    colaborador_codigo text NOT NULL,
    ciclo text,
    usuario_id uuid,
    usuario_nome text,
    acao text NOT NULL,
    status_anterior text,
    status_novo text,
    tela_origem text,
    observacao text,
    tipo_mensagem text DEFAULT 'TEXTO'::text NOT NULL,
    audio_arquivo bytea,
    audio_mime text,
    audio_nome text,
    lido_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario text NOT NULL,
    nome text NOT NULL,
    senha_hash text NOT NULL,
    senha_temporaria text,
    primeiro_login boolean DEFAULT false NOT NULL,
    perfil text DEFAULT 'MEDICAO'::text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    avatar_arquivo bytea,
    avatar_mime text,
    avatar_atualizado_at timestamp with time zone,
    tentativas_falhas integer DEFAULT 0 NOT NULL,
    bloqueado_ate timestamp with time zone,
    ultimo_login_at timestamp with time zone,
    online_at timestamp with time zone,
    excluido_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    CONSTRAINT usuarios_perfil_check CHECK ((perfil = ANY (ARRAY['ADMIN'::text, 'MEDICAO'::text, 'COLABORADOR'::text, 'FINANCEIRO'::text, 'ADMINISTRATIVO'::text])))
);


--
-- Name: vw_dashboard_medicoes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_dashboard_medicoes AS
 SELECT p.codigo_projeto,
    p.centro_custo,
    p.localizacao,
    p.contrato,
    m.ciclo,
    (date_trunc('month'::text, (m.data_cadastro)::timestamp with time zone))::date AS mes,
    count(*) AS total_registros,
    sum(m.medido_horas) AS total_horas,
    sum(m.valor_total) AS total_medido
   FROM (public.medicoes m
     JOIN public.projetos p ON ((p.id = m.id_projeto)))
  GROUP BY p.codigo_projeto, p.centro_custo, p.localizacao, p.contrato, m.ciclo, ((date_trunc('month'::text, (m.data_cadastro)::timestamp with time zone))::date);


--
-- Name: bm_aux_medicoes bm_aux_medicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bm_aux_medicoes
    ADD CONSTRAINT bm_aux_medicoes_pkey PRIMARY KEY (id);


--
-- Name: bm_aux_medicoes bm_aux_medicoes_source_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bm_aux_medicoes
    ADD CONSTRAINT bm_aux_medicoes_source_row_hash_key UNIQUE (source_row_hash);


--
-- Name: cadastros_fornecedores cadastros_fornecedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadastros_fornecedores
    ADD CONSTRAINT cadastros_fornecedores_pkey PRIMARY KEY (id);


--
-- Name: chat_conversas chat_conversas_chave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversas
    ADD CONSTRAINT chat_conversas_chave_key UNIQUE (chave);


--
-- Name: chat_conversas chat_conversas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversas
    ADD CONSTRAINT chat_conversas_pkey PRIMARY KEY (id);


--
-- Name: chat_mensagens chat_mensagens_origem_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_origem_key UNIQUE (origem);


--
-- Name: chat_mensagens chat_mensagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_pkey PRIMARY KEY (id);


--
-- Name: chat_participantes chat_participantes_conversa_id_usuario_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_conversa_id_usuario_id_key UNIQUE (conversa_id, usuario_id);


--
-- Name: chat_participantes chat_participantes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_pkey PRIMARY KEY (id);


--
-- Name: contratos contratos_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_nome_key UNIQUE (nome);


--
-- Name: contratos contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_pkey PRIMARY KEY (id);


--
-- Name: divergencias_medicao divergencias_medicao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divergencias_medicao
    ADD CONSTRAINT divergencias_medicao_pkey PRIMARY KEY (id);


--
-- Name: divergencias_medicao divergencias_medicao_sgc_nrvale_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divergencias_medicao
    ADD CONSTRAINT divergencias_medicao_sgc_nrvale_key UNIQUE (sgc_id, nr_vale);


--
-- Name: email_logs email_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);


--
-- Name: etl_execucoes etl_execucoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_execucoes
    ADD CONSTRAINT etl_execucoes_pkey PRIMARY KEY (id);


--
-- Name: mapa_pagamento_contexto mapa_pagamento_contexto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mapa_pagamento_contexto
    ADD CONSTRAINT mapa_pagamento_contexto_pkey PRIMARY KEY (ciclo);


--
-- Name: mapa_pagamento_itens mapa_pagamento_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mapa_pagamento_itens
    ADD CONSTRAINT mapa_pagamento_itens_pkey PRIMARY KEY (id);


--
-- Name: mapa_pagamento_itens mapa_pagamento_itens_source_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mapa_pagamento_itens
    ADD CONSTRAINT mapa_pagamento_itens_source_row_hash_key UNIQUE (source_row_hash);


--
-- Name: medicoes medicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicoes
    ADD CONSTRAINT medicoes_pkey PRIMARY KEY (id);


--
-- Name: medicoes medicoes_source_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicoes
    ADD CONSTRAINT medicoes_source_row_hash_key UNIQUE (source_row_hash);


--
-- Name: profissionais profissionais_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profissionais
    ADD CONSTRAINT profissionais_codigo_key UNIQUE (codigo);


--
-- Name: profissionais profissionais_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profissionais
    ADD CONSTRAINT profissionais_nome_key UNIQUE (nome);


--
-- Name: profissionais profissionais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profissionais
    ADD CONSTRAINT profissionais_pkey PRIMARY KEY (id);


--
-- Name: projetos projetos_codigo_projeto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projetos
    ADD CONSTRAINT projetos_codigo_projeto_key UNIQUE (codigo_projeto);


--
-- Name: projetos projetos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projetos
    ADD CONSTRAINT projetos_pkey PRIMARY KEY (id);


--
-- Name: sgc_aprovacoes_medicao sgc_aprovacoes_medicao_codigo_ciclo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sgc_aprovacoes_medicao
    ADD CONSTRAINT sgc_aprovacoes_medicao_codigo_ciclo_key UNIQUE (colaborador_codigo, ciclo);


--
-- Name: sgc_aprovacoes_medicao sgc_aprovacoes_medicao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sgc_aprovacoes_medicao
    ADD CONSTRAINT sgc_aprovacoes_medicao_pkey PRIMARY KEY (id);


--
-- Name: sgc_logs sgc_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sgc_logs
    ADD CONSTRAINT sgc_logs_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_usuario_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_usuario_key UNIQUE (usuario);


--
-- Name: email_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_logs_created_at_idx ON public.email_logs USING btree (created_at DESC);


--
-- Name: email_logs_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_logs_event_idx ON public.email_logs USING btree (event);


--
-- Name: email_logs_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_logs_idempotency_key_idx ON public.email_logs USING btree (idempotency_key);


--
-- Name: idx_bm_aux_medicoes_ciclo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bm_aux_medicoes_ciclo ON public.bm_aux_medicoes USING btree (ciclo);


--
-- Name: idx_bm_aux_medicoes_responsavel_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bm_aux_medicoes_responsavel_codigo ON public.bm_aux_medicoes USING btree (responsavel_codigo);


--
-- Name: idx_cadastros_fornecedores_cnpj_normalizado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cadastros_fornecedores_cnpj_normalizado ON public.cadastros_fornecedores USING btree (cnpj_normalizado);


--
-- Name: idx_cadastros_fornecedores_colaborador_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cadastros_fornecedores_colaborador_codigo ON public.cadastros_fornecedores USING btree (colaborador_codigo);


--
-- Name: idx_cadastros_fornecedores_final; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cadastros_fornecedores_final ON public.cadastros_fornecedores USING btree (final);


--
-- Name: idx_chat_conversas_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_conversas_updated_at ON public.chat_conversas USING btree (updated_at DESC);


--
-- Name: idx_chat_mensagens_conversa_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_mensagens_conversa_created ON public.chat_mensagens USING btree (conversa_id, created_at);


--
-- Name: idx_chat_participantes_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_participantes_usuario_id ON public.chat_participantes USING btree (usuario_id);


--
-- Name: idx_contratos_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_ativo ON public.contratos USING btree (ativo);


--
-- Name: idx_divergencias_medicao_colaborador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_divergencias_medicao_colaborador ON public.divergencias_medicao USING btree (colaborador_codigo, ciclo);


--
-- Name: idx_divergencias_medicao_sgc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_divergencias_medicao_sgc ON public.divergencias_medicao USING btree (sgc_id);


--
-- Name: idx_divergencias_medicao_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_divergencias_medicao_status ON public.divergencias_medicao USING btree (status);


--
-- Name: idx_etl_execucoes_ciclo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etl_execucoes_ciclo ON public.etl_execucoes USING btree (ciclo);


--
-- Name: idx_mapa_pagamento_itens_ato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mapa_pagamento_itens_ato ON public.mapa_pagamento_itens USING btree (ato);


--
-- Name: idx_mapa_pagamento_itens_ciclo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mapa_pagamento_itens_ciclo ON public.mapa_pagamento_itens USING btree (ciclo);


--
-- Name: idx_mapa_pagamento_itens_projetista; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mapa_pagamento_itens_projetista ON public.mapa_pagamento_itens USING btree (projetista_codigo);


--
-- Name: idx_medicoes_ciclo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medicoes_ciclo ON public.medicoes USING btree (ciclo);


--
-- Name: idx_medicoes_data_cadastro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medicoes_data_cadastro ON public.medicoes USING btree (data_cadastro);


--
-- Name: idx_medicoes_id_coordenador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medicoes_id_coordenador ON public.medicoes USING btree (id_coordenador);


--
-- Name: idx_medicoes_id_profissional; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medicoes_id_profissional ON public.medicoes USING btree (id_profissional);


--
-- Name: idx_medicoes_id_projeto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medicoes_id_projeto ON public.medicoes USING btree (id_projeto);


--
-- Name: idx_medicoes_numero_medicao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medicoes_numero_medicao ON public.medicoes USING btree (numero_medicao);


--
-- Name: idx_profissionais_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profissionais_codigo ON public.profissionais USING btree (codigo);


--
-- Name: idx_profissionais_codigo_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_profissionais_codigo_unique ON public.profissionais USING btree (codigo) WHERE (codigo IS NOT NULL);


--
-- Name: idx_profissionais_status_colaborador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profissionais_status_colaborador ON public.profissionais USING btree (status_colaborador);


--
-- Name: idx_sgc_aprovacoes_medicao_ciclo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_aprovacoes_medicao_ciclo ON public.sgc_aprovacoes_medicao USING btree (ciclo);


--
-- Name: idx_sgc_aprovacoes_medicao_revisao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_aprovacoes_medicao_revisao ON public.sgc_aprovacoes_medicao USING btree (revisao_solicitada_at);


--
-- Name: idx_sgc_aprovacoes_medicao_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_aprovacoes_medicao_status ON public.sgc_aprovacoes_medicao USING btree (status);


--
-- Name: idx_sgc_aprovacoes_medicao_status_conf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_aprovacoes_medicao_status_conf ON public.sgc_aprovacoes_medicao USING btree (status_conferencia);


--
-- Name: idx_sgc_logs_colaborador_ciclo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_logs_colaborador_ciclo ON public.sgc_logs USING btree (colaborador_codigo, ciclo);


--
-- Name: idx_sgc_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_logs_created_at ON public.sgc_logs USING btree (created_at DESC);


--
-- Name: idx_sgc_logs_sgc_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sgc_logs_sgc_id ON public.sgc_logs USING btree (sgc_id);


--
-- Name: idx_usuarios_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_ativo ON public.usuarios USING btree (ativo);


--
-- Name: mapa_pagamento_contexto_ativo_medicao_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mapa_pagamento_contexto_ativo_medicao_key ON public.mapa_pagamento_contexto USING btree (ativo_medicao) WHERE (ativo_medicao = true);


--
-- Name: chat_mensagens chat_mensagens_autor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: chat_mensagens chat_mensagens_conversa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES public.chat_conversas(id) ON DELETE CASCADE;


--
-- Name: chat_participantes chat_participantes_conversa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES public.chat_conversas(id) ON DELETE CASCADE;


--
-- Name: chat_participantes chat_participantes_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: divergencias_medicao divergencias_medicao_resolvido_por_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divergencias_medicao
    ADD CONSTRAINT divergencias_medicao_resolvido_por_usuario_id_fkey FOREIGN KEY (resolvido_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: divergencias_medicao divergencias_medicao_sgc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divergencias_medicao
    ADD CONSTRAINT divergencias_medicao_sgc_id_fkey FOREIGN KEY (sgc_id) REFERENCES public.sgc_aprovacoes_medicao(id) ON DELETE CASCADE;


--
-- Name: medicoes medicoes_id_coordenador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicoes
    ADD CONSTRAINT medicoes_id_coordenador_fkey FOREIGN KEY (id_coordenador) REFERENCES public.profissionais(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: medicoes medicoes_id_profissional_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicoes
    ADD CONSTRAINT medicoes_id_profissional_fkey FOREIGN KEY (id_profissional) REFERENCES public.profissionais(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: medicoes medicoes_id_projeto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medicoes
    ADD CONSTRAINT medicoes_id_projeto_fkey FOREIGN KEY (id_projeto) REFERENCES public.projetos(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sgc_logs sgc_logs_sgc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sgc_logs
    ADD CONSTRAINT sgc_logs_sgc_id_fkey FOREIGN KEY (sgc_id) REFERENCES public.sgc_aprovacoes_medicao(id) ON DELETE SET NULL;


--
-- Name: sgc_logs sgc_logs_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sgc_logs
    ADD CONSTRAINT sgc_logs_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
