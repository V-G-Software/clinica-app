// Servidor mock (F0). Diretório em /diretorio, organizações em /o/{slug}, utilitários em /__mock.
// Toda requisição e toda resposta são validadas contra contrato/openapi.yaml: resposta fora do
// contrato vira 500 com o cabeçalho X-Mock-Violacao, para o mock nunca se afastar do padrão.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { encontrarOperacao, validarRequisicao, validarResposta, versaoContrato } from '@clinica/contrato-validador';
import * as auth from './auth.ts';
import {
  agendar, caixaEmails, caixaPush, ErroApi, eventoPublico, limparJobs, reiniciarIds, listarJobs, novaOrg, novoId, orgs, processarJobsAte, STATUS_POR_CODIGO, type Org,
} from './estado.ts';
import { handlers, type Res } from './handlers.ts';
import { carregarAgenda } from './agenda.ts';
import { carregarExames } from './exames.ts';
import { autorizarNoPsc, carregarDocumentos } from './documentos.ts';
import * as r from './regras.ts';
import { agoraIso, agoraMs, comRelogioForcado, DIA, definirRelogio, HORA, iso, RELOGIO_INICIAL } from './tempo.ts';

const PORTA = Number(process.env.PORT ?? 4010);
const DIR_CENARIOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contrato/exemplos/cenarios');
const ESTRITO = process.env.MOCK_VALIDAR_RESPOSTA !== '0';

