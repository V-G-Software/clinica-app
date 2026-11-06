// Módulo agenda (ADR-0016): serviços, grade, bloqueios, horários livres e agendamentos. Paciente só vê
// os agendamentos dos pacientes vinculados à conta (o resto é 404) e só marca em horário livre.
import { partesLocais, temModulo } from '@clinica/dominio';
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { ErroApi, invalido, naoEncontrado, negado } from '../erros.ts';
import { C, criado, ok, vazio, type Handler, type Req } from '../http.ts';
import { auditar, conferirIfMatch, ehEquipeCtx, etag, exigir, exigirModulo, iso, lerCursor, pagina, type Ctx } from '../nucleo.ts';
import {
  ATIVOS, cancelar, cfgAgenda, confirmar, criarAgendamento, finalizar, horariosLivres, membroAtivoEquipe, ocupado, periodo, remarcar, resumos,
  serAgendamentos, serServico,
} from '../servicos/agenda.ts';
import { refUsuario, usuariosPorId } from '../servicos/refs.ts';
import { obterPaciente } from './pacientes.ts';

const MIN = 60_000, HORA = 60 * MIN;
const audit = (q: Req, acao: string, recurso: string, id: string) => auditar(q.tx, q.org.id, { usuarioId: q.ctx?.usuario.id ?? null, acao, recurso, recursoId: id, ip: q.ip, requestId: q.requestId });
const ctxAgenda = (q: Req) => { exigirModulo(q.org, 'agenda'); return C(q); };

// ─────────── Visibilidade ───────────
function filtroPaciente(ctx: Ctx, coluna: string, n: number) {
  if (ehEquipeCtx(ctx)) return { sql: '', params: [] as unknown[] };
  return { sql: ` AND ${coluna} IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $${n})`, params: [ctx.usuario.id] };
}
async function obterAgendamento(tx: Tx, ctx: Ctx, id: string) {
  if (!ctx.perms.has('agenda.agendamento.ler')) throw naoEncontrado('Agendamento');
  const f = filtroPaciente(ctx, 'paciente_id', 3);
  const a = await um(tx, `SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2${f.sql} FOR UPDATE`, [ctx.org.id, id, ...f.params]);
  if (!a) throw naoEncontrado('Agendamento');
  return a;
}
async function obterServico(tx: Tx, ctx: Ctx, id: string) {
  const s = await um(tx, 'SELECT * FROM servicos WHERE organizacao_id = $1 AND id = $2', [ctx.org.id, id]);
  if (!s || (!ehEquipeCtx(ctx) && !(s.status === 'ATIVO' && s.autoagendavel && cfgAgenda(ctx.org).autoagendamento))) throw naoEncontrado('Serviço');
  return s;
}
async function profissionais(tx: Tx, ctx: Ctx, servicos: any[]) {
  return usuariosPorId(tx, ctx.org, servicos.flatMap((s) => s.profissionais_ids));
}
async function umServico(tx: Tx, ctx: Ctx, s: any) { return serServico(ctx, s, await profissionais(tx, ctx, [s])); }
async function umAgendamento(tx: Tx, ctx: Ctx, a: any) { return (await serAgendamentos(tx, ctx, [a]))[0]; }
async function obterProfissional(tx: Tx, ctx: Ctx, id: string) {
  if (!ehEquipeCtx(ctx) || !ctx.perms.has('agenda.agendamento.ler') || !(await membroAtivoEquipe(tx, ctx.org, id))) throw naoEncontrado('Profissional');
  return id;
}
async function validarServico(tx: Tx, ctx: Ctx, b: any) {
  if (b.categoria === 'PROCEDIMENTO' && b.autoagendavel) throw invalido('autoagendavel', 'Procedimentos são marcados pela equipe.');
  for (const [i, id] of (b.profissionaisIds as string[]).entries()) if (!(await membroAtivoEquipe(tx, ctx.org, id))) throw invalido(`profissionaisIds.${i}`, 'Membro da equipe inválido.');
}
async function serGrade(tx: Tx, ctx: Ctx, prof: string) {
  const g = await um(tx, 'SELECT itens, versao FROM grades WHERE organizacao_id = $1 AND profissional_id = $2', [ctx.org.id, prof]);
  const u = (await usuariosPorId(tx, ctx.org, [prof])).get(prof);
  return {
    corpo: {
      profissional: refUsuario(u, prof, 'PROFISSIONAL'),
      itens: ((g?.itens ?? []) as any[]).map((i) => ({ diaSemana: i.diaSemana, inicio: i.inicio, fim: i.fim, ...(i.servicosIds ? { servicosIds: i.servicosIds } : {}) })),
      acoesPermitidas: ctx.perms.has('agenda.configuracao.gerenciar') ? ['EDITAR'] : [],
    },
    versao: g?.versao ?? 0,
  };
}
async function serBloqueios(tx: Tx, ctx: Ctx, linhas: any[]) {
  const us = await usuariosPorId(tx, ctx.org, linhas.map((b) => b.profissional_id).filter(Boolean));
  return linhas.map((b) => ({
    id: b.id, profissional: b.profissional_id ? refUsuario(us.get(b.profissional_id), b.profissional_id, 'PROFISSIONAL') : null,
    inicioEm: iso(b.inicio_em), fimEm: iso(b.fim_em), motivo: b.motivo ?? null,
    acoesPermitidas: ctx.perms.has('agenda.configuracao.gerenciar') ? ['REMOVER'] : [],
  }));
}

