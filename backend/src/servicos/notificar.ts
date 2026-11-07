// Central de notificações (8.2): toda notificação aparece na central (RN-NOT-001); push e e-mail são
// cópias DISCRETAS, sem conteúdo clínico nem nome de paciente (RN-NOT-002); canal pela RN-NOT-003.
import { novoId } from '../cripto.ts';
import { um, type Tx } from '../db.ts';
import { emitir } from '../eventos.ts';
import type { Org } from '../nucleo.ts';
import { enviarEmail } from './email.ts';
import { contadoresDe } from './contadores.ts';
import { agendar } from './jobs.ts';
import { pushAtivo } from './push.ts';

const TEXTO_DISCRETO: Record<string, string> = {
  CHAT_MENSAGEM: 'Você tem uma nova mensagem', CHECKIN_DISPONIVEL: 'Seu check-in de hoje está disponível',
  CHECKIN_LEMBRETE: 'Lembrete: seu check-in ainda não foi respondido', ALERTA_CRIADO: 'Há um novo alerta para revisar',
  ACOMPANHAMENTO_INICIADO: 'Seu acompanhamento foi iniciado', ACOMPANHAMENTO_CONCLUIDO: 'Seu acompanhamento foi concluído',
  CONVITE_ACEITO: 'Um convite foi aceito', SISTEMA: 'Você tem um novo aviso',
  AGENDAMENTO_CRIADO: 'Há um novo agendamento', AGENDAMENTO_ALTERADO: 'Um agendamento foi alterado', AGENDAMENTO_LEMBRETE: 'Lembrete de agendamento',
  EXAME_PEDIDO: 'Há um novo pedido de exame', EXAME_RESULTADO: 'Há um resultado de exame para revisar', EXAME_REVISADO: 'Um resultado de exame foi revisado',
};
const EMAIL_SEM_PUSH = new Set(['CHECKIN_DISPONIVEL', 'CHECKIN_LEMBRETE', 'ALERTA_CRIADO', 'AGENDAMENTO_LEMBRETE', 'AGENDAMENTO_ALTERADO', 'EXAME_PEDIDO', 'EXAME_REVISADO']);
export interface NovaNotificacao { tipo: string; titulo: string; texto: string; destino: unknown; agrupar?: string }
type Log = { info: (o: unknown, m: string) => void };

export async function notificar(tx: Tx, org: Org, usuarioId: string, n: NovaNotificacao, log: Log) {
  const u = await um(tx, 'SELECT id, email, status, preferencias_notificacao FROM usuarios WHERE organizacao_id = $1 AND id = $2', [org.id, usuarioId]);
  if (!u || u.status !== 'ATIVO') return;
  // Mensagens não lidas da mesma conversa viram uma notificação só (QUESTION-009).
  const existente = n.agrupar ? await um(tx, 'SELECT id FROM notificacoes WHERE organizacao_id = $1 AND usuario_id = $2 AND agrupar = $3 AND lido_em IS NULL', [org.id, usuarioId, n.agrupar]) : null;
  let id: string;
  if (existente) {
    id = existente.id;
    await tx.query('UPDATE notificacoes SET titulo = $3, texto = $4, criado_em = now() WHERE organizacao_id = $1 AND id = $2', [org.id, id, n.titulo, n.texto]);
  } else {
    id = novoId('ntf');
    await tx.query('INSERT INTO notificacoes (organizacao_id, id, usuario_id, tipo, titulo, texto, destino, agrupar) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [org.id, id, usuarioId, n.tipo, n.titulo, n.texto, n.destino ?? null, n.agrupar ?? null]);
  }
  await emitir(tx, org.id, 'notificacao.criada', { notificacaoId: id }, [usuarioId]);
  await avisarContadores(tx, org, [usuarioId]);

  const pref = u.preferencias_notificacao?.[n.tipo] ?? { push: true, email: true };
  const discreto = `${TEXTO_DISCRETO[n.tipo] ?? 'Você tem uma nova notificação'} — ${org.nome}.`;
  const temPush = pushAtivo() && pref.push && !!(await um(tx, 'SELECT 1 FROM inscricoes_push WHERE organizacao_id = $1 AND usuario_id = $2 LIMIT 1', [org.id, usuarioId]));
  if (temPush) {
    // Job na mesma transação: se a regra que notificou for desfeita, o push não sai. Agrupada (chat), a
    // notificação reaproveita o id do job e o push pendente é substituído em vez de repetido.
    await agendar(tx, org.id, `push:${id}`, 'push.enviar', Date.now(), { notificacaoId: id, texto: discreto });
    return;
  }
  // RN-NOT-003: sem push, os tipos que pedem ação viram e-mail discreto.
  if (pref.email && EMAIL_SEM_PUSH.has(n.tipo)) enviarEmail({ org: org.slug, para: u.email, assunto: org.nome, texto: `${discreto} Abra o app para ver.` }, log);
}

export async function avisarContadores(tx: Tx, org: Org, usuarios: string[]) {
  for (const id of new Set(usuarios)) await emitir(tx, org.id, 'contadores.alterados', await contadoresDe(tx, org, id), [id]);
}