// ─────────── Carga dos cenários ───────────
function carregarCenario(cenario: any) {
  cenario.__versaoContrato = versaoContrato;
  const org = novaOrg(cenario);
  orgs.set(org.slug, org);
  const termosAtuais = org.config.autenticacao.termosVersao;
  for (const s of cenario.usuarios) {
    const u = {
      ...auth.novaContaPaciente(org, { id: s.id, nome: s.nome, email: s.email }),
      nomeExibicao: s.nomeExibicao ?? s.nome, senha: s.senha ?? null, perfis: s.perfis, mfaSegredo: s.mfaSegredo ?? null,
      codigosRecuperacao: s.mfaSegredo ? ['RECUPERA-0001', 'RECUPERA-0002', 'RECUPERA-0003'] : [],
      trocarSenha: !!s.trocarSenha, termosAceitosVersao: s.termosAceitos === false ? null : termosAtuais,
      rotulosPerfis: s.rotulosPerfis ?? {}, profissional: s.profissional ?? null, vinculos: s.vinculos ?? [], criadoEm: '2026-10-01T12:00:00Z',
    };
    org.usuarios.set(u.id, u);
    if (s.push) {
      const id = `psi_${u.id}`;
      org.inscricoesPush.set(id, { id, usuarioId: u.id, endpoint: `https://push.exemplo/envio/${u.id}`, keys: { p256dh: 'exemplo', auth: 'exemplo' }, dispositivo: 'iPhone (Safari)', criadoEm: '2026-10-01T12:00:00Z' });
    }
  }
  for (const f of cenario.formularios) org.formularios.set(f.id, [{ ...f, publicadoEm: '2026-10-01T12:00:00Z' }]);
  for (const p of cenario.protocolos) org.protocolos.set(p.id, [structuredClone(p)]);
  for (const p of cenario.pacientes) {
    const { convite, $comentario, ...dados } = p;
    org.pacientes.set(p.id, { nomeSocial: null, camposAdicionais: {}, responsaveis: [], ...dados, status: 'ATIVO', _v: 1 });
    if (convite) {
      const email = p.contato?.email ?? p.responsaveis?.[0]?.contato?.email ?? null;
      org.convites.set(convite.token, { id: `cnt_${p.id}`, token: convite.token, tipo: 'PACIENTE', pacienteId: p.id, email, relacao: p.tipo === 'ANIMAL' ? 'ANIMAL' : 'PROPRIO', nome: p.nome, nomeConta: p.nome, criadoPor: convite.criadoPor, criadoEm: p.criadoEm, expiraEm: iso(Date.parse(p.criadoEm) + 7 * DIA), usadoEm: null });
    }
  }
  // Linha do tempo do cenário: tudo passa pelos mesmos jobs que o relógio dispara (RN-ACO).
  // Procedimento da agenda que originou o acompanhamento (RN-AGE-008): a ligação vem do agendamento no cenário.
  const agendamentoDe = new Map<string, string>((cenario.agenda?.agendamentos ?? []).filter((x: any) => x.acompanhamentoId).map((x: any) => [x.acompanhamentoId, x.id]));
  for (const a of cenario.acompanhamentos ?? []) {
    agendar(`seed:${a.id}:criar`, Date.parse(a.criadoEm), () => r.criarAcompanhamento(org, { ...a, agendamentoId: agendamentoDe.get(a.id) ?? null, seed: a }));
    for (const [i, m] of (a.mensagens ?? []).entries())
      agendar(`seed:${a.id}:msg:${i}`, Date.parse(m.em), () => r.postarMensagem(org, org.conversas.get(org.acompanhamentos.get(a.id).conversaId), { tipo: 'TEXTO', autorId: m.autorId, texto: m.texto, idCliente: crypto.randomUUID() }));
    for (const [i, x] of (a.resolverAlertas ?? []).entries())
      agendar(`seed:${a.id}:resolver:${i}`, Date.parse(x.em), () => { for (const al of org.alertas.values()) if (al.acompanhamentoId === a.id && al.status === 'ABERTO') r.resolverAlerta(org, al, x.por, x.nota); });
    if (a.arquivarConversaEm) agendar(`seed:${a.id}:arquivar`, Date.parse(a.arquivarConversaEm), () => { const c = org.conversas.get(org.acompanhamentos.get(a.id).conversaId); if (c) c.status = 'ARQUIVADA'; });
    if (a.encerrar) agendar(`seed:${a.id}:encerrar`, Date.parse(a.encerrar.em), () => r.encerrarAcompanhamento(org, org.acompanhamentos.get(a.id), a.encerrar.motivo, a.encerrar.por));
  }
  carregarAgenda(org, cenario);
  carregarExames(org, cenario, r.arquivoDeExemplo);
  carregarDocumentos(org, cenario);
  for (const c of cenario.conversas ?? []) {
    agendar(`seed:${c.id}:criar`, Date.parse(c.criadoEm), () => {
      const conv = r.criarConversa(org, c.pacienteId, c.participantesIds);
      org.conversas.delete(conv.id); org.mensagens.delete(conv.id);
      conv.id = c.id; org.conversas.set(c.id, conv); org.mensagens.set(c.id, []);
    });
    for (const [i, m] of (c.mensagens ?? []).entries())
      agendar(`seed:${c.id}:msg:${i}`, Date.parse(m.em) + 1, () => r.postarMensagem(org, org.conversas.get(c.id), { tipo: 'TEXTO', autorId: m.autorId, texto: m.texto, idCliente: crypto.randomUUID() }));
  }
  return org;
}
function carregarTudo() {
  orgs.clear(); limparJobs(); reiniciarIds(); caixaEmails.length = 0; caixaPush.length = 0;
  for (const arq of readdirSync(DIR_CENARIOS).filter((f) => f.endsWith('.json')).sort())
    carregarCenario(JSON.parse(readFileSync(path.join(DIR_CENARIOS, arq), 'utf8')));
  const inicial = Date.parse(RELOGIO_INICIAL);
  processarJobsAte(inicial);
  // As caixas de saída começam limpas: o histórico do seed não é "novo" para quem testa.
  caixaEmails.length = 0; caixaPush.length = 0;
  definirRelogio(inicial);
}

// ─────────── Servidor ───────────
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 20 * 1024 * 1024, trustProxy: true });
app.removeAllContentTypeParsers();
app.addContentTypeParser(['application/json', 'application/problem+json'], { parseAs: 'string' }, (_req, corpo, feito) => {
  if (corpo === '' || corpo === undefined) return feito(null, undefined);
  try { feito(null, JSON.parse(corpo as string)); } catch { feito(new ErroApi('VALIDACAO_FALHOU', 'JSON malformado.') as any, undefined); }
});
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, corpo, feito) => feito(null, corpo));

