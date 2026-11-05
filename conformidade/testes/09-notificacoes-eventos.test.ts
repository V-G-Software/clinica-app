// Central de notificações, preferências, inscrição de push e semântica de GET /v1/eventos.
import { describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente } from '../src/contexto.ts';

const { api, pacienteA, pacienteB, gestor } = ambiente();

describe('notificações', () => {
  it('central lista e marca como lidas; contadores acompanham', async () => {
    const lista = esperar(await api.chamar('GET', '/v1/notificacoes', { token: gestor.token, query: { limite: 5 } }), 200).body;
    expect(lista.itens.length).toBeLessThanOrEqual(5);
    for (const n of lista.itens) expect(JSON.stringify(n)).not.toMatch(/stack|undefined/);
    esperar(await api.chamar('POST', '/v1/notificacoes/leitura', { token: gestor.token, body: { todas: true } }), 204);
    const c = esperar(await api.chamar('GET', '/v1/contadores', { token: gestor.token }), 200).body;
    expect(c['notificacoes.naoLidas']).toBe(0);
    const nl = esperar(await api.chamar('GET', '/v1/notificacoes', { token: gestor.token, query: { naoLidas: true } }), 200).body;
    expect(nl.itens).toHaveLength(0);
  });

  it('preferências por tipo: ida e volta', async () => {
    const p = esperar(await api.chamar('GET', '/v1/notificacoes/preferencias', { token: pacienteA.token }), 200).body;
    const alterado = { itens: p.itens.map((i: any) => (i.tipo === 'CHAT_MENSAGEM' ? { ...i, email: false } : i)) };
    const r = esperar(await api.chamar('PUT', '/v1/notificacoes/preferencias', { token: pacienteA.token, body: alterado }), 200).body;
    expect(r.itens.find((i: any) => i.tipo === 'CHAT_MENSAGEM').email).toBe(false);
  });

  it('inscrição de push: cria (idempotente), remove, e não remove a de outra conta', async () => {
    const corpo = { inscricao: { endpoint: `https://push.exemplo/conformidade/${Date.now()}`, expirationTime: null, keys: { p256dh: 'BExemplo', auth: 'exemplo' } }, dispositivo: 'Conformidade' };
    const chave = crypto.randomUUID();
    const a = esperar(await api.chamar('POST', '/v1/notificacoes/push/inscricoes', { token: pacienteA.token, body: corpo, idempotencia: chave }), 201).body;
    const b = esperar(await api.chamar('POST', '/v1/notificacoes/push/inscricoes', { token: pacienteA.token, body: corpo, idempotencia: chave }), 201).body;
    expect(b.id).toBe(a.id);
    esperar(await api.chamar('DELETE', `/v1/notificacoes/push/inscricoes/${a.id}`, { token: pacienteB.token }), 404);
    esperar(await api.chamar('DELETE', `/v1/notificacoes/push/inscricoes/${a.id}`, { token: pacienteA.token }), 204);
    esperar(await api.chamar('DELETE', `/v1/notificacoes/push/inscricoes/${a.id}`, { token: pacienteA.token }), 404);
  });
});

describe('eventos', () => {
  it('sem cursor devolve o ponto de partida; cursor desconhecido devolve 410 CURSOR_EXPIRADO', async () => {
    const r = esperar(await api.chamar('GET', '/v1/eventos', { token: pacienteA.token }), 200).body;
    expect(r.itens).toEqual([]);
    expect('ultimoEventoId' in r).toBe(true);
    if (r.ultimoEventoId) esperar(await api.chamar('GET', '/v1/eventos', { token: pacienteA.token, query: { depois: r.ultimoEventoId } }), 200);
    esperar(await api.chamar('GET', '/v1/eventos', { token: pacienteA.token, query: { depois: 'evt_cursor_inexistente' } }), 410, 'CURSOR_EXPIRADO');
  });
});
