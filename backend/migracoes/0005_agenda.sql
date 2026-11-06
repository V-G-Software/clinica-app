-- F4 · Módulo agenda (ADR-0016): serviços, grade semanal, bloqueios e agendamentos (consultas e
-- procedimentos). Mesmas regras das anteriores: organizacao_id em toda tabela, RLS habilitado e forçado.
-- Agendamento nunca é apagado: cancelar é status + motivo; o histórico fica em `historico`.

-- Sobreposição impedida pelo banco (RN-AGE-001): a checagem na aplicação sozinha corre contra duas
-- requisições simultâneas. btree_gist é "trusted" (PG 13+): o dono do banco cria sem superusuário.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE servicos (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  nome text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('CONSULTA','PROCEDIMENTO')),
  duracao_minutos integer NOT NULL CHECK (duracao_minutos BETWEEN 5 AND 720),
  autoagendavel boolean NOT NULL,
  profissionais_ids text[] NOT NULL,
  orientacoes text,
  status text NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','ARQUIVADO')),
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, id),
  CHECK (NOT (categoria = 'PROCEDIMENTO' AND autoagendavel))
);

-- Grade semanal por profissional: itens { diaSemana, inicio, fim, servicosIds|null } no fuso da organização.
CREATE TABLE grades (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  profissional_id text NOT NULL,
  itens jsonb NOT NULL DEFAULT '[]',
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, profissional_id),
  FOREIGN KEY (organizacao_id, profissional_id) REFERENCES usuarios (organizacao_id, id)
);

-- Bloqueio (férias, feriado) não é dado clínico: remover é DELETE.
CREATE TABLE bloqueios (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  profissional_id text,               -- NULL = a organização inteira
  inicio_em timestamptz NOT NULL,
  fim_em timestamptz NOT NULL CHECK (fim_em > inicio_em),
  motivo text,
  criado_por text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id)
);
CREATE INDEX bloqueios_periodo ON bloqueios USING gist (organizacao_id, tstzrange(inicio_em, fim_em));

CREATE TABLE agendamentos (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  servico_id text NOT NULL,
  profissional_id text NOT NULL,
  inicio_em timestamptz NOT NULL,
  fim_em timestamptz NOT NULL CHECK (fim_em > inicio_em),
  status text NOT NULL DEFAULT 'AGENDADO' CHECK (status IN ('AGENDADO','CONFIRMADO','REALIZADO','CANCELADO','FALTOU')),
  origem text NOT NULL CHECK (origem IN ('EQUIPE','PACIENTE')),
  encaixe boolean NOT NULL DEFAULT false,
  local text,
  orientacoes text,                   -- preparo copiado do serviço na marcação
  observacao text,                    -- interna da equipe; nunca vai para o paciente
  motivo_cancelamento text,
  historico jsonb NOT NULL DEFAULT '[]',
  criado_por text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, servico_id) REFERENCES servicos (organizacao_id, id),
  FOREIGN KEY (organizacao_id, profissional_id) REFERENCES usuarios (organizacao_id, id),
  -- RN-AGE-001: dois agendamentos ativos (não cancelados) e sem encaixe do mesmo profissional não se
  -- sobrepõem. Encaixe é exceção pedida pela equipe; a aplicação ainda impede marcar sem encaixe por cima
  -- de um encaixe existente (o banco só garante o caso que importa sob concorrência).
  CONSTRAINT agendamentos_sem_sobreposicao EXCLUDE USING gist (
    organizacao_id WITH =, profissional_id WITH =, tstzrange(inicio_em, fim_em) WITH &&
  ) WHERE (status <> 'CANCELADO' AND NOT encaixe)
);
CREATE INDEX agendamentos_periodo ON agendamentos (organizacao_id, inicio_em);
CREATE INDEX agendamentos_paciente ON agendamentos (organizacao_id, paciente_id, inicio_em);
CREATE INDEX agendamentos_profissional ON agendamentos (organizacao_id, profissional_id, inicio_em);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['servicos','grades','bloqueios','agendamentos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON servicos, grades, agendamentos TO clinica_app;
GRANT SELECT, INSERT, DELETE ON bloqueios TO clinica_app;