const ORIGENS_LOCAIS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/;
function cabecalhosCors(origem: string | undefined, org?: Org): Record<string, string> {
  if (!origem) return {};
  const permitida = ORIGENS_LOCAIS.test(origem) || (org?.config.dominios ?? []).some((d: string) => origem === `https://${d}`);
  if (!permitida) return {};
  return {
    'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match, X-Request-Id, X-Cliente, X-Cliente-Versao, Last-Event-ID, X-Mock-Atraso-Ms, X-Mock-Erro',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'ETag, X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-Mock-Violacao',
    'Access-Control-Max-Age': '600',
  };
}
app.addHook('onRequest', async (req, reply) => {
  const slug = (req.params as any)?.slug ?? req.url.match(/^\/o\/([^/?]+)/)?.[1];
  reply.headers(cabecalhosCors(req.headers.origin, slug ? orgs.get(slug) : undefined));
  if (req.method === 'OPTIONS') return reply.code(204).send();
  processarJobsAte(agoraMs());
});

const reqId = (req: FastifyRequest) => (typeof req.headers['x-request-id'] === 'string' && /^[\w.-]{1,100}$/.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : novoId('req'));
function enviarProblema(reply: FastifyReply, e: ErroApi, requestId: string, instance?: string) {
  if (e.status === 429) reply.header('Retry-After', '60');
  return reply.code(e.status).type('application/problem+json').send(e.problema(requestId, instance));
}
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// ─────────── Diretório ───────────
const orgDiretorio = (org: Org) => ({ slug: org.slug, nome: org.config.nome, urlApi: r.urlApi(org), contratoVersao: versaoContrato, status: org.config.status });
async function rotaDiretorio(req: FastifyRequest, reply: FastifyReply) {
  const id = reqId(req);
  reply.header('X-Request-Id', id);
  const caminho = req.url.split('?')[0].replace(/^\/diretorio/, '');
  const achada = encontrarOperacao(req.method, caminho);
  if (!achada || achada.operacao.tag !== 'diretorio') return enviarProblema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Rota inexistente.'), id);
  const v = validarRequisicao(achada.operacao.operationId, { params: achada.params, query: req.query as any, headers: req.headers });
  if (!v.ok) return enviarProblema(reply, new ErroApi('VALIDACAO_FALHOU', 'Requisição inválida.', { campos: v.erros }), id);
  const org = achada.operacao.operationId === 'diretorioObterOrganizacao'
    ? orgs.get(achada.params.slug)
    : [...orgs.values()].find((o) => (o.config.dominios ?? []).includes(String((req.query as any).dominio).toLowerCase()));
  if (!org) return enviarProblema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Organização desconhecida.'), id);
  return reply.header('Cache-Control', 'max-age=60').send(orgDiretorio(org));
}
app.get('/diretorio/v1/organizacoes', rotaDiretorio);
app.get('/diretorio/v1/organizacoes/:slug', rotaDiretorio);

