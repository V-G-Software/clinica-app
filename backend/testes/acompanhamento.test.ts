// Jobs da seção 14.3 e garantias que a suíte de conformidade não alcança (ela não controla o relógio do
// backend real): abrir, expirar com alerta, idempotência do job, cancelamento ao encerrar, falha com
// rollback e backoff, e corridas (duas respostas ao mesmo check-in, duas conversas para o mesmo paciente).
// Pré-requisito: banco migrado e semeado (pnpm migrar && pnpm org:criar --todos).
import { partesLocais, somarDias } from '@clinica/dominio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { novoId } from '../src/cripto.ts';
import { comOrg, pool, type Tx } from '../src/db.ts';
import type { Log } from '../src/http.ts';
import { orgPorSlug, type Org } from '../src/nucleo.ts';
import { criarAcompanhamento, encerrarAcompanhamento, responderCheckin } from '../src/servicos/acompanhamento.ts';
import { criarConversa } from '../src/servicos/chat.ts';
import { agendar, executarVencidos, registrarJob } from '../src/servicos/jobs.ts';

const log: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };
let org: Org;
const GESTOR = 'usr_ana';
const RESPOSTAS = { dor: 2, noite: 'BEM', sangramento: 'NENHUM', mediuTemperatura: false };

/** Paciente novo com conta própria (sem conversa nem acompanhamento) para cada teste. */
async function novoPaciente(tx: Tx) {
  const sufixo = novoId('t').slice(-10);
  const pac = `pac_teste_${sufixo}`, usr = `usr_teste_${sufixo}`;
  await tx.query(`INSERT INTO pacientes (organizacao_id, id, tipo, nome, nome_busca, contato) VALUES ($1,$2,'PESSOA',$3,$4,$5)`, [org.id, pac, `Teste ${sufixo}`, `teste ${sufixo}`, { email: `${sufixo}@exemplo.com` }]);
  await tx.query(`INSERT INTO usuarios (organizacao_id, id, email, nome, nome_exibicao, perfis, status) VALUES ($1,$2,$3,$4,$4,'{PACIENTE}','ATIVO')`, [org.id, usr, `${sufixo}@exemplo.com`, `Teste ${sufixo}`]);
  await tx.query(`INSERT INTO vinculos (organizacao_id, usuario_id, paciente_id, relacao) VALUES ($1,$2,$3,'PROPRIO')`, [org.id, usr, pac]);
  return { pac, usr };
}
/** Protocolo de 3 dias: check-in dias 1 e 2 às 09:00, expira em 12 h, lembrete em 2 h, alerta se expirar. */
async function novoProtocolo(tx: Tx) {
  const id = novoId('prt');
  await tx.query(`INSERT INTO protocolos (organizacao_id, id, versao, nome, duracao_dias, status, checkins, regras_alerta) VALUES ($1,$2,1,'Teste',3,'ATIVO',$3,$4)`, [org.id, id,
    JSON.stringify([{ dias: [1, 2], horario: '09:00', formulario: { id: 'frm_pos_op_diario', versao: 1 }, lembreteAposHoras: 2, expiraAposHoras: 12 }]),
    JSON.stringify([{ id: 'sem_resposta', tipo: 'CHECKIN_EXPIRADO', severidade: 'MEDIA', mensagem: 'Não respondeu' }])]);
  return id;
}
async function cenario() {
  return comOrg(org.id, async (tx) => {
    const { pac, usr } = await novoPaciente(tx);
    const protocoloId = await novoProtocolo(tx);
    const hoje = partesLocais(Date.now(), org.fuso).data;
    const a = await criarAcompanhamento(tx, org, { pacienteId: pac, protocoloId, dataInicio: hoje, equipeIds: [GESTOR], criadoPor: GESTOR, observacao: null }, log);
    const ck = (await tx.query('SELECT * FROM checkins WHERE organizacao_id = $1 AND acompanhamento_id = $2 ORDER BY dia', [org.id, a.id])).rows;
    return { a, pac, usr, ck };
  });
}
/** "Avança o relógio" só destes jobs e roda o worker uma vez. */
async function vencer(ids: string[]) {
  await comOrg(org.id, (tx) => tx.query(`UPDATE jobs SET executar_em = now() - interval '1 second' WHERE organizacao_id = $1 AND id = ANY($2)`, [org.id, ids]));
  while (await executarVencidos(log) > 0);
}
const ler = <T = any>(sql: string, params: unknown[]) => comOrg(org.id, async (tx) => (await tx.query(sql, params)).rows as T[]);

