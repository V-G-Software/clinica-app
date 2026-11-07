// Módulo `exames` no mock (ADR-0017): pedidos de exame, resultados (imagem e PDF) e revisão, com as
// regras RN-EXA-001..006. PDF só na finalidade EXAME; a assinatura EICAR simula o antivírus recusando.
import { agendar, emitir, ErroApi, invalido, naoEncontrado, negado, novoId, type Org } from './estado.ts';
import * as r from './regras.ts';
import { type Ctx } from './regras.ts';
import { agoraIso } from './tempo.ts';

export interface EstadoExames { pedidos: Map<string, any>; resultados: Map<string, any> }
export const examesDe = (org: Org): EstadoExames => {
  const o = org as any;
  o.__exames ??= { pedidos: new Map(), resultados: new Map() };
  return o.__exames;
};
export const cfgExames = (org: Org) => ({ pacienteEnviaResultados: true, ...(r.configModulo(org, 'exames') as { pacienteEnviaResultados?: boolean }) });
const termoExame = (org: Org) => org.termos.exame ?? { singular: 'exame', plural: 'exames', genero: 'M' as const };

// ─────────── Arquivos de exame (PDF, antivírus simulado) ───────────
/** Assinatura de teste padrão dos antivírus (EICAR): o mock recusa como o ClamAV recusaria. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
export const ehPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
export const temVirus = (b: Buffer) => b.includes(Buffer.from(EICAR, 'latin1'));
/** Tipos aceitos por finalidade: PDF só em EXAME (RN-EXA-006). */
export function tiposPermitidos(org: Org, finalidade: string): string[] {
  const up = org.capacidades.upload;
  return finalidade === 'EXAME' ? up.tiposPermitidosExame ?? up.tiposPermitidos : up.tiposPermitidos;
}
export function exigirEnvioDeExame(ctx: Ctx) {
  r.exigirModulo(ctx.org, 'exames');
  r.exigir(ctx, 'exames.resultado.enviar');
}

// ─────────── Visibilidade ───────────
const exigirExames = (org: Org) => r.exigirModulo(org, 'exames');
function obterPedido(ctx: Ctx, id: string) {
  const p = examesDe(ctx.org).pedidos.get(id);
  if (!p || !ctx.perms.has('exames.exame.ler') || !r.podeVerPaciente(ctx, p.pacienteId)) throw naoEncontrado('Pedido');
  return p;
}
function obterResultado(ctx: Ctx, id: string) {
  const x = examesDe(ctx.org).resultados.get(id);
  if (!x || !ctx.perms.has('exames.exame.ler') || !r.podeVerPaciente(ctx, x.pacienteId)) throw naoEncontrado('Resultado');
  return x;
}
/** Quem revisa: solicitante do pedido; sem pedido, os profissionais com permissão de revisar. */
function revisores(org: Org, x: any): string[] {
  const p = x.pedidoId ? examesDe(org).pedidos.get(x.pedidoId) : null;
  const ativo = (id: string) => { const u = org.usuarios.get(id); return !!u && u.status === 'ATIVO' && r.usuarioEhEquipe(u); };
  if (p && ativo(p.solicitanteId)) return [p.solicitanteId];
  return [...org.usuarios.values()].filter((u) => u.status === 'ATIVO' && r.usuarioEhEquipe(u)
    && u.perfis.some((pf) => pf !== 'PACIENTE' && r.permissoesDe(org, pf).includes('exames.resultado.revisar'))).map((u) => u.id);
}
/** Equipe que acompanha os exames em tempo real. */
function equipeDosExames(org: Org): string[] {
  return [...org.usuarios.values()].filter((u) => u.status === 'ATIVO' && r.usuarioEhEquipe(u)
    && u.perfis.some((pf) => pf !== 'PACIENTE' && r.permissoesDe(org, pf).includes('exames.exame.ler'))).map((u) => u.id);
}
const interessados = (org: Org, pacienteId: string) => [...new Set([...equipeDosExames(org), ...r.contasIdsDoPaciente(org, pacienteId)])];

