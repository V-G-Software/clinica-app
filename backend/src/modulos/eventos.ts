// GET /v1/eventos (polling e recuperação). O stream SSE fica no servidor.
import { todos, um } from '../db.ts';
import { ErroApi } from '../erros.ts';
import { idEvento, seqDoId } from '../eventos.ts';
import { C, ok, type Handler } from '../http.ts';
import { iso } from '../nucleo.ts';

export const serEvento = (e: any) => ({ id: idEvento(e.seq), tipo: e.tipo, ocorridoEm: iso(e.ocorrido_em), dados: e.dados });
export async function eventosDepois(q: { tx: any; org: { id: string } }, usuarioId: string, depois: string, limite: number) {
  const seq = seqDoId(depois);
  const mais = await um(q.tx, `SELECT min(seq) AS min, max(seq) AS max FROM eventos WHERE organizacao_id = $1`, [q.org.id]);
  // Cursor desconhecido, futuro ou mais antigo que a janela de 24 h → recarregar as listas.
  if (!Number.isFinite(seq) || (mais.max !== null && seq > mais.max) || (mais.min !== null && seq < mais.min - 1)) throw new ErroApi('CURSOR_EXPIRADO', 'Recarregue as listas.');
  return todos(q.tx, `SELECT * FROM eventos WHERE organizacao_id = $1 AND seq > $2 AND $3 = ANY(destinatarios) ORDER BY seq LIMIT $4`, [q.org.id, seq, usuarioId, limite]);
}
export const handlersEventos: Record<string, Handler> = {
  eventosListar: async (q) => {
    const u = C(q).usuario.id;
    const ultimo = await um(q.tx, 'SELECT max(seq) AS max FROM eventos WHERE organizacao_id = $1', [q.org.id]);
    if (!q.query.depois) return ok({ itens: [], ultimoEventoId: ultimo?.max ? idEvento(ultimo.max) : null });
    const linhas = await eventosDepois(q, u, q.query.depois, q.query.limite ?? 100);
    return ok({ itens: linhas.map(serEvento), ultimoEventoId: linhas.length ? idEvento(linhas.at(-1).seq) : q.query.depois });
  },
};
