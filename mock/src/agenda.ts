// Módulo `agenda` no mock (ADR-0016): serviços, grade, bloqueios, horários livres e agendamentos
// (consultas e procedimentos), com as regras RN-AGE-001..007 e o lembrete como job determinístico.
import { agendar, cancelarJob, emitir, ErroApi, invalido, naoEncontrado, negado, novoId, type Org } from './estado.ts';
import * as r from './regras.ts';
import { type Ctx } from './regras.ts';
import { agoraIso, agoraMs, DIA, HORA, iso, localParaUtc, MINUTO, partesLocais, somarDias, diferencaDias } from './tempo.ts';

export interface EstadoAgenda {
  servicos: Map<string, any>;
  grades: Map<string, { itens: any[]; _v: number }>;
  bloqueios: Map<string, any>;
  agendamentos: Map<string, any>;
}
export const agendaDe = (org: Org): EstadoAgenda => {
  const o = org as any;
  o.__agenda ??= { servicos: new Map(), grades: new Map(), bloqueios: new Map(), agendamentos: new Map() };
  return o.__agenda;
};
const ATIVOS = new Set(['AGENDADO', 'CONFIRMADO']);
const cfg = (org: Org) => r.configModulo(org, 'agenda') as {
  autoagendamento: boolean; antecedenciaMinimaHoras: number; janelaDias: number; cancelamentoAteHoras: number; lembreteHorasAntes: number; intervaloMinutos: number;
};
const termoConsulta = (org: Org) => org.termos.consulta ?? { singular: 'consulta', plural: 'consultas', genero: 'F' };

// ─────────── Visibilidade ───────────
export function exigirAgenda(org: Org) { r.exigirModulo(org, 'agenda'); }
function obterAgendamento(ctx: Ctx, id: string) {
  const a = agendaDe(ctx.org).agendamentos.get(id);
  if (!a || !ctx.perms.has('agenda.agendamento.ler') || !r.podeVerPaciente(ctx, a.pacienteId)) throw naoEncontrado('Agendamento');
  return a;
}
function obterServico(ctx: Ctx, id: string) {
  const s = agendaDe(ctx.org).servicos.get(id);
  if (!s || (!r.ehEquipe(ctx) && !(s.status === 'ATIVO' && s.autoagendavel && cfg(ctx.org).autoagendamento))) throw naoEncontrado('Serviço');
  return s;
}
const equipeAtiva = (org: Org, id: string) => { const u = org.usuarios.get(id); return !!u && u.status === 'ATIVO' && r.usuarioEhEquipe(u); };
/** Equipe que acompanha a agenda em tempo real: quem tem a permissão de ler agendamentos. */
function equipeDaAgenda(org: Org): string[] {
  return [...org.usuarios.values()].filter((u) => u.status === 'ATIVO' && r.usuarioEhEquipe(u)
    && u.perfis.some((p) => p !== 'PACIENTE' && r.permissoesDe(org, p).includes('agenda.agendamento.ler'))).map((u) => u.id);
}

