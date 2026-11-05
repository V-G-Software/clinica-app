// Eventos de tempo real (8.4 / ADR-0003). Gravados na tabela `eventos` (24 h) e distribuídos entre
// instâncias por LISTEN/NOTIFY do Postgres: o NOTIFY só é entregue no COMMIT da transação, então
// ninguém recebe evento de algo que foi desfeito.
import pg from 'pg';
import { config } from './config.ts';
import { comOrg, type Tx } from './db.ts';

// NOTIFY aceita até 8000 bytes; acima disso dá erro e desfaz a transação da requisição. Eventos
// grandes (muitos destinatários, texto longo) vão só como referência e o ouvinte lê do banco.
const LIMITE_NOTIFY = 7000;

export interface EventoPublico { id: string; tipo: string; ocorridoEm: string; dados: Record<string, unknown> }
export const idEvento = (seq: number) => `evt_${String(seq).padStart(12, '0')}`;
export const seqDoId = (id: string) => (/^evt_\d+$/.test(id) ? Number(id.slice(4)) : NaN);

export async function emitir(tx: Tx, orgId: string, tipo: string, dados: Record<string, unknown>, para: Iterable<string>) {
  const destinatarios = [...new Set(para)];
  if (!destinatarios.length) return;
  const r = await tx.query<{ seq: number; ocorrido_em: Date }>(
    'INSERT INTO eventos (organizacao_id, tipo, dados, destinatarios) VALUES ($1, $2, $3, $4) RETURNING seq, ocorrido_em', [orgId, tipo, dados, destinatarios]);
  const ev = { org: orgId, para: destinatarios, evento: { id: idEvento(r.rows[0].seq), tipo, ocorridoEm: r.rows[0].ocorrido_em.toISOString().replace(/\.\d{3}Z$/, 'Z'), dados } };
  const payload = JSON.stringify(ev);
  await tx.query('SELECT pg_notify($1, $2)', ['eventos', Buffer.byteLength(payload) <= LIMITE_NOTIFY ? payload : JSON.stringify({ org: orgId, seq: r.rows[0].seq })]);
}

async function carregar(org: string, seq: number) {
  const r = await comOrg(org, (tx) => tx.query('SELECT tipo, dados, destinatarios, ocorrido_em FROM eventos WHERE organizacao_id = $1 AND seq = $2', [org, seq]));
  const e = r.rows[0];
  return e && { org, para: e.destinatarios as string[], evento: { id: idEvento(seq), tipo: e.tipo, ocorridoEm: (e.ocorrido_em as Date).toISOString().replace(/\.\d{3}Z$/, 'Z'), dados: e.dados } };
}

function entregar(org: string, para: string[], evento: EventoPublico) {
  const alvo = new Set<string>(para);
  for (const o of ouvintes) if (o.org === org && alvo.has(o.usuarioId)) o.enviar(evento);
  if (evento.tipo === 'sessao.encerrada') for (const o of ouvintes) if (o.org === org && alvo.has(o.usuarioId)) setTimeout(() => o.fechar(), 50);
}

type Ouvinte = { org: string; usuarioId: string; sessaoId: string; enviar: (e: EventoPublico) => void; fechar: () => void };
const ouvintes = new Set<Ouvinte>();
export const adicionarOuvinte = (o: Ouvinte) => { ouvintes.add(o); return () => ouvintes.delete(o); };
export function fecharOuvintesDaSessao(org: string, sessaoId: string) { for (const o of ouvintes) if (o.org === org && o.sessaoId === sessaoId) o.fechar(); }
export function fecharOuvintesDoUsuario(org: string, usuarioId: string) { for (const o of ouvintes) if (o.org === org && o.usuarioId === usuarioId) o.fechar(); }

let cliente: pg.Client | null = null;
/** Conexão dedicada que escuta NOTIFY e entrega aos ouvintes SSE desta instância. Reconecta se cair. */
export async function escutarEventos(log: { error: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void }) {
  const conectar = async () => {
    cliente = new pg.Client({ connectionString: config.bancoApp });
    cliente.on('notification', (n) => {
      if (n.channel !== 'eventos' || !n.payload) return;
      const { org, para, evento, sessaoEncerrada, seq } = JSON.parse(n.payload);
      if (sessaoEncerrada) { fecharOuvintesDaSessao(org, sessaoEncerrada); return; }
      if (evento) { entregar(org, para, evento); return; }
      if (seq) void carregar(org, seq).then((e) => e && entregar(e.org, e.para, e.evento)).catch((err) => log.warn({ err: err.message }, 'evento grande não carregado'));
    });
    cliente.on('error', (e) => { log.warn({ err: e.message }, 'LISTEN caiu; reconectando'); cliente = null; setTimeout(() => void conectar().catch(() => undefined), 1000); });
    await cliente.connect();
    await cliente.query('LISTEN eventos');
  };
  await conectar().catch((e) => log.error({ err: e.message }, 'não foi possível escutar eventos'));
}
export const pararEscuta = async () => { await cliente?.end().catch(() => undefined); cliente = null; };
