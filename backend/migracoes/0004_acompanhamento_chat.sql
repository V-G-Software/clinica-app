-- F2 · Acompanhamento, alertas, chat e jobs. Mesmas regras da 0001: organizacao_id em toda tabela,
-- RLS habilitado e forçado, chaves e índices começando por organizacao_id, nada clínico com DELETE (14.5).

-- Protocolos versionados: versão publicada é imutável (RN-ACO-003); só o status muda (arquivar).
CREATE TABLE protocolos (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  versao integer NOT NULL,
  nome text NOT NULL,
  descricao text,
  duracao_dias integer NOT NULL CHECK (duracao_dias > 0),
  status text NOT NULL CHECK (status IN ('ATIVO','ARQUIVADO')),
  checkins jsonb NOT NULL,
  orientacoes jsonb NOT NULL DEFAULT '[]',
  regras_alerta jsonb NOT NULL DEFAULT '[]',
  publicado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id, versao)
);

-- O acompanhamento guarda uma cópia da versão do protocolo: nova versão não altera quem já começou.
CREATE TABLE acompanhamentos (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  protocolo_id text NOT NULL,
  protocolo_versao integer NOT NULL,
  protocolo jsonb NOT NULL,
  data_inicio date NOT NULL,
  equipe_ids text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('AGENDADO','ATIVO','CONCLUIDO','ENCERRADO')),
  observacao text,
  motivo_encerramento text,
  encerrado_por text,
  conversa_id text,
  criado_por text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, protocolo_id, protocolo_versao) REFERENCES protocolos (organizacao_id, id, versao)
);
CREATE INDEX acompanhamentos_paciente ON acompanhamentos (organizacao_id, paciente_id);
CREATE INDEX acompanhamentos_status ON acompanhamentos (organizacao_id, status);

-- Check-ins nascem todos na criação do acompanhamento (RN-ACO-002), com a versão do formulário copiada.
CREATE TABLE checkins (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  acompanhamento_id text NOT NULL,
  paciente_id text NOT NULL,
  dia integer NOT NULL,
  status text NOT NULL CHECK (status IN ('AGENDADO','DISPONIVEL','RESPONDIDO','EXPIRADO','CANCELADO')),
  disponivel_em timestamptz NOT NULL,
  expira_em timestamptz NOT NULL,
  respondido_em timestamptz,
  respondido_por text,
  respostas jsonb,
  formulario jsonb NOT NULL,
  lembrete_apos_horas integer,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, acompanhamento_id) REFERENCES acompanhamentos (organizacao_id, id)
);
CREATE INDEX checkins_acompanhamento ON checkins (organizacao_id, acompanhamento_id, disponivel_em);
CREATE INDEX checkins_paciente ON checkins (organizacao_id, paciente_id, disponivel_em);
CREATE INDEX checkins_disponiveis ON checkins (organizacao_id) WHERE status = 'DISPONIVEL';

