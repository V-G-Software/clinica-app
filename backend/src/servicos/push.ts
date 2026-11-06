// Web Push com VAPID (14.1). O envio é um job (push.enviar): não atrasa a requisição, tenta de novo
// em falha temporária e nunca leva conteúdo clínico — só o texto discreto e o destino (RN-NOT-002).
import webpush from 'web-push';
import { config } from '../config.ts';
import { todos, um } from '../db.ts';
import { registrarJob } from './jobs.ts';
import { orgPorId } from './refs.ts';

export const pushAtivo = () => !!config.push;
/** Capacidade de push do manifesto: a chave pública vem da configuração do servidor, não do cenário. */
export const capacidadePush = () => (config.push ? { modo: 'WEB_PUSH', chavePublicaVapid: config.push.publica } : { modo: 'NENHUM' });

registrarJob('push.enviar', async (tx, orgId, { notificacaoId, texto }, log) => {
  if (!config.push) return;
  const n = await um(tx, 'SELECT id, usuario_id, tipo, destino FROM notificacoes WHERE organizacao_id = $1 AND id = $2', [orgId, notificacaoId]);
  if (!n) return;
  const org = await orgPorId(orgId);
  const inscricoes = await todos(tx, 'SELECT id, endpoint, chaves FROM inscricoes_push WHERE organizacao_id = $1 AND usuario_id = $2', [orgId, n.usuario_id]);
  const corpo = JSON.stringify({ titulo: org.nome, texto, notificacaoId: n.id, tipo: n.tipo, destino: n.destino, organizacao: org.slug });
  let temporarias = 0;
  for (const i of inscricoes) {
    try {
      await webpush.sendNotification({ endpoint: i.endpoint, keys: i.chaves }, corpo, {
        vapidDetails: { subject: config.push.assunto, publicKey: config.push.publica, privateKey: config.push.privada },
        TTL: 24 * 3600, urgency: n.tipo === 'ALERTA_CRIADO' ? 'high' : 'normal', timeout: 10_000,
      });
    } catch (e: any) {
      const status: number | undefined = e?.statusCode;
      // 404/410: inscrição morreu (app desinstalado, permissão revogada). Chave inválida: nunca vai funcionar.
      const definitiva = status === 404 || status === 410 || (status === undefined && !e?.code) || status === 400;
      if (definitiva) await tx.query('DELETE FROM inscricoes_push WHERE organizacao_id = $1 AND id = $2', [orgId, i.id]);
      else temporarias++;
      log.warn({ org: org.slug, inscricao: i.id, status, codigo: e?.code, definitiva }, 'push não entregue'); // sem endpoint no log
    }
  }
  if (temporarias && temporarias === inscricoes.length) throw new Error('push: falha temporária em todas as inscrições');
});
