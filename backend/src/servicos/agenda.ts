// Módulo agenda (ADR-0016): regras RN-AGE, horários livres, lembrete como job e serialização.
// A sobreposição sem encaixe é impedida pelo banco (EXCLUDE USING gist, migração 0005); a checagem
// aqui dá a mensagem certa e cobre o caso "sem encaixe por cima de um encaixe", que o banco não vê.
import { cap, configModulo, diferencaDias, localParaUtc, partesLocais, perfilPadrao, permissoesDe, somarDias, temModulo, type Termo } from '@clinica/dominio';
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { ErroApi, invalido } from '../erros.ts';
import { emitir } from '../eventos.ts';
import type { Log } from '../http.ts';
import { iso, type Ctx, type Org } from '../nucleo.ts';
import { conversaAtivaDoPaciente, participa } from './chat.ts';
import { agendar, cancelarPrefixo, registrarJob } from './jobs.ts';
import { notificar } from './notificar.ts';
import { contasDoPaciente, ehEquipeU, nomesPacientes, orgPorId, refUsuario, usuariosPorId } from './refs.ts';

const MIN = 60_000, HORA = 60 * MIN, DIA = 24 * HORA;
export const ATIVOS = ['AGENDADO', 'CONFIRMADO'];
export interface ConfigAgenda { autoagendamento: boolean; antecedenciaMinimaHoras: number; janelaDias: number; cancelamentoAteHoras: number; lembreteHorasAntes: number; intervaloMinutos: number }
export const cfgAgenda = (org: Org) => configModulo(org.modulos, 'agenda') as ConfigAgenda;
const termoConsulta = (org: Org): Termo => (org.termos as Record<string, Termo>).consulta ?? { singular: 'consulta', plural: 'consultas', genero: 'F' };
const um_a = (t: Termo) => (t.genero === 'F' ? 'uma' : 'um');
const part = (t: Termo, m: string, f: string) => (t.genero === 'F' ? f : m);

// ─────────── Período ───────────
export function periodo(org: Org, de: string, ate: string, maxDias: number) {
  const dias = diferencaDias(de, ate);
  if (dias < 0) throw invalido('ate', 'O fim do período vem antes do início.');
  if (dias >= maxDias) throw invalido('ate', `Consulte no máximo ${maxDias} dias por vez.`);
  return { inicio: new Date(localParaUtc(de, '00:00', org.fuso)), fim: new Date(localParaUtc(somarDias(ate, 1), '00:00', org.fuso)) };
}

// ─────────── Quem acompanha ───────────
/** Equipe ativa com permissão de ler a agenda (recebe os eventos em tempo real). */
export async function equipeDaAgenda(tx: Tx, org: Org): Promise<string[]> {
  const r = await todos(tx, `SELECT id, perfis FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO'`, [org.id]);
  return r.filter((u) => ehEquipeU(u) && u.perfis.some((p: any) => p !== 'PACIENTE' && permissoesDe(org.modulos, p).includes('agenda.agendamento.ler'))).map((u) => u.id);
}
export async function membroAtivoEquipe(tx: Tx, org: Org, id: string) {
  const u = await um(tx, `SELECT perfis, status FROM usuarios WHERE organizacao_id = $1 AND id = $2`, [org.id, id]);
  return !!u && u.status === 'ATIVO' && ehEquipeU(u);
}

