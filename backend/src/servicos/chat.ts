// Regras do chat (RN-CHA) usadas pelos handlers, pelo acompanhamento e pelos jobs.
import { configModulo, localParaUtc, partesLocais, somarDias } from '@clinica/dominio';
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { emitir } from '../eventos.ts';
import type { Log } from '../http.ts';
import type { Org } from '../nucleo.ts';
import { avisarContadores, notificar } from './notificar.ts';
import { ehEquipeU, refUsuario, usuariosPorId } from './refs.ts';

export const conversaAtivaDoPaciente = (tx: Tx, org: Org, pacienteId: string) =>
  um(tx, `SELECT * FROM conversas WHERE organizacao_id = $1 AND paciente_id = $2 AND status = 'ATIVA'`, [org.id, pacienteId]);

export async function participantesAtivos(tx: Tx, org: Org, conversaId: string): Promise<string[]> {
  return (await todos(tx, 'SELECT usuario_id FROM participantes WHERE organizacao_id = $1 AND conversa_id = $2 AND removido_em IS NULL ORDER BY entrou_em, usuario_id', [org.id, conversaId])).map((p) => p.usuario_id);
}
export async function participa(tx: Tx, org: Org, conversaId: string, usuarioId: string) {
  return !!(await um(tx, 'SELECT 1 FROM participantes WHERE organizacao_id = $1 AND conversa_id = $2 AND usuario_id = $3 AND removido_em IS NULL', [org.id, conversaId, usuarioId]));
}

/** Cria a conversa ATIVA do paciente; se outra requisição criou antes (índice único parcial), devolve aquela. */
export async function criarConversa(tx: Tx, org: Org, pacienteId: string, participantesIds: string[]) {
  const c = await um(tx, `INSERT INTO conversas (organizacao_id, id, paciente_id, status) VALUES ($1,$2,$3,'ATIVA')
                          ON CONFLICT (organizacao_id, paciente_id) WHERE status = 'ATIVA' DO NOTHING RETURNING *`, [org.id, novoId('cnv'), pacienteId]);
  if (!c) {
    const existente = (await conversaAtivaDoPaciente(tx, org, pacienteId))!;
    for (const id of participantesIds) await adicionarParticipante(tx, org, existente.id, id);
    return { conversa: existente, criada: false };
  }
  for (const id of new Set(participantesIds)) await adicionarParticipante(tx, org, c.id, id);
  return { conversa: c, criada: true };
}

/** Adiciona (ou readmite) participante. Quem entra depois começa com tudo lido. Devolve se mudou algo. */
export async function adicionarParticipante(tx: Tx, org: Org, conversaId: string, usuarioId: string): Promise<boolean> {
  const u = (await usuariosPorId(tx, org, [usuarioId])).get(usuarioId);
  if (!u) return false;
  const ultima = await um(tx, 'SELECT id FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 ORDER BY ordem DESC LIMIT 1', [org.id, conversaId]);
  const r = await tx.query(
    `INSERT INTO participantes (organizacao_id, conversa_id, usuario_id, perfil, lido_ate) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (organizacao_id, conversa_id, usuario_id) DO UPDATE SET removido_em = NULL, entrou_em = now()
       WHERE participantes.removido_em IS NOT NULL`,
    [org.id, conversaId, usuarioId, refUsuario(u, u.id).perfil, ultima?.id ?? null]);
  return (r.rowCount ?? 0) > 0;
}

export function resumoMensagem(m: { tipo: string; texto: string | null; referencia: any }) {
  if (m.tipo === 'CHECKIN') return m.referencia?.resumo ?? 'Check-in respondido';
  if (m.tipo === 'ANEXO') return m.texto ? `📷 ${m.texto}` : '📷 Foto';
  return (m.texto ?? '').slice(0, 120);
}

