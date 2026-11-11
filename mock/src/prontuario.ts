// Módulo `prontuario` no mock (ADR-0019): ficha clínica versionada, registros imutáveis depois de
// finalizados (correção por adendo), linha do tempo com os outros módulos, cópia ao paciente sob pedido
// e log de acesso. Só o profissional lê; toda leitura é registrada.
import { emitir, ErroApi, invalido, naoEncontrado, negado, novoId, type Org } from './estado.ts';
import * as r from './regras.ts';
import { type Ctx } from './regras.ts';
import { agoraIso, agoraMs, DIA, iso } from './tempo.ts';
import { agendaDe } from './agenda.ts';
import { examesDe } from './exames.ts';
import { documentosDe, gerarPdf } from './documentos.ts';

interface Estado { fichas: Map<string, any[]>; registros: Map<string, any>; acessos: any[]; copias: Map<string, any> }
export const prontuarioDe = (org: Org): Estado => {
  const o = org as any;
  o.__prontuario ??= { fichas: new Map(), registros: new Map(), acessos: [], copias: new Map() };
  return o.__prontuario;
};
const FICHA_VAZIA = { alergias: [], medicamentosEmUso: [], problemas: [], antecedentes: { pessoais: null, familiares: null, habitos: null } };
const PRAZO_COPIA = 15 * DIA; // LGPD art. 19, II

// ─────────── Acesso (RN-PRO-001) ───────────
const exigirProntuario = (org: Org) => r.exigirModulo(org, 'prontuario');
/** Paciente do prontuário: só equipe com `prontuario.prontuario.ler`; o resto é 404 (não revela existência). */
function pacienteParaLer(ctx: Ctx, pacienteId: string) {
  if (!r.ehEquipe(ctx) || !ctx.perms.has('prontuario.prontuario.ler')) throw naoEncontrado('Prontuário');
  const p = ctx.org.pacientes.get(pacienteId);
  if (!p) throw naoEncontrado('Prontuário');
  return p;
}
function registrarAcesso(ctx: Ctx, pacienteId: string, acao: string) {
  prontuarioDe(ctx.org).acessos.push({ pacienteId, usuarioId: ctx.usuario.id, acao, em: agoraIso() });
}
function profissionais(org: Org, perm: string): string[] {
  return [...org.usuarios.values()].filter((u) => u.status === 'ATIVO' && r.usuarioEhEquipe(u)
    && u.perfis.some((pf) => pf !== 'PACIENTE' && r.permissoesDe(org, pf).includes(perm))).map((u) => u.id);
}

// ─────────── Ficha ───────────
export function fichaAtual(org: Org, pacienteId: string) {
  const v = prontuarioDe(org).fichas.get(pacienteId);
  return v?.length ? v[v.length - 1] : { pacienteId, versao: 0, ...structuredClone(FICHA_VAZIA), atualizadoEm: null, atualizadoPorId: null };
}
const etagFicha = (pacienteId: string, versao: number) => r.etag(`ficha-${pacienteId}`, versao);
function serFicha(ctx: Ctx, f: any) {
  return {
    pacienteId: f.pacienteId, versao: f.versao, alergias: f.alergias, medicamentosEmUso: f.medicamentosEmUso, problemas: f.problemas, antecedentes: f.antecedentes,
    atualizadoEm: f.atualizadoEm, atualizadoPor: f.atualizadoPorId ? r.refUsuario(ctx.org, f.atualizadoPorId, 'PROFISSIONAL') : null,
    acoesPermitidas: ctx.perms.has('prontuario.registro.escrever') ? ['EDITAR'] : [],
  };
}
export function gravarFicha(org: Org, pacienteId: string, conteudo: any, porId: string, em = agoraIso()) {
  const atual = fichaAtual(org, pacienteId);
  const nova = {
    pacienteId, versao: atual.versao + 1, atualizadoEm: em, atualizadoPorId: porId,
    alergias: conteudo.alergias.map((a: any) => ({ substancia: a.substancia.trim(), reacao: a.reacao ?? null, gravidade: a.gravidade })),
    medicamentosEmUso: conteudo.medicamentosEmUso.map((m: any) => ({ nome: m.nome.trim(), posologia: m.posologia ?? null })),
    problemas: conteudo.problemas.map((p: any) => ({ descricao: p.descricao.trim(), cid: p.cid ?? null, situacao: p.situacao, desde: p.desde ?? null })),
    antecedentes: { pessoais: conteudo.antecedentes.pessoais ?? null, familiares: conteudo.antecedentes.familiares ?? null, habitos: conteudo.antecedentes.habitos ?? null },
  };
  const st = prontuarioDe(org);
  st.fichas.set(pacienteId, [...(st.fichas.get(pacienteId) ?? []), nova]); // versões anteriores ficam (RN-PRO-003)
  emitir(org, 'prontuario.ficha.atualizada', { pacienteId }, profissionais(org, 'prontuario.prontuario.ler'));
  return nova;
}