export const handlersAgenda: Record<string, Handler> = {
  // ─────────── Serviços ───────────
  agendaListarServicos: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler');
    const params: unknown[] = [q.org.id];
    let where = '';
    if (!ehEquipeCtx(ctx)) where += cfgAgenda(q.org).autoagendamento ? ` AND status = 'ATIVO' AND autoagendavel` : ' AND false';
    if (q.query.status) { params.push(q.query.status); where += ` AND status = $${params.length}`; }
    const lista = await todos(q.tx, `SELECT * FROM servicos WHERE organizacao_id = $1${where} ORDER BY nome COLLATE "C", id`, params);
    const profs = await profissionais(q.tx, ctx, lista);
    lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return ok({ itens: lista.map((s) => serServico(ctx, s, profs)) });
  },
  agendaCriarServico: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.configuracao.gerenciar');
    await validarServico(q.tx, ctx, q.body);
    const b = q.body;
    const s = (await um(q.tx, `INSERT INTO servicos (organizacao_id, id, nome, categoria, duracao_minutos, autoagendavel, profissionais_ids, orientacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [q.org.id, novoId('srv'), b.nome, b.categoria, b.duracaoMinutos, b.autoagendavel, b.profissionaisIds, b.orientacoes ?? null]))!;
    await audit(q, 'CRIAR', 'servico', s.id);
    return criado(await umServico(q.tx, ctx, s), { ETag: etag(s.id, s.versao) });
  },
  agendaObterServico: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler', true);
    const s = await obterServico(q.tx, ctx, q.params.servicoId);
    return ok(await umServico(q.tx, ctx, s), { ETag: etag(s.id, s.versao) });
  },
  agendaEditarServico: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler', true);
    const s = await obterServico(q.tx, ctx, q.params.servicoId);
    exigir(ctx, 'agenda.configuracao.gerenciar');
    const atual = await umServico(q.tx, ctx, s);
    conferirIfMatch(q.headers['if-match'], s.id, s.versao, () => atual);
    if (s.status !== 'ATIVO') throw invalido('status', 'Serviço arquivado não pode ser editado.');
    await validarServico(q.tx, ctx, q.body);
    const b = q.body;
    const r = await um(q.tx, `UPDATE servicos SET nome = $3, categoria = $4, duracao_minutos = $5, autoagendavel = $6, profissionais_ids = $7, orientacoes = $8, versao = versao + 1
      WHERE organizacao_id = $1 AND id = $2 AND versao = $9 RETURNING *`, [q.org.id, s.id, b.nome, b.categoria, b.duracaoMinutos, b.autoagendavel, b.profissionaisIds, b.orientacoes ?? null, s.versao]);
    if (!r) throw new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual: atual });
    await audit(q, 'ALTERAR', 'servico', s.id);
    return ok(await umServico(q.tx, ctx, r), { ETag: etag(r.id, r.versao) });
  },
  agendaArquivarServico: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler', true);
    const s = await obterServico(q.tx, ctx, q.params.servicoId);
    exigir(ctx, 'agenda.configuracao.gerenciar');
    const r = s.status === 'ARQUIVADO' ? s : (await um(q.tx, `UPDATE servicos SET status = 'ARQUIVADO', versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [q.org.id, s.id]))!;
    if (r !== s) await audit(q, 'ARQUIVAR', 'servico', s.id);
    return ok(await umServico(q.tx, ctx, r));
  },
  // ─────────── Grade e bloqueios ───────────
  agendaObterGrade: async (q) => {
    const ctx = ctxAgenda(q);
    const prof = await obterProfissional(q.tx, ctx, q.params.profissionalId);
    const g = await serGrade(q.tx, ctx, prof);
    return ok(g.corpo, { ETag: etag(`grd_${prof}`, g.versao) });
  },
  agendaSalvarGrade: async (q) => {
    const ctx = ctxAgenda(q);
    const prof = await obterProfissional(q.tx, ctx, q.params.profissionalId);
    exigir(ctx, 'agenda.configuracao.gerenciar');
    const atual = await serGrade(q.tx, ctx, prof);
    conferirIfMatch(q.headers['if-match'], `grd_${prof}`, atual.versao, () => atual.corpo);
    const ids = new Set((await todos(q.tx, 'SELECT id FROM servicos WHERE organizacao_id = $1', [q.org.id])).map((s) => s.id));
    (q.body.itens as any[]).forEach((it, i) => {
      if (it.inicio >= it.fim) throw invalido(`itens.${i}.fim`, 'O fim precisa ser depois do início.');
      (it.servicosIds ?? []).forEach((id: string, j: number) => { if (!ids.has(id)) throw invalido(`itens.${i}.servicosIds.${j}`, 'Serviço não encontrado.'); });
    });
    const itens = JSON.stringify((q.body.itens as any[]).map((it) => ({ diaSemana: it.diaSemana, inicio: it.inicio, fim: it.fim, servicosIds: it.servicosIds ?? null })));
    // Upsert com versão: duas edições simultâneas não se sobrescrevem (a segunda recebe 412).
    const r = atual.versao === 0
      ? await um(q.tx, `INSERT INTO grades (organizacao_id, profissional_id, itens) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING versao`, [q.org.id, prof, itens])
      : await um(q.tx, `UPDATE grades SET itens = $3, versao = versao + 1 WHERE organizacao_id = $1 AND profissional_id = $2 AND versao = $4 RETURNING versao`, [q.org.id, prof, itens, atual.versao]);
    if (!r) throw new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual: atual.corpo });
    await audit(q, 'ALTERAR', 'grade', prof);
    const g = await serGrade(q.tx, ctx, prof);
    return ok(g.corpo, { ETag: etag(`grd_${prof}`, g.versao) });
  },
  agendaListarBloqueios: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler');
    if (!ehEquipeCtx(ctx)) throw negado();
    const { inicio, fim } = periodo(q.org, q.query.de, q.query.ate, 366);
    const params: unknown[] = [q.org.id, inicio, fim];
    let where = '';
    if (q.query.profissionalId) { params.push(q.query.profissionalId); where = ` AND (profissional_id IS NULL OR profissional_id = $4)`; }
    const linhas = await todos(q.tx, `SELECT * FROM bloqueios WHERE organizacao_id = $1 AND inicio_em < $3 AND fim_em > $2${where} ORDER BY inicio_em, id`, params);
    return ok({ itens: await serBloqueios(q.tx, ctx, linhas) });
  },
  agendaCriarBloqueio: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.configuracao.gerenciar');
    const ini = new Date(q.body.inicioEm), fim = new Date(q.body.fimEm);
    if (+fim <= +ini) throw invalido('fimEm', 'O fim precisa ser depois do início.');
    if (q.body.profissionalId && !(await membroAtivoEquipe(q.tx, q.org, q.body.profissionalId))) throw invalido('profissionalId', 'Membro da equipe inválido.');
    const b = (await um(q.tx, `INSERT INTO bloqueios (organizacao_id, id, profissional_id, inicio_em, fim_em, motivo, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [q.org.id, novoId('blq'), q.body.profissionalId ?? null, ini, fim, q.body.motivo ?? null, ctx.usuario.id]))!;
    await audit(q, 'CRIAR', 'bloqueio', b.id);
    return criado((await serBloqueios(q.tx, ctx, [b]))[0]);
  },
  agendaRemoverBloqueio: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler', true);
    const b = ehEquipeCtx(ctx) ? await um(q.tx, 'SELECT id FROM bloqueios WHERE organizacao_id = $1 AND id = $2', [q.org.id, q.params.bloqueioId]) : null;
    if (!b) throw naoEncontrado('Bloqueio');
    exigir(ctx, 'agenda.configuracao.gerenciar');
    await q.tx.query('DELETE FROM bloqueios WHERE organizacao_id = $1 AND id = $2', [q.org.id, b.id]);
    await audit(q, 'REMOVER', 'bloqueio', b.id);
    return vazio();
  },
  agendaListarHorarios: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler');
    const paraPaciente = !ehEquipeCtx(ctx);
    if (paraPaciente) exigir(ctx, 'agenda.agendamento.criar');
    periodo(q.org, q.query.de, q.query.ate, 31);
    const s = await obterServico(q.tx, ctx, q.query.servicoId);
    if (s.status !== 'ATIVO') return ok({ itens: [] });
    const livres = await horariosLivres(q.tx, q.org, s, q.query.profissionalId, q.query.de, q.query.ate, paraPaciente);
    const us = await usuariosPorId(q.tx, q.org, [...new Set(livres.map((h) => h.profissionalId))]);
    return ok({ itens: livres.map((h) => ({ inicioEm: iso(new Date(h.inicio)), fimEm: iso(new Date(h.fim)), profissional: refUsuario(us.get(h.profissionalId), h.profissionalId, 'PROFISSIONAL') })) });
  },
  // ─────────── Agendamentos ───────────
  agendamentosListar: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.ler');
    const { inicio, fim } = periodo(q.org, q.query.de, q.query.ate, 366);
    const f = filtroPaciente(ctx, 'a.paciente_id', 4);
    const params: unknown[] = [q.org.id, inicio, fim, ...f.params];
    let where = f.sql;
    const add = (cond: string, v: unknown) => { params.push(v); where += ` AND ${cond.replace('?', `$${params.length}`)}`; };
    if (q.query.profissionalId) add('a.profissional_id = ?', q.query.profissionalId);
    if (q.query.pacienteId) add('a.paciente_id = ?', q.query.pacienteId);
    if (q.query.status) add('a.status = ?', q.query.status);
    if (q.query.categoria) add('s.categoria = ?', q.query.categoria);
    const limite = q.query.limite ?? 20;
    const off = lerCursor(q.query.cursor);
    const linhas = await todos(q.tx, `SELECT a.* FROM agendamentos a JOIN servicos s ON s.organizacao_id = a.organizacao_id AND s.id = a.servico_id
      WHERE a.organizacao_id = $1 AND a.inicio_em >= $2 AND a.inicio_em < $3${where} ORDER BY a.inicio_em, a.id OFFSET ${off} LIMIT ${limite + 1}`, params);
    const p = pagina(linhas, off, limite);
    return ok({ ...p, itens: await serAgendamentos(q.tx, ctx, p.itens) });
  },
  agendamentosCriar: async (q) => {
    const ctx = ctxAgenda(q);
    exigir(ctx, 'agenda.agendamento.criar');
    const b = q.body;
    const pac = await obterPaciente(q.tx, ctx, b.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const s = await um(q.tx, 'SELECT * FROM servicos WHERE organizacao_id = $1 AND id = $2', [q.org.id, b.servicoId]);
    if (!s || s.status !== 'ATIVO') throw invalido('servicoId', 'Serviço não encontrado.');
    if (!s.profissionais_ids.includes(b.profissionalId) || !(await membroAtivoEquipe(q.tx, q.org, b.profissionalId))) throw invalido('profissionalId', 'Este profissional não atende este serviço.');
    const inicio = new Date(b.inicioEm);
    let a;
    if (ehEquipeCtx(ctx)) {
      const dur = b.duracaoMinutos ?? s.duracao_minutos;
      if (!b.encaixe && await ocupado(q.tx, q.org, b.profissionalId, inicio, new Date(+inicio + dur * MIN))) throw new ErroApi('HORARIO_INDISPONIVEL', 'Já existe um agendamento neste horário. Escolha outro ou marque como encaixe.');
      a = await criarAgendamento(q.tx, q.org, { pacienteId: pac.id, servico: s, profissionalId: b.profissionalId, inicio, duracaoMinutos: dur, origem: 'EQUIPE', porId: ctx.usuario.id, local: b.local, observacao: b.observacao, encaixe: b.encaixe }, q.log);
    } else {
      for (const campo of ['duracaoMinutos', 'local', 'observacao', 'encaixe']) if (b[campo] !== undefined) throw invalido(campo, 'Campo exclusivo da equipe.');
      if (!s.autoagendavel) throw invalido('servicoId', 'Este serviço é marcado pela equipe.');
      const dia = partesLocais(+inicio, q.org.fuso).data;
      const livre = (await horariosLivres(q.tx, q.org, s, b.profissionalId, dia, dia, true)).some((h) => h.inicio === +inicio);
      if (!livre) {
        if (await ocupado(q.tx, q.org, b.profissionalId, inicio, new Date(+inicio + s.duracao_minutos * MIN))) throw new ErroApi('HORARIO_INDISPONIVEL', 'Este horário acabou de ser ocupado. Escolha outro.');
        throw invalido('inicioEm', 'Escolha um dos horários disponíveis.');
      }
      a = await criarAgendamento(q.tx, q.org, { pacienteId: pac.id, servico: s, profissionalId: b.profissionalId, inicio, origem: 'PACIENTE', porId: ctx.usuario.id }, q.log);
    }
    await audit(q, 'CRIAR', 'agendamento', a.id);
    return criado(await umAgendamento(q.tx, ctx, a), { ETag: etag(a.id, a.versao) });
  },
  agendamentosObter: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    await audit(q, 'LER', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, a), { ETag: etag(a.id, a.versao) });
  },
  agendamentosEditar: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    exigir(ctx, 'agenda.agendamento.gerenciar');
    const atual = await umAgendamento(q.tx, ctx, a);
    conferirIfMatch(q.headers['if-match'], a.id, a.versao, () => atual);
    if (!ATIVOS.includes(a.status)) throw invalido('status', 'Agendamento finalizado não pode ser editado.');
    const r = (await um(q.tx, `UPDATE agendamentos SET local = CASE WHEN $3 THEN $4 ELSE local END, observacao = CASE WHEN $5 THEN $6 ELSE observacao END, versao = versao + 1
      WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [q.org.id, a.id, 'local' in q.body, q.body.local ?? null, 'observacao' in q.body, q.body.observacao ?? null]))!;
    await audit(q, 'ALTERAR', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, r), { ETag: etag(r.id, r.versao) });
  },
  agendamentosConfirmar: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    if (ehEquipeCtx(ctx)) exigir(ctx, 'agenda.agendamento.gerenciar');
    else if (a.status === 'AGENDADO' && Date.now() >= +new Date(a.inicio_em)) throw invalido('status', 'O horário já passou.');
    const r = await confirmar(q.tx, q.org, a, ctx.usuario.id);
    if (r !== a) await audit(q, 'CONFIRMAR', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, r));
  },
  agendamentosCancelar: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    const porPaciente = !ehEquipeCtx(ctx);
    if (!porPaciente) exigir(ctx, 'agenda.agendamento.gerenciar');
    else if (ATIVOS.includes(a.status) && Date.now() > +new Date(a.inicio_em) - cfgAgenda(q.org).cancelamentoAteHoras * HORA)
      throw invalido('status', `Pelo app, só é possível cancelar até ${cfgAgenda(q.org).cancelamentoAteHoras} horas antes. Fale com a equipe pela conversa.`, 'FORA_DO_PRAZO');
    const r = await cancelar(q.tx, q.org, a, ctx.usuario.id, q.body.motivo, porPaciente, q.log);
    await audit(q, 'CANCELAR', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, r));
  },
  agendamentosRemarcar: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    exigir(ctx, 'agenda.agendamento.gerenciar');
    if (!ehEquipeCtx(ctx)) throw negado();
    if (!ATIVOS.includes(a.status)) throw invalido('status', 'Agendamento finalizado não pode ser remarcado.');
    const s = (await um(q.tx, 'SELECT profissionais_ids FROM servicos WHERE organizacao_id = $1 AND id = $2', [q.org.id, a.servico_id]))!;
    const prof = q.body.profissionalId ?? a.profissional_id;
    if (!s.profissionais_ids.includes(prof) || !(await membroAtivoEquipe(q.tx, q.org, prof))) throw invalido('profissionalId', 'Este profissional não atende este serviço.');
    const dur = q.body.duracaoMinutos ?? Math.round((+new Date(a.fim_em) - +new Date(a.inicio_em)) / MIN);
    const ini = new Date(q.body.inicioEm);
    if (!q.body.encaixe && await ocupado(q.tx, q.org, prof, ini, new Date(+ini + dur * MIN), a.id)) throw new ErroApi('HORARIO_INDISPONIVEL', 'Já existe um agendamento neste horário.');
    const r = await remarcar(q.tx, q.org, a, ctx.usuario.id, { inicio: ini, profissionalId: prof, duracaoMinutos: dur, encaixe: !!q.body.encaixe, motivo: q.body.motivo ?? null }, q.log);
    await audit(q, 'REMARCAR', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, r));
  },
  agendamentosRealizar: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    exigir(ctx, 'agenda.agendamento.gerenciar');
    const r = await finalizar(q.tx, q.org, a, ctx.usuario.id, 'REALIZADO');
    await audit(q, 'REALIZAR', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, r));
  },
  agendamentosRegistrarFalta: async (q) => {
    const ctx = ctxAgenda(q);
    const a = await obterAgendamento(q.tx, ctx, q.params.agendamentoId);
    exigir(ctx, 'agenda.agendamento.gerenciar');
    const r = await finalizar(q.tx, q.org, a, ctx.usuario.id, 'FALTOU');
    await audit(q, 'REGISTRAR_FALTA', 'agendamento', a.id);
    return ok(await umAgendamento(q.tx, ctx, r));
  },
};