-- Uma regra gera no máximo um alerta por check-in: job repetido (retry) não duplica.
CREATE TABLE alertas (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  acompanhamento_id text NOT NULL,
  checkin_id text,
  paciente_id text NOT NULL,
  regra_id text NOT NULL,
  severidade text NOT NULL CHECK (severidade IN ('ALTA','MEDIA','BAIXA')),
  mensagem text NOT NULL,
  status text NOT NULL CHECK (status IN ('ABERTO','RESOLVIDO')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por text,
  nota text,
  PRIMARY KEY (organizacao_id, id),
  UNIQUE (organizacao_id, checkin_id, regra_id),
  FOREIGN KEY (organizacao_id, acompanhamento_id) REFERENCES acompanhamentos (organizacao_id, id)
);
CREATE INDEX alertas_acompanhamento ON alertas (organizacao_id, acompanhamento_id);
CREATE INDEX alertas_abertos ON alertas (organizacao_id) WHERE status = 'ABERTO';

-- Chat. Uma conversa ATIVA por paciente (RN-CHA-001), garantida pelo banco mesmo sob concorrência.
CREATE TABLE conversas (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ATIVA','ARQUIVADA')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_aviso_fora_horario_em timestamptz,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id)
);
CREATE UNIQUE INDEX conversa_ativa_por_paciente ON conversas (organizacao_id, paciente_id) WHERE status = 'ATIVA';

-- Participante removido mantém a linha (removido_em): o histórico continua íntegro (RN-CHA-004).
CREATE TABLE participantes (
  organizacao_id text NOT NULL,
  conversa_id text NOT NULL,
  usuario_id text NOT NULL,
  perfil text NOT NULL,
  lido_ate text,
  entrou_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz,
  PRIMARY KEY (organizacao_id, conversa_id, usuario_id),
  FOREIGN KEY (organizacao_id, conversa_id) REFERENCES conversas (organizacao_id, id)
);
CREATE INDEX participantes_usuario ON participantes (organizacao_id, usuario_id) WHERE removido_em IS NULL;

-- Mensagens são imutáveis (só INSERT). `ordem` dá a sequência dentro da conversa sem depender do relógio.
CREATE TABLE mensagens (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  conversa_id text NOT NULL,
  ordem bigserial NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('TEXTO','ANEXO','CHECKIN','ORIENTACAO','SISTEMA')),
  autor_id text,
  autor_perfil text,
  texto text,
  anexos_ids text[] NOT NULL DEFAULT '{}',
  referencia jsonb,
  id_cliente text,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, conversa_id) REFERENCES conversas (organizacao_id, id)
);
CREATE INDEX mensagens_conversa ON mensagens (organizacao_id, conversa_id, ordem);
-- Reenvio com o mesmo idCliente devolve a mesma mensagem (RN-CHA-007).
CREATE UNIQUE INDEX mensagens_id_cliente ON mensagens (organizacao_id, conversa_id, autor_id, id_cliente) WHERE id_cliente IS NOT NULL;

-- Jobs agendados (14.3). Id determinístico (ex.: checkin:{id}:abrir): reagendar é upsert, cancelar é
-- apagar por prefixo, e nada duplica. O job é gravado na mesma transação da regra que o criou.
CREATE TABLE jobs (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  tipo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}',
  executar_em timestamptz NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  ultimo_erro text,
  falhou_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id)
);
CREATE INDEX jobs_vencidos ON jobs (executar_em) WHERE falhou_em IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['protocolos','acompanhamentos','checkins','alertas','conversas','participantes','mensagens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual())', t);
  END LOOP;
END $$;

-- jobs: RLS habilitado mas NÃO forçado. A aplicação continua presa à própria organização (grava e conclui
-- jobs só com contexto); o único acesso entre organizações é reivindicar_jobs(), que roda como dono e
-- devolve apenas identificadores. Todo job executa depois dentro de comOrg(organizacao_id).
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON jobs USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual());

CREATE FUNCTION reivindicar_jobs(limite integer, bloqueio interval)
RETURNS TABLE (organizacao_id text, id text, tipo text, dados jsonb, tentativas integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE jobs j SET bloqueado_ate = now() + bloqueio, tentativas = j.tentativas + 1
    FROM (SELECT x.organizacao_id, x.id FROM jobs x
           WHERE x.executar_em <= now() AND x.falhou_em IS NULL AND (x.bloqueado_ate IS NULL OR x.bloqueado_ate < now())
           ORDER BY x.executar_em LIMIT limite FOR UPDATE SKIP LOCKED) s
   WHERE j.organizacao_id = s.organizacao_id AND j.id = s.id
  RETURNING j.organizacao_id, j.id, j.tipo, j.dados, j.tentativas
$$;
REVOKE ALL ON FUNCTION reivindicar_jobs(integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reivindicar_jobs(integer, interval) TO clinica_app;

GRANT SELECT, INSERT ON protocolos, mensagens TO clinica_app;
GRANT UPDATE (status) ON protocolos TO clinica_app;
GRANT SELECT, INSERT, UPDATE ON acompanhamentos, checkins, alertas, conversas, participantes TO clinica_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO clinica_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO clinica_app;
