// Módulo documentos (ADR-0018): receita e atestado. O paciente só vê assinados/anulados dos pacientes
// vinculados (rascunho é 404 para ele); emitir, editar, descartar e assinar são do próprio emissor.
import { todos, um, type Tx } from '../db.ts';
import { invalido, naoEncontrado, negado } from '../erros.ts';
import { C, criado, ok, type Handler, type Req } from '../http.ts';
import { auditar, conferirIfMatch, ehEquipeCtx, etag, exigir, exigirModulo, lerCursor, limitar, pagina, type Ctx } from '../nucleo.ts';
import {
  anular, cfgDocumentos, criarDocumento, iniciarSessao, normAtestado, normReceita, retorno, serDocumentos, serSessao, validacaoPublica, validarConteudo,
} from '../servicos/documentos.ts';
import { obterPaciente } from './pacientes.ts';

const audit = (q: Req, acao: string, id: string, recurso = 'documento') => auditar(q.tx, q.org.id, { usuarioId: q.ctx?.usuario.id ?? null, acao, recurso, recursoId: id, ip: q.ip, requestId: q.requestId });
const ctxDoc = (q: Req) => { exigirModulo(q.org, 'documentos'); return C(q); };
/** Paciente: só dos vinculados e só assinado/anulado (documento sem assinatura nunca chega a ele). */
function filtro(ctx: Ctx, n: number) {
  if (ehEquipeCtx(ctx)) return { sql: '', params: [] as unknown[] };
  return { sql: ` AND status IN ('ASSINADO','ANULADO') AND paciente_id IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $${n})`, params: [ctx.usuario.id] };
}
async function obter(tx: Tx, ctx: Ctx, id: string) {
  if (!ctx.perms.has('documentos.documento.ler')) throw naoEncontrado('Documento');
  const f = filtro(ctx, 3);
  const d = await um(tx, `SELECT * FROM documentos WHERE organizacao_id = $1 AND id = $2${f.sql} FOR UPDATE`, [ctx.org.id, id, ...f.params]);
  if (!d) throw naoEncontrado('Documento');
  return d;
}
function exigirEmissor(ctx: Ctx, d?: any) {
  if (!ehEquipeCtx(ctx)) throw negado();
  exigir(ctx, 'documentos.documento.emitir');
  if (d && d.emissor_id !== ctx.usuario.id) throw negado('Só quem emitiu pode mudar este documento.');
}
const um1 = async (tx: Tx, ctx: Ctx, d: any) => (await serDocumentos(tx, ctx, [d]))[0];