// ─────────── Registros ───────────
function serRegistro(ctx: Ctx, x: any) {
  const org = ctx.org;
  const acoes: string[] = [];
  const escreve = ctx.perms.has('prontuario.registro.escrever');
  if (escreve && x.status === 'RASCUNHO' && x.autorId === ctx.usuario.id) acoes.push('EDITAR', 'FINALIZAR', 'DESCARTAR');
  if (escreve && x.status === 'FINALIZADO') acoes.push('ADENDAR');
  const adendos = [...prontuarioDe(org).registros.values()].filter((a) => a.registroOrigemId === x.id && a.status === 'FINALIZADO').sort((a, b) => a.finalizadoEm.localeCompare(b.finalizadoEm));
  return {
    id: x.id, paciente: r.refPaciente(org, x.pacienteId), tipo: x.tipo, status: x.status, autor: r.refUsuario(org, x.autorId, 'PROFISSIONAL'),
    texto: x.texto ?? null, modelo: x.modelo ?? null, respostas: x.respostas ?? null, agendamentoId: x.agendamentoId ?? null,
    registroOrigemId: x.registroOrigemId ?? null, adendosIds: adendos.map((a) => a.id), criadoEm: x.criadoEm, finalizadoEm: x.finalizadoEm ?? null, acoesPermitidas: acoes,
  };
}
function conteudoValido(org: Org, d: { formularioId?: string | null; respostas?: any; texto?: string | null }, usuarioId: string) {
  let modelo = null;
  if (d.formularioId) {
    const f = r.obterFormularioVersao(org, d.formularioId);
    if (!f || f.finalidade !== 'PRONTUARIO') throw invalido('formularioId', 'Modelo de prontuário não encontrado.');
    modelo = { formularioId: f.id, versao: f.versao, titulo: f.titulo };
    if (d.respostas) r.validarRespostas(org, f, d.respostas, usuarioId);
  } else if (d.respostas) throw invalido('respostas', 'Respostas exigem um modelo.');
  if (!(d.texto ?? '').trim() && !(d.respostas && Object.keys(d.respostas).length)) throw invalido('texto', 'Escreva o registro ou preencha o modelo.');
  return modelo;
}
export function criarRegistro(org: Org, d: { id?: string; pacienteId: string; autorId: string; tipo: string; texto?: string | null; formularioId?: string | null; respostas?: any; agendamentoId?: string | null; registroOrigemId?: string | null; finalizar?: boolean; em?: string }) {
  if (d.tipo === 'ADENDO') {
    const o = d.registroOrigemId ? prontuarioDe(org).registros.get(d.registroOrigemId) : null;
    if (!o || o.pacienteId !== d.pacienteId || o.status !== 'FINALIZADO') throw invalido('registroOrigemId', 'Adendo só se aplica a um registro finalizado deste paciente.');
  } else if (d.registroOrigemId) throw invalido('registroOrigemId', 'Só adendo aponta para outro registro.');
  if (d.agendamentoId) {
    const a = r.temModulo(org, 'agenda') ? agendaDe(org).agendamentos.get(d.agendamentoId) : null;
    if (!a || a.pacienteId !== d.pacienteId) throw invalido('agendamentoId', 'Atendimento não encontrado para este paciente.');
  }
  const modelo = conteudoValido(org, d, d.autorId);
  const em = d.em ?? agoraIso();
  const x = {
    id: d.id ?? novoId('reg'), pacienteId: d.pacienteId, autorId: d.autorId, tipo: d.tipo, status: d.finalizar ? 'FINALIZADO' : 'RASCUNHO',
    texto: d.texto?.trim() || null, modelo, respostas: d.respostas ?? null, agendamentoId: d.agendamentoId ?? null, registroOrigemId: d.registroOrigemId ?? null,
    criadoEm: em, finalizadoEm: d.finalizar ? em : null, _v: 1,
  };
  prontuarioDe(org).registros.set(x.id, x);
  emitir(org, 'prontuario.registro.atualizado', { pacienteId: x.pacienteId, registroId: x.id }, profissionais(org, 'prontuario.prontuario.ler'));
  return x;
}
function obterRegistro(ctx: Ctx, id: string) {
  const x = prontuarioDe(ctx.org).registros.get(id);
  if (!x || x.status === 'DESCARTADO') throw naoEncontrado('Registro');
  pacienteParaLer(ctx, x.pacienteId);
  if (x.status === 'RASCUNHO' && x.autorId !== ctx.usuario.id) throw naoEncontrado('Registro');
  return x;
}
function exigirAutorDoRascunho(ctx: Ctx, x: any) {
  if (!ctx.perms.has('prontuario.registro.escrever') || x.autorId !== ctx.usuario.id) throw negado('Só o autor mexe no próprio rascunho.');
  if (x.status !== 'RASCUNHO') throw invalido('status', 'Registro finalizado não muda: faça um adendo.');
}

