// Equipe: convite → primeiro acesso, desligamento revoga sessão, último gestor e configuração.
import { describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { percorrerEtapas } from '../src/sessoes.ts';

const amb = ambiente();
const { api, gestor, pacienteA, termosVersao, execucao } = amb;

describe.runIf(temModulo(amb, 'equipe'))('equipe', () => {
  it('lista membros; paciente não tem acesso', async () => {
    const r = esperar(await api.chamar('GET', '/v1/equipe/membros', { token: gestor.token }), 200).body;
    expect(r.itens.map((m: any) => m.id)).toContain(gestor.usuarioId);
    esperar(await api.chamar('GET', '/v1/equipe/membros', { token: pacienteA.token }), [403, 404]);
  });

  it('convite de membro → TROCAR_SENHA → CONFIGURAR_MFA → CONCLUIDO; desligar revoga a sessão', async () => {
    const email = `membro.${execucao}@exemplo.com`;
    const conv = esperar(await api.chamar('POST', '/v1/equipe/convites', { token: gestor.token, idempotencia: true, body: { nome: 'Membro Conformidade', email, perfis: ['SECRETARIA'] } }), 201).body;
    const pub = esperar(await api.chamar('GET', `/v1/publico/convites/${conv.token}`), 200).body;
    expect(pub.tipo).toBe('EQUIPE');
    const r = esperar(await api.chamar('POST', `/v1/auth/convites/${conv.token}/aceitar`, { body: { email, termosVersao } }), 200).body;
    const fim = await percorrerEtapas(api, r, { email }, termosVersao);
    expect(fim.vistas).toEqual(expect.arrayContaining(['TROCAR_SENHA', 'CONFIGURAR_MFA', 'CONCLUIDO']));
    const me = esperar(await api.chamar('GET', '/v1/me', { token: fim.tokenAcesso }), 200).body;
    const m = esperar(await api.chamar('GET', `/v1/equipe/membros/${me.id}`, { token: gestor.token }), 200);
    expect(m.body.status).toBe('ATIVO');
    esperar(await api.chamar('PATCH', `/v1/equipe/membros/${me.id}`, { token: fim.tokenAcesso, body: { status: 'DESLIGADO' }, headers: { 'If-Match': m.headers.get('etag')! } }), 403, 'PERMISSAO_NEGADA');
    const desligado = esperar(await api.chamar('PATCH', `/v1/equipe/membros/${me.id}`, { token: gestor.token, body: { status: 'DESLIGADO' }, headers: { 'If-Match': m.headers.get('etag')! } }), 200).body;
    expect(desligado.status).toBe('DESLIGADO');
    esperar(await api.chamar('GET', '/v1/sessao', { token: fim.tokenAcesso }), 401);
  });

  it('o último gestor não perde o perfil (409 ULTIMO_GESTOR)', async () => {
    const membros = esperar(await api.chamar('GET', '/v1/equipe/membros', { token: gestor.token, query: { status: 'ATIVO', limite: 100 } }), 200).body.itens;
    const gestores = membros.filter((m: any) => m.perfis.includes('GESTOR'));
    if (gestores.length !== 1 || gestores[0].id !== gestor.usuarioId) return; // só é seguro testar com um gestor
    const m = esperar(await api.chamar('GET', `/v1/equipe/membros/${gestor.usuarioId}`, { token: gestor.token }), 200);
    const perfis = m.body.perfis.filter((p: string) => p !== 'GESTOR');
    esperar(await api.chamar('PATCH', `/v1/equipe/membros/${gestor.usuarioId}`, { token: gestor.token, body: { perfis: perfis.length ? perfis : ['PROFISSIONAL'] }, headers: { 'If-Match': m.headers.get('etag')! } }), 409, 'ULTIMO_GESTOR');
  });
});

describe('configuração da organização', () => {
  it('GET/PATCH com If-Match; paciente recebe 404', async () => {
    const r = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200);
    const original = r.body.textos.boasVindasTexto;
    const p = esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, body: { textos: { boasVindasTexto: `${original} ` } }, headers: { 'If-Match': r.headers.get('etag')! } }), 200);
    esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, body: { textos: { boasVindasTexto: original } }, headers: { 'If-Match': r.headers.get('etag')! } }), 412, 'CONFLITO_VERSAO');
    esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, body: { textos: { boasVindasTexto: original } }, headers: { 'If-Match': p.headers.get('etag')! } }), 200);
    esperar(await api.chamar('GET', '/v1/organizacao', { token: pacienteA.token }), 404);
  });
});