// ─────────── Serialização ───────────
const resumo = (x: any) => ({ id: x.id, titulo: x.titulo, status: x.status, criadoEm: x.criadoEm });
export function serPedido(ctx: Ctx, p: any) {
  const org = ctx.org;
  const equipe = r.ehEquipe(ctx);
  const acoes: string[] = [];
  if (p.status === 'ABERTO') {
    if (ctx.perms.has('exames.resultado.enviar') && (equipe || cfgExames(org).pacienteEnviaResultados)) acoes.push('ENVIAR_RESULTADO');
    if (equipe && ctx.perms.has('exames.pedido.criar')) acoes.push('CONCLUIR', 'CANCELAR');
  }
  const resultados = [...examesDe(org).resultados.values()].filter((x) => x.pedidoId === p.id).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  return {
    id: p.id, paciente: r.refPaciente(org, p.pacienteId), solicitante: r.refUsuario(org, p.solicitanteId, 'PROFISSIONAL'),
    itens: p.itens.map((i: any) => ({ nome: i.nome, orientacoes: i.orientacoes ?? null })),
    orientacoes: p.orientacoes ?? null, observacao: equipe ? p.observacao ?? null : null,
    status: p.status, motivoCancelamento: p.motivoCancelamento ?? null, resultados: resultados.map(resumo),
    criadoEm: p.criadoEm, concluidoEm: p.concluidoEm ?? null, acoesPermitidas: acoes,
  };
}
export function serResultado(ctx: Ctx, x: any) {
  const org = ctx.org;
  const acoes: string[] = [];
  if (x.status === 'AGUARDANDO_REVISAO' && r.ehEquipe(ctx) && ctx.perms.has('exames.resultado.revisar')) acoes.push('REVISAR');
  const autor = org.usuarios.get(x.enviadoPorId);
  return {
    id: x.id, paciente: r.refPaciente(org, x.pacienteId), pedidoId: x.pedidoId ?? null, titulo: x.titulo, dataColeta: x.dataColeta ?? null,
    arquivos: x.arquivosIds.map((id: string) => r.serArquivo(org, org.arquivos.get(id))),
    comentario: x.comentario ?? null, origem: x.origem,
    enviadoPor: r.refUsuario(org, x.enviadoPorId, autor && r.usuarioEhEquipe(autor) ? undefined : 'PACIENTE'),
    status: x.status,
    revisao: x.revisao ? { por: r.refUsuario(org, x.revisao.porId), revisadoEm: x.revisao.em, nota: x.revisao.nota ?? null } : null,
    criadoEm: x.criadoEm, acoesPermitidas: acoes,
  };
}

// ─────────── Regras (RN-EXA) ───────────
export function criarPedido(org: Org, d: { id?: string; pacienteId: string; solicitanteId: string; itens: any[]; orientacoes?: string | null; observacao?: string | null }) {
  const p = {
    id: d.id ?? novoId('ped'), pacienteId: d.pacienteId, solicitanteId: d.solicitanteId,
    itens: d.itens.map((i) => ({ nome: i.nome, orientacoes: i.orientacoes ?? null })), orientacoes: d.orientacoes ?? null, observacao: d.observacao ?? null,
    status: 'ABERTO', motivoCancelamento: null, criadoEm: agoraIso(), concluidoEm: null, _v: 1,
  };
  examesDe(org).pedidos.set(p.id, p);
  emitir(org, 'exames.pedido.atualizado', { pedidoId: p.id }, interessados(org, p.pacienteId));
  const t = termoExame(org);
  for (const uid of r.contasIdsDoPaciente(org, p.pacienteId))
    r.notificarU(org, uid, { tipo: 'EXAME_PEDIDO', titulo: `Pedido de ${t.singular}`, texto: `Há um novo pedido de ${t.singular} para você. Veja as orientações no app.`, destino: { tela: 'exames.pedido', parametros: { pedidoId: p.id } } });
  return p;
}
function finalizarPedido(org: Org, p: any, status: 'CONCLUIDO' | 'CANCELADO', motivo: string | null) {
  if (p.status === status) return p;
  if (p.status !== 'ABERTO') throw invalido('status', 'Este pedido já foi finalizado.');
  p.status = status; p.motivoCancelamento = motivo; if (status === 'CONCLUIDO') p.concluidoEm = agoraIso(); p._v++;
  emitir(org, 'exames.pedido.atualizado', { pedidoId: p.id }, interessados(org, p.pacienteId));
  return p;
}
export const concluirPedido = (org: Org, p: any) => finalizarPedido(org, p, 'CONCLUIDO', null);
export const cancelarPedido = (org: Org, p: any, motivo: string) => finalizarPedido(org, p, 'CANCELADO', motivo);