// ─────────── Linha do tempo ───────────
function linhaDoTempo(ctx: Ctx, pacienteId: string) {
  const org = ctx.org;
  const itens: any[] = [];
  const NOME_TIPO: Record<string, string> = { ANAMNESE: 'Anamnese', EVOLUCAO: 'Evolução', ADENDO: 'Adendo' };
  for (const x of prontuarioDe(org).registros.values()) if (x.pacienteId === pacienteId && x.status === 'FINALIZADO')
    itens.push({ tipo: 'REGISTRO', id: x.id, titulo: `${NOME_TIPO[x.tipo]} · ${r.refUsuario(org, x.autorId).nome}`, resumo: x.texto ? String(x.texto).slice(0, 140) : x.modelo?.titulo ?? null, ocorridoEm: x.finalizadoEm, destino: { tela: 'prontuario.registro', parametros: { registroId: x.id } } });
  if (r.temModulo(org, 'agenda')) for (const a of agendaDe(org).agendamentos.values()) if (a.pacienteId === pacienteId)
    itens.push({ tipo: 'AGENDAMENTO', id: a.id, titulo: agendaDe(org).servicos.get(a.servicoId)?.nome ?? 'Atendimento', resumo: a.status, ocorridoEm: a.inicioEm, destino: { tela: 'agenda.detalhe', parametros: { agendamentoId: a.id } } });
  if (r.temModulo(org, 'acompanhamento')) for (const a of org.acompanhamentos.values()) if (a.pacienteId === pacienteId)
    itens.push({ tipo: 'ACOMPANHAMENTO', id: a.id, titulo: a.protocolo?.nome ?? 'Acompanhamento', resumo: a.status, ocorridoEm: a.criadoEm, destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } });
  if (r.temModulo(org, 'exames')) for (const x of examesDe(org).resultados.values()) if (x.pacienteId === pacienteId)
    itens.push({ tipo: 'RESULTADO_EXAME', id: x.id, titulo: x.titulo, resumo: x.status === 'REVISADO' ? 'Revisado' : 'Aguardando revisão', ocorridoEm: x.criadoEm, destino: { tela: 'exames.resultado', parametros: { resultadoId: x.id } } });
  if (r.temModulo(org, 'documentos')) for (const d of documentosDe(org).documentos.values()) if (d.pacienteId === pacienteId && (d.status === 'ASSINADO' || d.status === 'ANULADO'))
    itens.push({ tipo: 'DOCUMENTO', id: d.id, titulo: d.tipo === 'RECEITA' ? 'Receita' : 'Atestado', resumo: d.status === 'ANULADO' ? 'Anulado' : 'Assinado', ocorridoEm: d.assinadoEm, destino: { tela: 'documentos.detalhe', parametros: { documentoId: d.id } } });
  return itens.filter((i) => i.ocorridoEm).sort((a, b) => b.ocorridoEm.localeCompare(a.ocorridoEm) || b.id.localeCompare(a.id));
}