// ─────────── Serialização ───────────
export function serServico(ctx: Ctx, s: any) {
  const gerencia = ctx.perms.has('agenda.configuracao.gerenciar');
  const acoes: string[] = [];
  if (gerencia && s.status === 'ATIVO') acoes.push('EDITAR', 'ARQUIVAR');
  if (s.status === 'ATIVO' && ctx.perms.has('agenda.agendamento.criar') && (r.ehEquipe(ctx) || s.autoagendavel)) acoes.push('AGENDAR');
  return {
    id: s.id, nome: s.nome, categoria: s.categoria, duracaoMinutos: s.duracaoMinutos, autoagendavel: s.autoagendavel,
    profissionais: s.profissionaisIds.filter((id: string) => ctx.org.usuarios.has(id)).map((id: string) => r.refUsuario(ctx.org, id, 'PROFISSIONAL')),
    orientacoes: s.orientacoes ?? null, status: s.status, acoesPermitidas: acoes,
  };
}
function serGrade(ctx: Ctx, profissionalId: string) {
  const g = agendaDe(ctx.org).grades.get(profissionalId) ?? { itens: [], _v: 0 };
  return {
    profissional: r.refUsuario(ctx.org, profissionalId, 'PROFISSIONAL'),
    itens: g.itens.map((i) => ({ diaSemana: i.diaSemana, inicio: i.inicio, fim: i.fim, ...(i.servicosIds ? { servicosIds: i.servicosIds } : {}) })),
    acoesPermitidas: ctx.perms.has('agenda.configuracao.gerenciar') ? ['EDITAR'] : [],
  };
}
function serBloqueio(ctx: Ctx, b: any) {
  return {
    id: b.id, profissional: b.profissionalId ? r.refUsuario(ctx.org, b.profissionalId, 'PROFISSIONAL') : null,
    inicioEm: iso(b.inicioMs), fimEm: iso(b.fimMs), motivo: b.motivo ?? null,
    acoesPermitidas: ctx.perms.has('agenda.configuracao.gerenciar') ? ['REMOVER'] : [],
  };
}
function acoesAgendamento(ctx: Ctx, a: any): string[] {
  const acoes: string[] = [];
  const ativo = ATIVOS.has(a.status);
  const comecou = agoraMs() >= a.inicioMs;
  if (r.ehEquipe(ctx)) {
    if (ctx.perms.has('agenda.agendamento.gerenciar')) {
      if (ativo) acoes.push('EDITAR', 'REMARCAR', 'CANCELAR');
      if (a.status === 'AGENDADO') acoes.push('CONFIRMAR');
      if (ativo && comecou) acoes.push('REALIZAR', 'REGISTRAR_FALTA');
    }
  } else {
    if (a.status === 'AGENDADO' && !comecou) acoes.push('CONFIRMAR');
    if (ativo && agoraMs() <= a.inicioMs - cfg(ctx.org).cancelamentoAteHoras * HORA) acoes.push('CANCELAR');
  }
  if (r.temModulo(ctx.org, 'chat') && ctx.perms.has('chat.conversa.ler')) {
    const c = r.conversaAtivaDoPaciente(ctx.org, a.pacienteId);
    if (c && r.participa(c, ctx.usuario.id)) acoes.push('ABRIR_CONVERSA');
  }
  return acoes;
}
export function serAgendamento(ctx: Ctx, a: any) {
  const org = ctx.org;
  const s = agendaDe(org).servicos.get(a.servicoId);
  return {
    id: a.id, paciente: r.refPaciente(org, a.pacienteId), profissional: r.refUsuario(org, a.profissionalId, 'PROFISSIONAL'),
    servico: { id: s.id, nome: s.nome, categoria: s.categoria },
    inicioEm: iso(a.inicioMs), fimEm: iso(a.fimMs), status: a.status, origem: a.origem, encaixe: a.encaixe,
    local: a.local ?? null, orientacoes: a.orientacoes ?? null,
    observacao: r.ehEquipe(ctx) ? a.observacao ?? null : null,
    motivoCancelamento: a.motivoCancelamento ?? null,
    historico: a.historico.map((h: any) => ({ ocorridoEm: h.ocorridoEm, acao: h.acao, por: h.porId && org.usuarios.has(h.porId) ? r.refUsuario(org, h.porId) : null, ...(h.detalhe !== undefined ? { detalhe: h.detalhe } : {}) })),
    criadoEm: a.criadoEm, acoesPermitidas: acoesAgendamento(ctx, a),
  };
}
export function serAgendamentoResumo(org: Org, a: any) {
  const s = agendaDe(org).servicos.get(a.servicoId);
  const prof = org.usuarios.get(a.profissionalId)!;
  return {
    id: a.id, inicioEm: iso(a.inicioMs), fimEm: iso(a.fimMs), status: a.status,
    servico: { nome: s.nome, categoria: s.categoria },
    profissional: { id: prof.id, nome: prof.nomeExibicao }, paciente: r.refPaciente(org, a.pacienteId),
  };
}

