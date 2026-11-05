-- TOTP não pode ser reutilizado: guarda a última janela de 30 s aceita (código interceptado não vale de novo).
ALTER TABLE usuarios ADD COLUMN mfa_ultima_janela bigint NOT NULL DEFAULT 0;