// ─────────── Cópias (RN-PRO-005) ───────────
function serCopia(ctx: Ctx, c: any) {
  const org = ctx.org;
  const arq = c.arquivoId ? org.arquivos.get(c.arquivoId) : null;
  const atende = r.ehEquipe(ctx) && ctx.perms.has('prontuario.copia.atender') && c.status === 'SOLICITADA';
  return {
    id: c.id, paciente: r.refPaciente(org, c.pacienteId), solicitante: r.refUsuario(org, c.solicitanteId, 'PACIENTE'), status: c.status, prazoEm: c.prazoEm,
    arquivo: arq ? r.serArquivo(org, arq) : null, motivoRecusa: c.motivoRecusa ?? null, atendidoPor: c.atendidoPorId ? r.refUsuario(org, c.atendidoPorId, 'PROFISSIONAL') : null,
    criadoEm: c.criadoEm, atendidoEm: c.atendidoEm ?? null, acoesPermitidas: atende ? ['ATENDER', 'RECUSAR'] : [],
  };
}
export function solicitarCopia(org: Org, pacienteId: string, solicitanteId: string, em = agoraIso()) {
  const st = prontuarioDe(org);
  const aberto = [...st.copias.values()].find((c) => c.pacienteId === pacienteId && c.status === 'SOLICITADA');
  if (aberto) return { c: aberto, novo: false };
  const c = { id: novoId('cop'), pacienteId, solicitanteId, status: 'SOLICITADA', prazoEm: iso(Date.parse(em) + PRAZO_COPIA), criadoEm: em, arquivoId: null as string | null, atendidoPorId: null as string | null, atendidoEm: null as string | null, motivoRecusa: null as string | null };
  st.copias.set(c.id, c);
  for (const uid of profissionais(org, 'prontuario.copia.atender')) {
    r.notificarU(org, uid, { tipo: 'COPIA_PRONTUARIO_SOLICITADA', titulo: 'Pedido de cópia do prontuário', texto: 'Um paciente pediu cópia do prontuário. Prazo: 15 dias.', destino: { tela: 'prontuario.copias' } });
  }
  avisarCopia(org, c);
  return { c, novo: true };
}
function avisarCopia(org: Org, c: any) {
  const para = [...new Set([...profissionais(org, 'prontuario.copia.atender'), ...r.contasIdsDoPaciente(org, c.pacienteId)])];
  emitir(org, 'prontuario.copia.atualizada', { copiaId: c.id }, para);
  for (const uid of profissionais(org, 'prontuario.copia.atender')) r.avisarContadores(org)(uid);
}
function pdfDaCopia(org: Org, pacienteId: string): Buffer {
  const pac = org.pacientes.get(pacienteId);
  const f = fichaAtual(org, pacienteId);
  const L: Array<{ t: string; tam?: number; negrito?: boolean }> = [
    { t: org.config.nome, tam: 14, negrito: true }, { t: 'CÓPIA DO PRONTUÁRIO', tam: 16, negrito: true }, { t: `Paciente: ${pac?.nome ?? ''}` }, { t: `Gerada em ${agoraIso().slice(0, 10).split('-').reverse().join('/')}` }, { t: '' },
    { t: 'Ficha clínica', negrito: true },
    { t: `Alergias: ${f.alergias.map((a: any) => `${a.substancia} (${a.gravidade.toLowerCase()})`).join('; ') || 'nenhuma registrada'}` },
    { t: `Medicações em uso: ${f.medicamentosEmUso.map((m: any) => m.nome).join('; ') || 'nenhuma registrada'}` },
    { t: `Problemas: ${f.problemas.map((p: any) => `${p.descricao}${p.cid ? ` (${p.cid})` : ''}`).join('; ') || 'nenhum registrado'}` },
    { t: '' }, { t: 'Registros', negrito: true },
  ];
  for (const x of [...prontuarioDe(org).registros.values()].filter((x) => x.pacienteId === pacienteId && x.status === 'FINALIZADO').sort((a, b) => a.finalizadoEm.localeCompare(b.finalizadoEm)))
    L.push({ t: `${x.finalizadoEm.slice(0, 10).split('-').reverse().join('/')} · ${x.tipo} · ${r.refUsuario(org, x.autorId).nome}`, negrito: true }, { t: (x.texto ?? x.modelo?.titulo ?? '').slice(0, 300) });
  L.push({ t: '' }, { t: 'Mock: cópia de exemplo, sem validade.', negrito: true });
  return gerarPdf(L);
}