// ─────────── Período e horários livres (RN-AGE-002) ───────────
function periodo(org: Org, de: string, ate: string, maxDias: number) {
  const dias = diferencaDias(de, ate);
  if (dias < 0) throw invalido('ate', 'O fim do período vem antes do início.');
  if (dias >= maxDias) throw invalido('ate', `Consulte no máximo ${maxDias} dias por vez.`);
  return { inicioMs: localParaUtc(de, '00:00', org.config.fuso), fimMs: localParaUtc(somarDias(ate, 1), '00:00', org.config.fuso) };
}
const sobrepoe = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
function ocupado(org: Org, profissionalId: string, inicioMs: number, fimMs: number, ignorarId?: string) {
  for (const a of agendaDe(org).agendamentos.values())
    if (a.id !== ignorarId && a.profissionalId === profissionalId && a.status !== 'CANCELADO' && sobrepoe(a.inicioMs, a.fimMs, inicioMs, fimMs)) return true;
  return false;
}
function bloqueado(org: Org, profissionalId: string, inicioMs: number, fimMs: number) {
  for (const b of agendaDe(org).bloqueios.values())
    if ((!b.profissionalId || b.profissionalId === profissionalId) && sobrepoe(b.inicioMs, b.fimMs, inicioMs, fimMs)) return true;
  return false;
}
export function horariosLivres(org: Org, s: any, profissionalId: string | undefined, de: string, ate: string, paraPaciente: boolean) {
  const c = cfg(org);
  const fuso = org.config.fuso;
  const agora = agoraMs();
  const minimo = paraPaciente ? agora + c.antecedenciaMinimaHoras * HORA : agora;
  const maximo = paraPaciente ? agora + c.janelaDias * DIA : Infinity;
  const profs = s.profissionaisIds.filter((id: string) => (!profissionalId || id === profissionalId) && equipeAtiva(org, id));
  const livres: { inicioMs: number; fimMs: number; profissionalId: string }[] = [];
  for (let data = de; data <= ate; data = somarDias(data, 1)) {
    const diaSemana = partesLocais(localParaUtc(data, '12:00', fuso), fuso).diaSemana;
    for (const p of profs) {
      for (const it of agendaDe(org).grades.get(p)?.itens ?? []) {
        if (it.diaSemana !== diaSemana || (it.servicosIds && !it.servicosIds.includes(s.id))) continue;
        const ini = localParaUtc(data, it.inicio, fuso);
        const fim = localParaUtc(data, it.fim, fuso);
        for (let t = ini; t + s.duracaoMinutos * MINUTO <= fim; t += c.intervaloMinutos * MINUTO) {
          const tf = t + s.duracaoMinutos * MINUTO;
          if (t < minimo || t > maximo || ocupado(org, p, t, tf) || bloqueado(org, p, t, tf)) continue;
          livres.push({ inicioMs: t, fimMs: tf, profissionalId: p });
        }
      }
    }
  }
  // Itens de grade sobrepostos geram o mesmo horário mais de uma vez: um por profissional e instante.
  const unicos = new Map(livres.map((h) => [`${h.profissionalId}|${h.inicioMs}`, h]));
  return [...unicos.values()].sort((a, b) => a.inicioMs - b.inicioMs || a.profissionalId.localeCompare(b.profissionalId));
}

// ─────────── Ciclo de vida (RN-AGE) ───────────
function interessados(org: Org, a: any) { return [...new Set([...equipeDaAgenda(org), ...r.contasIdsDoPaciente(org, a.pacienteId)])]; }
function notificarOutroLado(org: Org, a: any, porPaciente: boolean, tipo: string, texto: string) {
  const t = termoConsulta(org);
  const destino = { tela: 'agenda.detalhe', parametros: { agendamentoId: a.id } };
  const s = agendaDe(org).servicos.get(a.servicoId);
  const titulo = s.categoria === 'PROCEDIMENTO' ? r.cap(org.termos.procedimento?.singular ?? 'procedimento') : r.cap(t.singular);
  const para = porPaciente ? [a.profissionalId] : r.contasIdsDoPaciente(org, a.pacienteId);
  for (const uid of para) r.notificarU(org, uid, { tipo, titulo, texto, destino });
}
function agendarLembrete(org: Org, a: any) {
  const id = `agendamento:${a.id}:lembrete`;
  cancelarJob(id);
  const em = a.inicioMs - cfg(org).lembreteHorasAntes * HORA;
  if (ATIVOS.has(a.status) && em > agoraMs()) agendar(id, em, () => lembrar(org, a.id));
}
function lembrar(org: Org, id: string) {
  const a = agendaDe(org).agendamentos.get(id);
  if (!a || !ATIVOS.has(a.status)) return; // idempotente: confere o estado antes de agir
  const t = termoConsulta(org);
  const texto = a.status === 'AGENDADO' ? `Lembrete: você tem ${t.genero === 'F' ? 'uma' : 'um'} ${t.singular} em breve. Confirme sua presença pelo app.` : `Lembrete: você tem ${t.genero === 'F' ? 'uma' : 'um'} ${t.singular} em breve.`;
  for (const uid of r.contasIdsDoPaciente(org, a.pacienteId))
    r.notificarU(org, uid, { tipo: 'AGENDAMENTO_LEMBRETE', titulo: r.cap(t.singular), texto, destino: { tela: 'agenda.detalhe', parametros: { agendamentoId: a.id } } });
}
function registrar(a: any, acao: string, porId: string | null, detalhe?: string | null) {
  a.historico.push({ ocorridoEm: agoraIso(), acao, porId, ...(detalhe !== undefined ? { detalhe } : {}) });
  a._v++;
}
function atualizado(org: Org, a: any) { emitir(org, 'agenda.agendamento.atualizado', { agendamentoId: a.id }, interessados(org, a)); }

