// Agenda (ADR-0016): garantias que a suíte de conformidade não alcança — concorrência (a constraint de
// exclusão do banco deixa passar só uma de duas marcações simultâneas), lembrete como job (dispara,
// some ao cancelar, acompanha a remarcação), a ligação procedimento ↔ acompanhamento (atomicidade e FKs)
// e o seed da linha do tempo.
// Pré-requisito: banco migrado e semeado (pnpm migrar && pnpm org:criar --todos).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { novoId } from '../src/cripto.ts';
import { comOrg, pool, type Tx } from '../src/db.ts';
import type { Log } from '../src/http.ts';
import { orgPorSlug, type Org } from '../src/nucleo.ts';
import { cancelar, criarAgendamento, finalizar, remarcar } from '../src/servicos/agenda.ts';
import { executarVencidos } from '../src/servicos/jobs.ts';

const log: Log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const H = 3_600_000;
const PROF = 'usr_carlos';
let org: Org;
let servico: any;
const ler = <T = any>(sql: string, params: unknown[]) => comOrg(org.id, async (tx) => (await tx.query(sql, params)).rows as T[]);

/** Paciente novo com conta, para não depender do estado do seed. */
async function novoPaciente(tx: Tx) {
  const sufixo = novoId('t').slice(-10);
  const pac = `pac_ag_${sufixo}`, usr = `usr_ag_${sufixo}`;
  await tx.query(`INSERT INTO pacientes (organizacao_id, id, tipo, nome, nome_busca, contato) VALUES ($1,$2,'PESSOA',$3,$4,'{}')`, [org.id, pac, `Agenda ${sufixo}`, `agenda ${sufixo}`]);
  await tx.query(`INSERT INTO usuarios (organizacao_id, id, email, nome, nome_exibicao, perfis, status) VALUES ($1,$2,$3,$4,$4,'{PACIENTE}','ATIVO')`, [org.id, usr, `${sufixo}@exemplo.com`, `Agenda ${sufixo}`]);
  await tx.query(`INSERT INTO vinculos (organizacao_id, usuario_id, paciente_id, relacao) VALUES ($1,$2,$3,'PROPRIO')`, [org.id, usr, pac]);
  return { pac, usr };
}
/** Horário único por teste, longe do seed e da conformidade: daqui a ~200 dias, minuto aleatório. */
const horarioLivre = () => new Date(Math.floor((Date.now() + 200 * 24 * H + Math.random() * 30 * 24 * H) / (30 * 60_000)) * 30 * 60_000);

beforeAll(async () => {
  org = (await orgPorSlug('modelo-otorrino'))!;
  servico = await comOrg(org.id, async (tx) => (await tx.query(`INSERT INTO servicos (organizacao_id, id, nome, categoria, duracao_minutos, autoagendavel, profissionais_ids)
    VALUES ($1,$2,'Teste de agenda','CONSULTA',30,true,$3) RETURNING *`, [org.id, novoId('srv'), [PROF]])).rows[0]);
});
afterAll(async () => { await pool.end(); });

describe('agenda: concorrência (RN-AGE-001 no banco)', () => {
  it('duas marcações simultâneas no mesmo horário: uma passa, a outra recebe HORARIO_INDISPONIVEL', async () => {
    const { pac } = await comOrg(org.id, novoPaciente);
    const inicio = horarioLivre();
    // Chama o serviço direto (sem a checagem prévia do handler): só o banco decide.
    const tentar = () => comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico, profissionalId: PROF, inicio, origem: 'EQUIPE', porId: 'usr_julia' }, log));
    const r = await Promise.allSettled([tentar(), tentar(), tentar()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const erros = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => x.reason.codigo);
    expect(erros).toEqual(['HORARIO_INDISPONIVEL', 'HORARIO_INDISPONIVEL']);
    const n = await ler('SELECT 1 FROM agendamentos WHERE organizacao_id = $1 AND profissional_id = $2 AND inicio_em = $3', [org.id, PROF, inicio]);
    expect(n).toHaveLength(1);
  });

  it('encaixe pode sobrepor; cancelado libera o horário', async () => {
    const { pac } = await comOrg(org.id, novoPaciente);
    const inicio = horarioLivre();
    const a = await comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico, profissionalId: PROF, inicio, origem: 'EQUIPE', porId: 'usr_julia' }, log));
    await comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico, profissionalId: PROF, inicio, origem: 'EQUIPE', porId: 'usr_julia', encaixe: true }, log));
    await comOrg(org.id, async (tx) => cancelar(tx, org, (await tx.query('SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0], 'usr_julia', 'Teste.', false, log));
    await expect(comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico, profissionalId: PROF, inicio, origem: 'EQUIPE', porId: 'usr_julia' }, log))).resolves.toBeTruthy();
  });
});