export function criarResultado(org: Org, d: { id?: string; pacienteId: string; pedidoId?: string | null; titulo: string; dataColeta?: string | null; arquivosIds: string[]; comentario?: string | null; enviadoPorId: string; origem: 'PACIENTE' | 'EQUIPE' }) {
  const x = {
    id: d.id ?? novoId('res'), pacienteId: d.pacienteId, pedidoId: d.pedidoId ?? null, titulo: d.titulo, dataColeta: d.dataColeta ?? null,
    arquivosIds: d.arquivosIds, comentario: d.comentario ?? null, origem: d.origem, enviadoPorId: d.enviadoPorId,
    status: 'AGUARDANDO_REVISAO', revisao: null as any, criadoEm: agoraIso(),
  };
  examesDe(org).resultados.set(x.id, x);
  emitir(org, 'exames.resultado.atualizado', { resultadoId: x.id, ...(x.pedidoId ? { pedidoId: x.pedidoId } : {}) }, interessados(org, x.pacienteId));
  if (x.pedidoId) emitir(org, 'exames.pedido.atualizado', { pedidoId: x.pedidoId }, interessados(org, x.pacienteId));
  const t = termoExame(org);
  const nome = org.pacientes.get(x.pacienteId)?.nome ?? '';
  for (const uid of revisores(org, x))
    r.notificarU(org, uid, { tipo: 'EXAME_RESULTADO', titulo: `Resultado de ${t.singular}`, texto: `${nome} tem um resultado de ${t.singular} para revisar.`, destino: { tela: 'exames.resultado', parametros: { resultadoId: x.id } } });
  for (const uid of equipeDosExames(org)) r.avisarContadores(org)(uid);
  return x;
}
export function revisarResultado(org: Org, x: any, porId: string, nota: string | null) {
  if (x.status === 'REVISADO') return x; // idempotente: não muda autor nem data
  x.status = 'REVISADO'; x.revisao = { porId, em: agoraIso(), nota };
  emitir(org, 'exames.resultado.atualizado', { resultadoId: x.id, ...(x.pedidoId ? { pedidoId: x.pedidoId } : {}) }, interessados(org, x.pacienteId));
  const t = termoExame(org);
  for (const uid of r.contasIdsDoPaciente(org, x.pacienteId))
    r.notificarU(org, uid, { tipo: 'EXAME_REVISADO', titulo: `Resultado de ${t.singular}`, texto: `A equipe revisou seu resultado de ${t.singular}.`, destino: { tela: 'exames.resultado', parametros: { resultadoId: x.id } } });
  for (const uid of equipeDosExames(org)) r.avisarContadores(org)(uid);
  return x;
}