export function criarAgendamento(org: Org, d: { pacienteId: string; servicoId: string; profissionalId: string; inicioMs: number; duracaoMinutos?: number; origem: 'EQUIPE' | 'PACIENTE'; porId: string; local?: string | null; observacao?: string | null; encaixe?: boolean; id?: string }) {
  const s = agendaDe(org).servicos.get(d.servicoId);
  const fimMs = d.inicioMs + (d.duracaoMinutos ?? s.duracaoMinutos) * MINUTO;
  const a = {
    id: d.id ?? novoId('agd'), pacienteId: d.pacienteId, servicoId: s.id, profissionalId: d.profissionalId, inicioMs: d.inicioMs, fimMs,
    status: 'AGENDADO', origem: d.origem, encaixe: !!d.encaixe, local: d.local ?? null, orientacoes: s.orientacoes ?? null,
    observacao: d.observacao ?? null, motivoCancelamento: null, historico: [] as any[], criadoEm: agoraIso(), _v: 0,
  };
  registrar(a, 'CRIADO', d.porId);
  agendaDe(org).agendamentos.set(a.id, a);
  agendarLembrete(org, a);
  emitir(org, 'agenda.agendamento.criado', { agendamentoId: a.id }, interessados(org, a));
  const t = termoConsulta(org);
  notificarOutroLado(org, a, d.origem === 'PACIENTE', 'AGENDAMENTO_CRIADO',
    d.origem === 'PACIENTE' ? `${r.cap(t.singular)} ${t.genero === 'F' ? 'marcada' : 'marcado'} pelo app.` : `${r.cap(t.genero === 'F' ? 'uma' : 'um')} ${t.singular} foi ${t.genero === 'F' ? 'marcada' : 'marcado'} para você.`);
  return a;
}
export function confirmar(org: Org, a: any, porId: string | null) {
  if (a.status === 'CONFIRMADO') return a;
  if (a.status !== 'AGENDADO') throw invalido('status', 'Só é possível confirmar o que ainda está agendado.');
  a.status = 'CONFIRMADO'; registrar(a, 'CONFIRMADO', porId);
  atualizado(org, a);
  return a;
}
export function cancelar(org: Org, a: any, porId: string, motivo: string, porPaciente: boolean) {
  if (!ATIVOS.has(a.status)) throw invalido('status', 'Este agendamento não pode mais ser cancelado.');
  a.status = 'CANCELADO'; a.motivoCancelamento = motivo; registrar(a, 'CANCELADO', porId, motivo);
  cancelarJob(`agendamento:${a.id}:lembrete`);
  atualizado(org, a);
  const t = termoConsulta(org);
  notificarOutroLado(org, a, porPaciente, 'AGENDAMENTO_ALTERADO', `${r.cap(t.genero === 'F' ? 'uma' : 'um')} ${t.singular} foi ${t.genero === 'F' ? 'cancelada' : 'cancelado'}.`);
  return a;
}
export function remarcar(org: Org, a: any, porId: string, d: { inicioMs: number; profissionalId: string; duracaoMinutos: number; encaixe: boolean; motivo: string | null }) {
  a.inicioMs = d.inicioMs; a.fimMs = d.inicioMs + d.duracaoMinutos * MINUTO; a.profissionalId = d.profissionalId; a.encaixe = d.encaixe;
  a.status = 'AGENDADO'; registrar(a, 'REMARCADO', porId, d.motivo);
  agendarLembrete(org, a);
  atualizado(org, a);
  const t = termoConsulta(org);
  notificarOutroLado(org, a, false, 'AGENDAMENTO_ALTERADO', `${r.cap(t.genero === 'F' ? 'uma' : 'um')} ${t.singular} foi ${t.genero === 'F' ? 'remarcada' : 'remarcado'}. Confira o novo horário.`);
  return a;
}
export function finalizar(org: Org, a: any, porId: string, status: 'REALIZADO' | 'FALTOU') {
  if (!ATIVOS.has(a.status)) throw invalido('status', 'Este agendamento já foi finalizado.');
  if (agoraMs() < a.inicioMs) throw invalido('status', 'Só depois do horário marcado.');
  a.status = status; registrar(a, status, porId);
  cancelarJob(`agendamento:${a.id}:lembrete`);
  atualizado(org, a);
  return a;
}