// ─────────── Organizações ───────────
const SEM_AUTH_MAS_LOGADO = new Set(['authSair']);
function lerCookie(req: FastifyRequest, nome: string) {
  return (req.headers.cookie ?? '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === nome)?.slice(1).join('=') || undefined;
}

app.route({
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  url: '/o/:slug/*',
  handler: async (req, reply) => {
    const requestId = reqId(req);
    reply.header('X-Request-Id', requestId);
    const org = orgs.get((req.params as any).slug);
    if (!org) return enviarProblema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Organização desconhecida.'), requestId);
    const caminho = '/' + (req.params as any)['*'].split('?')[0];
    const instance = `${r.urlApi(org)}${caminho}`;

    const atraso = Number(req.headers['x-mock-atraso-ms'] ?? 0);
    if (atraso > 0) await esperar(Math.min(atraso, 30_000));

    const achada = encontrarOperacao(req.method, caminho);
    if (!achada || achada.operacao.tag === 'diretorio') return enviarProblema(reply, new ErroApi('RECURSO_NAO_ENCONTRADO', 'Rota inexistente no contrato.'), requestId, instance);
    const op = achada.operacao;

    const erroForcado = req.headers['x-mock-erro'];
    if (typeof erroForcado === 'string' && erroForcado) {
      const status = /^\d{3}$/.test(erroForcado) ? Number(erroForcado) : STATUS_POR_CODIGO[erroForcado] ?? 500;
      const codigo = /^\d{3}$/.test(erroForcado) ? Object.entries(STATUS_POR_CODIGO).find(([, s]) => s === status)?.[0] ?? 'INDISPONIVEL_TEMPORARIAMENTE' : STATUS_POR_CODIGO[erroForcado] ? erroForcado : 'INDISPONIVEL_TEMPORARIAMENTE';
      return enviarProblema(reply, new ErroApi(codigo, 'Erro simulado pelo cabeçalho X-Mock-Erro.', {}, status), requestId, instance);
    }

    try {
      if (op.tag !== 'publico' && org.config.status === 'MANUTENCAO') throw new ErroApi('INDISPONIVEL_TEMPORARIAMENTE', org.config.mensagemStatus ?? 'Em manutenção.');
      if (op.tag !== 'publico' && org.config.status === 'SUSPENSA') throw new ErroApi('ORGANIZACAO_SUSPENSA');

      const temCorpo = req.body !== undefined && !Buffer.isBuffer(req.body);
      if (Buffer.isBuffer(req.body) && op.op.requestBody) throw new ErroApi('VALIDACAO_FALHOU', 'Envie Content-Type: application/json.', {}, 415);
      const v = validarRequisicao(op.operationId, { params: achada.params, query: req.query as any, headers: req.headers, body: req.body, temCorpo });
      if (!v.ok) throw new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: v.erros });

      const ctx = !op.publico || SEM_AUTH_MAS_LOGADO.has(op.operationId) ? auth.autenticar(org, req.headers.authorization, requestId) : null;
      if (op.operationId === 'eventosStream') return abrirStream(req, reply, org, ctx!, requestId);

      // Idempotência (4.7): mesma chave devolve a mesma resposta por 24 h, sem repetir o efeito.
      let chaveIdem: string | null = null;
      const hashCorpo = createHash('sha1').update(JSON.stringify(req.body ?? null) + caminho).digest('hex');
      if (op.idempotente) {
        chaveIdem = `${ctx?.usuario.id ?? req.ip}:${op.operationId}:${req.headers['idempotency-key']}`;
        const salvo = org.idempotencia.get(chaveIdem);
        if (salvo && agoraMs() - salvo.em < DIA) {
          if (salvo.hash !== hashCorpo) throw new ErroApi('VALIDACAO_FALHOU', 'Idempotency-Key já usada com outro conteúdo.', { campos: [{ campo: 'Idempotency-Key', codigo: 'REUTILIZADA', mensagem: 'Gere uma nova chave para uma nova operação.' }] });
          reply.header('Idempotent-Replayed', 'true');
          return responder(reply, op.operationId, salvo.res, requestId, instance);
        }
      }

      const res = handlers[op.operationId]({
        org, ctx, params: achada.params, query: v.query, body: req.body, headers: req.headers as any, ip: req.ip,
        nativo: req.headers['x-cliente'] === 'NATIVO', cookieRenovacao: lerCookie(req, 'renovacao'),
      });
      if (chaveIdem && res.status < 500) org.idempotencia.set(chaveIdem, { em: agoraMs(), hash: hashCorpo, res });
      processarJobsAte(agoraMs()); // efeitos imediatos (ex.: check-in retroativo disponível)
      return responder(reply, op.operationId, res, requestId, instance);
    } catch (e) {
      if (e instanceof ErroApi) return enviarProblema(reply, e, requestId, instance);
      req.log.error({ err: e }, 'erro inesperado no mock');
      return enviarProblema(reply, new ErroApi('INDISPONIVEL_TEMPORARIAMENTE', 'Erro inesperado no mock.', {}, 500), requestId, instance);
    }
  },
});

function responder(reply: FastifyReply, operationId: string, res: Res, requestId: string, instance: string) {
  if (res.headers) reply.headers(res.headers);
  if (res.cookie) reply.header('Set-Cookie', res.cookie);
  const v = validarResposta(operationId, res.status, res.body === undefined ? undefined : 'application/json', res.body);
  if (!v.ok) {
    reply.log.error({ operationId, status: res.status, violacoes: v.erros }, 'RESPOSTA FORA DO CONTRATO');
    if (ESTRITO) {
      reply.header('X-Mock-Violacao', 'resposta');
      return enviarProblema(reply, new ErroApi('INDISPONIVEL_TEMPORARIAMENTE', `Mock gerou resposta fora do contrato em ${operationId}: ${v.erros.map((x) => x.mensagem).join('; ')}`.slice(0, 1500), {}, 500), requestId, instance);
    }
  }
  if (res.body === undefined) return reply.code(res.status).send();
  return reply.code(res.status).type('application/json').send(res.body);
}

