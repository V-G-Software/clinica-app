// Diretório, configuração pública, saúde, convites e formato de erro.
import { describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { config } from '../src/config.ts';
import { ambiente } from '../src/contexto.ts';

const { api, slug } = ambiente();

describe('público', () => {
  it('diretório resolve a organização e devolve 404 para slug desconhecido', async () => {
    if (config.urlApi && !process.env.CONF_DIRETORIO_URL) return;
    const dir = config.diretorioUrl.replace(/\/$/, '');
    const ok = esperar(await api.chamar('GET', `/v1/organizacoes/${slug}`, { base: dir }), 200).body;
    expect(ok.urlApi).toBe(api.urlApi);
    expect(['ATIVA', 'MANUTENCAO', 'SUSPENSA']).toContain(ok.status);
    esperar(await api.chamar('GET', '/v1/organizacoes/organizacao-que-nao-existe-123', { base: dir }), 404, 'RECURSO_NAO_ENCONTRADO');
  });

  it('configuração pública: schema, ETag, Cache-Control e revalidação 304', async () => {
    const r = esperar(await api.chamar('GET', '/v1/publico/configuracao'), 200);
    expect(r.headers.get('etag')).toBeTruthy();
    expect(r.headers.get('cache-control')).toMatch(/max-age=\d+/);
    expect(r.body.organizacao.slug).toBe(slug);
    expect(r.body.autenticacao.metodos.some((m: any) => m.publico === 'EQUIPE')).toBe(true);
    const r2 = await api.chamar('GET', '/v1/publico/configuracao', { headers: { 'If-None-Match': r.headers.get('etag')! } });
    esperar(r2, 304);
  });

  it('saúde devolve versão do contrato e relógio do backend', async () => {
    const r = esperar(await api.chamar('GET', '/v1/publico/saude'), 200).body;
    expect(Math.abs(Date.parse(r.agora) - Date.now())).toBeGreaterThanOrEqual(0);
    expect(r.contrato.versao).toMatch(/^1\./);
  });

  it('convite inválido devolve 404 CONVITE_INVALIDO', async () => {
    esperar(await api.chamar('GET', '/v1/publico/convites/token-que-nao-existe-123'), 404, 'CONVITE_INVALIDO');
  });

  it('rota autenticada sem token devolve 401 SESSAO_EXPIRADA em problem+json', async () => {
    const r = esperar(await api.chamar('GET', '/v1/sessao'), 401, 'SESSAO_EXPIRADA');
    expect(r.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(r.body.type).toMatch(/^https?:\/\//);
  });

  it('corpo inválido devolve 422 VALIDACAO_FALHOU com a lista de campos', async () => {
    const r = esperar(await api.chamar('POST', '/v1/auth/entrar', { body: { email: 'nao-e-email' } }), 422, 'VALIDACAO_FALHOU');
    expect(r.body.campos.length).toBeGreaterThan(0);
  });
});
