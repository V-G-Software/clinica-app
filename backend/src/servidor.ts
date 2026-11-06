// Backend de referência (F1–F2). Diretório em /diretorio, cada organização em /o/{slug} (urlApi).
// Cada requisição: operação do contrato → validação → uma transação com o contexto da organização
// (RLS) → handler → validação da resposta. A organização vem do caminho e é conferida contra o token.
import { createHash } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { encontrarOperacao, validarRequisicao, validarResposta, versaoContrato } from '@clinica/contrato-validador';
import { config } from './config.ts';
import { iguais, assinarUrl } from './cripto.ts';
import { comOrg, global, pool, um } from './db.ts';
import { ErroApi, STATUS_POR_CODIGO } from './erros.ts';
import { adicionarOuvinte, escutarEventos } from './eventos.ts';
import type { Handler, Req, Res } from './http.ts';
import { autenticar, hashCorpo, orgPorDominio, orgPorSlug, type Org } from './nucleo.ts';
import { handlersAcompanhamento } from './modulos/acompanhamento.ts';
import { handlersArquivos } from './modulos/arquivos.ts';
import { handlersChat } from './modulos/chat.ts';
import { handlersAuth } from './modulos/auth.ts';
import { eventosDepois, handlersEventos, serEvento } from './modulos/eventos.ts';
import { handlersEquipe } from './modulos/equipe.ts';
import { handlersFormularios } from './modulos/formularios.ts';
import { handlersNotificacoes } from './modulos/notificacoes.ts';
import { handlersPacientes } from './modulos/pacientes.ts';
import { handlersPublico } from './modulos/publico.ts';
import { handlersSessao } from './modulos/sessao.ts';
import { storage, storageLocal } from './servicos/storage.ts';
import './servicos/acompanhamento.ts'; // registra os jobs do acompanhamento
import './servicos/push.ts'; // registra o job de push
import { iniciarWorker, pararWorker } from './servicos/jobs.ts';

const handlers: Record<string, Handler> = { ...handlersPublico, ...handlersAuth, ...handlersSessao, ...handlersNotificacoes, ...handlersArquivos, ...handlersEventos, ...handlersPacientes, ...handlersFormularios, ...handlersEquipe, ...handlersAcompanhamento, ...handlersChat };
const PUBLICAS_COM_LOGIN = new Set(['authSair']);

