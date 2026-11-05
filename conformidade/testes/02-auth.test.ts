// Etapas de login, MFA, código por e-mail, renovação com rotação e detecção de reuso, saída.
import { describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { config } from '../src/config.ts';
import { ambiente } from '../src/contexto.ts';
import { entrarEquipe, entrarPaciente, percorrerEtapas } from '../src/sessoes.ts';

const { api, termosVersao, pacienteA, execucao } = ambiente();

describe('autenticação', () => {
  it('senha errada devolve 401 AUTENTICACAO_INVALIDA sem revelar se a conta existe', async () => {
    const a = esperar(await api.chamar('POST', '/v1/auth/entrar', { body: { email: config.gestor.email, senha: 'senha-errada-123' } }), 401, 'AUTENTICACAO_INVALIDA');
    const b = esperar(await api.chamar('POST', '/v1/auth/entrar', { body: { email: `ninguem.${execucao}@exemplo.com`, senha: 'senha-errada-123' } }), 401, 'AUTENTICACAO_INVALIDA');
    expect(a.body.detail).toBe(b.body.detail);
  });

  it('excesso de tentativas devolve 429 MUITAS_TENTATIVAS', async () => {
    const email = `limite.${execucao}@exemplo.com`;
    let ultimo: any;
    for (let i = 0; i < 25; i++) {
      ultimo = await api.chamar('POST', '/v1/auth/entrar', { body: { email, senha: 'x' } });
      if (ultimo.status === 429) break;
    }
    esperar(ultimo, 429, 'MUITAS_TENTATIVAS');
  });

  it('equipe: senha → MFA (código errado é recusado) → CONCLUIDO', async () => {
    const r = esperar(await api.chamar('POST', '/v1/auth/entrar', { body: { email: config.gestor.email, senha: config.gestor.senha } }), 200).body;
    expect(r.etapa).toBe('MFA');
    expect(r.metodosMfa).toContain('TOTP');
    esperar(await api.chamar('POST', '/v1/auth/mfa/verificar', { body: { desafioId: r.desafioId, codigo: '999999' } }), [401, 422], 'CODIGO_INVALIDO');
    const fim = await percorrerEtapas(api, r, { ...config.gestor }, termosVersao);
    expect(fim.vistas.at(-1)).toBe('CONCLUIDO');
    esperar(await api.chamar('GET', '/v1/sessao', { token: fim.tokenAcesso }), 200);
  });

  it('primeiro acesso da equipe percorre TROCAR_SENHA, CONFIGURAR_MFA e ACEITAR_TERMOS', async () => {
    if (!config.primeiroAcesso) return;
    const fim = await entrarEquipe(api, { ...config.primeiroAcesso }, termosVersao);
    expect(fim.vistas).toEqual(expect.arrayContaining(['TROCAR_SENHA', 'CONFIGURAR_MFA', 'ACEITAR_TERMOS', 'CONCLUIDO']));
    expect(fim.codigosRecuperacao?.length).toBeGreaterThan(0);
  });

  it('paciente: código por e-mail (202 mesmo para e-mail desconhecido; código errado recusado)', async () => {
    esperar(await api.chamar('POST', '/v1/auth/codigo/solicitar', { body: { email: `desconhecido.${execucao}@exemplo.com` } }), 202);
    esperar(await api.chamar('POST', '/v1/auth/codigo/solicitar', { body: { email: config.paciente.email } }), 202);
    const errado = config.codigoEmail === '000001' ? '000002' : '000001';
    esperar(await api.chamar('POST', '/v1/auth/codigo/verificar', { body: { email: config.paciente.email, codigo: errado } }), [401, 422], 'CODIGO_INVALIDO');
    const fim = await entrarPaciente(api, config.paciente.email, termosVersao);
    const m = esperar(await api.chamar('GET', '/v1/sessao', { token: fim.tokenAcesso }), 200).body;
    expect(m.perfilAtivo).toBe('PACIENTE');
  });

  it('token de acesso inválido devolve 401 SESSAO_EXPIRADA', async () => {
    esperar(await api.chamar('GET', '/v1/sessao', { token: 'token-invalido' }), 401, 'SESSAO_EXPIRADA');
  });

  it('renovação (nativo) rotaciona o token; reuso revoga a sessão inteira', async () => {
    const s = await entrarPaciente(api, pacienteA.email, termosVersao);
    expect(s.tokenRenovacao).toBeTruthy();
    const r1 = esperar(await api.chamar('POST', '/v1/auth/renovar', { body: { tokenRenovacao: s.tokenRenovacao } }), 200).body;
    expect(r1.tokenRenovacao).toBeTruthy();
    expect(r1.tokenRenovacao).not.toBe(s.tokenRenovacao);
    esperar(await api.chamar('GET', '/v1/me', { token: r1.tokenAcesso }), 200);
    // Reuso do token antigo: revoga a sessão, inclusive o token novo.
    esperar(await api.chamar('POST', '/v1/auth/renovar', { body: { tokenRenovacao: s.tokenRenovacao } }), 401, 'SESSAO_REVOGADA');
    esperar(await api.chamar('POST', '/v1/auth/renovar', { body: { tokenRenovacao: r1.tokenRenovacao } }), 401, 'SESSAO_REVOGADA');
    const depois = await api.chamar('GET', '/v1/me', { token: r1.tokenAcesso });
    esperar(depois, 401);
    expect(['SESSAO_REVOGADA', 'SESSAO_EXPIRADA']).toContain(depois.body.codigo);
  });

  it('renovação (web) usa cookie HttpOnly; SameSite=Strict, restrito a /v1/auth', async () => {
    esperar(await api.chamar('POST', '/v1/auth/codigo/solicitar', { body: { email: pacienteA.email }, nativo: false }), 202);
    const r = esperar(await api.chamar('POST', '/v1/auth/codigo/verificar', { body: { email: pacienteA.email, codigo: config.codigoEmail }, nativo: false }), 200);
    expect(r.body.tokenRenovacao).toBeUndefined();
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=[^;]*\/v1\/auth/i);
    const par = cookie.split(';')[0];
    const r2 = esperar(await api.chamar('POST', '/v1/auth/renovar', { nativo: false, headers: { Cookie: par } }), 200);
    expect(r2.body.tokenAcesso).toBeTruthy();
    expect(r2.headers.get('set-cookie')?.split(';')[0]).not.toBe(par);
  });

  it('sair encerra a sessão', async () => {
    const s = await entrarPaciente(api, pacienteA.email, termosVersao);
    esperar(await api.chamar('POST', '/v1/auth/sair', { token: s.tokenAcesso }), 204);
    esperar(await api.chamar('GET', '/v1/me', { token: s.tokenAcesso }), 401);
    esperar(await api.chamar('POST', '/v1/auth/renovar', { body: { tokenRenovacao: s.tokenRenovacao } }), 401);
  });
});
