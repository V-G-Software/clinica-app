// Módulo `agenda` (ADR-0016): serviços, grade, bloqueios, horários livres e o ciclo do agendamento
// (RN-AGE-001..006). Usa um serviço próprio da execução, atendido pelo gestor, e devolve a grade original no fim.
// Sem o módulo, as rotas respondem 404 MODULO_NAO_CONTRATADO e nada aparece no manifesto.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esperar } from '../src/cliente.ts';
import { ambiente, temModulo } from '../src/contexto.ts';
import { partesLocais, somarDias } from '../src/datas.ts';

const amb = ambiente();
const { api, gestor, pacienteA, pacienteB, fuso, execucao } = amb;
const ativo = temModulo(amb, 'agenda');
const H = 3_600_000;

describe.runIf(!ativo)('agenda — módulo não contratado', () => {
  it('rotas respondem 404 MODULO_NAO_CONTRATADO e o manifesto não mostra nada da agenda', async () => {
    const hoje = partesLocais(Date.now(), fuso).data;
    esperar(await api.chamar('GET', '/v1/agendamentos', { token: gestor.token, query: { de: hoje, ate: hoje } }), 404, 'MODULO_NAO_CONTRATADO');
    esperar(await api.chamar('GET', '/v1/agenda/servicos', { token: pacienteA.token }), 404, 'MODULO_NAO_CONTRATADO');
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes.filter((p: string) => p.startsWith('agenda.'))).toEqual([]);
    expect(man.navegacao.filter((n: any) => n.destino.tela.startsWith('agenda.'))).toEqual([]);
  });
});