// ─────────── Ocupação e horários livres (RN-AGE-002) ───────────
export async function ocupado(tx: Tx, org: Org, profissionalId: string, ini: Date, fim: Date, ignorarId: string | null = null) {
  return !!(await um(tx, `SELECT 1 FROM agendamentos WHERE organizacao_id = $1 AND profissional_id = $2 AND status <> 'CANCELADO'
      AND tstzrange(inicio_em, fim_em) && tstzrange($3, $4) AND ($5::text IS NULL OR id <> $5) LIMIT 1`, [org.id, profissionalId, ini, fim, ignorarId]));
}
export async function horariosLivres(tx: Tx, org: Org, s: any, profissionalId: string | undefined, de: string, ate: string, paraPaciente: boolean) {
  const c = cfgAgenda(org);
  const agora = Date.now();
  const minimo = paraPaciente ? agora + c.antecedenciaMinimaHoras * HORA : agora;
  const maximo = paraPaciente ? agora + c.janelaDias * DIA : Infinity;
  const ativos = await todos(tx, `SELECT id FROM usuarios WHERE organizacao_id = $1 AND id = ANY($2) AND status = 'ATIVO'`, [org.id, s.profissionais_ids]);
  const profs = (ativos.map((u) => u.id) as string[]).filter((id) => !profissionalId || id === profissionalId);
  if (!profs.length) return [];
  const { inicio, fim } = periodo(org, de, ate, 366);
  const grades = new Map((await todos(tx, 'SELECT profissional_id, itens FROM grades WHERE organizacao_id = $1 AND profissional_id = ANY($2)', [org.id, profs])).map((g) => [g.profissional_id, g.itens as any[]]));
  const ocup = await todos(tx, `SELECT profissional_id, inicio_em, fim_em FROM agendamentos WHERE organizacao_id = $1 AND profissional_id = ANY($2)
      AND status <> 'CANCELADO' AND inicio_em < $4 AND fim_em > $3`, [org.id, profs, inicio, fim]);
  const blq = await todos(tx, `SELECT profissional_id, inicio_em, fim_em FROM bloqueios WHERE organizacao_id = $1
      AND (profissional_id IS NULL OR profissional_id = ANY($2)) AND inicio_em < $4 AND fim_em > $3`, [org.id, profs, inicio, fim]);
  const cruza = (lista: any[], p: string, t0: number, t1: number, todosProfs = false) =>
    lista.some((x) => (x.profissional_id === p || (todosProfs && x.profissional_id === null)) && +x.inicio_em < t1 && t0 < +x.fim_em);
  const livres = new Map<string, { inicio: number; fim: number; profissionalId: string }>();
  for (let data = de; data <= ate; data = somarDias(data, 1)) {
    const diaSemana = partesLocais(localParaUtc(data, '12:00', org.fuso), org.fuso).diaSemana;
    for (const p of profs) {
      for (const it of grades.get(p) ?? []) {
        if (it.diaSemana !== diaSemana || (it.servicosIds && !it.servicosIds.includes(s.id))) continue;
        const a = localParaUtc(data, it.inicio, org.fuso), b = localParaUtc(data, it.fim, org.fuso);
        for (let t = a; t + s.duracao_minutos * MIN <= b; t += c.intervaloMinutos * MIN) {
          const tf = t + s.duracao_minutos * MIN;
          if (t < minimo || t > maximo || cruza(ocup, p, t, tf) || cruza(blq, p, t, tf, true)) continue;
          livres.set(`${p}|${t}`, { inicio: t, fim: tf, profissionalId: p });
        }
      }
    }
  }
  return [...livres.values()].sort((x, y) => x.inicio - y.inicio || x.profissionalId.localeCompare(y.profissionalId));
}

