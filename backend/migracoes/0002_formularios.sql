-- Formulários versionados (9.2). Necessários já na F1: o cadastro de paciente valida os campos
-- adicionais pelo formulário de cadastro da organização. Versão publicada é imutável (RN-FRM-001).
CREATE TABLE formularios (
  organizacao_id text NOT NULL REFERENCES organizacoes(id),
  id text NOT NULL,
  versao integer NOT NULL,
  titulo text NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN ('CHECKIN','CADASTRO')),
  campos jsonb NOT NULL,
  publicado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizacao_id, id, versao)
);
ALTER TABLE formularios ENABLE ROW LEVEL SECURITY;
ALTER TABLE formularios FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON formularios USING (organizacao_id = org_atual()) WITH CHECK (organizacao_id = org_atual());
-- Só INSERT e SELECT: uma versão publicada nunca é alterada.
GRANT SELECT, INSERT ON formularios TO clinica_app;