describe('agenda: lembrete como job', () => {
  const job = (id: string) => ler('SELECT executar_em FROM jobs WHERE organizacao_id = $1 AND id = $2', [org.id, `agendamento:${id}:lembrete`]);

  it('é agendado lembreteHorasAntes antes; ao vencer, avisa a conta do paciente uma vez (AGENDAMENTO_LEMBRETE)', async () => {
    const { pac, usr } = await comOrg(org.id, novoPaciente);
    const inicio = horarioLivre();
    const a = await comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico, profissionalId: PROF, inicio, origem: 'EQUIPE', porId: 'usr_julia' }, log));
    const [j] = await job(a.id);
    const horas = (org.modulos.find((m) => m.id === 'agenda')!.config as any).lembreteHorasAntes;
    expect(+new Date(j.executar_em)).toBe(+inicio - horas * H);
    await comOrg(org.id, (tx) => tx.query(`UPDATE jobs SET executar_em = now() - interval '1 second' WHERE organizacao_id = $1 AND id = $2`, [org.id, `agendamento:${a.id}:lembrete`]));
    while (await executarVencidos(log) > 0);
    const ntf = await ler(`SELECT tipo, texto, destino FROM notificacoes WHERE organizacao_id = $1 AND usuario_id = $2 AND tipo = 'AGENDAMENTO_LEMBRETE'`, [org.id, usr]);
    expect(ntf).toHaveLength(1);
    expect(ntf[0].destino).toEqual({ tela: 'agenda.detalhe', parametros: { agendamentoId: a.id } });
    expect(ntf[0].texto).toMatch(/Confirme sua presença/);
    expect(await job(a.id)).toHaveLength(0);
  });

  it('cancelar remove o lembrete; remarcar reagenda para o novo horário', async () => {
    const { pac } = await comOrg(org.id, novoPaciente);
    const ini1 = horarioLivre();
    const a = await comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico, profissionalId: PROF, inicio: ini1, origem: 'EQUIPE', porId: 'usr_julia' }, log));
    const ini2 = new Date(+ini1 + 3 * 24 * H);
    await comOrg(org.id, async (tx) => remarcar(tx, org, (await tx.query('SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0], 'usr_julia', { inicio: ini2, profissionalId: PROF, duracaoMinutos: 30, encaixe: false, motivo: null }, log));
    const horas = (org.modulos.find((m) => m.id === 'agenda')!.config as any).lembreteHorasAntes;
    expect(+new Date((await job(a.id))[0].executar_em)).toBe(+ini2 - horas * H);
    await comOrg(org.id, async (tx) => cancelar(tx, org, (await tx.query('SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0], 'usr_julia', 'Teste.', false, log));
    expect(await job(a.id)).toHaveLength(0);
  });
});

describe('agenda: procedimento ↔ acompanhamento (RN-AGE-008)', () => {
  let procedimento: any;
  beforeAll(async () => {
    procedimento = await comOrg(org.id, async (tx) => (await tx.query(`INSERT INTO servicos (organizacao_id, id, nome, categoria, duracao_minutos, autoagendavel, profissionais_ids, protocolo_id)
      VALUES ($1,$2,'Procedimento de teste','PROCEDIMENTO',60,false,$3,'prt_septo7') RETURNING *`, [org.id, novoId('srv'), [PROF]])).rows[0]);
  });

  it('atômico: se o acompanhamento falha, o agendamento não fica pela metade', async () => {
    const { pac } = await comOrg(org.id, novoPaciente);
    const id = novoId('agd');
    await expect(comOrg(org.id, (tx) => criarAgendamento(tx, org, { id, pacienteId: pac, servico: procedimento, profissionalId: PROF, inicio: horarioLivre(), origem: 'EQUIPE', porId: 'usr_julia', encaixe: true,
      acompanhamento: { protocoloId: 'prt_inexistente', equipeIds: [PROF] } }, log))).rejects.toThrow();
    expect(await ler('SELECT 1 FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, id])).toHaveLength(0);
  });

  it('FK no commit: agendamento não aponta para acompanhamento inexistente', async () => {
    const { pac } = await comOrg(org.id, novoPaciente);
    await expect(comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico: procedimento, profissionalId: PROF, inicio: horarioLivre(), origem: 'EQUIPE', porId: 'usr_julia', encaixe: true,
      acompanhamentoId: 'acp_inexistente' }, log))).rejects.toThrow(/agendamentos_acompanhamento_fk/);
  });

  it('remarcar para outro dia encerra e recria; falta encerra o atual', async () => {
    const { pac } = await comOrg(org.id, novoPaciente);
    const ini = horarioLivre();
    const a = await comOrg(org.id, (tx) => criarAgendamento(tx, org, { pacienteId: pac, servico: procedimento, profissionalId: PROF, inicio: ini, origem: 'EQUIPE', porId: 'usr_julia', encaixe: true,
      acompanhamento: { protocoloId: 'prt_septo7', equipeIds: [PROF] } }, log));
    const [acp1] = await ler('SELECT id, status, agendamento_id FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.acompanhamento_id]);
    expect(acp1).toMatchObject({ status: 'AGENDADO', agendamento_id: a.id });
    const r = await comOrg(org.id, async (tx) => remarcar(tx, org, (await tx.query('SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0], 'usr_julia', { inicio: new Date(+ini + 2 * 24 * H), profissionalId: PROF, duracaoMinutos: 60, encaixe: true, motivo: null }, log));
    expect(r.acompanhamento_id).not.toBe(acp1.id);
    const st = Object.fromEntries((await ler('SELECT id, status FROM acompanhamentos WHERE organizacao_id = $1 AND agendamento_id = $2', [org.id, a.id])).map((x) => [x.id, x.status]));
    expect(st).toEqual({ [acp1.id]: 'ENCERRADO', [r.acompanhamento_id]: 'AGENDADO' });
    // A falta só vale depois do início: simula o horário passado direto no banco.
    await comOrg(org.id, (tx) => tx.query(`UPDATE agendamentos SET inicio_em = now() - interval '2 hours', fim_em = now() - interval '1 hour' WHERE organizacao_id = $1 AND id = $2`, [org.id, a.id]));
    await comOrg(org.id, async (tx) => finalizar(tx, org, (await tx.query('SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, a.id])).rows[0], 'usr_julia', 'FALTOU', log));
    const [acp2] = await ler('SELECT status, motivo_encerramento FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, r.acompanhamento_id]);
    expect(acp2.status).toBe('ENCERRADO');
    expect(acp2.motivo_encerramento).toMatch(/Falta registrada/);
  });
});

describe('agenda: seed da linha do tempo', () => {
  it('reproduz os estados do cenário (cirurgias, retornos, falta, cancelamento)', async () => {
    const st = Object.fromEntries((await ler(`SELECT id, status FROM agendamentos WHERE organizacao_id = $1 AND id = ANY($2)`, [org.id, ['agd_rafael_cirurgia', 'agd_beatriz_cirurgia', 'agd_helena_retorno', 'agd_sonia_consulta', 'agd_paulo_consulta', 'agd_marcos_retorno']])).map((x) => [x.id, x.status]));
    expect(st).toMatchObject({
      agd_rafael_cirurgia: 'REALIZADO', agd_beatriz_cirurgia: 'CONFIRMADO', agd_helena_retorno: 'REALIZADO',
      agd_sonia_consulta: 'FALTOU', agd_paulo_consulta: 'CANCELADO', agd_marcos_retorno: 'CONFIRMADO',
    });
    const [beatriz] = await ler('SELECT historico FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [org.id, 'agd_beatriz_cirurgia']);
    expect(beatriz.historico.map((h: any) => h.acao)).toEqual(['CRIADO', 'CONFIRMADO']);
  });
  it('liga as cirurgias do cenário aos acompanhamentos, nos dois sentidos', async () => {
    const ag = await ler(`SELECT id, acompanhamento_id FROM agendamentos WHERE organizacao_id = $1 AND id = ANY($2) ORDER BY id`, [org.id, ['agd_beatriz_cirurgia', 'agd_rafael_cirurgia']]);
    expect(ag).toEqual([{ id: 'agd_beatriz_cirurgia', acompanhamento_id: 'acp_beatriz' }, { id: 'agd_rafael_cirurgia', acompanhamento_id: 'acp_rafael' }]);
    const acp = await ler(`SELECT id, agendamento_id FROM acompanhamentos WHERE organizacao_id = $1 AND id = ANY($2) ORDER BY id`, [org.id, ['acp_beatriz', 'acp_rafael']]);
    expect(acp).toEqual([{ id: 'acp_beatriz', agendamento_id: 'agd_beatriz_cirurgia' }, { id: 'acp_rafael', agendamento_id: 'agd_rafael_cirurgia' }]);
  });
});
