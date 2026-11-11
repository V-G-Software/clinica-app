-- F6 (ADR-0018): módulo documentos — receita simples e atestado assinados por PSC em nuvem (PAdES).

ALTER TABLE arquivos DROP CONSTRAINT IF EXISTS arquivos_finalidade_check;
ALTER TABLE arquivos ADD CONSTRAINT arquivos_finalidade_check CHECK (finalidade IN ('CHECKIN','CHAT','PERFIL','ORGANIZACAO','EXAME','DOCUMENTO'));

CREATE TABLE documentos (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('RECEITA','ATESTADO')),
  paciente_id text NOT NULL,
  emissor_id text NOT NULL,
  registro jsonb NOT NULL,              -- conselho, número e UF no momento da emissão (vão impressos no PDF)
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','ASSINANDO','ASSINADO','DESCARTADO','ANULADO')),
  receita jsonb,
  atestado jsonb,
  arquivo_id text,
  codigo text,                          -- validação pública
  sha256 text,                          -- do PDF assinado entregue
  conversa_id text,
  mensagem_id text,
  entregue_em timestamptz,
  motivo_anulacao text,
  erro_assinatura text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  assinado_em timestamptz,
  anulado_em timestamptz,
  versao integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, paciente_id) REFERENCES pacientes (organizacao_id, id),
  FOREIGN KEY (organizacao_id, emissor_id) REFERENCES usuarios (organizacao_id, id),
  FOREIGN KEY (organizacao_id, arquivo_id) REFERENCES arquivos (organizacao_id, id),
  CHECK ((tipo = 'RECEITA') = (receita IS NOT NULL) AND (tipo = 'ATESTADO') = (atestado IS NOT NULL)),
  -- Assinado ou anulado tem PDF, código e hash; antes disso, não.
  CHECK ((status IN ('ASSINADO','ANULADO')) = (arquivo_id IS NOT NULL AND codigo IS NOT NULL AND sha256 IS NOT NULL AND assinado_em IS NOT NULL)),
  CHECK ((status = 'ANULADO') = (anulado_em IS NOT NULL))
);
CREATE UNIQUE INDEX documentos_codigo ON documentos (organizacao_id, codigo) WHERE codigo IS NOT NULL;
CREATE INDEX documentos_paciente ON documentos (organizacao_id, paciente_id, criado_em DESC);
CREATE INDEX documentos_rascunhos ON documentos (organizacao_id, emissor_id, criado_em DESC) WHERE status = 'RASCUNHO';
CREATE UNIQUE INDEX documentos_arquivo ON documentos (organizacao_id, arquivo_id) WHERE arquivo_id IS NOT NULL;

-- Sessão de assinatura (OAuth/PKCE no PSC). O `state` não é guardado: só o hash. O verificador PKCE é
-- cifrado (vale 10 min e só serve junto com o `code` que o PSC entrega ao navegador).
CREATE TABLE sessoes_assinatura (
  organizacao_id text NOT NULL,
  id text NOT NULL,
  usuario_id text NOT NULL,
  provedor text NOT NULL,
  documentos_ids text[] NOT NULL CHECK (cardinality(documentos_ids) BETWEEN 1 AND 10),
  retorno_url text NOT NULL,
  state_hash text NOT NULL,
  verificador_cifrado text NOT NULL,
  status text NOT NULL DEFAULT 'AGUARDANDO_AUTORIZACAO' CHECK (status IN ('AGUARDANDO_AUTORIZACAO','ASSINANDO','CONCLUIDA','FALHOU','EXPIRADA')),
  erro text,
  url_autorizacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  PRIMARY KEY (organizacao_id, id),
  FOREIGN KEY (organizacao_id, usuario_id) REFERENCES usuarios (organizacao_id, id)
);
CREATE UNIQUE INDEX sessoes_assinatura_state ON sessoes_assinatura (organizacao_id, state_hash);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documentos','sessoes_assinatura'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual())', t);
  END LOOP;
END $$;

-- Nada é apagado: descartado e anulado ficam no histórico.
GRANT SELECT, INSERT, UPDATE ON documentos, sessoes_assinatura TO clinica_app;
