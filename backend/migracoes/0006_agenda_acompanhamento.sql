-- F4, etapa 4 (RN-AGE-008, QUESTION-032): procedimento da agenda ligado ao acompanhamento pós-procedimento.
-- A ligação é circular (o agendamento nasce antes e passa a apontar para o acompanhamento criado em
-- seguida; remarcar troca o acompanhamento): as FKs são verificadas no commit (DEFERRABLE INITIALLY DEFERRED).

-- A validação de uma FK nova consulta a tabela referenciada; com FORCE RLS, até o dono passaria pela
-- política (e org_atual() sem contexto falha). Tira o FORCE só durante esta transação: o dono valida
-- todas as linhas, de todas as organizações, e o FORCE volta antes do commit.
ALTER TABLE agendamentos NO FORCE ROW LEVEL SECURITY;
ALTER TABLE acompanhamentos NO FORCE ROW LEVEL SECURITY;

ALTER TABLE servicos ADD COLUMN protocolo_id text;  -- sugestão; protocolos são versionados (PK com versao), validado na aplicação

ALTER TABLE agendamentos ADD COLUMN acompanhamento_id text;
ALTER TABLE agendamentos ADD CONSTRAINT agendamentos_acompanhamento_fk
  FOREIGN KEY (organizacao_id, acompanhamento_id) REFERENCES acompanhamentos (organizacao_id, id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE acompanhamentos ADD COLUMN agendamento_id text;
ALTER TABLE acompanhamentos ADD CONSTRAINT acompanhamentos_agendamento_fk
  FOREIGN KEY (organizacao_id, agendamento_id) REFERENCES agendamentos (organizacao_id, id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX acompanhamentos_agendamento ON acompanhamentos (organizacao_id, agendamento_id) WHERE agendamento_id IS NOT NULL;

ALTER TABLE agendamentos FORCE ROW LEVEL SECURITY;
ALTER TABLE acompanhamentos FORCE ROW LEVEL SECURITY;
