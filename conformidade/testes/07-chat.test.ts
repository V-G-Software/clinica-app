// Chat: mensagem do paciente chega à equipe em até 5 s (SSE e polling), idCliente idempotente,
// leitura, isolamento e conversa arquivada bloqueando envio.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { config } from '../src/config.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { ouvirPolling, ouvirSse } from '../src/tempo-real.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB, tempoReal } = amb;
let conversa: any;

describe.runIf(temModulo(amb, 'chat'))('chat', () => {
  beforeAll(async () => {
    const r = esperar(await api.chamar('POST', '/v1/conversas', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), [200, 201]);
    conversa = r.body;
    expect(conversa.participantes.map((p: any) => p.usuarioId)).toEqual(expect.arrayContaining([gestor.usuarioId, pacienteA.usuarioId]));
    const de2 = esperar(await api.chamar('POST', '/v1/conversas', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId } }), 200).body;
    expect(de2.id).toBe(conversa.id); // RN-CHA-001: uma conversa ativa por paciente
  });

  async function enviarDoPaciente(texto: string) {
    return esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/mensagens`, { token: pacienteA.token, idempotencia: true, body: { idCliente: randomUUID(), tipo: 'TEXTO', texto } }), 201).body;
  }

  it(`tempo real no modo declarado (${tempoReal.modo}): mensagem chega à equipe em até ${config.prazoTempoRealMs} ms`, async () => {
    const ouvinte = tempoReal.modo === 'SSE' ? await ouvirSse(api, gestor.token) : await ouvirPolling(api, gestor.token, 1000);
    try {
      await new Promise((ok) => setTimeout(ok, 300));
      const t0 = Date.now();
      const m = await enviarDoPaciente('Mensagem para o teste de tempo real.');
      const ev = await ouvinte.esperarEvento((e) => e.tipo === 'chat.mensagem.criada' && e.dados?.mensagemId === m.id, config.prazoTempoRealMs);
      expect(ev.dados.conversaId).toBe(conversa.id);
      expect(Date.now() - t0).toBeLessThanOrEqual(config.prazoTempoRealMs);
      expect(JSON.stringify(ev)).not.toContain('Mensagem para o teste'); // evento leva só identificadores
    } finally { ouvinte.fechar(); }
  });

  it('polling (alternativa obrigatória ao SSE) também entrega o evento', async () => {
    const ouvinte = await ouvirPolling(api, gestor.token, 1000);
    try {
      const m = await enviarDoPaciente('Mensagem para o teste de polling.');
      await ouvinte.esperarEvento((e) => e.tipo === 'chat.mensagem.criada' && e.dados?.mensagemId === m.id, config.prazoTempoRealMs);
    } finally { ouvinte.fechar(); }
  });

  it('SSE reenvia o que foi perdido a partir de Last-Event-ID', async () => {
    if (tempoReal.modo !== 'SSE') return;
    const { ultimoEventoId } = esperar(await api.chamar('GET', '/v1/eventos', { token: gestor.token }), 200).body;
    const m = await enviarDoPaciente('Enquanto a equipe estava offline.');
    const ouvinte = await ouvirSse(api, gestor.token, ultimoEventoId ?? undefined);
    try { await ouvinte.esperarEvento((e) => e.dados?.mensagemId === m.id, config.prazoTempoRealMs); } finally { ouvinte.fechar(); }
  });

  it('idCliente repetido devolve a mesma mensagem (RN-CHA-007)', async () => {
    const idCliente = randomUUID();
    const a = esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/mensagens`, { token: pacienteA.token, idempotencia: true, body: { idCliente, tipo: 'TEXTO', texto: 'uma vez' } }), 201).body;
    const b = esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/mensagens`, { token: pacienteA.token, idempotencia: true, body: { idCliente, tipo: 'TEXTO', texto: 'uma vez' } }), 201).body;
    expect(b.id).toBe(a.id);
    const lista = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: gestor.token, query: { limite: 50 } }), 200).body;
    expect(lista.itens.filter((m: any) => m.idCliente === idCliente)).toHaveLength(1);
  });

  it('leitura zera as não lidas de quem leu; paginação por antesDe', async () => {
    const lista = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: gestor.token, query: { limite: 2 } }), 200).body;
    expect(lista.itens.length).toBeLessThanOrEqual(2);
    const ultima = lista.itens.at(-1);
    if (lista.temMais) {
      const antes = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: gestor.token, query: { antesDe: lista.itens[0].id, limite: 2 } }), 200).body;
      expect(antes.itens.map((m: any) => m.id)).not.toContain(lista.itens[0].id);
    }
    esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/leitura`, { token: gestor.token, body: { ateMensagemId: ultima.id } }), 204);
    const c = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}`, { token: gestor.token }), 200).body;
    expect(c.naoLidas).toBe(0);
    expect(c.participantes.find((p: any) => p.usuarioId === gestor.usuarioId).lidoAte).toBe(ultima.id);
  });

  it('isolamento: outro paciente não vê a conversa nem envia nela (404)', async () => {
    esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}`, { token: pacienteB.token }), 404);
    esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: pacienteB.token }), 404);
    esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/mensagens`, { token: pacienteB.token, idempotencia: true, body: { idCliente: randomUUID(), tipo: 'TEXTO', texto: 'intruso' } }), 404);
    const lista = esperar(await api.chamar('GET', '/v1/conversas', { token: pacienteB.token }), 200).body;
    expect(lista.itens.map((c: any) => c.id)).not.toContain(conversa.id);
  });

  it('título é calculado para quem vê (RN-CHA-003)', async () => {
    const daEquipe = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}`, { token: gestor.token }), 200).body;
    const doPaciente = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}`, { token: pacienteA.token }), 200).body;
    expect(daEquipe.titulo).toBe(daEquipe.paciente.nome);
    expect(doPaciente.titulo).not.toBe(daEquipe.titulo);
    expect(doPaciente.acoesPermitidas).not.toContain('ARQUIVAR');
  });

  it('conversa arquivada bloqueia envio com 409 CONVERSA_ARQUIVADA e mantém o histórico', async () => {
    const antes = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: gestor.token, query: { limite: 100 } }), 200).body.itens.length;
    const arq = esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/arquivar`, { token: gestor.token }), 200).body;
    expect(arq.status).toBe('ARQUIVADA');
    esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/mensagens`, { token: pacienteA.token, idempotencia: true, body: { idCliente: randomUUID(), tipo: 'TEXTO', texto: 'depois de arquivar' } }), 409, 'CONVERSA_ARQUIVADA');
    const depois = esperar(await api.chamar('GET', `/v1/conversas/${conversa.id}/mensagens`, { token: gestor.token, query: { limite: 100 } }), 200).body.itens.length;
    expect(depois).toBe(antes);
    esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/arquivar`, { token: pacienteA.token }), 403, 'PERMISSAO_NEGADA');
    expect(esperar(await api.chamar('POST', `/v1/conversas/${conversa.id}/reabrir`, { token: gestor.token }), 200).body.status).toBe('ATIVA');
    await enviarDoPaciente('depois de reabrir');
  });
});
