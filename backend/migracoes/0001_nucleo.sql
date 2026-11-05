-- F1 · Núcleo, pacientes e equipe. Executado pelo papel DONO (clinica_dono); a aplicação conecta como
-- clinica_app, sem BYPASSRLS e sem ser dona das tabelas (seção 14.2).
--
-- Isolamento: toda tabela de dado de cliente tem organizacao_id, RLS habilitado E FORÇADO, e a política
-- compara com current_setting('app.organizacao_id') SEM missing_ok: sem contexto a consulta FALHA,
-- em vez de devolver tudo. Índices e unicidades começam por organizacao_id.

CREATE FUNCTION org_atual() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.organizacao_id') $$;

-- Organizações: configuração da plataforma (sem dado de paciente). Lida antes do login (configuração
-- pública, diretório), por isso sem RLS; a aplicação só tem SELECT e UPDATE de colunas de configuração.
CREATE TABLE organizacoes (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  fuso text NOT NULL,
  locale text NOT NULL DEFAULT 'pt-BR',
  status text NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA','MANUTENCAO','SUSPENSA')),
  mensagem_status text,
  dominios text[] NOT NULL DEFAULT '{}',          -- domínios do app (resolução no diretório)
  url_api text NOT NULL,
  configuracao jsonb NOT NULL,                     -- contato, tema, pwa, autenticacao, textos, links, mapaUrl
  termos jsonb NOT NULL,
  modulos jsonb NOT NULL,
  capacidades jsonb NOT NULL,
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  email text NOT NULL CHECK (email = lower(email)),
  nome text NOT NULL,
  nome_exibicao text NOT NULL,
  senha_hash text,
  perfis text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('CONVIDADO','ATIVO','SUSPENSO','DESLIGADO')),
  mfa_segredo_cifrado text,                        -- AES-256-GCM com a chave da aplicação
  codigos_recuperacao_hash text[] NOT NULL DEFAULT '{}',
  trocar_senha boolean NOT NULL DEFAULT false,
  termos_aceitos_versao text,
  rotulos_perfis jsonb NOT NULL DEFAULT '{}',
  profissional jsonb,
  preferencias jsonb NOT NULL DEFAULT '{"tema":"SISTEMA","densidade":"CONFORTAVEL"}',
  preferencias_notificacao jsonb NOT NULL DEFAULT '{}',
  foto_arquivo_id text,
  ultimo_acesso_em timestamptz,
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id),
  UNIQUE (organizacao_id, email)
);

CREATE TABLE pacientes (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('PESSOA','ANIMAL')),
  nome text NOT NULL,
  nome_social text,
  data_nascimento date,
  contato jsonb NOT NULL DEFAULT '{}',
  campos_adicionais jsonb NOT NULL DEFAULT '{}',
  responsaveis jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','INATIVO')),
  nome_busca text NOT NULL,                        -- nome normalizado (sem acento, minúsculo) para busca
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id)
);
CREATE INDEX pacientes_nome ON pacientes (organizacao_id, status, nome);

-- Conta do app ↔ paciente (ADR-0005).
CREATE TABLE vinculos (
  organizacao_id text NOT NULL,
  usuario_id text NOT NULL,
  paciente_id text NOT NULL,
  relacao text NOT NULL CHECK (relacao IN ('PROPRIO','DEPENDENTE','ANIMAL')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, usuario_id, paciente_id),
  FOREIGN KEY (organizacao_id, usuario_id) REFERENCES usuarios(organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes(organizacao_id, id)
);
CREATE INDEX vinculos_paciente ON vinculos (organizacao_id, paciente_id);

CREATE TABLE convites (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  token_hash text NOT NULL,                        -- só o hash: o token aparece uma vez, na criação
  tipo text NOT NULL CHECK (tipo IN ('PACIENTE','EQUIPE')),
  paciente_id text,
  usuario_id text,
  email text,
  relacao text,
  nome text NOT NULL,
  nome_conta text,
  criado_por text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  revogado_em timestamptz,
  PRIMARY KEY (organizacao_id, id),
  UNIQUE (organizacao_id, token_hash)
);

CREATE TABLE desafios (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  usuario_id text,
  mfa_ok boolean NOT NULL DEFAULT false,
  tentativas integer NOT NULL DEFAULT 0,
  nativo boolean NOT NULL DEFAULT false,
  segredo_pendente_cifrado text,
  convite_id text,
  email_pendente text,
  codigo_hash text,
  termos_versao text,
  expira_em timestamptz NOT NULL,
  PRIMARY KEY (organizacao_id, id)
);

CREATE TABLE codigos_email (
  organizacao_id text NOT NULL,
  email text NOT NULL,
  codigo_hash text NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  expira_em timestamptz NOT NULL,
  PRIMARY KEY (organizacao_id, email)
);

CREATE TABLE sessoes (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  usuario_id text NOT NULL,
  perfil_ativo text NOT NULL,
  validade_renovacao interval NOT NULL,
  renovacao_expira_em timestamptz NOT NULL,
  revogada_em timestamptz,
  motivo_revogacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id)
);
CREATE INDEX sessoes_usuario ON sessoes (organizacao_id, usuario_id) WHERE revogada_em IS NULL;