beforeAll(async () => { org = (await orgPorSlug('modelo-otorrino'))!; });
afterAll(async () => { await pool.end(); });

describe('jobs do acompanhamento (14.3)', () => {
  it('nasce com check-ins AGENDADOS e jobs de id determinístico', async () => {
    const { a, ck } = await cenario();
    expect(ck.map((c) => c.status)).toEqual(['AGENDADO', 'AGENDADO']);
    const jobs = (await ler<{ id: string }>('SELECT id FROM jobs WHERE organizacao_id = $1 AND (id LIKE $2 OR id LIKE $3 OR id LIKE $4) ORDER BY id', [org.id, `checkin:${ck[0].id}:%`, `checkin:${ck[1].id}:%`, `acompanhamento:${a.id}:%`])).map((j) => j.id);
    expect(jobs).toEqual(expect.arrayContaining([`checkin:${ck[0].id}:abrir`, `checkin:${ck[0].id}:expirar`, `checkin:${ck[0].id}:lembrete`, `acompanhamento:${a.id}:concluir`]));
    // Disponível no dia 1 às 09:00 no fuso da organização.
    expect(partesLocais(new Date(ck[0].disponivel_em).getTime(), org.fuso)).toMatchObject({ data: somarDias(partesLocais(Date.now(), org.fuso).data, 1), hora: '09:00' });
  });

  it('abrir: DISPONIVEL, notificação CHECKIN_DISPONIVEL para a conta do paciente e evento', async () => {
    const { ck, usr } = await cenario();
    await vencer([`checkin:${ck[0].id}:abrir`]);
    expect((await ler('SELECT status FROM checkins WHERE organizacao_id = $1 AND id = $2', [org.id, ck[0].id]))[0].status).toBe('DISPONIVEL');
    expect((await ler('SELECT tipo FROM notificacoes WHERE organizacao_id = $1 AND usuario_id = $2', [org.id, usr])).map((n) => n.tipo)).toContain('CHECKIN_DISPONIVEL');
    const ev = await ler(`SELECT tipo FROM eventos WHERE organizacao_id = $1 AND $2 = ANY(destinatarios) AND tipo = 'acompanhamento.checkin.disponivel'`, [org.id, usr]);
    expect(ev).toHaveLength(1);
    expect((await ler('SELECT 1 FROM jobs WHERE organizacao_id = $1 AND id = $2', [org.id, `checkin:${ck[0].id}:abrir`]))).toHaveLength(0);
  });

  it('expirar sem resposta: EXPIRADO e um alerta CHECKIN_EXPIRADO — rodar o job de novo não duplica', async () => {
    const { a, ck } = await cenario();
    await vencer([`checkin:${ck[0].id}:abrir`]);
    await vencer([`checkin:${ck[0].id}:expirar`]);
    expect((await ler('SELECT status FROM checkins WHERE organizacao_id = $1 AND id = $2', [org.id, ck[0].id]))[0].status).toBe('EXPIRADO');
    // Retry/duplicata do mesmo job (ex.: worker caiu depois do efeito e antes de concluir).
    await comOrg(org.id, (tx) => agendar(tx, org.id, `checkin:${ck[0].id}:expirar`, 'checkin.expirar', Date.now() - 1000, { checkinId: ck[0].id }));
    while (await executarVencidos(log) > 0);
    const alertas = await ler('SELECT regra_id, status FROM alertas WHERE organizacao_id = $1 AND acompanhamento_id = $2', [org.id, a.id]);
    expect(alertas).toEqual([{ regra_id: 'sem_resposta', status: 'ABERTO' }]);
  });

  it('check-in respondido não expira nem lembra (os jobs dele são cancelados)', async () => {
    const { ck, usr } = await cenario();
    await vencer([`checkin:${ck[0].id}:abrir`]);
    await comOrg(org.id, (tx) => responderCheckin(tx, org, ck[0].id, RESPOSTAS, usr, log));
    expect(await ler('SELECT id FROM jobs WHERE organizacao_id = $1 AND id LIKE $2', [org.id, `checkin:${ck[0].id}:%`])).toEqual([]);
  });

  it('encerrar cancela check-ins e todos os jobs pendentes do acompanhamento', async () => {
    const { a, ck } = await cenario();
    await comOrg(org.id, async (tx) => {
      const atual = (await tx.query('SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0];
      await encerrarAcompanhamento(tx, org, atual, 'Teste', GESTOR, log);
    });
    expect((await ler('SELECT status FROM checkins WHERE organizacao_id = $1 AND acompanhamento_id = $2', [org.id, a.id])).every((c) => c.status === 'CANCELADO')).toBe(true);
    const pendentes = await ler('SELECT id FROM jobs WHERE organizacao_id = $1 AND (id LIKE $2 OR id LIKE $3 OR id LIKE $4)', [org.id, `acompanhamento:${a.id}:%`, `checkin:${ck[0].id}:%`, `checkin:${ck[1].id}:%`]);
    expect(pendentes).toEqual([]);
  });

  it('job que falha: efeito desfeito (mesma transação), job volta com backoff e o erro registrado', async () => {
    const marca = novoId('falha');
    registrarJob('teste.falha', async (tx, orgId) => {
      await tx.query(`INSERT INTO auditoria (organizacao_id, acao, recurso, recurso_id) VALUES ($1, 'TESTE', 'job', $2)`, [orgId, marca]);
      throw new Error('falha proposital');
    });
    await comOrg(org.id, (tx) => agendar(tx, org.id, `teste:${marca}`, 'teste.falha', Date.now() - 1000));
    await executarVencidos(log);
    expect(await ler('SELECT 1 FROM auditoria WHERE organizacao_id = $1 AND recurso_id = $2', [org.id, marca])).toEqual([]);
    const [j] = await ler(`SELECT tentativas, ultimo_erro, bloqueado_ate > now() AS adiado, falhou_em FROM jobs WHERE organizacao_id = $1 AND id = $2`, [org.id, `teste:${marca}`]);
    expect(j).toEqual({ tentativas: 1, ultimo_erro: 'falha proposital', adiado: true, falhou_em: null });
    // Adiado: o próximo ciclo não pega de novo antes do backoff.
    await executarVencidos(log);
    expect((await ler('SELECT tentativas FROM jobs WHERE organizacao_id = $1 AND id = $2', [org.id, `teste:${marca}`]))[0].tentativas).toBe(1);
    await comOrg(org.id, (tx) => tx.query('DELETE FROM jobs WHERE organizacao_id = $1 AND id = $2', [org.id, `teste:${marca}`]));
  });
});

describe('concorrência', () => {
  it('duas respostas simultâneas ao mesmo check-in: uma grava, a outra recebe CHECKIN_JA_RESPONDIDO', async () => {
    const { ck, usr } = await cenario();
    await vencer([`checkin:${ck[0].id}:abrir`]);
    const r = await Promise.allSettled([1, 2].map(() => comOrg(org.id, (tx) => responderCheckin(tx, org, ck[0].id, RESPOSTAS, usr, log))));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejeitada = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejeitada.reason.codigo).toBe('CHECKIN_JA_RESPONDIDO');
  });

  it('duas criações simultâneas de conversa para o mesmo paciente: uma conversa ATIVA só (RN-CHA-001)', async () => {
    const { pac, usr } = await comOrg(org.id, (tx) => novoPaciente(tx));
    const r = await Promise.all([1, 2].map(() => comOrg(org.id, (tx) => criarConversa(tx, org, pac, [GESTOR, usr]))));
    expect(r[0].conversa.id).toBe(r[1].conversa.id);
    expect(r.filter((x) => x.criada)).toHaveLength(1);
    expect(await ler(`SELECT id FROM conversas WHERE organizacao_id = $1 AND paciente_id = $2 AND status = 'ATIVA'`, [org.id, pac])).toHaveLength(1);
  });
});
