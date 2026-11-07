// Módulo exames (ADR-0017): pedidos e resultados. O paciente só vê o que é dos pacientes vinculados à
// conta (o resto é 404); pedir e revisar são da equipe com permissão; enviar, do paciente e da equipe.
import { todos, um, type Tx } from '../db.ts';
import { invalido, naoEncontrado, negado } from '../erros.ts';
import { C, criado, ok, type Handler, type Req } from '../http.ts';
import { auditar, ehEquipeCtx, etag, exigir, exigirModulo, lerCursor, pagina, type Ctx } from '../nucleo.ts';
import { cfgExames, criarPedido, criarResultado, finalizarPedido, revisarResultado, serPedidos, serResultados } from '../servicos/exames.ts';
import { obterPaciente } from './pacientes.ts';

const audit = (q: Req, acao: string, recurso: string, id: string) => auditar(q.tx, q.org.id, { usuarioId: q.ctx?.usuario.id ?? null, acao, recurso, recursoId: id, ip: q.ip, requestId: q.requestId });
const ctxExames = (q: Req) => { exigirModulo(q.org, 'exames'); return C(q); };

function filtroPaciente(ctx: Ctx, n: number) {
  if (ehEquipeCtx(ctx)) return { sql: '', params: [] as unknown[] };
  return { sql: ` AND paciente_id IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $${n})`, params: [ctx.usuario.id] };
}
async function obter(tx: Tx, ctx: Ctx, tabela: 'pedidos_exame' | 'resultados_exame', id: string, nome: string) {
  if (!ctx.perms.has('exames.exame.ler')) throw naoEncontrado(nome);
  const f = filtroPaciente(ctx, 3);
  const x = await um(tx, `SELECT * FROM ${tabela} WHERE organizacao_id = $1 AND id = $2${f.sql} FOR UPDATE`, [ctx.org.id, id, ...f.params]);
  if (!x) throw naoEncontrado(nome);
  return x;
}
async function listar(q: Req, tabela: 'pedidos_exame' | 'resultados_exame', filtros: Record<string, string>) {
  const ctx = ctxExames(q);
  exigir(ctx, 'exames.exame.ler');
  const f = filtroPaciente(ctx, 2);
  const params: unknown[] = [q.org.id, ...f.params];
  let where = f.sql;
  for (const [campo, coluna] of Object.entries(filtros)) if (q.query[campo]) { params.push(q.query[campo]); where += ` AND ${coluna} = $${params.length}`; }
  const limite = q.query.limite ?? 20;
  const off = lerCursor(q.query.cursor);
  const linhas = await todos(q.tx, `SELECT * FROM ${tabela} WHERE organizacao_id = $1${where} ORDER BY criado_em DESC, id DESC OFFSET ${off} LIMIT ${limite + 1}`, params);
  return { ctx, p: pagina(linhas, off, limite) };
}
const umPedido = async (tx: Tx, ctx: Ctx, p: any) => (await serPedidos(tx, ctx, [p]))[0];
const umResultado = async (tx: Tx, ctx: Ctx, x: any) => (await serResultados(tx, ctx, [x]))[0];