// ─────────── Tela inicial e contador ───────────
const pendentes = (org: Org) => [...prontuarioDe(org).copias.values()].filter((c) => c.status === 'SOLICITADA');
export function contadorCopiasPendentes(org: Org, perms: Set<string>) {
  return r.temModulo(org, 'prontuario') && perms.has('prontuario.copia.atender') ? pendentes(org).length : 0;
}
export function secoesInicio(ctx: Ctx): any[] {
  if (!r.temModulo(ctx.org, 'prontuario') || !r.ehEquipe(ctx) || !ctx.perms.has('prontuario.copia.atender')) return [];
  const l = pendentes(ctx.org).sort((a, b) => a.prazoEm.localeCompare(b.prazoEm));
  return l.length ? [{ id: 'copias-prontuario-pendentes', tipo: 'COPIAS_PRONTUARIO_PENDENTES', dados: { total: l.length, itens: l.slice(0, 5).map((c) => serCopia(ctx, c)) } }] : [];
}
export function podeVerArquivoDeCopia(ctx: Ctx, copiaId: string) {
  const c = prontuarioDe(ctx.org).copias.get(copiaId);
  if (!c) return false;
  return (r.ehEquipe(ctx) && ctx.perms.has('prontuario.copia.atender')) || (!r.ehEquipe(ctx) && r.podeVerPaciente(ctx, c.pacienteId));
}

// ─────────── Carga do cenário ───────────
export function carregarProntuario(org: Org, cen: any, agendar: (id: string, quando: number, fn: () => void) => void) {
  const p = cen.prontuario;
  if (!p) return;
  for (const f of p.fichas ?? []) agendar(`seed:ficha:${f.pacienteId}`, Date.parse(f.em), () => gravarFicha(org, f.pacienteId, f.conteudo, f.porId, f.em));
  for (const x of p.registros ?? []) agendar(`seed:${x.id}`, Date.parse(x.em), () => criarRegistro(org, { ...x, em: x.em }));
  for (const c of p.copias ?? []) agendar(`seed:${c.pacienteId}:copia`, Date.parse(c.em), () => solicitarCopia(org, c.pacienteId, c.solicitanteId, c.em));
}

