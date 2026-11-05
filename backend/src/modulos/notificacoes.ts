// Central de notificações, preferências por tipo e inscrições de Web Push (8.2).
import { novoId } from '../cripto.ts';
import { todos, um } from '../db.ts';
import { naoEncontrado } from '../erros.ts';
import { C, criado, ok, vazio, type Handler } from '../http.ts';
import { iso, lerCursor, pagina } from '../nucleo.ts';
import { avisarContadores } from '../servicos/notificar.ts';

const TIPOS = ['CHAT_MENSAGEM', 'CHECKIN_DISPONIVEL', 'CHECKIN_LEMBRETE', 'ALERTA_CRIADO', 'ACOMPANHAMENTO_INICIADO', 'ACOMPANHAMENTO_CONCLUIDO', 'CONVITE_ACEITO', 'SISTEMA'];
const serNotificacao = (n: any) => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, texto: n.texto, criadoEm: iso(n.criado_em), lidoEm: iso(n.lido_em), destino: n.destino ?? null });

export const handlersNotificacoes: Record<string, Handler> = {
  notificacoesListar: async (q) => {
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const filtro = q.query.naoLidas === true ? 'AND lido_em IS NULL' : q.query.naoLidas === false ? 'AND lido_em IS NOT NULL' : '';
    const linhas = await todos(q.tx, `SELECT * FROM notificacoes WHERE organizacao_id = $1 AND usuario_id = $2 ${filtro} ORDER BY criado_em DESC, id DESC OFFSET $3 LIMIT $4`, [q.org.id, C(q).usuario.id, inicio, limite + 1]);
    const p = pagina(linhas, inicio, limite);
    return ok({ ...p, itens: p.itens.map(serNotificacao) });
  },
  notificacoesMarcarLidas: async (q) => {
    const u = C(q).usuario.id;
    if (q.body.todas) await q.tx.query('UPDATE notificacoes SET lido_em = now() WHERE organizacao_id = $1 AND usuario_id = $2 AND lido_em IS NULL', [q.org.id, u]);
    else await q.tx.query('UPDATE notificacoes SET lido_em = now() WHERE organizacao_id = $1 AND usuario_id = $2 AND id = ANY($3) AND lido_em IS NULL', [q.org.id, u, q.body.ids ?? []]);
    await avisarContadores(q.tx, q.org, [u]);
    return vazio();
  },
  notificacoesObterPreferencias: async (q) => {
    const p = C(q).usuario.preferencias_notificacao ?? {};
    return ok({ itens: TIPOS.map((tipo) => ({ tipo, ...(p[tipo] ?? { push: true, email: true }) })) });
  },
  notificacoesSalvarPreferencias: async (q) => {
    const ctx = C(q);
    const p: Record<string, { push: boolean; email: boolean }> = { ...(ctx.usuario.preferencias_notificacao ?? {}) };
    for (const i of q.body.itens) p[i.tipo] = { push: i.push, email: i.email };
    await q.tx.query('UPDATE usuarios SET preferencias_notificacao = $3 WHERE organizacao_id = $1 AND id = $2', [q.org.id, ctx.usuario.id, p]);
    ctx.usuario.preferencias_notificacao = p;
    return handlersNotificacoes.notificacoesObterPreferencias(q);
  },
  pushInscrever: async (q) => {
    const u = C(q).usuario.id;
    const { endpoint, keys } = q.body.inscricao;
    // O mesmo aparelho reinscrito substitui a inscrição anterior (endpoint é único).
    const r = await um(q.tx, `INSERT INTO inscricoes_push (organizacao_id, id, usuario_id, endpoint, chaves, dispositivo) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (organizacao_id, endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, chaves = EXCLUDED.chaves, dispositivo = EXCLUDED.dispositivo, criado_em = now()
      RETURNING id, dispositivo, criado_em`, [q.org.id, novoId('psi'), u, endpoint, keys, q.body.dispositivo ?? null]);
    return criado({ id: r!.id, dispositivo: r!.dispositivo, criadoEm: iso(r!.criado_em) });
  },
  pushRemoverInscricao: async (q) => {
    const r = await q.tx.query('DELETE FROM inscricoes_push WHERE organizacao_id = $1 AND id = $2 AND usuario_id = $3', [q.org.id, q.params.inscricaoId, C(q).usuario.id]);
    if (!r.rowCount) throw naoEncontrado('Inscrição');
    return vazio();
  },
};
