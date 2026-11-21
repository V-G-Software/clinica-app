-- F7 (ADR-0019): módulo prontuario — ficha clínica versionada, registros (anamnese, evolução, adendo),
-- log de acesso e cópia ao paciente. Imutabilidade (RN-PRO-003) garantida no banco por trigger, que
-- vale também para o dono das tabelas: grants restringem o app; o trigger restringe todo mundo.

ALTER TABLE formularios DROP CONSTRAINT IF EXISTS formularios_finalidade_check;
ALTER TABLE formularios ADD CONSTRAINT formularios_finalidade_check CHECK (finalidade IN ('CHECKIN','CADASTRO','PRONTUARIO'));
ALTER TABLE arquivos DROP CONSTRAINT IF EXISTS arquivos_finalidade_check;
ALTER TABLE arquivos ADD CONSTRAINT arquivos_finalidade_check CHECK (finalidade IN ('CHECKIN','CHAT','PERFIL','ORGANIZACAO','EXAME','DOCUMENTO','PRONTUARIO'));

-- Ficha: cada gravação é uma linha nova (versão 1, 2, ...). Nunca UPDATE nem DELETE.
CREATE TABLE fichas_clinicas (
  organizacao_id text NOT NULL,
  paciente_id text NOT NULL,
  versao integer NOT NULL CHECK (versao >= 1),
  alergias jsonb NOT NULL CHECK (jsonb_typeof(alergias) = 'array'),
  medicamentos jsonb NOT NULL CHECK (jsonb_typeof(medicamentos) = 'array'),
  problemas jsonb NOT NULL CHECK (jsonb_typeof(problemas) = 'array'),
  antecedentes jsonb NOT NULL CHECK (jsonb_typeof(antecedentes) = 'object'),
  atualizado_por text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, paciente_id, versao),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, atualizado_por) REFERENCES usuarios (organizacao_id, id)
);

CREATE TABLE registros_clinicos (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  autor_id text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ANAMNESE','EVOLUCAO','ADENDO')),
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','FINALIZADO','DESCARTADO')),
  texto text,
  modelo jsonb,                          -- { formularioId, versao, titulo } no momento da criação
  respostas jsonb,
  agendamento_id text,                   -- sem FK: a agenda pode não estar contratada; conferido na API
  registro_origem_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, autor_id) REFERENCES usuarios (organizacao_id, id),
  FOREIGN KEY (organizacao_id, registro_origem_id) REFERENCES registros_clinicos (organizacao_id, id),
  CHECK ((tipo = 'ADENDO') = (registro_origem_id IS NOT NULL)),
  CHECK ((status = 'FINALIZADO') = (finalizado_em IS NOT NULL)),
  CHECK (respostas IS NULL OR modelo IS NOT NULL),
  CHECK (coalesce(btrim(texto), '') <> '' OR (respostas IS NOT NULL AND respostas <> '{}'::jsonb))
);
CREATE INDEX registros_clinicos_paciente ON registros_clinicos (organizacao_id, paciente_id, criado_em DESC);
CREATE INDEX registros_clinicos_origem ON registros_clinicos (organizacao_id, registro_origem_id) WHERE registro_origem_id IS NOT NULL;

-- Log de acesso (RN-PRO-001): append-only.
CREATE TABLE acessos_prontuario (
  organizacao_id text NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY,
  paciente_id text NOT NULL,
  usuario_id text NOT NULL,
  acao text NOT NULL CHECK (acao IN ('LER_FICHA','LER_REGISTROS','LER_REGISTRO','LER_LINHA_DO_TEMPO','LER_VERSOES','GERAR_COPIA')),
  acessado_em timestamptz NOT NULL DEFAULT now(),
  ip text,
  request_id text,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, usuario_id) REFERENCES usuarios (organizacao_id, id)
);
CREATE INDEX acessos_prontuario_paciente ON acessos_prontuario (organizacao_id, paciente_id, acessado_em DESC, id DESC);