// ─────────── Tela inicial (seções PROXIMA_CONSULTA e AGENDA_DO_DIA) ───────────
export function secoesInicio(ctx: Ctx): any[] {
  const { org } = ctx;
  if (!r.temModulo(org, 'agenda') || !ctx.perms.has('agenda.agendamento.ler')) return [];
  const lista = [...agendaDe(org).agendamentos.values()];
  if (r.ehEquipe(ctx)) {
    const hoje = partesLocais(agoraMs(), org.config.fuso).data;
    const { inicioMs, fimMs } = periodo(org, hoje, hoje, 1);
    // Profissional vê a própria agenda; gestão e secretaria veem a de todos.
    const so = ctx.perfil === 'PROFISSIONAL' ? ctx.usuario.id : null;
    const doDia = lista.filter((a) => a.status !== 'CANCELADO' && a.inicioMs >= inicioMs && a.inicioMs < fimMs && (!so || a.profissionalId === so)).sort((a, b) => a.inicioMs - b.inicioMs);
    return [{ id: 'agenda-do-dia', tipo: 'AGENDA_DO_DIA', dados: { data: hoje, total: doDia.length, itens: doDia.slice(0, 20).map((a) => serAgendamentoResumo(org, a)) } }];
  }
  const meus = r.pacientesDaConta(ctx.usuario);
  const prox = lista.filter((a) => meus.has(a.pacienteId) && ATIVOS.has(a.status) && a.fimMs > agoraMs()).sort((a, b) => a.inicioMs - b.inicioMs)[0];
  return prox ? [{ id: 'proxima-consulta', tipo: 'PROXIMA_CONSULTA', dados: { agendamento: serAgendamento(ctx, prox) } }] : [];
}

// ─────────── Carga do cenário ───────────
export function carregarAgenda(org: Org, cen: any) {
  const ag = cen.agenda;
  if (!ag) return;
  const st = agendaDe(org);
  for (const s of ag.servicos ?? []) st.servicos.set(s.id, { orientacoes: null, status: 'ATIVO', ...s, _v: 1 });
  for (const [prof, itens] of Object.entries(ag.grades ?? {})) st.grades.set(prof, { itens: itens as any[], _v: 1 });
  for (const b of ag.bloqueios ?? []) st.bloqueios.set(b.id, { id: b.id, profissionalId: b.profissionalId ?? null, inicioMs: Date.parse(b.inicioEm), fimMs: Date.parse(b.fimEm), motivo: b.motivo ?? null });
  for (const x of ag.agendamentos ?? []) {
    agendar(`seed:${x.id}:criar`, Date.parse(x.criadoEm), () => criarAgendamento(org, {
      id: x.id, pacienteId: x.pacienteId, servicoId: x.servicoId, profissionalId: x.profissionalId, inicioMs: Date.parse(x.inicioEm),
      duracaoMinutos: x.duracaoMinutos, origem: x.origem ?? 'EQUIPE', porId: x.criadoPor, local: x.local, observacao: x.observacao, encaixe: x.encaixe,
    }));
    const a = () => st.agendamentos.get(x.id);
    if (x.confirmar) agendar(`seed:${x.id}:confirmar`, Date.parse(x.confirmar.em), () => confirmar(org, a(), x.confirmar.por ?? null));
    if (x.cancelar) agendar(`seed:${x.id}:cancelar`, Date.parse(x.cancelar.em), () => cancelar(org, a(), x.cancelar.por, x.cancelar.motivo, !!x.cancelar.peloPaciente));
    if (x.realizar) agendar(`seed:${x.id}:realizar`, Date.parse(x.realizar.em), () => finalizar(org, a(), x.realizar.por, 'REALIZADO'));
    if (x.falta) agendar(`seed:${x.id}:falta`, Date.parse(x.falta.em), () => finalizar(org, a(), x.falta.por, 'FALTOU'));
  }
}

