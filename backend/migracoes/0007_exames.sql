-- F5 (ADR-0017): módulo exames — pedidos, resultados (imagem e PDF) e revisão.

ALTER TABLE arquivos DROP CONSTRAINT IF EXISTS arquivos_finalidade_check;
ALTER TABLE arquivos ADD CONSTRAINT arquivos_finalidade_check CHECK (finalidade IN ('CHECKIN','CHAT','PERFIL','ORGANIZACAO','EXAME'));

CREATE TABLE pedidos_exame (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  solicitante_id text NOT NULL,
  itens jsonb NOT NULL,
  orientacoes text,
  observacao text,
  status text NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','CONCLUIDO','CANCELADO')),
  motivo_cancelamento text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, solicitante_id) REFERENCES usuarios (organizacao_id, id),
  CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 30)
);
CREATE INDEX pedidos_exame_paciente ON pedidos_exame (organizacao_id, paciente_id, criado_em DESC);

CREATE TABLE resultados_exame (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  paciente_id text NOT NULL,
  pedido_id text,
  titulo text NOT NULL,
  data_coleta date,
  comentario text,
  origem text NOT NULL CHECK (origem IN ('PACIENTE','EQUIPE')),
  enviado_por text NOT NULL,
  status text NOT NULL DEFAULT 'AGUARDANDO_REVISAO' CHECK (status IN ('AGUARDANDO_REVISAO','REVISADO')),
  revisado_por text,
  revisado_em timestamptz,
  nota_revisao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, pedido_id) REFERENCES pedidos_exame (organizacao_id, id),
  FOREIGN KEY (organizacao_id, enviado_por) REFERENCES usuarios (organizacao_id, id),
  FOREIGN KEY (organizacao_id, revisado_por) REFERENCES usuarios (organizacao_id, id),
  CHECK ((status = 'REVISADO') = (revisado_em IS NOT NULL))
);
CREATE INDEX resultados_exame_paciente ON resultados_exame (organizacao_id, paciente_id, criado_em DESC);
CREATE INDEX resultados_exame_pendentes ON resultados_exame (organizacao_id, criado_em) WHERE status = 'AGUARDANDO_REVISAO';
CREATE INDEX resultados_exame_pedido ON resultados_exame (organizacao_id, pedido_id) WHERE pedido_id IS NOT NULL;

-- RN-EXA-003: um arquivo entra em no máximo um resultado. A PK garante isso no banco, inclusive com
-- dois envios simultâneos do mesmo arquivo.
CREATE TABLE resultado_arquivos (
  organizacao_id text NOT NULL,
  arquivo_id text NOT NULL,
  resultado_id text NOT NULL,
  ordem smallint NOT NULL,
  PRIMARY KEY (organizacao_id, arquivo_id),
  FOREIGN KEY (organizacao_id, arquivo_id) REFERENCES arquivos (organizacao_id, id),
  FOREIGN KEY (organizacao_id, resultado_id) REFERENCES resultados_exame (organizacao_id, id)
);
CREATE INDEX resultado_arquivos_resultado ON resultado_arquivos (organizacao_id, resultado_id, ordem);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedidos_exame','resultados_exame','resultado_arquivos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual())', t);
  END LOOP;
END $$;

-- Nada é apagado (pedido cancelado e resultado ficam no histórico).
GRANT SELECT, INSERT, UPDATE ON pedidos_exame, resultados_exame TO clinica_app;
GRANT SELECT, INSERT ON resultado_arquivos TO clinica_app;