export const handlersExames: Record<string, Handler> = {
  examesListarPedidos: async (q) => {
    const { ctx, p } = await listar(q, 'pedidos_exame', { pacienteId: 'paciente_id', status: 'status' });
    return ok({ ...p, itens: await serPedidos(q.tx, ctx, p.itens) });
  },
  examesCriarPedido: async (q) => {
    const ctx = ctxExames(q);
    exigir(ctx, 'exames.pedido.criar');
    if (!ehEquipeCtx(ctx)) throw negado();
    const pac = await obterPaciente(q.tx, ctx, q.body.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const p = await criarPedido(q.tx, q.org, { pacienteId: pac.id, solicitanteId: ctx.usuario.id, itens: q.body.itens, orientacoes: q.body.orientacoes, observacao: q.body.observacao }, q.log);
    await audit(q, 'CRIAR', 'pedido_exame', p.id);
    return criado(await umPedido(q.tx, ctx, p), { ETag: etag(p.id, p.versao) });
  },
  examesObterPedido: async (q) => {
    const ctx = ctxExames(q);
    const p = await obter(q.tx, ctx, 'pedidos_exame', q.params.pedidoId, 'Pedido');
    return ok(await umPedido(q.tx, ctx, p), { ETag: etag(p.id, p.versao) });
  },
  examesConcluirPedido: async (q) => {
    const ctx = ctxExames(q);
    const p = await obter(q.tx, ctx, 'pedidos_exame', q.params.pedidoId, 'Pedido');
    if (!ehEquipeCtx(ctx)) throw negado();
    exigir(ctx, 'exames.pedido.criar');
    const r = await finalizarPedido(q.tx, q.org, p, 'CONCLUIDO', null);
    if (r !== p) await audit(q, 'CONCLUIR', 'pedido_exame', p.id);
    return ok(await umPedido(q.tx, ctx, r));
  },
  examesCancelarPedido: async (q) => {
    const ctx = ctxExames(q);
    const p = await obter(q.tx, ctx, 'pedidos_exame', q.params.pedidoId, 'Pedido');
    if (!ehEquipeCtx(ctx)) throw negado();
    exigir(ctx, 'exames.pedido.criar');
    const r = await finalizarPedido(q.tx, q.org, p, 'CANCELADO', q.body.motivo);
    if (r !== p) await audit(q, 'CANCELAR', 'pedido_exame', p.id);
    return ok(await umPedido(q.tx, ctx, r));
  },
  examesListarResultados: async (q) => {
    const { ctx, p } = await listar(q, 'resultados_exame', { pacienteId: 'paciente_id', pedidoId: 'pedido_id', status: 'status' });
    return ok({ ...p, itens: await serResultados(q.tx, ctx, p.itens) });
  },
  examesEnviarResultado: async (q) => {
    const ctx = ctxExames(q);
    exigir(ctx, 'exames.resultado.enviar');
    const b = q.body;
    const equipe = ehEquipeCtx(ctx);
    if (!equipe && !cfgExames(q.org).pacienteEnviaResultados) throw negado();
    const pac = await obterPaciente(q.tx, ctx, b.pacienteId);
    if (b.pedidoId) {
      const p = await um(q.tx, 'SELECT paciente_id, status FROM pedidos_exame WHERE organizacao_id = $1 AND id = $2 FOR UPDATE', [q.org.id, b.pedidoId]);
      if (!p || p.paciente_id !== pac.id) throw invalido('pedidoId', 'Pedido não encontrado para este paciente.');
      if (p.status !== 'ABERTO') throw invalido('pedidoId', 'Este pedido já foi finalizado.');
    }
    // RN-EXA-003: só arquivo da própria conta, de exame e já processado (FOR UPDATE: sem corrida com outro envio).
    const ids = b.arquivosIds as string[];
    const arqs = new Map((await todos(q.tx, 'SELECT * FROM arquivos WHERE organizacao_id = $1 AND id = ANY($2) FOR UPDATE', [q.org.id, ids])).map((a) => [a.id, a]));
    for (const [i, id] of ids.entries()) {
      const a = arqs.get(id);
      if (!a || a.dono_id !== ctx.usuario.id || a.finalidade !== 'EXAME') throw invalido(`arquivosIds.${i}`, 'Arquivo não encontrado.');
      if (a.status !== 'DISPONIVEL') throw invalido(`arquivosIds.${i}`, a.status === 'REJEITADO' ? 'Arquivo recusado.' : 'Arquivo ainda em processamento.');
    }
    const x = await criarResultado(q.tx, q.org, { pacienteId: pac.id, pedidoId: b.pedidoId ?? null, titulo: b.titulo, dataColeta: b.dataColeta ?? null, arquivosIds: ids, comentario: b.comentario ?? null, enviadoPor: ctx.usuario.id, origem: equipe ? 'EQUIPE' : 'PACIENTE' }, q.log);
    await audit(q, 'CRIAR', 'resultado_exame', x.id);
    return criado(await umResultado(q.tx, ctx, x));
  },
  examesObterResultado: async (q) => {
    const ctx = ctxExames(q);
    return ok(await umResultado(q.tx, ctx, await obter(q.tx, ctx, 'resultados_exame', q.params.resultadoId, 'Resultado')));
  },
  examesRevisarResultado: async (q) => {
    const ctx = ctxExames(q);
    const x = await obter(q.tx, ctx, 'resultados_exame', q.params.resultadoId, 'Resultado');
    if (!ehEquipeCtx(ctx)) throw negado();
    exigir(ctx, 'exames.resultado.revisar');
    const r = await revisarResultado(q.tx, q.org, x, ctx.usuario.id, q.body?.nota ?? null, q.log);
    if (r !== x) await audit(q, 'REVISAR', 'resultado_exame', x.id);
    return ok(await umResultado(q.tx, ctx, r));
  },
};
