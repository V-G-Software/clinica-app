// Regras do acompanhamento (RN-ACO) e os jobs da seção 14.3. Toda função recebe a transação com o
// contexto da organização; jobs são idempotentes (conferem o estado antes de agir).
import { HORA, cap, campoVisivel, compara, configModulo, flex, localParaUtc, somarDias, temModulo, validarRespostas } from '@clinica/dominio';
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { ErroApi } from '../erros.ts';
import { emitir } from '../eventos.ts';
import type { Log } from '../http.ts';
import type { Org } from '../nucleo.ts';
import { criarConversa, postarMensagem } from './chat.ts';
import { agendar, cancelarPrefixo, registrarJob } from './jobs.ts';
import { avisarContadores, notificar } from './notificar.ts';
import { contasDoPaciente, equipeAtiva, orgPorId } from './refs.ts';

const termo = (org: Org, chave: string) => org.termos[chave] ?? { singular: chave, plural: `${chave}s`, genero: 'M' as const };
const interessados = async (tx: Tx, org: Org, a: any) => [...await equipeAtiva(tx, org, a.equipe_ids), ...await contasDoPaciente(tx, org, a.paciente_id)];
const atualizado = async (tx: Tx, org: Org, a: any) => emitir(tx, org.id, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, await interessados(tx, org, a));

export const protocoloVersao = (tx: Tx, orgId: string, id: string, versao?: number) =>
  um(tx, `SELECT * FROM protocolos WHERE organizacao_id = $1 AND id = $2 ${versao ? 'AND versao = $3' : 'ORDER BY versao DESC LIMIT 1'}`, versao ? [orgId, id, versao] : [orgId, id]);
/** Forma pública do protocolo (também é a cópia congelada guardada no acompanhamento). */
export const protocoloPublico = (p: any) => ({
  id: p.id, versao: p.versao, nome: p.nome, descricao: p.descricao ?? null, duracaoDias: p.duracao_dias, status: p.status,
  checkins: p.checkins, orientacoes: p.orientacoes ?? [], regrasAlerta: p.regras_alerta ?? [],
});

export interface NovoAcompanhamento { id?: string; pacienteId: string; protocoloId: string; dataInicio: string; equipeIds: string[]; criadoPor: string; observacao: string | null; criadoEm?: string }

