// Contadores do manifesto e de GET /v1/contadores (badges do menu).
import { ehEquipe, temModulo } from '@clinica/dominio';
import { um, type Tx } from '../db.ts';
import type { Org } from '../nucleo.ts';

export async function contadoresDe(tx: Tx, org: Org, usuarioId: string): Promise<Record<string, number>> {
  const n = async (sql: string, params: unknown[]) => (await um<{ n: number }>(tx, sql, params))!.n;
  const r: Record<string, number> = {};
  r['notificacoes.naoLidas'] = await n('SELECT count(*)::int AS n FROM notificacoes WHERE organizacao_id = $1 AND usuario_id = $2 AND lido_em IS NULL', [org.id, usuarioId]);
  const u = await um(tx, 'SELECT perfis FROM usuarios WHERE organizacao_id = $1 AND id = $2', [org.id, usuarioId]);
  const equipe = !!u && ehEquipe(u.perfis);
  if (temModulo(org.modulos, 'chat'))
    // Mensagens de outros autores depois da última lida, só em conversas ATIVAS em que participa.
    r['chat.naoLidas'] = await n(`
      SELECT count(m.*)::int AS n FROM participantes p
        JOIN conversas c ON c.organizacao_id = p.organizacao_id AND c.id = p.conversa_id AND c.status = 'ATIVA'
        JOIN mensagens m ON m.organizacao_id = p.organizacao_id AND m.conversa_id = p.conversa_id AND m.autor_id IS DISTINCT FROM p.usuario_id
         AND m.ordem > COALESCE((SELECT l.ordem FROM mensagens l WHERE l.organizacao_id = p.organizacao_id AND l.id = p.lido_ate), 0)
       WHERE p.organizacao_id = $1 AND p.usuario_id = $2 AND p.removido_em IS NULL`, [org.id, usuarioId]);
  if (temModulo(org.modulos, 'acompanhamento')) {
    r['acompanhamento.alertasAbertos'] = equipe ? await n(`SELECT count(*)::int AS n FROM alertas WHERE organizacao_id = $1 AND status = 'ABERTO'`, [org.id]) : 0;
    r['acompanhamento.checkinsPendentes'] = equipe
      ? await n(`SELECT count(*)::int AS n FROM checkins WHERE organizacao_id = $1 AND status = 'DISPONIVEL'`, [org.id])
      : await n(`SELECT count(*)::int AS n FROM checkins WHERE organizacao_id = $1 AND status = 'DISPONIVEL'
                   AND paciente_id IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2)`, [org.id, usuarioId]);
  }
  return r;
}