// ─────────── SSE (8.4) ───────────
function abrirStream(req: FastifyRequest, reply: FastifyReply, org: Org, ctx: r.Ctx, requestId: string) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', 'X-Request-Id': requestId, ...cabecalhosCors(req.headers.origin, org),
  });
  const escrever = (e: any) => raw.write(`id: ${e.id}\nevent: ${e.tipo}\ndata: ${JSON.stringify(eventoPublico(e))}\n\n`);
  raw.write('retry: 3000\n\n');
  const ultimo = req.headers['last-event-id'];
  if (typeof ultimo === 'string') {
    const seq = Number(ultimo.replace(/^evt_/, ''));
    const maisAntigo = org.eventos[0]?.seq ?? org.seqEvento + 1;
    if (!Number.isFinite(seq) || (seq < maisAntigo - 1 && org.eventos.length)) {
      raw.write(`event: erro\ndata: ${JSON.stringify({ codigo: 'CURSOR_EXPIRADO' })}\n\n`); // o frontend recarrega as listas
    } else for (const e of org.eventos) if (e.seq > seq && e.para.has(ctx.usuario.id)) escrever(e);
  }
  const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);
  const ouvinte = {
    usuarioId: ctx.usuario.id, sessaoId: ctx.sessao.id, enviar: escrever,
    fechar: () => { clearInterval(ping); org.ouvintes.delete(ouvinte); raw.end(); },
  };
  org.ouvintes.add(ouvinte);
  req.raw.on('close', () => { clearInterval(ping); org.ouvintes.delete(ouvinte); });
}

// ─────────── /__mock (fora do contrato) ───────────
const exigirOrg = (slug: string) => { const o = orgs.get(slug); if (!o) throw Object.assign(new Error('organização desconhecida'), { statusCode: 404 }); return o; };