CREATE TABLE tokens_renovacao (
  organizacao_id text NOT NULL,
  hash text NOT NULL,
  sessao_id text NOT NULL,
  usado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, hash)
);

CREATE TABLE tokens_senha (
  organizacao_id text NOT NULL,
  hash text NOT NULL,
  usuario_id text NOT NULL,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  PRIMARY KEY (organizacao_id, hash)
);

CREATE TABLE idempotencia (
  organizacao_id text NOT NULL,
  chave text NOT NULL,                             -- ator:operationId:Idempotency-Key
  hash_corpo text NOT NULL,
  status integer NOT NULL,
  corpo jsonb,
  cabecalhos jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, chave)
);

CREATE TABLE tentativas (
  organizacao_id text NOT NULL,
  chave text NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tentativas_chave ON tentativas (organizacao_id, chave, em);

CREATE TABLE notificacoes (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  usuario_id text NOT NULL,
  tipo text NOT NULL,
  titulo text NOT NULL,
  texto text NOT NULL,
  destino jsonb,
  agrupar text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  lido_em timestamptz,
  PRIMARY KEY (organizacao_id, id)
);
CREATE INDEX notificacoes_usuario ON notificacoes (organizacao_id, usuario_id, criado_em DESC);

CREATE TABLE inscricoes_push (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  usuario_id text NOT NULL,
  endpoint text NOT NULL,
  chaves jsonb NOT NULL,
  dispositivo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id),
  UNIQUE (organizacao_id, endpoint)
);

CREATE TABLE arquivos (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  dono_id text NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN ('CHECKIN','CHAT','PERFIL','ORGANIZACAO')),
  status text NOT NULL CHECK (status IN ('AGUARDANDO_ENVIO','PROCESSANDO','DISPONIVEL','REJEITADO')),
  motivo_rejeicao text,
  chave_storage text NOT NULL,
  usado_em timestamptz,
  conversa_id text,
  checkin_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id)
);

-- Eventos (24 h). seq é global e crescente; o id exposto é derivado dele.
CREATE TABLE eventos (
  organizacao_id text NOT NULL,
  seq bigserial,
  tipo text NOT NULL,
  dados jsonb NOT NULL,
  destinatarios text[] NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, seq)
);
CREATE INDEX eventos_destinatarios ON eventos USING gin (destinatarios);

-- Trilha de auditoria append-only (14.4): a aplicação só tem INSERT e SELECT.
CREATE TABLE auditoria (
  organizacao_id text NOT NULL,
  id bigserial,
  em timestamptz NOT NULL DEFAULT now(),
  usuario_id text,
  acao text NOT NULL,                              -- LER, CRIAR, ALTERAR, ...
  recurso text NOT NULL,
  recurso_id text,
  ip inet,
  request_id text,
  PRIMARY KEY (organizacao_id, id)
);

-- RLS habilitado e forçado em toda tabela de cliente.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','pacientes','vinculos','convites','desafios','codigos_email','sessoes','tokens_renovacao',
    'tokens_senha','idempotencia','tentativas','notificacoes','inscricoes_push','arquivos','eventos','auditoria'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual())', t);
  END LOOP;
END $$;

-- Permissões do papel da aplicação.
GRANT USAGE ON SCHEMA public TO clinica_app;
GRANT SELECT ON organizacoes TO clinica_app;
GRANT UPDATE (nome, configuracao, modulos, versao) ON organizacoes TO clinica_app;
-- Sem DELETE em dado de cliente: paciente é inativado, conta é desligada, nada clínico é apagado (14.5).
GRANT SELECT, INSERT, UPDATE ON usuarios, pacientes, vinculos, convites, sessoes, notificacoes, arquivos TO clinica_app;
-- DELETE só no que é efêmero por natureza.
GRANT SELECT, INSERT, UPDATE, DELETE ON desafios, codigos_email, tokens_renovacao, tokens_senha, idempotencia, tentativas, inscricoes_push, eventos TO clinica_app;
GRANT SELECT, INSERT ON auditoria TO clinica_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO clinica_app;
GRANT EXECUTE ON FUNCTION org_atual() TO clinica_app;
