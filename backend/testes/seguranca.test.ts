// Cabeçalhos de segurança e limite de requisições por IP (14.4). Limite baixo só neste arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.LIMITE_IP_POR_MIN = '5';
const { criarServidor } = await import('../src/servidor.ts');
const { pool } = await import('../src/db.ts');
const { zerarLimites } = await import('../src/servicos/limites.ts');
const app = criarServidor();

beforeAll(async () => { await app.ready(); zerarLimites(); });
afterAll(async () => { await app.close(); await pool.end(); });

describe('segurança HTTP', () => {
  it('toda resposta sai com nosniff, sem referrer, sem frame e CSP fechada', async () => {
    zerarLimites();
    const r = await app.inject({ method: 'GET', url: '/o/modelo-otorrino/v1/publico/saude' });
    expect(r.headers).toMatchObject({
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
    });
  });

  it('origem que não é da organização não recebe CORS', async () => {
    zerarLimites();
    const r = await app.inject({ method: 'GET', url: '/o/modelo-otorrino/v1/publico/saude', headers: { origin: 'https://atacante.exemplo' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('acima do limite por IP: 429 MUITAS_TENTATIVAS com Retry-After', async () => {
    zerarLimites();
    const codigos: number[] = [];
    for (let i = 0; i < 7; i++) codigos.push((await app.inject({ method: 'GET', url: '/o/modelo-otorrino/v1/publico/saude', remoteAddress: '10.9.9.9' })).statusCode);
    expect(codigos).toEqual([200, 200, 200, 200, 200, 429, 429]);
    const r = await app.inject({ method: 'GET', url: '/o/modelo-otorrino/v1/publico/saude', remoteAddress: '10.9.9.9' });
    expect(r.statusCode).toBe(429);
    expect(r.json().codigo).toBe('MUITAS_TENTATIVAS');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    // Outro IP não é afetado.
    expect((await app.inject({ method: 'GET', url: '/o/modelo-otorrino/v1/publico/saude', remoteAddress: '10.9.9.8' })).statusCode).toBe(200);
  });
});