// ─────────── Tela inicial, contador e menu ───────────
export function contadorParaRevisar(org: Org, perms: Set<string> | string[]): number {
  const p = perms instanceof Set ? perms : new Set(perms);
  if (!r.temModulo(org, 'exames') || !p.has('exames.resultado.revisar')) return 0;
  return [...examesDe(org).resultados.values()].filter((x) => x.status === 'AGUARDANDO_REVISAO').length;
}
export function secoesInicio(ctx: Ctx): any[] {
  const { org } = ctx;
  if (!r.temModulo(org, 'exames') || !ctx.perms.has('exames.exame.ler')) return [];
  if (r.ehEquipe(ctx)) {
    if (!ctx.perms.has('exames.resultado.revisar')) return [];
    const pend = [...examesDe(org).resultados.values()].filter((x) => x.status === 'AGUARDANDO_REVISAO').sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    return [{ id: 'resultados-para-revisar', tipo: 'RESULTADOS_PARA_REVISAR', dados: { total: pend.length, itens: pend.slice(0, 5).map((x) => serResultado(ctx, x)) } }];
  }
  const meus = r.pacientesDaConta(ctx.usuario);
  const abertos = [...examesDe(org).pedidos.values()].filter((p) => p.status === 'ABERTO' && meus.has(p.pacienteId)).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  return abertos.length ? [{ id: 'exames-pendentes', tipo: 'EXAMES_PENDENTES', dados: { itens: abertos.slice(0, 5).map((p) => serPedido(ctx, p)) } }] : [];
}

// ─────────── Carga do cenário ───────────
export function carregarExames(org: Org, cen: any, arquivoDeExemplo: (org: Org, donoId: string, finalidade: string) => string) {
  const ex = cen.exames;
  if (!ex) return;
  const st = examesDe(org);
  for (const p of ex.pedidos ?? []) {
    agendar(`seed:${p.id}:criar`, Date.parse(p.criadoEm), () => criarPedido(org, { id: p.id, pacienteId: p.pacienteId, solicitanteId: p.solicitanteId, itens: p.itens, orientacoes: p.orientacoes, observacao: p.observacao }));
    if (p.concluir) agendar(`seed:${p.id}:concluir`, Date.parse(p.concluir.em), () => concluirPedido(org, st.pedidos.get(p.id)));
    if (p.cancelar) agendar(`seed:${p.id}:cancelar`, Date.parse(p.cancelar.em), () => cancelarPedido(org, st.pedidos.get(p.id), p.cancelar.motivo));
  }
  for (const x of ex.resultados ?? []) {
    const autor = org.usuarios.get(x.enviadoPor);
    agendar(`seed:${x.id}:criar`, Date.parse(x.criadoEm), () => criarResultado(org, {
      id: x.id, pacienteId: x.pacienteId, pedidoId: x.pedidoId ?? null, titulo: x.titulo, dataColeta: x.dataColeta ?? null, comentario: x.comentario ?? null,
      arquivosIds: [arquivoDeExemplo(org, x.enviadoPor, 'EXAME')], enviadoPorId: x.enviadoPor, origem: autor && r.usuarioEhEquipe(autor) ? 'EQUIPE' : 'PACIENTE',
    }));
    if (x.revisar) agendar(`seed:${x.id}:revisar`, Date.parse(x.revisar.em), () => revisarResultado(org, st.resultados.get(x.id), x.revisar.por, x.revisar.nota ?? null));
  }
}

