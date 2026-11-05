// Configuração da suíte por variáveis de ambiente (ver .env.exemplo). Os padrões apontam para o mock.
const e = process.env;
export const config = {
  diretorioUrl: e.CONF_DIRETORIO_URL ?? 'http://localhost:4010/diretorio',
  slug: e.CONF_SLUG ?? 'modelo-otorrino',
  urlApi: e.CONF_URL_API,
  antesUrl: e.CONF_ANTES_URL ?? (e.CONF_URL_API || e.CONF_DIRETORIO_URL ? undefined : 'http://localhost:4010/__mock/reiniciar'),
  gestor: {
    email: e.CONF_GESTOR_EMAIL ?? 'ana@modelo-otorrino.exemplo',
    senha: e.CONF_GESTOR_SENHA ?? 'Senha@12345',
    totp: e.CONF_GESTOR_TOTP ?? 'JBSWY3DPEHPK3PXP',
  },
  paciente: { email: e.CONF_PACIENTE_EMAIL ?? 'marcos@exemplo.com' },
  codigoEmail: e.CONF_CODIGO_EMAIL ?? '123456',
  primeiroAcesso: e.CONF_PRIMEIRO_ACESSO_EMAIL === '' ? null : {
    email: e.CONF_PRIMEIRO_ACESSO_EMAIL ?? 'carlos@modelo-otorrino.exemplo',
    senha: e.CONF_PRIMEIRO_ACESSO_SENHA ?? 'Provisoria@1',
  },
  dominio: e.CONF_DOMINIO ?? (e.CONF_URL_API || e.CONF_DIRETORIO_URL ? undefined : `${e.CONF_SLUG ?? 'modelo-otorrino'}.localhost`),
  prazoTempoRealMs: Number(e.CONF_PRAZO_TEMPO_REAL_MS ?? 5000),
};