app.get('/__mock/relogio', async () => ({ agora: agoraIso(), proximosJobs: listarJobs().slice(0, 30) }));
app.post('/__mock/relogio', async (req) => {
  const b = (req.body ?? {}) as any;
  const alvo = b.definir ? Date.parse(b.definir) : agoraMs() + (Number(b.avancarDias ?? 0) * DIA) + (Number(b.avancarHoras ?? 0) * HORA) + (Number(b.avancarMinutos ?? 0) * 60_000);
  if (!Number.isFinite(alvo) || alvo < agoraMs()) throw Object.assign(new Error('o relógio só anda para frente'), { statusCode: 422 });
  const executados = processarJobsAte(alvo);
  definirRelogio(alvo);
  return { agora: agoraIso(), jobsExecutados: executados, proximosJobs: listarJobs().slice(0, 10) };
});
app.post('/__mock/reiniciar', async () => { carregarTudo(); return { ok: true, agora: agoraIso() }; });
app.get('/__mock/emails', async (req) => { const q = req.query as any; return caixaEmails.filter((e) => (!q.org || e.org === q.org) && (!q.para || e.para === q.para)).slice(0, 100); });
app.get('/__mock/push', async (req) => { const q = req.query as any; return caixaPush.filter((e) => (!q.org || e.org === q.org) && (!q.usuarioId || e.usuarioId === q.usuarioId)).slice(0, 100); });
app.get('/__mock/cenarios', async () => [...orgs.values()].map((o) => ({
  slug: o.slug, nome: o.config.nome, diretorio: `${r.BASE_PUBLICA}/diretorio/v1/organizacoes/${o.slug}`, urlApi: r.urlApi(o),
  logins: o.cenario.usuarios.map((u: any) => ({ id: u.id, nome: u.nome, email: u.email, perfis: u.perfis, ...(u.senha ? { senha: u.senha, mfa: u.mfaSegredo ? `TOTP ${auth.TOTP_FIXO} ou segredo ${u.mfaSegredo}` : 'configurar no 1º acesso' } : { codigoEmail: auth.CODIGO_EMAIL_FIXO }) })),
  convitesPendentes: [...o.convites.values()].filter((c) => !c.usadoEm && !c.revogadoEm).map((c) => ({ tipo: c.tipo, nome: c.nome, link: `${process.env.MOCK_URL_FRONTEND ?? 'http://localhost:5173'}/convite/${c.token}?org=${o.slug}` })),
})));
app.post('/__mock/simular/mensagem', async (req) => {
  const b = req.body as any;
  const org = exigirOrg(b.org);
  const c = org.conversas.get(b.conversaId);
  if (!c) throw Object.assign(new Error('conversa desconhecida'), { statusCode: 404 });
  const autorId = b.autorId ?? r.participantesAtivos(c).find((id: string) => org.usuarios.get(id)!.perfis.includes('PACIENTE')) ?? r.participantesAtivos(c)[0];
  return r.serMensagem(org, r.postarMensagem(org, c, { tipo: 'TEXTO', autorId, texto: b.texto ?? 'Mensagem simulada.', idCliente: crypto.randomUUID() }));
});
app.post('/__mock/simular/checkin', async (req) => {
  const b = req.body as any;
  const org = exigirOrg(b.org);
  const c = org.checkins.get(b.checkinId);
  if (!c) throw Object.assign(new Error('check-in desconhecido'), { statusCode: 404 });
  const conta = r.contasIdsDoPaciente(org, c.pacienteId)[0];
  if (!conta) throw Object.assign(new Error('paciente sem conta no app'), { statusCode: 422 });
  const respostas = b.respostas ?? Object.fromEntries(c.formulario.campos.filter((f: any) => f.obrigatorio && !f.visivelSe).map((f: any) => [f.id,
    f.tipo === 'ESCALA' || f.tipo === 'NUMERO' ? f.min ?? 0 : f.tipo === 'SIM_NAO' ? false : f.tipo === 'ESCOLHA_UNICA' ? f.opcoes[0].valor : f.tipo === 'ESCOLHA_MULTIPLA' ? [f.opcoes[0].valor] : f.tipo === 'FOTO' ? [r.fotoDeExemplo(org, conta)] : f.tipo === 'DATA' ? agoraIso().slice(0, 10) : f.tipo === 'HORA' ? '09:00' : 'ok']));
  try { r.responderCheckin(org, c, respostas, conta); } catch (e) { if (e instanceof ErroApi) throw Object.assign(new Error(JSON.stringify(e.problema('mock'))), { statusCode: e.status }); throw e; }
  return { ok: true, checkinId: c.id, status: c.status, alertas: [...org.alertas.values()].filter((a) => a.checkinId === c.id).map((a) => a.mensagem) };
});
app.put('/__mock/envios/:slug/:id', async (req, reply) => {
  const { slug, id } = req.params as any;
  const q = req.query as any;
  const a = exigirOrg(slug).arquivos.get(id);
  if (!a || a.assinatura !== q.assinatura || Number(q.exp) < agoraMs()) return reply.code(403).send({ erro: 'assinatura inválida ou expirada' });
  if (req.headers['content-type'] !== a.tipo) return reply.code(400).send({ erro: 'Content-Type diferente do declarado' });
  a.bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));
  return reply.code(200).send();
});
// "App do provedor" de assinatura (PSC simulado, ADR-0018): autoriza na hora e volta ao retorno público.
app.get('/__mock/psc/:slug/autorizar', async (req, reply) => {
  const org = exigirOrg((req.params as any).slug);
  return reply.redirect(autorizarNoPsc(org, String((req.query as any).state ?? '')), 302);
});
app.get('/__mock/arquivos/:slug/:id', async (req, reply) => {
  const { slug, id } = req.params as any;
  const q = req.query as any;
  const a = exigirOrg(slug).arquivos.get(id);
  if (!a || a.status !== 'DISPONIVEL' || !a.bytes) return reply.code(404).send();
  if (!(a.publico && q.publico) && Number(q.exp) < agoraMs()) return reply.code(403).send({ erro: 'URL expirada; peça de novo em GET /v1/arquivos/{id}' });
  // PDF sempre como anexo: o app não renderiza PDF na própria origem (ADR-0017).
  if (a.tipo === 'application/pdf') reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(a.nome)}"`);
  return reply.header('Cache-Control', 'private, max-age=60').type(a.tipo).send(a.bytes);
});

// ─────────── Início ───────────
carregarTudo();
setInterval(() => processarJobsAte(agoraMs()), 1000).unref();
app.listen({ port: PORTA, host: process.env.HOST ?? '0.0.0.0' }).then(() => {
  app.log.info(`Mock do contrato ${versaoContrato} em ${r.BASE_PUBLICA} — relógio em ${agoraIso()}`);
  for (const o of orgs.values()) app.log.info(`  ${o.slug.padEnd(16)} ${r.urlApi(o)}`);
});
export { app, comRelogioForcado };