// ─────────── Ciclo de vida ───────────
const evento = (acao: string, porId: string | null, detalhe?: string | null) => ({ ocorridoEm: iso(new Date()), acao, porId, ...(detalhe !== undefined ? { detalhe } : {}) });
async function interessados(tx: Tx, org: Org, a: any) { return [...new Set([...await equipeDaAgenda(tx, org), ...await contasDoPaciente(tx, org, a.paciente_id)])]; }
async function avisarOutroLado(tx: Tx, org: Org, a: any, porPaciente: boolean, tipo: string, texto: string, log: Log) {
  const s = await um(tx, 'SELECT categoria FROM servicos WHERE organizacao_id = $1 AND id = $2', [org.id, a.servico_id]);
  const t = termoConsulta(org);
  const titulo = s?.categoria === 'PROCEDIMENTO' ? cap((org.termos as any).procedimento?.singular ?? 'procedimento') : cap(t.singular);
  const destino = { tela: 'agenda.detalhe', parametros: { agendamentoId: a.id } };
  const para = porPaciente ? [a.profissional_id] : await contasDoPaciente(tx, org, a.paciente_id);
  for (const uid of para) await notificar(tx, org, uid, { tipo, titulo, texto, destino }, log);
}
async function agendarLembrete(tx: Tx, org: Org, a: any) {
  const id = `agendamento:${a.id}:lembrete`;
  await cancelarPrefixo(tx, org.id, id);
  const em = +new Date(a.inicio_em) - cfgAgenda(org).lembreteHorasAntes * HORA;
  if (ATIVOS.includes(a.status) && em > Date.now()) await agendar(tx, org.id, id, 'agenda.lembrete', em, { agendamentoId: a.id });
}
registrarJob('agenda.lembrete', async (tx, orgId, { agendamentoId }, log) => {
  const a = await um(tx, 'SELECT * FROM agendamentos WHERE organizacao_id = $1 AND id = $2', [orgId, agendamentoId]);
  if (!a || !ATIVOS.includes(a.status)) return; // idempotente: confere o estado antes de agir
  const org = await orgPorId(orgId);
  const t = termoConsulta(org);
  const texto = `Lembrete: você tem ${um_a(t)} ${t.singular} em breve.${a.status === 'AGENDADO' ? ' Confirme sua presença pelo app.' : ''}`;
  for (const uid of await contasDoPaciente(tx, org, a.paciente_id))
    await notificar(tx, org, uid, { tipo: 'AGENDAMENTO_LEMBRETE', titulo: cap(t.singular), texto, destino: { tela: 'agenda.detalhe', parametros: { agendamentoId: a.id } } }, log);
});
async function atualizar(tx: Tx, org: Org, a: any, set: Record<string, unknown>, ev: object | null) {
  const cols = Object.keys(set);
  const r = (await um(tx, `UPDATE agendamentos SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}${cols.length ? ', ' : ''}
      versao = versao + 1${ev ? `, historico = historico || $${cols.length + 3}::jsonb` : ''} WHERE organizacao_id = $1 AND id = $2 RETURNING *`,
    [org.id, a.id, ...Object.values(set), ...(ev ? [JSON.stringify([ev])] : [])]))!;
  await emitir(tx, org.id, 'agenda.agendamento.atualizado', { agendamentoId: r.id }, await interessados(tx, org, r));
  return r;
}
/** Traduz a constraint de exclusão (23P01) em 409 de negócio. */
async function comExclusao<T>(fn: () => Promise<T>, msg: string): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e?.code === '23P01') throw new ErroApi('HORARIO_INDISPONIVEL', msg);
    throw e;
  }
}