// ─────────── Tela inicial ───────────
export async function secoesInicioAgenda(tx: Tx, ctx: Ctx) {
  const org = ctx.org;
  if (!temModulo(org.modulos, 'agenda') || !ctx.perms.has('agenda.agendamento.ler')) return [];
  if (ehEquipeCtx(ctx)) {
    const hoje = partesLocais(Date.now(), org.fuso).data;
    const { inicio, fim } = periodo(org, hoje, hoje, 1);
    // Profissional vê a própria agenda; gestão e secretaria veem a de todos.
    const so = ctx.perfil === 'PROFISSIONAL' ? ctx.usuario.id : null;
    const linhas = await todos(tx, `SELECT * FROM agendamentos WHERE organizacao_id = $1 AND status <> 'CANCELADO' AND inicio_em >= $2 AND inicio_em < $3
      AND ($4::text IS NULL OR profissional_id = $4) ORDER BY inicio_em, id`, [org.id, inicio, fim, so]);
    return [{ id: 'agenda-do-dia', tipo: 'AGENDA_DO_DIA', dados: { data: hoje, total: linhas.length, itens: await resumos(tx, org, linhas.slice(0, 20)) } }];
  }
  const prox = await um(tx, `SELECT * FROM agendamentos WHERE organizacao_id = $1 AND status = ANY($2) AND fim_em > now()
      AND paciente_id IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $3) ORDER BY inicio_em, id LIMIT 1`, [org.id, ATIVOS, ctx.usuario.id]);
  return prox ? [{ id: 'proxima-consulta', tipo: 'PROXIMA_CONSULTA', dados: { agendamento: await umAgendamento(tx, ctx, prox) } }] : [];
}