-- Cópia ao paciente (RN-PRO-005).
CREATE TABLE copias_prontuario (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  solicitante_id text NOT NULL,
  status text NOT NULL DEFAULT 'SOLICITADA' CHECK (status IN ('SOLICITADA','DISPONIVEL','RECUSADA')),
  prazo_em timestamptz NOT NULL,
  arquivo_id text,
  motivo_recusa text,
  atendido_por text,
  atendido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, solicitante_id) REFERENCES usuarios (organizacao_id, id),
  FOREIGN KEY (organizacao_id, atendido_por) REFERENCES usuarios (organizacao_id, id),
  FOREIGN KEY (organizacao_id, arquivo_id) REFERENCES arquivos (organizacao_id, id),
  CHECK ((status = 'DISPONIVEL') = (arquivo_id IS NOT NULL)),
  CHECK ((status = 'RECUSADA') = (motivo_recusa IS NOT NULL)),
  CHECK ((status = 'SOLICITADA') = (atendido_em IS NULL))
);
-- Um pedido aberto por paciente, inclusive com dois pedidos simultâneos.
CREATE UNIQUE INDEX copias_prontuario_aberta ON copias_prontuario (organizacao_id, paciente_id) WHERE status = 'SOLICITADA';
CREATE INDEX copias_prontuario_lista ON copias_prontuario (organizacao_id, criado_em DESC, id DESC);
CREATE UNIQUE INDEX copias_prontuario_arquivo ON copias_prontuario (organizacao_id, arquivo_id) WHERE arquivo_id IS NOT NULL;

-- ─────────── Imutabilidade (RN-PRO-003) ───────────
CREATE FUNCTION prontuario_somente_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prontuario: % não é permitido em %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER fichas_clinicas_imutavel BEFORE UPDATE OR DELETE ON fichas_clinicas FOR EACH ROW EXECUTE FUNCTION prontuario_somente_insercao();
CREATE TRIGGER fichas_clinicas_sem_truncate BEFORE TRUNCATE ON fichas_clinicas FOR EACH STATEMENT EXECUTE FUNCTION prontuario_somente_insercao();
CREATE TRIGGER acessos_prontuario_imutavel BEFORE UPDATE OR DELETE ON acessos_prontuario FOR EACH ROW EXECUTE FUNCTION prontuario_somente_insercao();
CREATE TRIGGER acessos_prontuario_sem_truncate BEFORE TRUNCATE ON acessos_prontuario FOR EACH STATEMENT EXECUTE FUNCTION prontuario_somente_insercao();
CREATE TRIGGER registros_clinicos_sem_delete BEFORE DELETE ON registros_clinicos FOR EACH ROW EXECUTE FUNCTION prontuario_somente_insercao();
CREATE TRIGGER registros_clinicos_sem_truncate BEFORE TRUNCATE ON registros_clinicos FOR EACH STATEMENT EXECUTE FUNCTION prontuario_somente_insercao();

-- Registro: só rascunho muda, e só no conteúdo e no status. Finalizado e descartado congelam.
CREATE FUNCTION registros_clinicos_regras() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.registro_origem_id IS NOT NULL THEN
      SELECT paciente_id, status INTO o FROM registros_clinicos WHERE organizacao_id = NEW.organizacao_id AND id = NEW.registro_origem_id;
      IF o IS NULL OR o.paciente_id <> NEW.paciente_id OR o.status <> 'FINALIZADO' THEN
        RAISE EXCEPTION 'prontuario: adendo só de registro finalizado do mesmo paciente' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'RASCUNHO' THEN
    RAISE EXCEPTION 'prontuario: registro % está % e não muda', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.organizacao_id <> OLD.organizacao_id OR NEW.id <> OLD.id OR NEW.paciente_id <> OLD.paciente_id OR NEW.autor_id <> OLD.autor_id
     OR NEW.tipo <> OLD.tipo OR NEW.registro_origem_id IS DISTINCT FROM OLD.registro_origem_id OR NEW.modelo IS DISTINCT FROM OLD.modelo
     OR NEW.criado_em <> OLD.criado_em THEN
    RAISE EXCEPTION 'prontuario: autoria, paciente, tipo, modelo e origem não mudam' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registros_clinicos_regras BEFORE INSERT OR UPDATE ON registros_clinicos FOR EACH ROW EXECUTE FUNCTION registros_clinicos_regras();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fichas_clinicas','registros_clinicos','acessos_prontuario','copias_prontuario'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual())', t);
  END LOOP;
END $$;

-- Nada do prontuário é apagado pela API (RN-PRO-004).
GRANT SELECT, INSERT ON fichas_clinicas, acessos_prontuario TO clinica_app;
GRANT SELECT, INSERT, UPDATE ON registros_clinicos, copias_prontuario TO clinica_app;