export async function criarAgendamento(tx: Tx, org: Org, d: { id?: string; pacienteId: string; servico: any; profissionalId: string; inicio: Date; duracaoMinutos?: number; origem: 'EQUIPE' | 'PACIENTE'; porId: string; local?: string | null; observacao?: string | null; encaixe?: boolean; criadoEm?: Date }, log: Log) {
  const fim = new Date(+d.inicio + (d.duracaoMinutos ?? d.servico.duracao_minutos) * MIN);
  const a = (await comExclusao(() => um(tx, `INSERT INTO agendamentos (organizacao_id, id, paciente_id, servico_id, profissional_id, inicio_em, fim_em, origem, encaixe, local, orientacoes, observacao, historico, criado_por, criado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, now())) RETURNING *`,
    [org.id, d.id ?? novoId('agd'), d.pacienteId, d.servico.id, d.profissionalId, d.inicio, fim, d.origem, !!d.encaixe, d.local ?? null, d.servico.orientacoes ?? null,
      d.observacao ?? null, JSON.stringify([{ ...evento('CRIADO', d.porId), ...(d.criadoEm ? { ocorridoEm: iso(d.criadoEm) } : {}) }]), d.porId, d.criadoEm ?? null]),
  'Já existe um agendamento neste horário. Escolha outro ou marque como encaixe.'))!;
  await agendarLembrete(tx, org, a);
  await emitir(tx, org.id, 'agenda.agendamento.criado', { agendamentoId: a.id }, await interessados(tx, org, a));
  const t = termoConsulta(org);
  await avisarOutroLado(tx, org, a, d.origem === 'PACIENTE', 'AGENDAMENTO_CRIADO',
    d.origem === 'PACIENTE' ? `${cap(t.singular)} ${part(t, 'marcado', 'marcada')} pelo app.` : `${cap(um_a(t))} ${t.singular} foi ${part(t, 'marcado', 'marcada')} para você.`, log);
  return a;
}
export async function confirmar(tx: Tx, org: Org, a: any, porId: string | null) {
  if (a.status === 'CONFIRMADO') return a;
  if (a.status !== 'AGENDADO') throw invalido('status', 'Só é possível confirmar o que ainda está agendado.');
  return atualizar(tx, org, a, { status: 'CONFIRMADO' }, evento('CONFIRMADO', porId));
}
export async function cancelar(tx: Tx, org: Org, a: any, porId: string, motivo: string, porPaciente: boolean, log: Log) {
  if (!ATIVOS.includes(a.status)) throw invalido('status', 'Este agendamento não pode mais ser cancelado.');
  const r = await atualizar(tx, org, a, { status: 'CANCELADO', motivo_cancelamento: motivo }, evento('CANCELADO', porId, motivo));
  await cancelarPrefixo(tx, org.id, `agendamento:${a.id}:lembrete`);
  const t = termoConsulta(org);
  await avisarOutroLado(tx, org, r, porPaciente, 'AGENDAMENTO_ALTERADO', `${cap(um_a(t))} ${t.singular} foi ${part(t, 'cancelado', 'cancelada')}.`, log);
  return r;
}
export async function remarcar(tx: Tx, org: Org, a: any, porId: string, d: { inicio: Date; profissionalId: string; duracaoMinutos: number; encaixe: boolean; motivo: string | null }, log: Log) {
  const r = await comExclusao(() => atualizar(tx, org, a, {
    inicio_em: d.inicio, fim_em: new Date(+d.inicio + d.duracaoMinutos * MIN), profissional_id: d.profissionalId, encaixe: d.encaixe, status: 'AGENDADO',
  }, evento('REMARCADO', porId, d.motivo)), 'Já existe um agendamento neste horário.');
  await agendarLembrete(tx, org, r);
  const t = termoConsulta(org);
  await avisarOutroLado(tx, org, r, false, 'AGENDAMENTO_ALTERADO', `${cap(um_a(t))} ${t.singular} foi ${part(t, 'remarcado', 'remarcada')}. Confira o novo horário.`, log);
  return r;
}
export async function finalizar(tx: Tx, org: Org, a: any, porId: string, status: 'REALIZADO' | 'FALTOU') {
  if (!ATIVOS.includes(a.status)) throw invalido('status', 'Este agendamento já foi finalizado.');
  if (Date.now() < +new Date(a.inicio_em)) throw invalido('status', 'Só depois do horário marcado.');
  const r = await atualizar(tx, org, a, { status }, evento(status, porId));
  await cancelarPrefixo(tx, org.id, `agendamento:${a.id}:lembrete`);
  return r;
}