export async function criarAcompanhamento(tx: Tx, org: Org, d: NovoAcompanhamento, log: Log, agora = Date.now()) {
  const prot = (await protocoloVersao(tx, org.id, d.protocoloId))!;
  const protocolo = protocoloPublico(prot); // RN-ACO-003: congela a versão vigente
  const fuso = org.fuso;
  const inicio = localParaUtc(d.dataInicio, '00:00', fuso);
  const a = (await um(tx, `INSERT INTO acompanhamentos (organizacao_id, id, paciente_id, protocolo_id, protocolo_versao, protocolo, data_inicio, equipe_ids, status, observacao, criado_por, criado_em)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now())) RETURNING *`,
    [org.id, d.id ?? novoId('acp'), d.pacienteId, prot.id, prot.versao, protocolo, d.dataInicio, [...new Set(d.equipeIds)], inicio <= agora ? 'ATIVO' : 'AGENDADO', d.observacao, d.criadoPor, d.criadoEm ?? null]))!;
  let fimMs = localParaUtc(somarDias(d.dataInicio, protocolo.duracaoDias + 1), '00:00', fuso);
  const disponiveis: any[] = [];

  // RN-ACO-002: todos os check-ins nascem agora, com disponivelEm/expiraEm e a versão do formulário copiada.
  for (const prog of protocolo.checkins) {
    const f = await um(tx, 'SELECT id, versao, titulo, finalidade, campos, publicado_em FROM formularios WHERE organizacao_id = $1 AND id = $2 AND versao = $3', [org.id, prog.formulario.id, prog.formulario.versao]);
    const formulario = { id: f.id, versao: f.versao, titulo: f.titulo, finalidade: f.finalidade, campos: f.campos, publicadoEm: new Date(f.publicado_em).toISOString().replace(/\.\d{3}Z$/, 'Z') };
    for (const dia of [...prog.dias].sort((x: number, y: number) => x - y)) {
      const disp = localParaUtc(somarDias(d.dataInicio, dia), prog.horario, fuso);
      const exp = disp + prog.expiraAposHoras * HORA;
      fimMs = Math.max(fimMs, exp);
      // Data retroativa: já vencido fica EXPIRADO sem alerta nem notificação; já aberto nasce DISPONIVEL.
      const status = exp <= agora ? 'EXPIRADO' : disp <= agora ? 'DISPONIVEL' : 'AGENDADO';
      const c = (await um(tx, `INSERT INTO checkins (organizacao_id, id, acompanhamento_id, paciente_id, dia, status, disponivel_em, expira_em, formulario, lembrete_apos_horas)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [org.id, novoId('chk'), a.id, a.paciente_id, dia, status, new Date(disp), new Date(exp), formulario, prog.lembreteAposHoras ?? null]))!;
      if (status === 'EXPIRADO') continue;
      if (status === 'AGENDADO') await agendar(tx, org.id, `checkin:${c.id}:abrir`, 'checkin.abrir', disp, { checkinId: c.id });
      else disponiveis.push(c);
      await agendar(tx, org.id, `checkin:${c.id}:expirar`, 'checkin.expirar', exp, { checkinId: c.id });
      const lembrete = c.lembrete_apos_horas ? disp + c.lembrete_apos_horas * HORA : null;
      if (lembrete && lembrete > agora) await agendar(tx, org.id, `checkin:${c.id}:lembrete`, 'checkin.lembrete', lembrete, { checkinId: c.id });
    }
  }
  for (const [i, o] of (protocolo.orientacoes ?? []).entries()) {
    const em = localParaUtc(somarDias(d.dataInicio, o.dia), o.horario, fuso);
    if (em > agora) await agendar(tx, org.id, `acompanhamento:${a.id}:orientacao:${i}`, 'acompanhamento.orientacao', em, { acompanhamentoId: a.id, indice: i });
  }
  if (a.status === 'AGENDADO') await agendar(tx, org.id, `acompanhamento:${a.id}:ativar`, 'acompanhamento.ativar', inicio, { acompanhamentoId: a.id });
  await agendar(tx, org.id, `acompanhamento:${a.id}:concluir`, 'acompanhamento.concluir', Math.max(fimMs, agora), { acompanhamentoId: a.id });

  // RN-CHA-001: liga à conversa ativa do paciente (cria se não houver) e registra a mensagem SISTEMA.
  const contas = await contasDoPaciente(tx, org, a.paciente_id);
  if (temModulo(org.modulos, 'chat')) {
    const { conversa } = await criarConversa(tx, org, a.paciente_id, [...a.equipe_ids, ...contas]);
    await tx.query('UPDATE acompanhamentos SET conversa_id = $3 WHERE organizacao_id = $1 AND id = $2', [org.id, a.id, conversa.id]);
    a.conversa_id = conversa.id;
    const t = termo(org, 'acompanhamento');
    await postarMensagem(tx, org, conversa, { tipo: 'SISTEMA', autorId: null, texto: `${cap(t.singular)} ${flex(t, 'iniciado', 'iniciada')}: ${protocolo.nome}.`, referencia: { tipo: 'ACOMPANHAMENTO', id: a.id, resumo: protocolo.nome, temAlerta: false } }, log);
  }
  await atualizado(tx, org, a);
  for (const uid of contas)
    await notificar(tx, org, uid, { tipo: 'ACOMPANHAMENTO_INICIADO', titulo: protocolo.nome, texto: 'A equipe iniciou o seu acompanhamento.', destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } }, log);
  for (const c of disponiveis) await avisarCheckinDisponivel(tx, org, a, c, log);
  return a;
}

async function avisarCheckinDisponivel(tx: Tx, org: Org, a: any, c: any, log: Log) {
  const contas = await contasDoPaciente(tx, org, a.paciente_id);
  await emitir(tx, org.id, 'acompanhamento.checkin.disponivel', { checkinId: c.id, acompanhamentoId: a.id }, contas);
  const t = termo(org, 'checkin');
  for (const uid of contas)
    await notificar(tx, org, uid, { tipo: 'CHECKIN_DISPONIVEL', titulo: `${cap(t.singular)} disponível`, texto: `${flex(t, 'O', 'A')} ${t.singular} de hoje já pode ser respondid${flex(t, 'o', 'a')}.`, destino: { tela: 'acompanhamento.checkin', parametros: { checkinId: c.id } } }, log);
}

const carregar = async (tx: Tx, orgId: string, checkinId: string) => {
  const c = await um(tx, 'SELECT * FROM checkins WHERE organizacao_id = $1 AND id = $2 FOR UPDATE', [orgId, checkinId]);
  const a = c && await um(tx, 'SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [orgId, c.acompanhamento_id]);
  return { c, a };
};

// ─────────── Jobs (14.3) ───────────
registrarJob('checkin.abrir', async (tx, orgId, { checkinId }, log) => {
  const { c, a } = await carregar(tx, orgId, checkinId);
  if (!c || c.status !== 'AGENDADO' || !a || a.status === 'ENCERRADO') return;
  const org = await orgPorId(orgId);
  await tx.query(`UPDATE checkins SET status = 'DISPONIVEL' WHERE organizacao_id = $1 AND id = $2`, [orgId, c.id]);
  await avisarCheckinDisponivel(tx, org, a, c, log);
  await avisarContadores(tx, org, await equipeAtiva(tx, org, a.equipe_ids));
});
registrarJob('checkin.lembrete', async (tx, orgId, { checkinId }, log) => {
  const { c } = await carregar(tx, orgId, checkinId);
  if (!c || c.status !== 'DISPONIVEL') return;
  const org = await orgPorId(orgId);
  const t = termo(org, 'checkin');
  for (const uid of await contasDoPaciente(tx, org, c.paciente_id))
    await notificar(tx, org, uid, { tipo: 'CHECKIN_LEMBRETE', titulo: `Lembrete de ${t.singular}`, texto: `Você ainda não respondeu ${flex(t, 'o', 'a')} ${t.singular} de hoje.`, destino: { tela: 'acompanhamento.checkin', parametros: { checkinId: c.id } } }, log);
});
registrarJob('checkin.expirar', async (tx, orgId, { checkinId }, log) => {
  const { c, a } = await carregar(tx, orgId, checkinId);
  if (!c || c.status !== 'DISPONIVEL' || !a) return;
  const org = await orgPorId(orgId);
  await tx.query(`UPDATE checkins SET status = 'EXPIRADO' WHERE organizacao_id = $1 AND id = $2`, [orgId, c.id]);
  for (const regra of a.protocolo.regrasAlerta ?? []) if (regra.tipo === 'CHECKIN_EXPIRADO') await criarAlerta(tx, org, a, c, regra, log);
  await atualizado(tx, org, a);
  await avisarContadores(tx, org, await interessados(tx, org, a));
});
registrarJob('acompanhamento.orientacao', async (tx, orgId, { acompanhamentoId, indice }, log) => {
  const org = await orgPorId(orgId);
  const a = await um(tx, 'SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [orgId, acompanhamentoId]);
  if (!a || a.status === 'ENCERRADO' || !temModulo(org.modulos, 'chat') || !configModulo(org.modulos, 'acompanhamento').publicarCheckinNaConversa) return;
  const conversa = a.conversa_id && await um(tx, `SELECT * FROM conversas WHERE organizacao_id = $1 AND id = $2 AND status = 'ATIVA'`, [orgId, a.conversa_id]);
  const texto = a.protocolo.orientacoes?.[indice]?.texto;
  if (conversa && texto) await postarMensagem(tx, org, conversa, { tipo: 'ORIENTACAO', autorId: null, texto }, log);
});
registrarJob('acompanhamento.ativar', async (tx, orgId, { acompanhamentoId }) => {
  const a = await um(tx, `UPDATE acompanhamentos SET status = 'ATIVO', versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 AND status = 'AGENDADO' RETURNING *`, [orgId, acompanhamentoId]);
  if (a) await atualizado(tx, await orgPorId(orgId), a);
});
registrarJob('acompanhamento.concluir', async (tx, orgId, { acompanhamentoId }, log) => {
  const a = await um(tx, `UPDATE acompanhamentos SET status = 'CONCLUIDO', versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 AND status IN ('ATIVO','AGENDADO') RETURNING *`, [orgId, acompanhamentoId]);
  if (!a) return;
  const org = await orgPorId(orgId);
  await atualizado(tx, org, a);
  for (const uid of await contasDoPaciente(tx, org, a.paciente_id))
    await notificar(tx, org, uid, { tipo: 'ACOMPANHAMENTO_CONCLUIDO', titulo: a.protocolo.nome, texto: 'Seu acompanhamento foi concluído. Obrigado por responder!', destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } }, log);
});

/** RN-ACO-008: encerra, cancela check-ins futuros e jobs pendentes, avisa na conversa. */
export async function encerrarAcompanhamento(tx: Tx, org: Org, a: any, motivo: string, porId: string, log: Log) {
  const r = (await um(tx, `UPDATE acompanhamentos SET status = 'ENCERRADO', motivo_encerramento = $3, encerrado_por = $4, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [org.id, a.id, motivo, porId]))!;
  await cancelarPrefixo(tx, org.id, `acompanhamento:${a.id}:`);
  const cancelados = await todos(tx, `UPDATE checkins SET status = 'CANCELADO' WHERE organizacao_id = $1 AND acompanhamento_id = $2 AND status IN ('AGENDADO','DISPONIVEL') RETURNING id`, [org.id, a.id]);
  for (const c of cancelados) await cancelarPrefixo(tx, org.id, `checkin:${c.id}:`);
  const conversa = temModulo(org.modulos, 'chat') && a.conversa_id && await um(tx, `SELECT * FROM conversas WHERE organizacao_id = $1 AND id = $2 AND status = 'ATIVA'`, [org.id, a.conversa_id]);
  const t = termo(org, 'acompanhamento');
  if (conversa) await postarMensagem(tx, org, conversa, { tipo: 'SISTEMA', autorId: null, texto: `${cap(t.singular)} ${flex(t, 'encerrado', 'encerrada')} pela equipe.` }, log);
  await atualizado(tx, org, r);
  await avisarContadores(tx, org, await interessados(tx, org, r));
  return r;
}

export async function criarAlerta(tx: Tx, org: Org, a: any, c: any, regra: any, log: Log) {
  const alerta = await um(tx, `INSERT INTO alertas (organizacao_id, id, acompanhamento_id, checkin_id, paciente_id, regra_id, severidade, mensagem, status)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ABERTO') ON CONFLICT (organizacao_id, checkin_id, regra_id) DO NOTHING RETURNING *`,
    [org.id, novoId('alr'), a.id, c?.id ?? null, a.paciente_id, regra.id, regra.severidade, regra.mensagem]);
  if (!alerta) return null;
  const equipe = await equipeAtiva(tx, org, a.equipe_ids, 'acompanhamento.alerta.ler');
  await emitir(tx, org.id, 'acompanhamento.alerta.criado', { alertaId: alerta.id, acompanhamentoId: a.id }, equipe);
  const paciente = (await um(tx, 'SELECT nome FROM pacientes WHERE organizacao_id = $1 AND id = $2', [org.id, a.paciente_id]))?.nome;
  for (const uid of equipe)
    await notificar(tx, org, uid, { tipo: 'ALERTA_CRIADO', titulo: regra.mensagem, texto: `${paciente}: ${regra.mensagem}.`, destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } }, log);
  return alerta;
}

function valorLegivel(campo: any, v: any): string {
  if (campo.opcoes) return (Array.isArray(v) ? v : [v]).map((x) => campo.opcoes.find((o: any) => o.valor === x)?.rotulo ?? x).join(', ').toLowerCase();
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return String(v);
}
export function resumoRespostas(dia: number, formulario: any, respostas: Record<string, unknown>) {
  const partes = [`Dia ${dia}`];
  for (const campo of formulario.campos) {
    if (partes.length >= 4) break;
    const v = respostas[campo.id];
    if (v === undefined || !['ESCALA', 'NUMERO', 'ESCOLHA_UNICA'].includes(campo.tipo)) continue;
    partes.push(`${campo.id.replace(/[A-Z]/g, (l: string) => ` ${l.toLowerCase()}`)} ${valorLegivel(campo, v)}`);
  }
  return partes.join(' · ');
}

/** Resposta do check-in (RN-ACO-004/005/007). A linha é travada: duas respostas simultâneas não passam. */
export async function responderCheckin(tx: Tx, org: Org, checkinId: string, respostas: Record<string, unknown>, usuarioId: string, log: Log) {
  const { c, a } = await carregar(tx, org.id, checkinId);
  if (c.status === 'RESPONDIDO') throw new ErroApi('CHECKIN_JA_RESPONDIDO', 'Este check-in já foi respondido. Para completar, use a conversa.');
  if (c.status !== 'DISPONIVEL') throw new ErroApi('CHECKIN_INDISPONIVEL', 'Este check-in não está disponível para resposta.');
  const fotos = c.formulario.campos.filter((x: any) => x.tipo === 'FOTO').flatMap((x: any) => (Array.isArray(respostas[x.id]) ? respostas[x.id] as string[] : []));
  const livres = new Set((await todos(tx, `SELECT id FROM arquivos WHERE organizacao_id = $1 AND id = ANY($2) AND dono_id = $3 AND status = 'DISPONIVEL' AND usado_em IS NULL`,
    [org.id, fotos.filter((x: unknown) => typeof x === 'string'), usuarioId])).map((x) => x.id));
  const erros = validarRespostas(c.formulario.campos, respostas, 'respostas', (id) => livres.has(id));
  if (erros.length) throw new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: erros });
  const visiveis = Object.fromEntries(Object.entries(respostas).filter(([k]) => campoVisivel(c.formulario.campos.find((x: any) => x.id === k), respostas)));
  const r = (await um(tx, `UPDATE checkins SET status = 'RESPONDIDO', respostas = $3, respondido_em = now(), respondido_por = $4 WHERE organizacao_id = $1 AND id = $2 RETURNING *`,
    [org.id, c.id, visiveis, usuarioId]))!;
  const usadas = c.formulario.campos.filter((x: any) => x.tipo === 'FOTO').flatMap((x: any) => (visiveis[x.id] as string[] | undefined) ?? []);
  if (usadas.length) await tx.query('UPDATE arquivos SET usado_em = now(), checkin_id = $3 WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, usadas, c.id]);
  await cancelarPrefixo(tx, org.id, `checkin:${c.id}:`);
  // RN-ACO-005: regras avaliadas pelo backend; alertas são informativos.
  const alertas = [];
  for (const regra of a.protocolo.regrasAlerta ?? [])
    if (regra.tipo === 'RESPOSTA' && compara(visiveis[regra.campo], regra.operador, regra.valor)) alertas.push(await criarAlerta(tx, org, a, r, regra, log));
  const equipe = await equipeAtiva(tx, org, a.equipe_ids);
  await emitir(tx, org.id, 'acompanhamento.checkin.respondido', { checkinId: c.id, acompanhamentoId: a.id }, equipe);
  // RN-ACO-007: o check-in respondido aparece na conversa.
  if (temModulo(org.modulos, 'chat') && configModulo(org.modulos, 'acompanhamento').publicarCheckinNaConversa && a.conversa_id) {
    const conversa = await um(tx, `SELECT * FROM conversas WHERE organizacao_id = $1 AND id = $2 AND status = 'ATIVA'`, [org.id, a.conversa_id]);
    if (conversa) await postarMensagem(tx, org, conversa, { tipo: 'CHECKIN', autorId: usuarioId, referencia: { tipo: 'CHECKIN', id: c.id, resumo: resumoRespostas(c.dia, c.formulario, visiveis), temAlerta: alertas.some(Boolean) } }, log);
  }
  await avisarContadores(tx, org, [...equipe, ...await contasDoPaciente(tx, org, a.paciente_id)]);
  return r;
}

export async function resolverAlerta(tx: Tx, org: Org, alertaId: string, porId: string, nota: string | null) {
  const al = await um(tx, `UPDATE alertas SET status = 'RESOLVIDO', resolvido_em = now(), resolvido_por = $3, nota = $4 WHERE organizacao_id = $1 AND id = $2 AND status = 'ABERTO' RETURNING *`, [org.id, alertaId, porId, nota]);
  if (!al) return;
  const a = await um(tx, 'SELECT equipe_ids FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, al.acompanhamento_id]);
  const equipe = await equipeAtiva(tx, org, a.equipe_ids);
  await emitir(tx, org.id, 'acompanhamento.alerta.resolvido', { alertaId: al.id }, equipe);
  await avisarContadores(tx, org, equipe);
}