describe.runIf(ativo)('agenda', () => {
  let cfg: any;
  let autoagendamento: boolean;
  let servico: any;
  let gradeOriginal: any[];
  let etagGrade: string;
  let hoje: string;
  let agora: number;
  const ate = () => somarDias(hoje, 6);
  const horarios = async (token: string, extra: Record<string, string> = {}) =>
    esperar(await api.chamar('GET', '/v1/agenda/horarios', { token, query: { servicoId: servico.id, de: hoje, ate: ate(), ...extra } }), 200).body.itens as any[];
  const agendamento = async (token: string, id: string, status = 200) => esperar(await api.chamar('GET', `/v1/agendamentos/${id}`, { token }), status).body;

  beforeAll(async () => {
    agora = Date.parse(esperar(await api.chamar('GET', '/v1/publico/saude'), 200).body.agora);
    hoje = partesLocais(agora, fuso).data;
    const org = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200).body;
    cfg = org.agenda;
    const manA = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    autoagendamento = manA.permissoes.includes('agenda.agendamento.criar');
    expect(autoagendamento).toBe(cfg.autoagendamento);
    servico = esperar(await api.chamar('POST', '/v1/agenda/servicos', { token: gestor.token, body: {
      nome: `Consulta conformidade ${execucao}`, categoria: 'CONSULTA', duracaoMinutos: 30, autoagendavel: true, profissionaisIds: [gestor.usuarioId], orientacoes: 'Chegue 10 minutos antes.',
    } }), 201).body;
    // Grade do gestor: a original + o dia inteiro, todos os dias, só para o serviço desta execução.
    const g = esperar(await api.chamar('GET', `/v1/agenda/grades/${gestor.usuarioId}`, { token: gestor.token }), 200);
    gradeOriginal = g.body.itens;
    const itens = [...gradeOriginal, ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicio: '00:00', fim: '23:59', servicosIds: [servico.id] }))];
    etagGrade = esperar(await api.chamar('PUT', `/v1/agenda/grades/${gestor.usuarioId}`, { token: gestor.token, body: { itens }, headers: { 'If-Match': g.headers.get('etag')! } }), 200).headers.get('etag')!;
  });
  afterAll(async () => {
    if (!etagGrade) return;
    await api.chamar('PUT', `/v1/agenda/grades/${gestor.usuarioId}`, { token: gestor.token, body: { itens: gradeOriginal }, headers: { 'If-Match': etagGrade } });
    if (servico) await api.chamar('POST', `/v1/agenda/servicos/${servico.id}/arquivar`, { token: gestor.token });
  });

  it('manifesto: permissões, menu e configuração do módulo', async () => {
    const man = esperar(await api.chamar('GET', '/v1/sessao', { token: gestor.token }), 200).body;
    expect(man.permissoes).toEqual(expect.arrayContaining(['agenda.agendamento.ler', 'agenda.agendamento.criar', 'agenda.agendamento.gerenciar', 'agenda.configuracao.gerenciar']));
    expect(man.modulos.find((m: any) => m.id === 'agenda').config).toEqual(cfg);
    const manA = esperar(await api.chamar('GET', '/v1/sessao', { token: pacienteA.token }), 200).body;
    expect(manA.permissoes).toContain('agenda.agendamento.ler');
    expect(manA.permissoes).not.toContain('agenda.agendamento.gerenciar');
    expect(manA.navegacao.some((n: any) => n.destino.tela === 'agenda.meus')).toBe(true);
  });

  it('serviço: procedimento nunca é autoagendável; edição com If-Match (412 com versão velha)', async () => {
    esperar(await api.chamar('POST', '/v1/agenda/servicos', { token: gestor.token, body: { nome: `Cirurgia ${execucao}`, categoria: 'PROCEDIMENTO', duracaoMinutos: 60, autoagendavel: true, profissionaisIds: [gestor.usuarioId] } }), 422, 'VALIDACAO_FALHOU');
    const s = esperar(await api.chamar('GET', `/v1/agenda/servicos/${servico.id}`, { token: gestor.token }), 200);
    const corpo = { nome: servico.nome, categoria: 'CONSULTA', duracaoMinutos: 30, autoagendavel: true, profissionaisIds: [gestor.usuarioId], orientacoes: 'Chegue 15 minutos antes.' };
    const v2 = esperar(await api.chamar('PUT', `/v1/agenda/servicos/${servico.id}`, { token: gestor.token, body: corpo, headers: { 'If-Match': s.headers.get('etag')! } }), 200).body;
    expect(v2.orientacoes).toBe('Chegue 15 minutos antes.');
    esperar(await api.chamar('PUT', `/v1/agenda/servicos/${servico.id}`, { token: gestor.token, body: corpo, headers: { 'If-Match': s.headers.get('etag')! } }), 412, 'CONFLITO_VERSAO');
    esperar(await api.chamar('POST', '/v1/agenda/servicos', { token: pacienteA.token, body: corpo }), 403, 'PERMISSAO_NEGADA');
    const lista = esperar(await api.chamar('GET', '/v1/agenda/servicos', { token: gestor.token }), 200).body.itens;
    expect(lista.map((x: any) => x.id)).toContain(servico.id);
  });

  it('horários livres: dentro da grade, no futuro, com a duração do serviço; período longo é recusado', async () => {
    const livres = await horarios(gestor.token);
    expect(livres.length).toBeGreaterThan(0);
    for (const h of livres.slice(0, 50)) {
      expect(Date.parse(h.inicioEm)).toBeGreaterThanOrEqual(agora - 60_000);
      expect(Date.parse(h.fimEm) - Date.parse(h.inicioEm)).toBe(30 * 60_000);
      expect(h.profissional.usuarioId).toBe(gestor.usuarioId);
    }
    esperar(await api.chamar('GET', '/v1/agenda/horarios', { token: gestor.token, query: { servicoId: servico.id, de: hoje, ate: somarDias(hoje, 40) } }), 422, 'VALIDACAO_FALHOU');
  });

  let marcado: any;
  it('equipe marca; o horário sai da lista; o mesmo horário de novo → 409 HORARIO_INDISPONIVEL; encaixe passa (RN-AGE-001)', async () => {
    const [h] = (await horarios(gestor.token)).filter((x) => Date.parse(x.inicioEm) > agora + (cfg.cancelamentoAteHoras + 2) * H);
    marcado = esperar(await api.chamar('POST', '/v1/agendamentos', { token: gestor.token, idempotencia: true, body: {
      pacienteId: pacienteA.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId, inicioEm: h.inicioEm, local: 'Sala 2', observacao: 'Nota interna.',
    } }), 201).body;
    expect(marcado).toMatchObject({ status: 'AGENDADO', origem: 'EQUIPE', encaixe: false, inicioEm: h.inicioEm, fimEm: h.fimEm, local: 'Sala 2', observacao: 'Nota interna.', orientacoes: 'Chegue 15 minutos antes.' });
    expect(marcado.historico.map((x: any) => x.acao)).toEqual(['CRIADO']);
    expect((await horarios(gestor.token)).map((x) => x.inicioEm)).not.toContain(h.inicioEm);
    esperar(await api.chamar('POST', '/v1/agendamentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteB.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId, inicioEm: h.inicioEm } }), 409, 'HORARIO_INDISPONIVEL');
    const encaixe = esperar(await api.chamar('POST', '/v1/agendamentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteB.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId, inicioEm: h.inicioEm, encaixe: true } }), 201).body;
    expect(encaixe.encaixe).toBe(true);
    esperar(await api.chamar('POST', `/v1/agendamentos/${encaixe.id}/cancelar`, { token: gestor.token, body: { motivo: 'Teste de encaixe.' } }), 200);
  });

  it('isolamento: paciente vê o seu sem a nota interna; outro paciente recebe 404', async () => {
    const visto = await agendamento(pacienteA.token, marcado.id);
    expect(visto.observacao).toBeNull();
    expect(visto.acoesPermitidas).toEqual(expect.arrayContaining(['CONFIRMAR', 'CANCELAR']));
    expect(visto.acoesPermitidas).not.toContain('REMARCAR');
    await agendamento(pacienteB.token, marcado.id, 404);
    const listaB = esperar(await api.chamar('GET', '/v1/agendamentos', { token: pacienteB.token, query: { de: hoje, ate: ate() } }), 200).body.itens;
    expect(listaB.map((a: any) => a.id)).not.toContain(marcado.id);
    const listaA = esperar(await api.chamar('GET', '/v1/agendamentos', { token: pacienteA.token, query: { de: hoje, ate: ate() } }), 200).body.itens;
    expect(listaA.map((a: any) => a.id)).toContain(marcado.id);
  });

  it('paciente é avisado (notificação AGENDAMENTO_CRIADO) e vê a próxima consulta no início', async () => {
    const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: pacienteA.token }), 200).body.itens;
    expect(ntf.some((n: any) => n.tipo === 'AGENDAMENTO_CRIADO' && n.destino?.parametros?.agendamentoId === marcado.id)).toBe(true);
    const inicio = esperar(await api.chamar('GET', '/v1/inicio', { token: pacienteA.token }), 200).body.secoes;
    const prox = inicio.find((s: any) => s.tipo === 'PROXIMA_CONSULTA');
    expect(prox?.dados.agendamento.id).toBe(marcado.id);
  });

  it('paciente confirma (repetir não muda nada) e não pode remarcar, realizar nem editar', async () => {
    const c = esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/confirmar`, { token: pacienteA.token }), 200).body;
    expect(c.status).toBe('CONFIRMADO');
    const c2 = esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/confirmar`, { token: pacienteA.token }), 200).body;
    expect(c2.historico.filter((x: any) => x.acao === 'CONFIRMADO')).toHaveLength(1);
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/remarcar`, { token: pacienteA.token, body: { inicioEm: marcado.inicioEm } }), 403, 'PERMISSAO_NEGADA');
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/realizar`, { token: pacienteA.token }), 403, 'PERMISSAO_NEGADA');
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/confirmar`, { token: pacienteB.token }), 404);
  });

  it('equipe remarca: volta para AGENDADO, grava o motivo e libera o horário antigo', async () => {
    const livres = (await horarios(gestor.token)).filter((x) => Date.parse(x.inicioEm) > Date.parse(marcado.inicioEm) + 2 * H);
    const novo = livres[0];
    const r = esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/remarcar`, { token: gestor.token, body: { inicioEm: novo.inicioEm, motivo: 'Paciente pediu outro horário.' } }), 200).body;
    expect(r).toMatchObject({ status: 'AGENDADO', inicioEm: novo.inicioEm });
    expect(r.historico.at(-1)).toMatchObject({ acao: 'REMARCADO', detalhe: 'Paciente pediu outro horário.', por: { usuarioId: gestor.usuarioId } });
    expect((await horarios(gestor.token)).map((x) => x.inicioEm)).toContain(marcado.inicioEm);
    marcado = r;
  });

  it('edição com If-Match; realizar ou registrar falta antes do horário → 422 (RN-AGE-006)', async () => {
    const atual = esperar(await api.chamar('GET', `/v1/agendamentos/${marcado.id}`, { token: gestor.token }), 200);
    const e = esperar(await api.chamar('PATCH', `/v1/agendamentos/${marcado.id}`, { token: gestor.token, body: { local: 'Sala 3' }, headers: { 'If-Match': atual.headers.get('etag')! } }), 200).body;
    expect(e.local).toBe('Sala 3');
    esperar(await api.chamar('PATCH', `/v1/agendamentos/${marcado.id}`, { token: gestor.token, body: { local: 'Sala 4' }, headers: { 'If-Match': atual.headers.get('etag')! } }), 412, 'CONFLITO_VERSAO');
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/realizar`, { token: gestor.token }), 422, 'VALIDACAO_FALHOU');
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/falta`, { token: gestor.token }), 422, 'VALIDACAO_FALHOU');
  });

  it('paciente cancela dentro do prazo; cancelado não volta e o horário fica livre (RN-AGE-004)', async () => {
    const c = esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/cancelar`, { token: pacienteA.token, body: { motivo: 'Não vou conseguir ir.' } }), 200).body;
    expect(c).toMatchObject({ status: 'CANCELADO', motivoCancelamento: 'Não vou conseguir ir.' });
    expect(c.acoesPermitidas).toEqual(expect.not.arrayContaining(['CONFIRMAR', 'CANCELAR']));
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/confirmar`, { token: pacienteA.token }), 422, 'VALIDACAO_FALHOU');
    esperar(await api.chamar('POST', `/v1/agendamentos/${marcado.id}/cancelar`, { token: gestor.token, body: { motivo: 'De novo.' } }), 422, 'VALIDACAO_FALHOU');
    expect((await horarios(gestor.token)).map((x) => x.inicioEm)).toContain(marcado.inicioEm);
  });

  it('paciente não cancela pelo app depois do prazo', async () => {
    const perto = (await horarios(gestor.token)).find((x) => Date.parse(x.inicioEm) > agora + H && Date.parse(x.inicioEm) < agora + (cfg.cancelamentoAteHoras - 1) * H);
    if (!perto) return; // prazo de cancelamento curto demais para haver horário no meio
    const a = esperar(await api.chamar('POST', '/v1/agendamentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId, inicioEm: perto.inicioEm } }), 201).body;
    expect((await agendamento(pacienteA.token, a.id)).acoesPermitidas).not.toContain('CANCELAR');
    esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/cancelar`, { token: pacienteA.token, body: { motivo: 'Em cima da hora.' } }), 422, 'VALIDACAO_FALHOU');
    esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/cancelar`, { token: gestor.token, body: { motivo: 'Limpeza do teste.' } }), 200);
  });

  it('atendimento já começou: equipe registra realizado e falta; finalizado não muda mais', async () => {
    const passado = new Date(Math.floor((agora - 3 * H) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
    const criar = async () => esperar(await api.chamar('POST', '/v1/agendamentos', { token: gestor.token, idempotencia: true, body: { pacienteId: pacienteB.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId, inicioEm: passado, encaixe: true } }), 201).body;
    const a = await criar();
    expect(a.acoesPermitidas).toEqual(expect.arrayContaining(['REALIZAR', 'REGISTRAR_FALTA']));
    expect(esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/realizar`, { token: gestor.token }), 200).body.status).toBe('REALIZADO');
    esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/falta`, { token: gestor.token }), 422, 'VALIDACAO_FALHOU');
    const b = await criar();
    expect(esperar(await api.chamar('POST', `/v1/agendamentos/${b.id}/falta`, { token: gestor.token }), 200).body.status).toBe('FALTOU');
    esperar(await api.chamar('POST', `/v1/agendamentos/${b.id}/cancelar`, { token: gestor.token, body: { motivo: 'Tarde demais.' } }), 422, 'VALIDACAO_FALHOU');
  });

  it('bloqueio tira os horários do período; remover devolve', async () => {
    const [h] = (await horarios(gestor.token)).filter((x) => Date.parse(x.inicioEm) > agora + 2 * H);
    const b = esperar(await api.chamar('POST', '/v1/agenda/bloqueios', { token: gestor.token, body: { profissionalId: gestor.usuarioId, inicioEm: h.inicioEm, fimEm: h.fimEm, motivo: 'Reunião' } }), 201).body;
    expect((await horarios(gestor.token)).map((x) => x.inicioEm)).not.toContain(h.inicioEm);
    const lista = esperar(await api.chamar('GET', '/v1/agenda/bloqueios', { token: gestor.token, query: { de: hoje, ate: ate() } }), 200).body.itens;
    expect(lista.map((x: any) => x.id)).toContain(b.id);
    esperar(await api.chamar('POST', '/v1/agenda/bloqueios', { token: gestor.token, body: { profissionalId: null, inicioEm: h.fimEm, fimEm: h.inicioEm } }), 422);
    esperar(await api.chamar('DELETE', `/v1/agenda/bloqueios/${b.id}`, { token: gestor.token }), 204);
    expect((await horarios(gestor.token)).map((x) => x.inicioEm)).toContain(h.inicioEm);
    esperar(await api.chamar('GET', '/v1/agenda/bloqueios', { token: pacienteA.token, query: { de: hoje, ate: ate() } }), 403, 'PERMISSAO_NEGADA');
  });

  it('autoagendamento: o paciente marca só em horário livre; campos da equipe são recusados (RN-AGE-002)', async () => {
    if (!autoagendamento) {
      expect(esperar(await api.chamar('GET', '/v1/agenda/servicos', { token: pacienteA.token }), 200).body.itens).toEqual([]);
      esperar(await api.chamar('POST', '/v1/agendamentos', { token: pacienteA.token, idempotencia: true, body: { pacienteId: pacienteA.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId, inicioEm: new Date(agora + 72 * H).toISOString().replace(/\.\d{3}Z$/, 'Z') } }), 403, 'PERMISSAO_NEGADA');
      return;
    }
    const servicos = esperar(await api.chamar('GET', '/v1/agenda/servicos', { token: pacienteA.token }), 200).body.itens;
    expect(servicos.map((s: any) => s.id)).toContain(servico.id);
    expect(servicos.every((s: any) => s.autoagendavel && s.status === 'ATIVO')).toBe(true);
    const livres = await horarios(pacienteA.token);
    expect(livres.every((x) => Date.parse(x.inicioEm) >= agora + cfg.antecedenciaMinimaHoras * H - 60_000)).toBe(true);
    const h = livres[0];
    const base = { pacienteId: pacienteA.pacienteId, servicoId: servico.id, profissionalId: gestor.usuarioId };
    esperar(await api.chamar('POST', '/v1/agendamentos', { token: pacienteA.token, idempotencia: true, body: { ...base, inicioEm: h.inicioEm, encaixe: true } }), 422, 'VALIDACAO_FALHOU');
    const torto = new Date(Date.parse(h.inicioEm) + 7 * 60_000).toISOString().replace('.000Z', 'Z');
    esperar(await api.chamar('POST', '/v1/agendamentos', { token: pacienteA.token, idempotencia: true, body: { ...base, inicioEm: torto } }), 422, 'VALIDACAO_FALHOU');
    esperar(await api.chamar('POST', '/v1/agendamentos', { token: pacienteA.token, idempotencia: true, body: { ...base, pacienteId: pacienteB.pacienteId, inicioEm: h.inicioEm } }), 404);
    const a = esperar(await api.chamar('POST', '/v1/agendamentos', { token: pacienteA.token, idempotencia: true, body: { ...base, inicioEm: h.inicioEm } }), 201).body;
    expect(a).toMatchObject({ status: 'AGENDADO', origem: 'PACIENTE', observacao: null });
    esperar(await api.chamar('POST', '/v1/agendamentos', { token: pacienteB.token, idempotencia: true, body: { ...base, pacienteId: pacienteB.pacienteId, inicioEm: h.inicioEm } }), 409, 'HORARIO_INDISPONIVEL');
    // O profissional fica sabendo.
    const ntf = esperar(await api.chamar('GET', '/v1/notificacoes', { token: gestor.token }), 200).body.itens;
    expect(ntf.some((n: any) => n.tipo === 'AGENDAMENTO_CRIADO' && n.destino?.parametros?.agendamentoId === a.id)).toBe(true);
    esperar(await api.chamar('POST', `/v1/agendamentos/${a.id}/cancelar`, { token: gestor.token, body: { motivo: 'Limpeza do teste.' } }), 200);
  });

  it('equipe vê a agenda do dia no início e filtra a lista por profissional e status', async () => {
    const inicio = esperar(await api.chamar('GET', '/v1/inicio', { token: gestor.token }), 200).body.secoes;
    const dia = inicio.find((s: any) => s.tipo === 'AGENDA_DO_DIA');
    expect(dia?.dados.data).toBe(hoje);
    const lista = esperar(await api.chamar('GET', '/v1/agendamentos', { token: gestor.token, query: { de: hoje, ate: ate(), profissionalId: gestor.usuarioId, status: 'CANCELADO' } }), 200).body.itens;
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((a: any) => a.status === 'CANCELADO' && a.profissional.usuarioId === gestor.usuarioId)).toBe(true);
    const ordem = lista.map((a: any) => a.inicioEm);
    expect([...ordem].sort()).toEqual(ordem);
    esperar(await api.chamar('GET', '/v1/agendamentos', { token: gestor.token, query: { de: ate(), ate: hoje } }), 422, 'VALIDACAO_FALHOU');
  });

  it('configuração do módulo pelo gestor (PATCH /v1/organizacao)', async () => {
    const atual = esperar(await api.chamar('GET', '/v1/organizacao', { token: gestor.token }), 200);
    const mudou = esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, body: { agenda: { lembreteHorasAntes: 48 } }, headers: { 'If-Match': atual.headers.get('etag')! } }), 200);
    expect(mudou.body.agenda).toEqual({ ...cfg, lembreteHorasAntes: 48 });
    esperar(await api.chamar('PATCH', '/v1/organizacao', { token: gestor.token, body: { agenda: { lembreteHorasAntes: cfg.lembreteHorasAntes } }, headers: { 'If-Match': mudou.headers.get('etag')! } }), 200);
  });
});