export const handlersDocumentos: Record<string, Handler> = {
  documentosListar: async (q) => {
    const ctx = ctxDoc(q);
    exigir(ctx, 'documentos.documento.ler');
    const f = filtro(ctx, 2);
    const params: unknown[] = [q.org.id, ...f.params];
    let where = f.sql;
    for (const [campo, coluna] of Object.entries({ pacienteId: 'paciente_id', tipo: 'tipo', status: 'status', emissorId: 'emissor_id' }))
      if (q.query[campo]) { params.push(q.query[campo]); where += ` AND ${coluna} = $${params.length}`; }
    const limite = q.query.limite ?? 20;
    const off = lerCursor(q.query.cursor);
    const linhas = await todos(q.tx, `SELECT * FROM documentos WHERE organizacao_id = $1${where} ORDER BY criado_em DESC, id DESC OFFSET ${off} LIMIT ${limite + 1}`, params);
    const p = pagina(linhas, off, limite);
    return ok({ ...p, itens: await serDocumentos(q.tx, ctx, p.itens) });
  },
  documentosCriar: async (q) => {
    const ctx = ctxDoc(q);
    exigirEmissor(ctx);
    if (!cfgDocumentos(q.org).tiposPermitidos.includes(q.body.tipo)) throw invalido('tipo', 'Este tipo de documento não está habilitado nesta organização.');
    const pac = await obterPaciente(q.tx, ctx, q.body.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const d = await criarDocumento(q.tx, q.org, { pacienteId: pac.id, emissorId: ctx.usuario.id, tipo: q.body.tipo, receita: q.body.receita, atestado: q.body.atestado });
    await audit(q, 'CRIAR', d.id);
    return criado(await um1(q.tx, ctx, d), { ETag: etag(d.id, d.versao) });
  },
  documentosObter: async (q) => {
    const ctx = ctxDoc(q);
    const d = await obter(q.tx, ctx, q.params.documentoId);
    return ok(await um1(q.tx, ctx, d), { ETag: etag(d.id, d.versao) });
  },
  documentosEditar: async (q) => {
    const ctx = ctxDoc(q);
    const d = await obter(q.tx, ctx, q.params.documentoId);
    exigirEmissor(ctx, d);
    // Estado antes da versão: documento em assinatura ou assinado não muda, qualquer que seja o ETag.
    if (d.status !== 'RASCUNHO') throw invalido('status', d.status === 'ASSINANDO' ? 'O documento está sendo assinado.' : 'Só rascunho pode ser editado.');
    const atual = await um1(q.tx, ctx, d);
    conferirIfMatch(q.headers['if-match'], d.id, d.versao, () => atual);
    const receita = q.body.receita ?? (d.tipo === 'RECEITA' ? d.receita : undefined);
    const atestado = q.body.atestado ?? (d.tipo === 'ATESTADO' ? d.atestado : undefined);
    validarConteudo(d.tipo, receita, atestado);
    const r = (await um(q.tx, `UPDATE documentos SET receita = $3, atestado = $4, erro_assinatura = NULL, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *`,
      [q.org.id, d.id, normReceita(receita) ?? null, normAtestado(atestado) ?? null]))!;
    await audit(q, 'EDITAR', d.id);
    return ok(await um1(q.tx, ctx, r), { ETag: etag(r.id, r.versao) });
  },
  documentosDescartar: async (q) => {
    const ctx = ctxDoc(q);
    const d = await obter(q.tx, ctx, q.params.documentoId);
    exigirEmissor(ctx, d);
    if (d.status === 'DESCARTADO') return ok(await um1(q.tx, ctx, d));
    if (d.status !== 'RASCUNHO') throw invalido('status', 'Só rascunho pode ser descartado.');
    const r = (await um(q.tx, `UPDATE documentos SET status = 'DESCARTADO', versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [q.org.id, d.id]))!;
    await audit(q, 'DESCARTAR', d.id);
    return ok(await um1(q.tx, ctx, r));
  },
  documentosAnular: async (q) => {
    const ctx = ctxDoc(q);
    const d = await obter(q.tx, ctx, q.params.documentoId);
    if (!ehEquipeCtx(ctx)) throw negado();
    exigir(ctx, 'documentos.documento.emitir');
    if (d.emissor_id !== ctx.usuario.id && ctx.perfil !== 'GESTOR') throw negado('Só quem emitiu ou a gestão pode anular.');
    const r = await anular(q.tx, q.org, d, q.body.motivo.trim(), q.log);
    if (r !== d) await audit(q, 'ANULAR', d.id);
    return ok(await um1(q.tx, ctx, r));
  },
  documentosIniciarAssinatura: async (q) => {
    const ctx = ctxDoc(q);
    exigirEmissor(ctx);
    const s = await iniciarSessao(q.tx, ctx, q.body);
    await audit(q, 'INICIAR_ASSINATURA', s.id, 'sessao_assinatura');
    return criado(serSessao(s));
  },
  documentosObterAssinatura: async (q) => {
    const ctx = ctxDoc(q);
    const s = await um(q.tx, 'SELECT * FROM sessoes_assinatura WHERE organizacao_id = $1 AND id = $2', [q.org.id, q.params.sessaoId]);
    if (!s || s.usuario_id !== ctx.usuario.id) throw naoEncontrado('Sessão de assinatura');
    return ok(serSessao(s));
  },
  // Público (sem login): o PSC redireciona o navegador para cá; a proteção é o `state` de uso único.
  documentosRetornoAssinatura: async (q) => {
    exigirModulo(q.org, 'documentos');
    await limitar(q.tx, q.org.id, `assinatura-retorno:ip:${q.ip}`, 60);
    const destino = await retorno(q.tx, q.org, { state: q.query.state, code: q.query.code, error: q.query.error }, q.log);
    return { status: 302, headers: { Location: destino, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } };
  },
  publicoValidarDocumento: async (q) => {
    exigirModulo(q.org, 'documentos');
    await limitar(q.tx, q.org.id, `validacao:ip:${q.ip}`, 120);
    const v = await validacaoPublica(q.tx, q.org, q.params.codigo);
    if (!v) throw naoEncontrado('Documento');
    return ok(v, { 'Cache-Control': 'no-store' });
  },
};