// ─────────── Handlers ───────────
type Q = { org: Org; ctx: Ctx | null; params: Record<string, string>; query: Record<string, any>; body: any; headers: Record<string, any> };
type Res = { status: number; body?: any; headers?: Record<string, string> };
const C = (q: Q) => { exigirAgenda(q.org); return q.ctx!; };
const ok = (body: any, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
const etagServico = (s: any) => r.etag(s.id, s._v);
const etagGrade = (org: Org, prof: string) => r.etag(`grd_${prof}`, agendaDe(org).grades.get(prof)?._v ?? 0);

function validarServico(org: Org, b: any) {
  if (b.categoria === 'PROCEDIMENTO' && b.autoagendavel) throw invalido('autoagendavel', 'Procedimentos são marcados pela equipe.');
  b.profissionaisIds.forEach((id: string, i: number) => { if (!equipeAtiva(org, id)) throw invalido(`profissionaisIds.${i}`, 'Membro da equipe inválido.'); });
}
function obterProfissional(ctx: Ctx, id: string) {
  if (!r.ehEquipe(ctx) || !ctx.perms.has('agenda.agendamento.ler')) throw naoEncontrado('Profissional');
  if (!equipeAtiva(ctx.org, id)) throw naoEncontrado('Profissional');
  return id;
}

export const handlersAgenda: Record<string, (q: Q) => Res> = {
  agendaListarServicos: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler');
    let lista = [...agendaDe(q.org).servicos.values()];
    if (!r.ehEquipe(ctx)) lista = cfg(q.org).autoagendamento ? lista.filter((s) => s.status === 'ATIVO' && s.autoagendavel) : [];
    if (q.query.status) lista = lista.filter((s) => s.status === q.query.status);
    return ok({ itens: lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((s) => serServico(ctx, s)) });
  },
  agendaCriarServico: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.configuracao.gerenciar');
    validarServico(q.org, q.body);
    const s = { id: novoId('srv'), ...q.body, orientacoes: q.body.orientacoes ?? null, status: 'ATIVO', _v: 1 };
    agendaDe(q.org).servicos.set(s.id, s);
    return { status: 201, body: serServico(ctx, s), headers: { ETag: etagServico(s) } };
  },
  agendaObterServico: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler', true);
    const s = obterServico(ctx, q.params.servicoId);
    return ok(serServico(ctx, s), { ETag: etagServico(s) });
  },
  agendaEditarServico: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler', true);
    const s = obterServico(ctx, q.params.servicoId);
    r.exigir(ctx, 'agenda.configuracao.gerenciar');
    r.conferirIfMatch(q.headers['if-match'], s.id, s._v, () => serServico(ctx, s));
    if (s.status !== 'ATIVO') throw invalido('status', 'Serviço arquivado não pode ser editado.');
    validarServico(q.org, q.body);
    Object.assign(s, { ...q.body, orientacoes: q.body.orientacoes ?? null }); s._v++;
    return ok(serServico(ctx, s), { ETag: etagServico(s) });
  },
  agendaArquivarServico: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler', true);
    const s = obterServico(ctx, q.params.servicoId);
    r.exigir(ctx, 'agenda.configuracao.gerenciar');
    if (s.status !== 'ARQUIVADO') { s.status = 'ARQUIVADO'; s._v++; }
    return ok(serServico(ctx, s));
  },
  agendaObterGrade: (q) => {
    const ctx = C(q);
    const prof = obterProfissional(ctx, q.params.profissionalId);
    return ok(serGrade(ctx, prof), { ETag: etagGrade(q.org, prof) });
  },
  agendaSalvarGrade: (q) => {
    const ctx = C(q);
    const prof = obterProfissional(ctx, q.params.profissionalId);
    r.exigir(ctx, 'agenda.configuracao.gerenciar');
    const st = agendaDe(q.org);
    const atual = st.grades.get(prof) ?? { itens: [], _v: 0 };
    r.conferirIfMatch(q.headers['if-match'], `grd_${prof}`, atual._v, () => serGrade(ctx, prof));
    q.body.itens.forEach((it: any, i: number) => {
      if (it.inicio >= it.fim) throw invalido(`itens.${i}.fim`, 'O fim precisa ser depois do início.');
      (it.servicosIds ?? []).forEach((id: string, j: number) => { if (!st.servicos.has(id)) throw invalido(`itens.${i}.servicosIds.${j}`, 'Serviço não encontrado.'); });
    });
    st.grades.set(prof, { itens: q.body.itens.map((it: any) => ({ ...it, servicosIds: it.servicosIds ?? null })), _v: atual._v + 1 });
    return ok(serGrade(ctx, prof), { ETag: etagGrade(q.org, prof) });
  },
  agendaListarBloqueios: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler');
    if (!r.ehEquipe(ctx)) throw negado();
    const { inicioMs, fimMs } = periodo(q.org, q.query.de, q.query.ate, 366);
    const lista = [...agendaDe(q.org).bloqueios.values()]
      .filter((b) => sobrepoe(b.inicioMs, b.fimMs, inicioMs, fimMs) && (!q.query.profissionalId || !b.profissionalId || b.profissionalId === q.query.profissionalId))
      .sort((a, b) => a.inicioMs - b.inicioMs);
    return ok({ itens: lista.map((b) => serBloqueio(ctx, b)) });
  },
  agendaCriarBloqueio: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.configuracao.gerenciar');
    const ini = Date.parse(q.body.inicioEm), fim = Date.parse(q.body.fimEm);
    if (fim <= ini) throw invalido('fimEm', 'O fim precisa ser depois do início.');
    if (q.body.profissionalId && !equipeAtiva(q.org, q.body.profissionalId)) throw invalido('profissionalId', 'Membro da equipe inválido.');
    const b = { id: novoId('blq'), profissionalId: q.body.profissionalId ?? null, inicioMs: ini, fimMs: fim, motivo: q.body.motivo ?? null };
    agendaDe(q.org).bloqueios.set(b.id, b);
    return { status: 201, body: serBloqueio(ctx, b) };
  },
  agendaRemoverBloqueio: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler', true);
    if (!r.ehEquipe(ctx) || !agendaDe(q.org).bloqueios.has(q.params.bloqueioId)) throw naoEncontrado('Bloqueio');
    r.exigir(ctx, 'agenda.configuracao.gerenciar');
    agendaDe(q.org).bloqueios.delete(q.params.bloqueioId);
    return { status: 204 };
  },
  agendaListarHorarios: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler');
    const paraPaciente = !r.ehEquipe(ctx);
    if (paraPaciente) r.exigir(ctx, 'agenda.agendamento.criar');
    periodo(q.org, q.query.de, q.query.ate, 31);
    const s = obterServico(ctx, q.query.servicoId);
    if (s.status !== 'ATIVO') return ok({ itens: [] });
    const livres = horariosLivres(q.org, s, q.query.profissionalId, q.query.de, q.query.ate, paraPaciente);
    return ok({ itens: livres.map((h) => ({ inicioEm: iso(h.inicioMs), fimEm: iso(h.fimMs), profissional: r.refUsuario(q.org, h.profissionalId, 'PROFISSIONAL') })) });
  },
  agendamentosListar: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.ler');
    const { inicioMs, fimMs } = periodo(q.org, q.query.de, q.query.ate, 366);
    let lista = [...agendaDe(q.org).agendamentos.values()].filter((a) => a.inicioMs >= inicioMs && a.inicioMs < fimMs && r.podeVerPaciente(ctx, a.pacienteId));
    if (q.query.profissionalId) lista = lista.filter((a) => a.profissionalId === q.query.profissionalId);
    if (q.query.pacienteId) lista = lista.filter((a) => a.pacienteId === q.query.pacienteId);
    if (q.query.status) lista = lista.filter((a) => a.status === q.query.status);
    if (q.query.categoria) lista = lista.filter((a) => agendaDe(q.org).servicos.get(a.servicoId).categoria === q.query.categoria);
    lista.sort((a, b) => a.inicioMs - b.inicioMs || a.id.localeCompare(b.id));
    const p = r.paginar(lista, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((a) => serAgendamento(ctx, a)) });
  },
  agendamentosCriar: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'agenda.agendamento.criar');
    const b = q.body;
    const pac = r.obterPaciente(ctx, b.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const s = agendaDe(q.org).servicos.get(b.servicoId);
    if (!s || s.status !== 'ATIVO') throw invalido('servicoId', 'Serviço não encontrado.');
    if (!s.profissionaisIds.includes(b.profissionalId) || !equipeAtiva(q.org, b.profissionalId)) throw invalido('profissionalId', 'Este profissional não atende este serviço.');
    const inicioMs = Date.parse(b.inicioEm);
    let a;
    if (r.ehEquipe(ctx)) {
      const dur = b.duracaoMinutos ?? s.duracaoMinutos;
      if (!b.encaixe && ocupado(q.org, b.profissionalId, inicioMs, inicioMs + dur * MINUTO)) throw new ErroApi('HORARIO_INDISPONIVEL', 'Já existe um agendamento neste horário. Escolha outro ou marque como encaixe.');
      a = criarAgendamento(q.org, { pacienteId: pac.id, servicoId: s.id, profissionalId: b.profissionalId, inicioMs, duracaoMinutos: dur, origem: 'EQUIPE', porId: ctx.usuario.id, local: b.local, observacao: b.observacao, encaixe: b.encaixe });
    } else {
      for (const campo of ['duracaoMinutos', 'local', 'observacao', 'encaixe']) if (b[campo] !== undefined) throw invalido(campo, 'Campo exclusivo da equipe.');
      if (!s.autoagendavel) throw invalido('servicoId', 'Este serviço é marcado pela equipe.');
      const dia = partesLocais(inicioMs, q.org.config.fuso).data;
      const livre = horariosLivres(q.org, s, b.profissionalId, dia, dia, true).some((h) => h.inicioMs === inicioMs);
      if (!livre) {
        if (ocupado(q.org, b.profissionalId, inicioMs, inicioMs + s.duracaoMinutos * MINUTO)) throw new ErroApi('HORARIO_INDISPONIVEL', 'Este horário acabou de ser ocupado. Escolha outro.');
        throw invalido('inicioEm', 'Escolha um dos horários disponíveis.');
      }
      a = criarAgendamento(q.org, { pacienteId: pac.id, servicoId: s.id, profissionalId: b.profissionalId, inicioMs, origem: 'PACIENTE', porId: ctx.usuario.id });
    }
    return { status: 201, body: serAgendamento(ctx, a), headers: { ETag: r.etag(a.id, a._v) } };
  },
  agendamentosObter: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    return ok(serAgendamento(ctx, a), { ETag: r.etag(a.id, a._v) });
  },
  agendamentosEditar: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    r.exigir(ctx, 'agenda.agendamento.gerenciar');
    r.conferirIfMatch(q.headers['if-match'], a.id, a._v, () => serAgendamento(ctx, a));
    if (!ATIVOS.has(a.status)) throw invalido('status', 'Agendamento finalizado não pode ser editado.');
    if ('local' in q.body) a.local = q.body.local;
    if ('observacao' in q.body) a.observacao = q.body.observacao;
    a._v++;
    atualizado(q.org, a);
    return ok(serAgendamento(ctx, a), { ETag: r.etag(a.id, a._v) });
  },
  agendamentosConfirmar: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    if (r.ehEquipe(ctx)) r.exigir(ctx, 'agenda.agendamento.gerenciar');
    else if (agoraMs() >= a.inicioMs && a.status === 'AGENDADO') throw invalido('status', 'O horário já passou.');
    return ok(serAgendamento(ctx, confirmar(q.org, a, ctx.usuario.id)));
  },
  agendamentosCancelar: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    const porPaciente = !r.ehEquipe(ctx);
    if (!porPaciente) r.exigir(ctx, 'agenda.agendamento.gerenciar');
    else if (ATIVOS.has(a.status) && agoraMs() > a.inicioMs - cfg(q.org).cancelamentoAteHoras * HORA)
      throw invalido('status', `Pelo app, só é possível cancelar até ${cfg(q.org).cancelamentoAteHoras} horas antes. Fale com a equipe pela conversa.`, 'FORA_DO_PRAZO');
    return ok(serAgendamento(ctx, cancelar(q.org, a, ctx.usuario.id, q.body.motivo, porPaciente)));
  },
  agendamentosRemarcar: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    r.exigir(ctx, 'agenda.agendamento.gerenciar');
    if (!r.ehEquipe(ctx)) throw negado();
    if (!ATIVOS.has(a.status)) throw invalido('status', 'Agendamento finalizado não pode ser remarcado.');
    const s = agendaDe(q.org).servicos.get(a.servicoId);
    const prof = q.body.profissionalId ?? a.profissionalId;
    if (!s.profissionaisIds.includes(prof) || !equipeAtiva(q.org, prof)) throw invalido('profissionalId', 'Este profissional não atende este serviço.');
    const dur = q.body.duracaoMinutos ?? Math.round((a.fimMs - a.inicioMs) / MINUTO);
    const ini = Date.parse(q.body.inicioEm);
    if (!q.body.encaixe && ocupado(q.org, prof, ini, ini + dur * MINUTO, a.id)) throw new ErroApi('HORARIO_INDISPONIVEL', 'Já existe um agendamento neste horário.');
    return ok(serAgendamento(ctx, remarcar(q.org, a, ctx.usuario.id, { inicioMs: ini, profissionalId: prof, duracaoMinutos: dur, encaixe: !!q.body.encaixe, motivo: q.body.motivo ?? null })));
  },
  agendamentosRealizar: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    r.exigir(ctx, 'agenda.agendamento.gerenciar');
    return ok(serAgendamento(ctx, finalizar(q.org, a, ctx.usuario.id, 'REALIZADO')));
  },
  agendamentosRegistrarFalta: (q) => {
    const ctx = C(q);
    const a = obterAgendamento(ctx, q.params.agendamentoId);
    r.exigir(ctx, 'agenda.agendamento.gerenciar');
    return ok(serAgendamento(ctx, finalizar(q.org, a, ctx.usuario.id, 'FALTOU')));
  },
};