export function criarServidor() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["idempotency-key"]', 'res.headers["set-cookie"]'], censor: '[removido]' } },
    bodyLimit: 1024 * 1024, trustProxy: true, genReqId: (r) => (typeof r.headers['x-request-id'] === 'string' && /^[\w.-]{1,100}$/.test(r.headers['x-request-id']) ? r.headers['x-request-id'] : `req_${createHash('sha1').update(String(Math.random()) + Date.now()).digest('hex').slice(0, 20)}`),
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(['application/json'], { parseAs: 'string' }, (_r, corpo, feito) => {
    if (!corpo) return feito(null, undefined);
    try { feito(null, JSON.parse(corpo as string)); } catch { feito(new ErroApi('VALIDACAO_FALHOU', 'JSON malformado.') as never, undefined); }
  });
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_r, corpo, feito) => feito(null, corpo));

  // CORS: só as origens do frontend da própria organização (3.2); em dev, localhost.
  const ORIGENS_DEV = /^https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/;
  const cors = (origem: string | undefined, org?: Org | null): Record<string, string> => {
    if (!origem) return {};
    const ok = (!config.producao && ORIGENS_DEV.test(origem)) || (org?.dominios ?? []).some((d) => origem === `https://${d}`);
    if (!ok) return {};
    return {
      'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match, X-Request-Id, X-Cliente, X-Cliente-Versao, Last-Event-ID',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'ETag, X-Request-Id, Retry-After', 'Access-Control-Max-Age': '600',
    };
  };
  const problema = (reply: FastifyReply, e: ErroApi, instance?: string) => {
    if (e.status === 429) reply.header('Retry-After', '60');
    return reply.code(e.status).type('application/problem+json').send(e.problema(String(reply.request.id), instance));
  };
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
    const slug = req.url.match(/^\/o\/([^/?]+)/)?.[1];
    reply.headers(cors(req.headers.origin, slug ? await orgPorSlug(slug) : null));
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  // ─────────── Diretório (3.3) ───────────
  const diretorio = (org: Org) => ({ slug: org.slug, nome: org.nome, urlApi: org.urlApi, contratoVersao: versaoContrato, status: org.status });
  app.get('/diretorio/v1/organizacoes/:slug', async (req, reply) => {
    const org = await orgPorSlug((req.params as any).slug);
    return org ? reply.header('Cache-Control', 'max-age=60').send(diretorio(org)) : problema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Organização desconhecida.'));
  });
  app.get('/diretorio/v1/organizacoes', async (req, reply) => {
    const d = (req.query as any).dominio;
    if (typeof d !== 'string' || d.length < 3) return problema(reply, new ErroApi('VALIDACAO_FALHOU', 'Informe o domínio.', { campos: [{ campo: 'dominio', codigo: 'OBRIGATORIO', mensagem: 'dominio é obrigatório' }] }));
    const org = await orgPorDominio(d);
    return org ? reply.send(diretorio(org)) : problema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Organização desconhecida.'));
  });

  // ─────────── Storage local (URLs assinadas pelo próprio backend) ───────────
  app.put('/_arquivos/envio/*', async (req, reply) => {
    const chave = (req.params as any)['*'];
    const q = req.query as any;
    if (!storageLocal.conferir('PUT', chave, Number(q.exp), String(q.ass ?? ''), String(req.headers['content-type'] ?? ''))) return reply.code(403).send();
    await storageLocal.gravar(chave, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    return reply.code(200).send();
  });
  app.get('/_arquivos/ver/*', async (req, reply) => {
    const chave = (req.params as any)['*'];
    const q = req.query as any;
    if (!storageLocal.conferir('GET', chave, Number(q.exp), String(q.ass ?? ''))) return reply.code(403).send();
    const b = await storageLocal.ler(chave);
    return b ? reply.header('Cache-Control', 'private, max-age=60').type('application/octet-stream').header('Content-Type', tipoPorBytes(b)).send(b) : reply.code(404).send();
  });
  app.get('/_arquivos/publico/:org/:id', async (req, reply) => {
    const { org, id } = req.params as any;
    const a = await comOrg(org, (tx) => um(tx, `SELECT tipo FROM arquivos WHERE organizacao_id = $1 AND id = $2 AND finalidade = 'ORGANIZACAO' AND status = 'DISPONIVEL'`, [org, id])).catch(() => null);
    const b = a ? await storageLocal.ler(`final/${org}/${id}`) : null;
    return b ? reply.header('Cache-Control', 'public, max-age=3600').type(a.tipo).send(b) : reply.code(404).send();
  });
  void iguais; void assinarUrl;

  // ─────────── Organizações ───────────
  app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/o/:slug/*', handler: async (req, reply) => {
    const org = await orgPorSlug((req.params as any).slug);
    if (!org) return problema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Organização desconhecida.'));
    const caminho = '/' + String((req.params as any)['*']).split('?')[0];
    const instance = `${org.urlApi}${caminho}`;
    const achada = encontrarOperacao(req.method, caminho);
    if (!achada || achada.operacao.tag === 'diretorio') return problema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Rota inexistente no contrato.'), instance);
    const op = achada.operacao;
    const handler = handlers[op.operationId];
    try {
      if (!handler && op.operationId !== 'eventosStream') throw new ErroApi('RECURSO_NAO_ENCONTRADO', 'Operação ainda não implementada neste backend.');
      if (op.tag !== 'publico' && org.status === 'MANUTENCAO') throw new ErroApi('INDISPONIVEL_TEMPORARIAMENTE', org.mensagemStatus ?? 'Em manutenção.');
      if (op.tag !== 'publico' && org.status === 'SUSPENSA') throw new ErroApi('ORGANIZACAO_SUSPENSA');
      const temCorpo = req.body !== undefined && !Buffer.isBuffer(req.body);
      if (Buffer.isBuffer(req.body) && op.op.requestBody) throw new ErroApi('VALIDACAO_FALHOU', 'Envie Content-Type: application/json.', {}, 415);
      const v = validarRequisicao(op.operationId, { params: achada.params, query: req.query as any, headers: req.headers, body: req.body, temCorpo });
      if (!v.ok) throw new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: v.erros });
      const precisaLogin = !op.publico || PUBLICAS_COM_LOGIN.has(op.operationId);

      if (op.operationId === 'eventosStream') return await stream(req, reply, org);

      const hash = hashCorpo(req.body, caminho);
      const res = await comOrg(org.id, async (tx) => {
        const ctx = precisaLogin ? await autenticar(tx, org, req.headers.authorization) : null;
        let chave: string | null = null;
        if (op.idempotente) {
          chave = `${ctx?.usuario.id ?? req.ip}:${op.operationId}:${req.headers['idempotency-key']}`;
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${org.id}|${chave}`]); // serializa a mesma chave
          const salvo = await um(tx, `SELECT * FROM idempotencia WHERE organizacao_id = $1 AND chave = $2 AND criado_em > now() - interval '24 hours'`, [org.id, chave]);
          if (salvo) {
            if (salvo.hash_corpo !== hash) throw new ErroApi('VALIDACAO_FALHOU', 'Idempotency-Key já usada com outro conteúdo.', { campos: [{ campo: 'Idempotency-Key', codigo: 'REUTILIZADA', mensagem: 'Gere uma nova chave para uma nova operação.' }] });
            return { status: salvo.status, body: salvo.corpo ?? undefined, headers: { ...salvo.cabecalhos, 'Idempotent-Replayed': 'true' } } as Res;
          }
        }
        const q: Req = { org, ctx, tx, params: achada.params, query: v.query, body: req.body, headers: req.headers as any, ip: req.ip, nativo: req.headers['x-cliente'] === 'NATIVO', cookieRenovacao: lerCookie(req, 'renovacao'), requestId: String(req.id), log: req.log };
        const r = await handler(q);
        if (chave && r.status < 500) await tx.query(`INSERT INTO idempotencia (organizacao_id, chave, hash_corpo, status, corpo, cabecalhos) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (organizacao_id, chave) DO UPDATE SET hash_corpo = EXCLUDED.hash_corpo, status = EXCLUDED.status, corpo = EXCLUDED.corpo, cabecalhos = EXCLUDED.cabecalhos, criado_em = now()`,
          [org.id, chave, hash, r.status, r.body === undefined ? null : JSON.stringify(r.body), r.headers ?? {}]);
        return r;
      });
      res.depoisDoCommit?.();
      return responder(reply, op.operationId, res, instance);
    } catch (e) {
      if (e instanceof ErroApi) return problema(reply, e, instance);
      req.log.error({ err: e }, 'erro inesperado');
      return problema(reply, new ErroApi('INDISPONIVEL_TEMPORARIAMENTE', 'Erro inesperado.', {}, 500), instance);
    }
  } });

  function responder(reply: FastifyReply, operationId: string, res: Res, instance: string) {
    if (res.headers) reply.headers(res.headers);
    if (res.cookie) reply.header('Set-Cookie', res.cookie);
    const erro = res.status >= 400;
    if (config.validarResposta) {
      const v = validarResposta(operationId, res.status, res.body === undefined ? undefined : erro ? 'application/problem+json' : 'application/json', res.body);
      if (!v.ok) {
        reply.log.error({ operationId, status: res.status, violacoes: v.erros }, 'RESPOSTA FORA DO CONTRATO');
        return problema(reply.header('X-Violacao-Contrato', 'resposta'), new ErroApi('INDISPONIVEL_TEMPORARIAMENTE', `Resposta fora do contrato em ${operationId}.`, {}, 500), instance);
      }
    }
    if (res.body === undefined) return reply.code(res.status).send();
    return reply.code(res.status).type(erro ? 'application/problem+json' : 'application/json').send(res.body);
  }

  // ─────────── SSE (8.4) ───────────
  async function stream(req: FastifyRequest, reply: FastifyReply, org: Org) {
    const ctx = await comOrg(org.id, (tx) => autenticar(tx, org, req.headers.authorization));
    const ultimo = typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : null;
    const perdidos = ultimo ? await comOrg(org.id, (tx) => eventosDepois({ tx, org }, ctx.usuario.id, ultimo, 500)).catch((e) => (e instanceof ErroApi ? 'expirado' : Promise.reject(e))) : [];
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Request-Id': String(req.id), ...cors(req.headers.origin, org) });
    const escrever = (e: { id: string; tipo: string }) => raw.write(`id: ${e.id}\nevent: ${e.tipo}\ndata: ${JSON.stringify(e)}\n\n`);
    raw.write('retry: 3000\n\n');
    if (perdidos === 'expirado') raw.write(`event: erro\ndata: ${JSON.stringify({ codigo: 'CURSOR_EXPIRADO' })}\n\n`);
    else for (const e of perdidos) escrever(serEvento(e));
    const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);
    const remover = adicionarOuvinte({ org: org.id, usuarioId: ctx.usuario.id, sessaoId: ctx.sessaoId, enviar: escrever, fechar: () => { clearInterval(ping); remover(); raw.end(); } });
    req.raw.on('close', () => { clearInterval(ping); remover(); });
  }
  return app;
}

function lerCookie(req: FastifyRequest, nome: string) {
  return (req.headers.cookie ?? '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === nome)?.slice(1).join('=') || undefined;
}
function tipoPorBytes(b: Buffer) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

/** Limpeza periódica: eventos e idempotência (24 h), tentativas (1 dia), desafios e códigos vencidos. */
async function limpar() {
  for (const { id } of (await global('SELECT id FROM organizacoes')).rows)
    await comOrg(id, async (tx) => {
      await tx.query("DELETE FROM eventos WHERE organizacao_id = $1 AND ocorrido_em < now() - interval '24 hours'", [id]);
      await tx.query("DELETE FROM idempotencia WHERE organizacao_id = $1 AND criado_em < now() - interval '24 hours'", [id]);
      await tx.query("DELETE FROM tentativas WHERE organizacao_id = $1 AND em < now() - interval '1 day'", [id]);
      await tx.query('DELETE FROM desafios WHERE organizacao_id = $1 AND expira_em < now()', [id]);
      await tx.query('DELETE FROM codigos_email WHERE organizacao_id = $1 AND expira_em < now()', [id]);
      // Envios não usados (14.3): nunca concluídos, ou fotos de check-in/chat que não foram anexadas em 24 h.
      const descartados = await tx.query(`UPDATE arquivos SET status = 'REJEITADO', motivo_rejeicao = 'Descartado: não foi usado em 24 horas.'
        WHERE organizacao_id = $1 AND criado_em < now() - interval '24 hours' AND usado_em IS NULL
          AND (status IN ('AGUARDANDO_ENVIO','PROCESSANDO') OR (status = 'DISPONIVEL' AND finalidade IN ('CHECKIN','CHAT'))) RETURNING id, chave_storage`, [id]);
      for (const a of descartados.rows) { await storage.remover(a.chave_storage).catch(() => undefined); await storage.remover(`final/${id}/${a.id}`).catch(() => undefined); }
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = criarServidor();
  await escutarEventos(app.log);
  if (process.env.JOBS !== '0') iniciarWorker(app.log); // JOBS=0: instância só de API (o worker roda em outra)
  setInterval(() => void limpar().catch((e) => app.log.error({ err: e.message }, 'limpeza falhou')), 10 * 60_000).unref();
  await app.listen({ port: config.porta, host: process.env.HOST ?? '0.0.0.0' });
  app.log.info(`Backend de referência (contrato ${versaoContrato}) em ${config.urlPublica}`);
  const fechar = async () => { pararWorker(); await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', fechar); process.on('SIGINT', fechar);
}
export { STATUS_POR_CODIGO };