// ─────────── Serialização ───────────
export function serServico(ctx: Ctx, s: any, profs: Map<string, any>) {
  const acoes: string[] = [];
  if (ctx.perms.has('agenda.configuracao.gerenciar') && s.status === 'ATIVO') acoes.push('EDITAR', 'ARQUIVAR');
  if (s.status === 'ATIVO' && ctx.perms.has('agenda.agendamento.criar') && (ctx.perfil !== 'PACIENTE' || s.autoagendavel)) acoes.push('AGENDAR');
  return {
    id: s.id, nome: s.nome, categoria: s.categoria, duracaoMinutos: s.duracao_minutos, autoagendavel: s.autoagendavel,
    profissionais: (s.profissionais_ids as string[]).filter((id) => profs.has(id)).map((id) => refUsuario(profs.get(id), id, 'PROFISSIONAL')),
    orientacoes: s.orientacoes ?? null, status: s.status, acoesPermitidas: acoes,
  };
}
async function acoes(tx: Tx, ctx: Ctx, a: any): Promise<string[]> {
  const r: string[] = [];
  const ativo = ATIVOS.includes(a.status);
  const comecou = Date.now() >= +new Date(a.inicio_em);
  if (ctx.perfil !== 'PACIENTE') {
    if (ctx.perms.has('agenda.agendamento.gerenciar')) {
      if (ativo) r.push('EDITAR', 'REMARCAR', 'CANCELAR');
      if (a.status === 'AGENDADO') r.push('CONFIRMAR');
      if (ativo && comecou) r.push('REALIZAR', 'REGISTRAR_FALTA');
    }
  } else {
    if (a.status === 'AGENDADO' && !comecou) r.push('CONFIRMAR');
    if (ativo && Date.now() <= +new Date(a.inicio_em) - cfgAgenda(ctx.org).cancelamentoAteHoras * HORA) r.push('CANCELAR');
  }
  if (temModulo(ctx.org.modulos, 'chat') && ctx.perms.has('chat.conversa.ler')) {
    const c = await conversaAtivaDoPaciente(tx, ctx.org, a.paciente_id);
    if (c && await participa(tx, ctx.org, c.id, ctx.usuario.id)) r.push('ABRIR_CONVERSA');
  }
  return r;
}
/** Serializa em lote (uma consulta por tipo de referência, não por item). */
export async function serAgendamentos(tx: Tx, ctx: Ctx, linhas: any[]) {
  if (!linhas.length) return [];
  const org = ctx.org;
  const servicos = new Map((await todos(tx, 'SELECT id, nome, categoria FROM servicos WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, [...new Set(linhas.map((a) => a.servico_id))]])).map((s) => [s.id, s]));
  const usuarios = await usuariosPorId(tx, org, linhas.flatMap((a) => [a.profissional_id, ...(a.historico as any[]).map((h) => h.porId).filter(Boolean)]));
  const nomes = await nomesPacientes(tx, org, linhas.map((a) => a.paciente_id));
  const equipe = ctx.perfil !== 'PACIENTE';
  return Promise.all(linhas.map(async (a) => {
    const s = servicos.get(a.servico_id)!;
    return {
      id: a.id, paciente: { id: a.paciente_id, nome: nomes.get(a.paciente_id) ?? '—' },
      profissional: refUsuario(usuarios.get(a.profissional_id), a.profissional_id, 'PROFISSIONAL'),
      servico: { id: s.id, nome: s.nome, categoria: s.categoria },
      inicioEm: iso(a.inicio_em), fimEm: iso(a.fim_em), status: a.status, origem: a.origem, encaixe: a.encaixe,
      local: a.local ?? null, orientacoes: a.orientacoes ?? null, observacao: equipe ? a.observacao ?? null : null,
      motivoCancelamento: a.motivo_cancelamento ?? null,
      historico: (a.historico as any[]).map((h) => ({ ocorridoEm: h.ocorridoEm, acao: h.acao, por: h.porId && usuarios.has(h.porId) ? refUsuario(usuarios.get(h.porId), h.porId) : null, ...(h.detalhe !== undefined ? { detalhe: h.detalhe } : {}) })),
      criadoEm: iso(a.criado_em), acoesPermitidas: await acoes(tx, ctx, a),
    };
  }));
}
export async function resumos(tx: Tx, org: Org, linhas: any[]) {
  if (!linhas.length) return [];
  const servicos = new Map((await todos(tx, 'SELECT id, nome, categoria FROM servicos WHERE organizacao_id = $1 AND id = ANY($2)', [org.id, [...new Set(linhas.map((a) => a.servico_id))]])).map((s) => [s.id, s]));
  const usuarios = await usuariosPorId(tx, org, linhas.map((a) => a.profissional_id));
  const nomes = await nomesPacientes(tx, org, linhas.map((a) => a.paciente_id));
  return linhas.map((a) => ({
    id: a.id, inicioEm: iso(a.inicio_em), fimEm: iso(a.fim_em), status: a.status,
    servico: { nome: servicos.get(a.servico_id)!.nome, categoria: servicos.get(a.servico_id)!.categoria },
    profissional: { id: a.profissional_id, nome: usuarios.get(a.profissional_id)?.nome_exibicao ?? '—' },
    paciente: { id: a.paciente_id, nome: nomes.get(a.paciente_id) ?? '—' },
  }));
}
export { perfilPadrao };