// ─────────── Handlers ───────────
type Q = { org: Org; ctx: Ctx | null; params: Record<string, string>; query: Record<string, any>; body: any; headers: Record<string, any> };
type Res = { status: number; body?: any; headers?: Record<string, string> };
const C = (q: Q) => { exigirProntuario(q.org); return q.ctx!; };
const ok = (body: any, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
const desc = (a: any, b: any) => b.criadoEm.localeCompare(a.criadoEm) || b.id.localeCompare(a.id);

export const handlersProntuario: Record<string, (q: Q) => Res> = {
  prontuarioObterFicha: (q) => {
    const ctx = C(q);
    pacienteParaLer(ctx, q.params.pacienteId);
    registrarAcesso(ctx, q.params.pacienteId, 'LER_FICHA');
    const f = fichaAtual(q.org, q.params.pacienteId);
    return ok(serFicha(ctx, f), { ETag: etagFicha(f.pacienteId, f.versao) });
  },
  prontuarioAtualizarFicha: (q) => {
    const ctx = C(q);
    pacienteParaLer(ctx, q.params.pacienteId);
    r.exigir(ctx, 'prontuario.registro.escrever');
    const atual = fichaAtual(q.org, q.params.pacienteId);
    if (q.headers['if-match'] !== etagFicha(atual.pacienteId, atual.versao))
      throw new ErroApi('CONFLITO_VERSAO', 'A ficha foi alterada por outra pessoa. Recarregue.', { estadoAtual: serFicha(ctx, atual) });
    const nova = gravarFicha(q.org, q.params.pacienteId, q.body, ctx.usuario.id);
    return ok(serFicha(ctx, nova), { ETag: etagFicha(nova.pacienteId, nova.versao) });
  },
  prontuarioListarVersoesFicha: (q) => {
    const ctx = C(q);
    pacienteParaLer(ctx, q.params.pacienteId);
    registrarAcesso(ctx, q.params.pacienteId, 'LER_VERSOES');
    const v = [...(prontuarioDe(q.org).fichas.get(q.params.pacienteId) ?? [])].reverse();
    const p = r.paginar(v, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((f) => serFicha(ctx, f)) });
  },
  prontuarioListarRegistros: (q) => {
    const ctx = C(q);
    pacienteParaLer(ctx, q.params.pacienteId);
    registrarAcesso(ctx, q.params.pacienteId, 'LER_REGISTROS');
    let l = [...prontuarioDe(q.org).registros.values()].filter((x) => x.pacienteId === q.params.pacienteId && x.status !== 'DESCARTADO' && (x.status === 'FINALIZADO' || x.autorId === ctx.usuario.id));
    if (q.query.tipo) l = l.filter((x) => x.tipo === q.query.tipo);
    const p = r.paginar(l.sort(desc), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((x) => serRegistro(ctx, x)) });
  },
  prontuarioCriarRegistro: (q) => {
    const ctx = C(q);
    const pac = pacienteParaLer(ctx, q.params.pacienteId);
    r.exigir(ctx, 'prontuario.registro.escrever');
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const x = criarRegistro(q.org, { pacienteId: pac.id, autorId: ctx.usuario.id, ...q.body });
    return { status: 201, body: serRegistro(ctx, x), headers: { ETag: r.etag(x.id, x._v) } };
  },
  prontuarioObterRegistro: (q) => {
    const ctx = C(q);
    const x = obterRegistro(ctx, q.params.registroId);
    registrarAcesso(ctx, x.pacienteId, 'LER_REGISTRO');
    return ok(serRegistro(ctx, x), { ETag: r.etag(x.id, x._v) });
  },
  prontuarioEditarRegistro: (q) => {
    const ctx = C(q);
    const x = obterRegistro(ctx, q.params.registroId);
    exigirAutorDoRascunho(ctx, x);
    r.conferirIfMatch(q.headers['if-match'], x.id, x._v, () => serRegistro(ctx, x));
    const novo = { ...x, ...('texto' in q.body ? { texto: q.body.texto?.trim() || null } : {}), ...('respostas' in q.body ? { respostas: q.body.respostas } : {}) };
    if ('agendamentoId' in q.body) {
      const a = q.body.agendamentoId && r.temModulo(q.org, 'agenda') ? agendaDe(q.org).agendamentos.get(q.body.agendamentoId) : null;
      if (q.body.agendamentoId && (!a || a.pacienteId !== x.pacienteId)) throw invalido('agendamentoId', 'Atendimento não encontrado para este paciente.');
      novo.agendamentoId = q.body.agendamentoId ?? null;
    }
    conteudoValido(q.org, { formularioId: x.modelo?.formularioId, respostas: novo.respostas, texto: novo.texto }, ctx.usuario.id);
    Object.assign(x, novo, { _v: x._v + 1 });
    emitir(q.org, 'prontuario.registro.atualizado', { pacienteId: x.pacienteId, registroId: x.id }, [ctx.usuario.id]);
    return ok(serRegistro(ctx, x), { ETag: r.etag(x.id, x._v) });
  },
  prontuarioFinalizarRegistro: (q) => {
    const ctx = C(q);
    const x = obterRegistro(ctx, q.params.registroId);
    if (x.status === 'FINALIZADO') return ok(serRegistro(ctx, x));
    exigirAutorDoRascunho(ctx, x);
    Object.assign(x, { status: 'FINALIZADO', finalizadoEm: agoraIso(), _v: x._v + 1 });
    emitir(q.org, 'prontuario.registro.atualizado', { pacienteId: x.pacienteId, registroId: x.id }, profissionais(q.org, 'prontuario.prontuario.ler'));
    return ok(serRegistro(ctx, x));
  },
  prontuarioDescartarRegistro: (q) => {
    const ctx = C(q);
    const x = obterRegistro(ctx, q.params.registroId);
    exigirAutorDoRascunho(ctx, x);
    Object.assign(x, { status: 'DESCARTADO', _v: x._v + 1 });
    return ok(serRegistro(ctx, x));
  },
  prontuarioLinhaDoTempo: (q) => {
    const ctx = C(q);
    pacienteParaLer(ctx, q.params.pacienteId);
    registrarAcesso(ctx, q.params.pacienteId, 'LER_LINHA_DO_TEMPO');
    return ok(r.paginar(linhaDoTempo(ctx, q.params.pacienteId), q.query.cursor, q.query.limite));
  },
  prontuarioListarAcessos: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'prontuario.acesso.auditar');
    if (!q.org.pacientes.get(q.params.pacienteId)) throw naoEncontrado('Paciente');
    const l = prontuarioDe(q.org).acessos.filter((a) => a.pacienteId === q.params.pacienteId).slice().reverse();
    const p = r.paginar(l, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((a) => ({ usuario: r.refUsuario(q.org, a.usuarioId), acao: a.acao, acessadoEm: a.em })) });
  },
  prontuarioListarCopias: (q) => {
    const ctx = C(q);
    let l = [...prontuarioDe(q.org).copias.values()];
    if (r.ehEquipe(ctx)) r.exigir(ctx, 'prontuario.copia.atender');
    else { r.exigir(ctx, 'prontuario.copia.solicitar'); l = l.filter((c) => r.podeVerPaciente(ctx, c.pacienteId)); }
    if (q.query.status) l = l.filter((c) => c.status === q.query.status);
    const p = r.paginar(l.sort(desc), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((c) => serCopia(ctx, c)) });
  },
  prontuarioSolicitarCopia: (q) => {
    const ctx = C(q);
    if (r.ehEquipe(ctx)) throw negado('A cópia é pedida pelo paciente (ou responsável) pelo app.');
    r.exigir(ctx, 'prontuario.copia.solicitar');
    const pac = r.obterPaciente(ctx, q.body.pacienteId);
    const { c, novo } = solicitarCopia(q.org, pac.id, ctx.usuario.id);
    return { status: novo ? 201 : 200, body: serCopia(ctx, c) };
  },
  prontuarioAtenderCopia: (q) => {
    const ctx = C(q);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'prontuario.copia.atender');
    const c = prontuarioDe(q.org).copias.get(q.params.copiaId);
    if (!c) throw naoEncontrado('Pedido de cópia');
    if (c.status !== 'SOLICITADA') throw invalido('status', 'Este pedido já foi respondido.');
    const bytes = pdfDaCopia(q.org, c.pacienteId);
    const arqId = novoId('arq');
    q.org.arquivos.set(arqId, { id: arqId, nome: `prontuario-${agoraIso().slice(0, 10)}.pdf`, tipo: 'application/pdf', tamanhoBytes: bytes.length, finalidade: 'PRONTUARIO', status: 'DISPONIVEL', motivoRejeicao: null, criadoEm: agoraIso(), donoId: ctx.usuario.id, bytes, copiaId: c.id });
    Object.assign(c, { status: 'DISPONIVEL', arquivoId: arqId, atendidoPorId: ctx.usuario.id, atendidoEm: agoraIso() });
    registrarAcesso(ctx, c.pacienteId, 'GERAR_COPIA');
    for (const uid of r.contasIdsDoPaciente(q.org, c.pacienteId))
      r.notificarU(q.org, uid, { tipo: 'COPIA_PRONTUARIO_DISPONIVEL', titulo: q.org.config.nome, texto: 'A cópia que você pediu está disponível no app.', destino: { tela: 'prontuario.minhas-copias' } });
    avisarCopia(q.org, c);
    return ok(serCopia(ctx, c));
  },
  prontuarioRecusarCopia: (q) => {
    const ctx = C(q);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'prontuario.copia.atender');
    const c = prontuarioDe(q.org).copias.get(q.params.copiaId);
    if (!c) throw naoEncontrado('Pedido de cópia');
    if (c.status !== 'SOLICITADA') throw invalido('status', 'Este pedido já foi respondido.');
    Object.assign(c, { status: 'RECUSADA', motivoRecusa: q.body.motivo.trim(), atendidoPorId: ctx.usuario.id, atendidoEm: agoraIso() });
    for (const uid of r.contasIdsDoPaciente(q.org, c.pacienteId))
      r.notificarU(q.org, uid, { tipo: 'COPIA_PRONTUARIO_DISPONIVEL', titulo: q.org.config.nome, texto: 'Há uma resposta ao seu pedido de cópia.', destino: { tela: 'prontuario.minhas-copias' } });
    avisarCopia(q.org, c);
    return ok(serCopia(ctx, c));
  },
};
void agoraMs;
