// Middleware: 401 SESSAO_EXPIRADA → renova uma vez (single-flight) e repete a chamada.
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('__VERSAO_APP__', '0.1.0');
const { configurarApi, ok } = await import('@/api');

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } });

describe('cliente da API', () => {
  it('renova uma vez para várias chamadas que expiram juntas e repete cada uma', async () => {
    let token = 'velho';
    let renovacoes = 0;
    const f = vi.fn(async (req: Request | string) => {
      const r = typeof req === 'string' ? new Request(req) : req;
      const caminho = new URL(r.url).pathname;
      if (caminho.endsWith('/v1/auth/renovar')) { renovacoes++; await new Promise((x) => setTimeout(x, 10)); return json(200, { tokenAcesso: 'novo', expiraEm: '2030-01-01T00:00:00Z' }); }
      if (r.headers.get('Authorization') !== 'Bearer novo') return json(401, { codigo: 'SESSAO_EXPIRADA', requestId: 'r1' });
      return json(200, { ok: caminho });
    });
    const perdida = vi.fn();
    configurarApi('http://api.teste/o/x', 'x', { token: () => token, aoRenovar: (t) => (token = t.tokenAcesso), aoPerderSessao: perdida }, f as any);
    const { api } = await import('@/api');
    const [a, b] = await Promise.all([ok(api().GET('/v1/contadores', {})), ok(api().GET('/v1/me', {}))]);
    expect(a).toEqual({ ok: '/o/x/v1/contadores' });
    expect(b).toEqual({ ok: '/o/x/v1/me' });
    expect(renovacoes).toBe(1);
    expect(perdida).not.toHaveBeenCalled();
  });

  it('sessão revogada não tenta renovar e avisa a perda de sessão', async () => {
    const f = vi.fn(async () => json(401, { codigo: 'SESSAO_REVOGADA', requestId: 'r2' }));
    const perdida = vi.fn();
    configurarApi('http://api.teste/o/x', 'x', { token: () => 't', aoRenovar: () => undefined, aoPerderSessao: perdida }, f as any);
    const { api } = await import('@/api');
    await expect(ok(api().GET('/v1/me', {}))).rejects.toMatchObject({ status: 401, codigo: 'SESSAO_REVOGADA', requestId: 'r2' });
    expect(perdida).toHaveBeenCalledWith('SESSAO_REVOGADA');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('erro 422 expõe os campos sem o prefixo', async () => {
    const f = vi.fn(async () => json(422, { codigo: 'VALIDACAO_FALHOU', requestId: 'r3', campos: [{ campo: 'respostas.dor', codigo: 'OBRIGATORIO', mensagem: 'Informe a dor.' }] }));
    configurarApi('http://api.teste/o/x', 'x', { token: () => 't', aoRenovar: () => undefined, aoPerderSessao: () => undefined }, f as any);
    const { api } = await import('@/api');
    const e = await ok(api().GET('/v1/me', {})).catch((x) => x);
    expect(e.porCampo('respostas')).toEqual({ dor: 'Informe a dor.' });
  });
});