export interface NovaMensagem { tipo: string; autorId: string | null; texto?: string | null; anexosIds?: string[]; referencia?: unknown; idCliente?: string | null }
/** Grava a mensagem, marca os anexos como usados, avança a leitura do autor, emite o evento e notifica (RN-CHA-008). */
export async function postarMensagem(tx: Tx, org: Org, conversa: { id: string; paciente_id: string }, m: NovaMensagem, log: Log) {
  const autores = m.autorId ? await usuariosPorId(tx, org, [m.autorId]) : new Map();
  const autor = m.autorId ? autores.get(m.autorId) : null;
  const perfilAutor = m.autorId
    ? (await um(tx, 'SELECT perfil FROM participantes WHERE organizacao_id = $1 AND conversa_id = $2 AND usuario_id = $3', [org.id, conversa.id, m.autorId]))?.perfil ?? refUsuario(autor, m.autorId).perfil
    : null;
  const msg = (await um(tx, `INSERT INTO mensagens (organizacao_id, id, conversa_id, tipo, autor_id, autor_perfil, texto, anexos_ids, referencia, id_cliente)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [org.id, novoId('msg'), conversa.id, m.tipo, m.autorId, perfilAutor, m.texto ?? null, m.anexosIds ?? [], m.referencia ?? null, m.idCliente ?? null]))!;
  if (msg.anexos_ids.length)
    await tx.query('UPDATE arquivos SET usado_em = now(), conversa_id = $3 WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, msg.anexos_ids, conversa.id]);
  if (m.autorId) await tx.query('UPDATE participantes SET lido_ate = $4 WHERE organizacao_id = $1 AND conversa_id = $2 AND usuario_id = $3', [org.id, conversa.id, m.autorId, msg.id]);

  const todosIds = await participantesAtivos(tx, org, conversa.id);
  // O evento leva só identificadores: o conteúdo é buscado com o token de quem recebe.
  await emitir(tx, org.id, 'chat.mensagem.criada', { conversaId: conversa.id, mensagemId: msg.id }, todosIds);
  if (msg.tipo === 'SISTEMA') { await avisarContadores(tx, org, todosIds); return msg; }
  const nomePaciente = (await um(tx, 'SELECT nome FROM pacientes WHERE organizacao_id = $1 AND id = $2', [org.id, conversa.paciente_id]))?.nome ?? '';
  const destinatarios = await usuariosPorId(tx, org, todosIds);
  const deQuem = autor ? refUsuario(autor, autor.id).nome : org.nome;
  for (const uid of todosIds) {
    if (uid === m.autorId) continue;
    const d = destinatarios.get(uid);
    await notificar(tx, org, uid, {
      tipo: 'CHAT_MENSAGEM', agrupar: conversa.id,
      titulo: d && ehEquipeU(d) ? nomePaciente : org.nome,
      texto: `${deQuem}: ${resumoMensagem(msg)}`.slice(0, 160),
      destino: { tela: 'chat.conversa', parametros: { conversaId: conversa.id } },
    }, log);
  }
  return msg;
}

/** RN-CHA-006: dentro do horário de atendimento, no fuso da organização? */
export function dentroDoHorario(org: Org, ms = Date.now()) {
  const l = partesLocais(ms, org.fuso);
  return (configModulo(org.modulos, 'chat').horarioAtendimento ?? []).some((h: any) => h.diaSemana === l.diaSemana && l.hora >= h.inicio && l.hora < h.fim);
}
/** Próxima abertura do atendimento depois de `ms` (o aviso fora do horário sai no máximo uma vez por período). */
export function proximaAbertura(org: Org, ms: number): number | null {
  const base = partesLocais(ms, org.fuso).data;
  let melhor: number | null = null;
  for (let d = 0; d < 8; d++) {
    const data = somarDias(base, d);
    for (const h of configModulo(org.modulos, 'chat').horarioAtendimento ?? []) {
      const t = localParaUtc(data, h.inicio, org.fuso);
      if (partesLocais(t, org.fuso).diaSemana === h.diaSemana && t > ms && (melhor === null || t < melhor)) melhor = t;
    }
  }
  return melhor;
}

/** Mensagens não lidas: depois da última lida, de outros autores (inclui SISTEMA). */
export async function naoLidas(tx: Tx, org: Org, conversaId: string, usuarioId: string): Promise<number> {
  const r = await um<{ n: number }>(tx, `
    SELECT count(m.*)::int AS n FROM participantes p
      JOIN mensagens m ON m.organizacao_id = p.organizacao_id AND m.conversa_id = p.conversa_id AND m.autor_id IS DISTINCT FROM p.usuario_id
       AND m.ordem > COALESCE((SELECT l.ordem FROM mensagens l WHERE l.organizacao_id = p.organizacao_id AND l.id = p.lido_ate), 0)
     WHERE p.organizacao_id = $1 AND p.conversa_id = $2 AND p.usuario_id = $3 AND p.removido_em IS NULL`, [org.id, conversaId, usuarioId]);
  return r?.n ?? 0;
}