// ─────────── Handlers ───────────
type Q = { org: Org; ctx: Ctx | null; params: Record<string, string>; query: Record<string, any>; body: any; headers: Record<string, any> };
type Res = { status: number; body?: any; headers?: Record<string, string> };
const C = (q: Q) => { exigirExames(q.org); return q.ctx!; };
const ok = (body: any, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
const doMaisRecente = (a: any, b: any) => b.criadoEm.localeCompare(a.criadoEm) || b.id.localeCompare(a.id);

export const handlersExames: Record<string, (q: Q) => Res> = {
  examesListarPedidos: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'exames.exame.ler');
    let lista = [...examesDe(q.org).pedidos.values()].filter((p) => r.podeVerPaciente(ctx, p.pacienteId));
    if (q.query.pacienteId) lista = lista.filter((p) => p.pacienteId === q.query.pacienteId);
    if (q.query.status) lista = lista.filter((p) => p.status === q.query.status);
    const p = r.paginar(lista.sort(doMaisRecente), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((x) => serPedido(ctx, x)) });
  },
  examesCriarPedido: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'exames.pedido.criar');
    if (!r.ehEquipe(ctx)) throw negado();
    const pac = r.obterPaciente(ctx, q.body.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const p = criarPedido(q.org, { pacienteId: pac.id, solicitanteId: ctx.usuario.id, itens: q.body.itens, orientacoes: q.body.orientacoes, observacao: q.body.observacao });
    return { status: 201, body: serPedido(ctx, p), headers: { ETag: r.etag(p.id, p._v) } };
  },
  examesObterPedido: (q) => {
    const ctx = C(q);
    const p = obterPedido(ctx, q.params.pedidoId);
    return ok(serPedido(ctx, p), { ETag: r.etag(p.id, p._v) });
  },
  examesConcluirPedido: (q) => {
    const ctx = C(q);
    const p = obterPedido(ctx, q.params.pedidoId);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'exames.pedido.criar');
    return ok(serPedido(ctx, concluirPedido(q.org, p)));
  },
  examesCancelarPedido: (q) => {
    const ctx = C(q);
    const p = obterPedido(ctx, q.params.pedidoId);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'exames.pedido.criar');
    return ok(serPedido(ctx, cancelarPedido(q.org, p, q.body.motivo)));
  },
  examesListarResultados: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'exames.exame.ler');
    let lista = [...examesDe(q.org).resultados.values()].filter((x) => r.podeVerPaciente(ctx, x.pacienteId));
    if (q.query.pacienteId) lista = lista.filter((x) => x.pacienteId === q.query.pacienteId);
    if (q.query.pedidoId) lista = lista.filter((x) => x.pedidoId === q.query.pedidoId);
    if (q.query.status) lista = lista.filter((x) => x.status === q.query.status);
    const p = r.paginar(lista.sort(doMaisRecente), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((x) => serResultado(ctx, x)) });
  },
  examesEnviarResultado: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'exames.resultado.enviar');
    const b = q.body;
    const equipe = r.ehEquipe(ctx);
    if (!equipe && !cfgExames(q.org).pacienteEnviaResultados) throw negado();
    const pac = r.obterPaciente(ctx, b.pacienteId);
    if (b.pedidoId) {
      const p = examesDe(q.org).pedidos.get(b.pedidoId);
      if (!p || p.pacienteId !== pac.id) throw invalido('pedidoId', 'Pedido não encontrado para este paciente.');
      if (p.status !== 'ABERTO') throw invalido('pedidoId', 'Este pedido já foi finalizado.');
    }
    (b.arquivosIds as string[]).forEach((id, i) => {
      const a = q.org.arquivos.get(id);
      if (!a || a.donoId !== ctx.usuario.id || a.finalidade !== 'EXAME') throw invalido(`arquivosIds.${i}`, 'Arquivo não encontrado.');
      if (a.status !== 'DISPONIVEL') throw invalido(`arquivosIds.${i}`, a.status === 'REJEITADO' ? 'Arquivo recusado.' : 'Arquivo ainda em processamento.');
      if ([...examesDe(q.org).resultados.values()].some((x) => x.arquivosIds.includes(id))) throw invalido(`arquivosIds.${i}`, 'Arquivo já usado em outro resultado.');
    });
    const x = criarResultado(q.org, { pacienteId: pac.id, pedidoId: b.pedidoId ?? null, titulo: b.titulo.trim(), dataColeta: b.dataColeta ?? null, arquivosIds: b.arquivosIds, comentario: b.comentario ?? null, enviadoPorId: ctx.usuario.id, origem: equipe ? 'EQUIPE' : 'PACIENTE' });
    return { status: 201, body: serResultado(ctx, x) };
  },
  examesObterResultado: (q) => {
    const ctx = C(q);
    return ok(serResultado(ctx, obterResultado(ctx, q.params.resultadoId)));
  },
  examesRevisarResultado: (q) => {
    const ctx = C(q);
    const x = obterResultado(ctx, q.params.resultadoId);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'exames.resultado.revisar');
    return ok(serResultado(ctx, revisarResultado(q.org, x, ctx.usuario.id, q.body?.nota ?? null)));
  },
};
export { ErroApi };
