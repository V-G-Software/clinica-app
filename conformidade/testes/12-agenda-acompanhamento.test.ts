// Procedimento da agenda ↔ acompanhamento pós-procedimento (RN-AGE-008, QUESTION-032):
// marcar com `acompanhamento` cria o acompanhamento AGENDADO no dia local do procedimento, ligado nos dois
// sentidos; remarcar para outro dia encerra e recria; cancelar encerra; nada é apagado.
// Só roda com os módulos `agenda` e `acompanhamento`. Horários longe do presente e com encaixe: não colidem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { partesLocais } from '../src/datas.ts';

const amb = ambiente();
const { api, gestor, pacienteA, fuso, execucao } = amb;
const ativo = temModulo(amb, 'agenda') && temModulo(amb, 'acompanhamento');
const H = 3_600_000;
const MEIA_HORA = 30 * 60_000;

describe.runIf(ativo)('agenda ↔ acompanhamento (RN-AGE-008)', () => {
  let agora: number;
  let protocolo: any;
  let procedimento: any;
  let consulta: any;
  const acompanhamento = async (id: string) => esperar(await api.chamar('GET', `/v1/acompanhamentos/${id}`, { token: gestor.token }), 200).body;
  /** Instante futuro único (dias à frente, minuto múltiplo de 30). */
  const daqui = (dias: number) => new Date(Math.floor((agora + dias * 24 * H + Math.random() * 12 * H) / MEIA_HORA) * MEIA_HORA).toISOString();
  const marcar = async (body: Record<string, unknown>, status = 201, codigo?: string) => esperar(await api.chamar('POST', '/v1/agendamentos', { token: gestor.token, idempotencia: true, body: {
    pacienteId: pacienteA.pacienteId, profissionalId: gestor.usuarioId, encaixe: true, ...body,
  } }), status, codigo).body;

  beforeAll(async () => {
    agora = Date.parse(esperar(await api.chamar('GET', '/v1/publico/saude'), 200).body.agora);
    protocolo = esperar(await api.chamar('GET', '/v1/protocolos', { token: gestor.token, query: { status: 'ATIVO', limite: 1 } }), 200).body.itens[0];
    procedimento = esperar(await api.chamar('POST', '/v1/agenda/servicos', { token: gestor.token, body: {
      nome: `Procedimento conformidade ${execucao}`, categoria: 'PROCEDIMENTO', duracaoMinutos: 60, autoagendavel: false, profissionaisIds: [gestor.usuarioId], protocoloId: protocolo.id,
    } }), 201).body;
    consulta = esperar(await api.chamar('POST', '/v1/agenda/servicos', { token: gestor.token, body: {
      nome: `Consulta conformidade ${execucao} b`, categoria: 'CONSULTA', duracaoMinutos: 30, autoagendavel: false, profissionaisIds: [gestor.usuarioId],
    } }), 201).body;
  });
  afterAll(async () => {
    for (const s of [procedimento, consulta]) if (s) await api.chamar('POST', `/v1/agenda/servicos/${s.id}/arquivar`, { token: gestor.token });
  });

  it('serviço guarda o protocolo sugerido; consulta não aceita protocolo; paciente não vê', async () => {
    expect(procedimento.protocoloId).toBe(protocolo.id);
    expect(consulta.protocoloId).toBeNull();
    esperar(await api.chamar('POST', '/v1/agenda/servicos', { token: gestor.token, body: {
      nome: 'Inválido', categoria: 'CONSULTA', duracaoMinutos: 30, autoagendavel: false, profissionaisIds: [gestor.usuarioId], protocoloId: protocolo.id,
    } }), 422, 'VALIDACAO_FALHOU');
    const doPaciente = esperar(await api.chamar('GET', '/v1/agenda/servicos', { token: pacienteA.token }), 200).body.itens;
    expect(doPaciente.every((s: any) => s.protocoloId === null)).toBe(true);
  });

  it('marcar sem `acompanhamento` não cria nada; consulta com `acompanhamento` → 422', async () => {
    const a = await marcar({ servicoId: procedimento.id, inicioEm: daqui(60) });
    expect(a.acompanhamentoId).toBeNull();
    await marcar({ servicoId: consulta.id, inicioEm: daqui(61), acompanhamento: { protocoloId: protocolo.id } }, 422, 'VALIDACAO_FALHOU');
    esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/cancelar`, { token: gestor.token, body: { motivo: 'Limpeza da conformidade.' } }), 200);
  });

  let agendamento: any;
  it('procedimento com `acompanhamento`: nasce AGENDADO no dia local do procedimento, ligado nos dois sentidos', async () => {
    const inicioEm = daqui(70);
    agendamento = await marcar({ servicoId: procedimento.id, inicioEm, acompanhamento: { protocoloId: protocolo.id } });
    expect(agendamento.acompanhamentoId).toEqual(expect.any(String));
    const acp = await acompanhamento(agendamento.acompanhamentoId);
    expect(acp).toMatchObject({ status: 'AGENDADO', dataInicio: partesLocais(Date.parse(inicioEm), fuso).data, agendamentoId: agendamento.id, paciente: { id: pacienteA.pacienteId }, protocolo: { id: protocolo.id } });
    expect(acp.equipe.map((e: any) => e.usuarioId)).toEqual([gestor.usuarioId]);
    // O paciente vê a ligação no agendamento e no acompanhamento.
    const doPaciente = esperar(await api.chamar('GET', `/v1/agendamentos/${agendamento.id}`, { token: pacienteA.token }), 200).body;
    expect(doPaciente.acompanhamentoId).toBe(agendamento.acompanhamentoId);
  });

  it('remarcar no mesmo dia mantém o acompanhamento; para outro dia encerra e recria (nada é apagado)', async () => {
    const mesmoDia = new Date(Date.parse(agendamento.inicioEm) + MEIA_HORA).toISOString();
    const r1 = esperar(await api.chamar('POST', `/v1/agendamentos/${agendamento.id}/remarcar`, { token: gestor.token, body: { inicioEm: mesmoDia, encaixe: true } }), 200).body;
    // Meia hora depois pode cruzar a meia-noite local: só afirma quando o dia não mudou.
    if (partesLocais(Date.parse(mesmoDia), fuso).data === partesLocais(Date.parse(agendamento.inicioEm), fuso).data) expect(r1.acompanhamentoId).toBe(agendamento.acompanhamentoId);
    const antigoId = r1.acompanhamentoId;
    const outroDia = new Date(Date.parse(mesmoDia) + 3 * 24 * H).toISOString();
    const r2 = esperar(await api.chamar('POST', `/v1/agendamentos/${agendamento.id}/remarcar`, { token: gestor.token, body: { inicioEm: outroDia, encaixe: true, motivo: 'Hospital remarcou.' } }), 200).body;
    expect(r2.acompanhamentoId).toEqual(expect.any(String));
    expect(r2.acompanhamentoId).not.toBe(antigoId);
    const antigo = await acompanhamento(antigoId);
    expect(antigo.status).toBe('ENCERRADO');
    expect(antigo.motivoEncerramento).toMatch(/remarcad/);
    expect(antigo.agendamentoId).toBe(agendamento.id);
    const novo = await acompanhamento(r2.acompanhamentoId);
    expect(novo).toMatchObject({ status: 'AGENDADO', dataInicio: partesLocais(Date.parse(outroDia), fuso).data, agendamentoId: agendamento.id, protocolo: { id: antigo.protocolo.id } });
    expect(novo.equipe.map((e: any) => e.usuarioId)).toEqual(antigo.equipe.map((e: any) => e.usuarioId));
    agendamento = r2;
  });

  it('cancelar o procedimento encerra o acompanhamento com o motivo', async () => {
    const r = esperar(await api.chamar('POST', `/v1/agendamentos/${agendamento.id}/cancelar`, { token: gestor.token, body: { motivo: 'Paciente desistiu da cirurgia.' } }), 200).body;
    expect(r.acompanhamentoId).toBe(agendamento.acompanhamentoId);
    const acp = await acompanhamento(agendamento.acompanhamentoId);
    expect(acp.status).toBe('ENCERRADO');
    expect(acp.motivoEncerramento).toContain('Paciente desistiu da cirurgia.');
  });

  it('acompanhamento já encerrado à mão não muda quando o procedimento é cancelado', async () => {
    const a = await marcar({ servicoId: procedimento.id, inicioEm: daqui(80), acompanhamento: { protocoloId: protocolo.id } });
    esperar(await api.chamar('POST', `/v1/acompanhamentos/${a.acompanhamentoId}/encerrar`, { token: gestor.token, body: { motivo: 'Encerrado pela equipe.' } }), 200);
    esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/cancelar`, { token: gestor.token, body: { motivo: 'Outro motivo.' } }), 200);
    expect((await acompanhamento(a.acompanhamentoId)).motivoEncerramento).toBe('Encerrado pela equipe.');
  });
});
