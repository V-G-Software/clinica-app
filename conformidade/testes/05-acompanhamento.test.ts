// Acompanhamento com dataInicio no passado: check-in disponível, resposta, alerta pela regra,
// isolamento entre pacientes, idempotência da resposta, versão do protocolo e encerramento.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { partesLocais, somarDias } from '../src/datas.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB, fuso, execucao } = amb;
const ativo = temModulo(amb, 'acompanhamento');

let protocolo: any;
let acomp: any;
let checkin: any;

describe.runIf(ativo)('acompanhamento', () => {
  beforeAll(async () => {
    const agora = Date.parse(esperar(await api.chamar('GET', '/v1/publico/saude'), 200).body.agora);
    const ref = partesLocais(agora - 60 * 60_000, fuso); // check-in abriu há 1 hora (no fuso da organização)
    const form = esperar(await api.chamar('POST', '/v1/formularios', { token: gestor.token, body: {
      titulo: `Conformidade ${execucao}`, finalidade: 'CHECKIN',
      campos: [
        { id: 'dor', tipo: 'ESCALA', rotulo: 'Dor', min: 0, max: 10, obrigatorio: true },
        { id: 'febre', tipo: 'SIM_NAO', rotulo: 'Teve febre?', obrigatorio: true },
        { id: 'temperatura', tipo: 'NUMERO', rotulo: 'Temperatura', min: 34, max: 43, casasDecimais: 1, obrigatorio: true, visivelSe: { campo: 'febre', operador: 'IGUAL', valor: true } },
        { id: 'observacao', tipo: 'TEXTO_LONGO', rotulo: 'Observação', obrigatorio: false },
      ],
    } }), 201).body;
    protocolo = esperar(await api.chamar('POST', '/v1/protocolos', { token: gestor.token, body: {
      nome: `Conformidade ${execucao}`, duracaoDias: 2,
      checkins: [{ dias: [1, 2], horario: ref.hora, formulario: { id: form.id, versao: form.versao }, lembreteAposHoras: null, expiraAposHoras: 12 }],
      orientacoes: [{ dia: 1, horario: ref.hora, texto: 'Orientação de teste.' }],
      regrasAlerta: [
        { id: 'dor_alta', tipo: 'RESPOSTA', campo: 'dor', operador: 'MAIOR_OU_IGUAL', valor: 8, severidade: 'ALTA', mensagem: 'Dor 8 ou mais relatada' },
        { id: 'sem_resposta', tipo: 'CHECKIN_EXPIRADO', severidade: 'MEDIA', mensagem: 'Check-in não respondido' },
      ],
    } }), 201).body;
    acomp = esperar(await api.chamar('POST', '/v1/acompanhamentos', { token: gestor.token, idempotencia: true, body: {
      pacienteId: pacienteA.pacienteId, protocoloId: protocolo.id, dataInicio: somarDias(ref.data, -1), equipeIds: [gestor.usuarioId], observacao: 'teste',
    } }), 201).body;
  });

  it('nasce ATIVO, com dia atual 1 e check-in do dia 1 DISPONIVEL (RN-ACO-002)', async () => {
    expect(acomp.status).toBe('ATIVO');
    expect(acomp.diaAtual).toBe(1);
    expect(acomp.protocolo.versao).toBe(protocolo.versao);
    const lista = esperar(await api.chamar('GET', '/v1/checkins', { token: pacienteA.token, query: { acompanhamentoId: acomp.id } }), 200).body;
    checkin = lista.itens.find((c: any) => c.dia === 1);
    expect(checkin.status).toBe('DISPONIVEL');
    expect(checkin.acoesPermitidas).toContain('RESPONDER');
    expect(lista.itens.find((c: any) => c.dia === 2).status).toBe('AGENDADO');
  });

  it('isolamento: outro paciente não vê nem responde (404); equipe vê mas não responde (403)', async () => {
    esperar(await api.chamar('GET', `/v1/checkins/${checkin.id}`, { token: pacienteB.token }), 404);
    esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteB.token, idempotencia: true, body: { respostas: { dor: 1, febre: false } } }), 404);
    esperar(await api.chamar('GET', `/v1/acompanhamentos/${acomp.id}`, { token: pacienteB.token }), 404);
    const lista = esperar(await api.chamar('GET', '/v1/acompanhamentos', { token: pacienteB.token }), 200).body;
    expect(lista.itens.map((a: any) => a.id)).not.toContain(acomp.id);
    const visto = esperar(await api.chamar('GET', `/v1/checkins/${checkin.id}`, { token: gestor.token }), 200).body;
    expect(visto.acoesPermitidas).not.toContain('RESPONDER');
    esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: gestor.token, idempotencia: true, body: { respostas: { dor: 1, febre: false } } }), 403, 'PERMISSAO_NEGADA');
  });

  it('valida respostas contra o formulário (obrigatório visível, campo desconhecido, intervalo)', async () => {
    const semDor = esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: true, body: { respostas: { febre: false } } }), 422, 'VALIDACAO_FALHOU');
    expect(semDor.body.campos.map((c: any) => c.campo)).toContain('respostas.dor');
    const semTemp = esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: true, body: { respostas: { dor: 2, febre: true } } }), 422);
    expect(semTemp.body.campos.map((c: any) => c.campo)).toContain('respostas.temperatura');
    esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: true, body: { respostas: { dor: 11, febre: false } } }), 422);
    esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: true, body: { respostas: { dor: 2, febre: false, inventado: 'x' } } }), 422);
  });

  it('resposta gera alerta pela regra; repetir com a mesma chave não duplica; nova chave → 409', async () => {
    const chave = randomUUID();
    const corpo = { respostas: { dor: 9, febre: false, observacao: 'Doendo bastante.' } };
    const r1 = esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: chave, body: corpo }), 201).body;
    expect(r1.status).toBe('RESPONDIDO');
    expect(r1.respostas.dor).toBe(9);
    const r2 = esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: chave, body: corpo }), 201).body;
    expect(r2.respondidoEm).toBe(r1.respondidoEm);
    esperar(await api.chamar('POST', `/v1/checkins/${checkin.id}/respostas`, { token: pacienteA.token, idempotencia: true, body: corpo }), 409, 'CHECKIN_JA_RESPONDIDO');
    const alertas = esperar(await api.chamar('GET', '/v1/alertas', { token: gestor.token, query: { acompanhamentoId: acomp.id } }), 200).body.itens;
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ regraId: 'dor_alta', severidade: 'ALTA', status: 'ABERTO', checkinId: checkin.id });
    const det = esperar(await api.chamar('GET', `/v1/acompanhamentos/${acomp.id}`, { token: gestor.token }), 200).body;
    expect(det.resumoCheckins.respondidos).toBe(1);
    expect(det.alertasAbertos).toBe(1);
    esperar(await api.chamar('GET', '/v1/alertas', { token: pacienteA.token }), [403, 404]);
  });

  it('resolver alerta registra quem e quando', async () => {
    const [alerta] = esperar(await api.chamar('GET', '/v1/alertas', { token: gestor.token, query: { acompanhamentoId: acomp.id, status: 'ABERTO' } }), 200).body.itens;
    const r = esperar(await api.chamar('POST', `/v1/alertas/${alerta.id}/resolver`, { token: gestor.token, body: { nota: 'Contato feito.' } }), 200).body;
    expect(r.status).toBe('RESOLVIDO');
    expect(r.resolvidoPor.usuarioId).toBe(gestor.usuarioId);
    expect(r.resolvidoEm).toBeTruthy();
    expect(r.acoesPermitidas).not.toContain('RESOLVER');
  });

  it('nova versão do protocolo não altera acompanhamento em andamento (RN-ACO-003)', async () => {
    const atual = esperar(await api.chamar('GET', `/v1/protocolos/${protocolo.id}`, { token: gestor.token }), 200);
    const { id, versao, status, acoesPermitidas, ...corpo } = atual.body;
    const v2 = esperar(await api.chamar('PUT', `/v1/protocolos/${protocolo.id}`, { token: gestor.token, body: { ...corpo, descricao: 'v2' }, headers: { 'If-Match': atual.headers.get('etag')! } }), 200).body;
    expect(v2.versao).toBe(protocolo.versao + 1);
    esperar(await api.chamar('PUT', `/v1/protocolos/${protocolo.id}`, { token: gestor.token, body: { ...corpo, descricao: 'v3' }, headers: { 'If-Match': atual.headers.get('etag')! } }), 412, 'CONFLITO_VERSAO');
    const antigo = esperar(await api.chamar('GET', `/v1/protocolos/${protocolo.id}`, { token: gestor.token, query: { versao: protocolo.versao } }), 200).body;
    expect(antigo.versao).toBe(protocolo.versao);
    const det = esperar(await api.chamar('GET', `/v1/acompanhamentos/${acomp.id}`, { token: gestor.token }), 200).body;
    expect(det.protocolo.versao).toBe(protocolo.versao);
  });

  it('encerrar exige motivo e cancela os check-ins futuros (RN-ACO-008)', async () => {
    const agora = Date.parse(esperar(await api.chamar('GET', '/v1/publico/saude'), 200).body.agora);
    const futuro = esperar(await api.chamar('POST', '/v1/acompanhamentos', { token: gestor.token, idempotencia: true, body: {
      pacienteId: pacienteB.pacienteId, protocoloId: protocolo.id, dataInicio: somarDias(partesLocais(agora, fuso).data, 5),
    } }), 201).body;
    expect(futuro.status).toBe('AGENDADO');
    expect(futuro.diaAtual).toBeLessThan(0);
    esperar(await api.chamar('POST', `/v1/acompanhamentos/${futuro.id}/encerrar`, { token: gestor.token, body: {} }), 422);
    const enc = esperar(await api.chamar('POST', `/v1/acompanhamentos/${futuro.id}/encerrar`, { token: gestor.token, body: { motivo: 'Cirurgia remarcada.' } }), 200).body;
    expect(enc.status).toBe('ENCERRADO');
    expect(enc.motivoEncerramento).toBe('Cirurgia remarcada.');
    const cks = esperar(await api.chamar('GET', '/v1/checkins', { token: gestor.token, query: { acompanhamentoId: futuro.id } }), 200).body.itens;
    expect(cks.every((c: any) => c.status === 'CANCELADO')).toBe(true);
    esperar(await api.chamar('POST', `/v1/acompanhamentos/${futuro.id}/encerrar`, { token: pacienteB.token, body: { motivo: 'Paciente tentando encerrar.' } }), [403, 404]);
  });
});
