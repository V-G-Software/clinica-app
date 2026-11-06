// Protocolos, acompanhamentos, check-ins e alertas (9.3–9.5). Paciente só enxerga o que é dos pacientes
// vinculados à conta; o resto é 404 (não revela existência). Regras em servicos/acompanhamento.ts.
import { diferencaDias, partesLocais, temModulo } from '@clinica/dominio';
import { novoId } from '../cripto.ts';
import { todos, um, type Tx } from '../db.ts';
import { invalido, naoEncontrado, negado } from '../erros.ts';
import { C, criado, ok, type Handler, type Req } from '../http.ts';
import { auditar, conferirIfMatch, ehEquipeCtx, etag, exigir, exigirModulo, iso, lerCursor, pagina, type Ctx } from '../nucleo.ts';
import { criarAcompanhamento, encerrarAcompanhamento, protocoloPublico, protocoloVersao, resolverAlerta, responderCheckin } from '../servicos/acompanhamento.ts';
import { adicionarParticipante, participa } from '../servicos/chat.ts';
import { emitir } from '../eventos.ts';
import { arquivoResumo, contasDoPaciente, equipeAtiva, membroValido, nomesPacientes, refUsuario, usuariosPorId } from '../servicos/refs.ts';
import { obterPaciente } from './pacientes.ts';

const audit = (q: Req, acao: string, recurso: string, id: string) => auditar(q.tx, q.org.id, { usuarioId: q.ctx?.usuario.id ?? null, acao, recurso, recursoId: id, ip: q.ip, requestId: q.requestId });

// ─────────── Protocolos ───────────
function serProtocolo(ctx: Ctx, p: any) {
  const acoes: string[] = [];
  if (ctx.perms.has('acompanhamento.protocolo.gerenciar')) acoes.push('EDITAR', ...(p.status === 'ATIVO' ? ['ARQUIVAR'] : []));
  if (p.status === 'ATIVO' && ctx.perms.has('acompanhamento.acompanhamento.criar')) acoes.push('INICIAR_ACOMPANHAMENTO');
  return { ...protocoloPublico(p), acoesPermitidas: acoes };
}
async function validarProtocolo(tx: Tx, orgId: string, p: any) {
  const campos = new Set<string>();
  for (const [i, ck] of p.checkins.entries()) {
    const f = await um(tx, 'SELECT finalidade, campos FROM formularios WHERE organizacao_id = $1 AND id = $2 AND versao = $3', [orgId, ck.formulario.id, ck.formulario.versao]);
    if (!f) throw invalido(`checkins.${i}.formulario`, 'Formulário ou versão inexistente.');
    if (f.finalidade === 'CADASTRO') throw invalido(`checkins.${i}.formulario`, 'Use um formulário de check-in.');
    if (ck.dias.some((d: number) => d > p.duracaoDias)) throw invalido(`checkins.${i}.dias`, 'Dia além da duração do protocolo.');
    f.campos.forEach((c: any) => campos.add(c.id));
  }
  (p.orientacoes ?? []).forEach((o: any, i: number) => { if (o.dia > p.duracaoDias) throw invalido(`orientacoes.${i}.dia`, 'Dia além da duração do protocolo.'); });
  (p.regrasAlerta ?? []).forEach((ra: any, i: number) => {
    if (ra.tipo === 'RESPOSTA' && !campos.has(ra.campo)) throw invalido(`regrasAlerta.${i}.campo`, 'Campo não existe nos formulários do protocolo.');
  });
  if (new Set((p.regrasAlerta ?? []).map((x: any) => x.id)).size !== (p.regrasAlerta ?? []).length) throw invalido('regrasAlerta', 'Identificadores repetidos.');
}
const inserirProtocolo = (tx: Tx, orgId: string, id: string, versao: number, status: string, b: any) =>
  um(tx, `INSERT INTO protocolos (organizacao_id, id, versao, nome, descricao, duracao_dias, status, checkins, orientacoes, regras_alerta)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [orgId, id, versao, b.nome, b.descricao ?? null, b.duracaoDias, status, JSON.stringify(b.checkins), JSON.stringify(b.orientacoes ?? []), JSON.stringify(b.regrasAlerta ?? [])]);

// ─────────── Visibilidade ───────────
/** Filtro SQL de pacientes visíveis: equipe vê a organização; paciente, os vinculados (parâmetro $2). */
function filtroPaciente(ctx: Ctx, coluna: string) {
  if (ehEquipeCtx(ctx)) return { sql: '', params: [] as unknown[] };
  return { sql: ` AND ${coluna} IN (SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2)`, params: [ctx.usuario.id] };
}
async function obterAcompanhamento(tx: Tx, ctx: Ctx, id: string, travar = false) {
  exigirModulo(ctx.org, 'acompanhamento');
  if (!ctx.perms.has('acompanhamento.acompanhamento.ler')) throw naoEncontrado('Acompanhamento');
  const f = filtroPaciente(ctx, 'paciente_id');
  const a = await um(tx, `SELECT * FROM acompanhamentos WHERE organizacao_id = $1${f.sql} AND id = $${2 + f.params.length}${travar ? ' FOR UPDATE' : ''}`, [ctx.org.id, ...f.params, id]);
  if (!a) throw naoEncontrado('Acompanhamento');
  return a;
}
async function obterCheckin(tx: Tx, ctx: Ctx, id: string) {
  exigirModulo(ctx.org, 'acompanhamento');
  if (!ctx.perms.has('acompanhamento.checkin.ler')) throw naoEncontrado('Check-in');
  const f = filtroPaciente(ctx, 'paciente_id');
  const c = await um(tx, `SELECT * FROM checkins WHERE organizacao_id = $1${f.sql} AND id = $${2 + f.params.length}`, [ctx.org.id, ...f.params, id]);
  if (!c) throw naoEncontrado('Check-in');
  return c;
}

// ─────────── Serialização ───────────
export const resumoCheckin = (c: any, nomes: Map<string, string>) => ({
  id: c.id, acompanhamentoId: c.acompanhamento_id, paciente: { id: c.paciente_id, nome: nomes.get(c.paciente_id) ?? '—' }, dia: c.dia, status: c.status,
  disponivelEm: iso(c.disponivel_em), expiraEm: iso(c.expira_em),
});

export async function serAcompanhamento(tx: Tx, ctx: Ctx, a: any) {
  const org = ctx.org;
  const equipe = ehEquipeCtx(ctx);
  const cks = await todos(tx, 'SELECT * FROM checkins WHERE organizacao_id = $1 AND acompanhamento_id = $2 ORDER BY dia, disponivel_em', [org.id, a.id]);
  const conta = (s: string) => cks.filter((c) => c.status === s).length;
  const prox = cks.find((c) => c.status === 'DISPONIVEL') ?? cks.find((c) => c.status === 'AGENDADO') ?? null;
  const nomes = await nomesPacientes(tx, org, [a.paciente_id]);
  const usuarios = await usuariosPorId(tx, org, a.equipe_ids);
  const conversa = temModulo(org.modulos, 'chat') && a.conversa_id ? a.conversa_id : null;
  const souParticipante = conversa ? await participa(tx, org, conversa, ctx.usuario.id) : false;
  const emAndamento = a.status === 'ATIVO' || a.status === 'AGENDADO';
  const acoes: string[] = [];
  if (equipe && emAndamento && ctx.perms.has('acompanhamento.acompanhamento.criar')) acoes.push('EDITAR');
  if (equipe && emAndamento && ctx.perms.has('acompanhamento.acompanhamento.encerrar')) acoes.push('ENCERRAR');
  if (conversa && (souParticipante || (equipe && ctx.perms.has('chat.conversa.gerenciar')))) acoes.push('ABRIR_CONVERSA');
  const alertas = equipe ? (await um<{ n: number }>(tx, `SELECT count(*)::int AS n FROM alertas WHERE organizacao_id = $1 AND acompanhamento_id = $2 AND status = 'ABERTO'`, [org.id, a.id]))!.n : 0;
  return {
    id: a.id, paciente: { id: a.paciente_id, nome: nomes.get(a.paciente_id) ?? '—' },
    protocolo: { id: a.protocolo.id, versao: a.protocolo.versao, nome: a.protocolo.nome },
    dataInicio: a.data_inicio, diaAtual: diferencaDias(a.data_inicio, partesLocais(Date.now(), org.fuso).data), totalDias: a.protocolo.duracaoDias, status: a.status,
    equipe: a.equipe_ids.filter((id: string) => usuarios.has(id)).map((id: string) => refUsuario(usuarios.get(id), id)),
    conversaId: conversa && (souParticipante || equipe) ? conversa : null,
    agendamentoId: a.agendamento_id ?? null,
    resumoCheckins: { respondidos: conta('RESPONDIDO'), pendentes: conta('DISPONIVEL'), expirados: conta('EXPIRADO'), agendados: conta('AGENDADO') },
    alertasAbertos: alertas,
    proximoCheckin: prox ? resumoCheckin(prox, nomes) : null,
    observacao: equipe ? a.observacao ?? null : null, // observação é interna da equipe
    motivoEncerramento: a.motivo_encerramento ?? null,
    criadoEm: iso(a.criado_em),
    acoesPermitidas: acoes,
  };
}

export async function serAlerta(tx: Tx, ctx: Ctx, al: any, nomes?: Map<string, string>) {
  const org = ctx.org;
  const acoes: string[] = [];
  if (al.status === 'ABERTO' && ctx.perms.has('acompanhamento.alerta.resolver')) acoes.push('RESOLVER');
  const a = await um(tx, 'SELECT conversa_id FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [org.id, al.acompanhamento_id]);
  if (temModulo(org.modulos, 'chat') && a?.conversa_id && (ctx.perms.has('chat.conversa.gerenciar') || await participa(tx, org, a.conversa_id, ctx.usuario.id))) acoes.push('ABRIR_CONVERSA');
  const n = nomes ?? await nomesPacientes(tx, org, [al.paciente_id]);
  const resolvedor = al.resolvido_por ? (await usuariosPorId(tx, org, [al.resolvido_por])).get(al.resolvido_por) : null;
  return {
    id: al.id, acompanhamentoId: al.acompanhamento_id, checkinId: al.checkin_id, paciente: { id: al.paciente_id, nome: n.get(al.paciente_id) ?? '—' },
    regraId: al.regra_id, severidade: al.severidade, mensagem: al.mensagem, status: al.status, criadoEm: iso(al.criado_em),
    resolvidoEm: iso(al.resolvido_em), resolvidoPor: al.resolvido_por ? { usuarioId: al.resolvido_por, nome: refUsuario(resolvedor ?? undefined, al.resolvido_por).nome } : null,
    nota: al.nota ?? null, acoesPermitidas: acoes,
  };
}

async function serCheckin(tx: Tx, ctx: Ctx, c: any, detalhe: boolean, nomes?: Map<string, string>) {
  const n = nomes ?? await nomesPacientes(tx, ctx.org, [c.paciente_id]);
  const fotos: string[] = [];
  if (detalhe && c.respostas)
    for (const campo of c.formulario.campos) if (campo.tipo === 'FOTO' && Array.isArray(c.respostas[campo.id])) fotos.push(...c.respostas[campo.id]);
  const podeResponder = ctx.perfil === 'PACIENTE' && ctx.perms.has('acompanhamento.checkin.responder') && c.status === 'DISPONIVEL';
  const alertas = ehEquipeCtx(ctx) && ctx.perms.has('acompanhamento.alerta.ler')
    ? await Promise.all((await todos(tx, 'SELECT * FROM alertas WHERE organizacao_id = $1 AND checkin_id = $2 ORDER BY criado_em', [ctx.org.id, c.id])).map((x) => serAlerta(tx, ctx, x, n))) : [];
  return {
    ...resumoCheckin(c, n), respondidoEm: iso(c.respondido_em),
    ...(detalhe ? { formulario: c.formulario, anexos: await Promise.all(fotos.map((id) => arquivoResumo(tx, ctx.org, id))) } : {}),
    respostas: c.respostas ?? null,
    alertas,
    acoesPermitidas: podeResponder ? ['RESPONDER'] : [],
  };
}

async function validarEquipe(tx: Tx, ctx: Ctx, ids: string[]) {
  for (const [i, id] of ids.entries()) if (!await membroValido(tx, ctx.org, id)) throw invalido(`equipeIds.${i}`, 'Membro da equipe inválido.');
}

export const handlersAcompanhamento: Record<string, Handler> = {
  protocolosListar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.protocolo.ler');
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    let linhas = await todos(q.tx, 'SELECT DISTINCT ON (id) * FROM protocolos WHERE organizacao_id = $1 ORDER BY id, versao DESC', [q.org.id]);
    if (q.query.status) linhas = linhas.filter((p) => p.status === q.query.status);
    linhas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id));
    const p = pagina(linhas.slice(inicio, inicio + limite + 1), inicio, limite);
    return ok({ ...p, itens: p.itens.map((x) => serProtocolo(ctx, x)) });
  },
  protocolosCriar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.protocolo.gerenciar');
    await validarProtocolo(q.tx, q.org.id, q.body);
    const p = await inserirProtocolo(q.tx, q.org.id, novoId('prt'), 1, 'ATIVO', q.body);
    await audit(q, 'CRIAR', 'protocolo', p!.id);
    return criado(serProtocolo(ctx, p), { ETag: etag(p!.id, 1) });
  },
  protocolosObter: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.protocolo.ler', true);
    const p = await protocoloVersao(q.tx, q.org.id, q.params.protocoloId, q.query.versao);
    if (!p) throw naoEncontrado('Protocolo');
    const ultima = await protocoloVersao(q.tx, q.org.id, p.id);
    return ok(serProtocolo(ctx, p), { ETag: etag(p.id, ultima!.versao) });
  },
  protocolosPublicarVersao: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.protocolo.gerenciar');
    // Trava a última versão: duas publicações simultâneas com o mesmo If-Match não criam a mesma versão.
    const atual = await um(q.tx, 'SELECT * FROM protocolos WHERE organizacao_id = $1 AND id = $2 ORDER BY versao DESC LIMIT 1 FOR UPDATE', [q.org.id, q.params.protocoloId]);
    if (!atual) throw naoEncontrado('Protocolo');
    conferirIfMatch(q.headers['if-match'], atual.id, atual.versao, () => serProtocolo(ctx, atual));
    await validarProtocolo(q.tx, q.org.id, q.body);
    const p = await inserirProtocolo(q.tx, q.org.id, atual.id, atual.versao + 1, atual.status, q.body); // RN-ACO-003
    await audit(q, 'ALTERAR', 'protocolo', atual.id);
    return ok(serProtocolo(ctx, p), { ETag: etag(p!.id, p!.versao) });
  },
  protocolosArquivar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.protocolo.gerenciar');
    const r = await q.tx.query(`UPDATE protocolos SET status = 'ARQUIVADO' WHERE organizacao_id = $1 AND id = $2`, [q.org.id, q.params.protocoloId]);
    if (!r.rowCount) throw naoEncontrado('Protocolo');
    await audit(q, 'ARQUIVAR', 'protocolo', q.params.protocoloId);
    return ok(serProtocolo(ctx, await protocoloVersao(q.tx, q.org.id, q.params.protocoloId)));
  },

  acompanhamentosListar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.acompanhamento.ler');
    const f = filtroPaciente(ctx, 'a.paciente_id');
    const params: unknown[] = [q.org.id, ...f.params];
    let where = f.sql;
    const add = (cond: string, v: unknown) => { params.push(v); where += ` AND ${cond.replace('?', `$${params.length}`)}`; };
    if (q.query.status) add('a.status = ?', q.query.status);
    if (q.query.pacienteId) add('a.paciente_id = ?', q.query.pacienteId);
    if (q.query.profissionalId) add('? = ANY(a.equipe_ids)', q.query.profissionalId);
    if (q.query.comAlertaAberto !== undefined)
      where += ` AND ${q.query.comAlertaAberto ? '' : 'NOT '}EXISTS (SELECT 1 FROM alertas x WHERE x.organizacao_id = a.organizacao_id AND x.acompanhamento_id = a.id AND x.status = 'ABERTO')`;
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const linhas = await todos(q.tx, `SELECT a.* FROM acompanhamentos a WHERE a.organizacao_id = $1${where} ORDER BY a.data_inicio DESC, a.criado_em DESC, a.id OFFSET ${inicio} LIMIT ${limite + 1}`, params);
    const p = pagina(linhas, inicio, limite);
    return ok({ ...p, itens: await Promise.all(p.itens.map((a) => serAcompanhamento(q.tx, ctx, a))) });
  },
  acompanhamentosCriar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.acompanhamento.criar');
    const pac = await obterPaciente(q.tx, ctx, q.body.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const prot = await protocoloVersao(q.tx, q.org.id, q.body.protocoloId);
    if (!prot) throw invalido('protocoloId', 'Protocolo não encontrado.');
    if (prot.status !== 'ATIVO') throw invalido('protocoloId', 'Protocolo arquivado.');
    const equipeIds: string[] = q.body.equipeIds?.length ? q.body.equipeIds : [ctx.usuario.id];
    await validarEquipe(q.tx, ctx, equipeIds);
    const a = await criarAcompanhamento(q.tx, q.org, { pacienteId: pac.id, protocoloId: prot.id, dataInicio: q.body.dataInicio, equipeIds, criadoPor: ctx.usuario.id, observacao: q.body.observacao ?? null }, q.log);
    await audit(q, 'CRIAR', 'acompanhamento', a.id);
    const atual = await um(q.tx, 'SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND id = $2', [q.org.id, a.id]);
    return criado(await serAcompanhamento(q.tx, ctx, atual), { ETag: etag(a.id, atual.versao) });
  },
  acompanhamentosObter: async (q) => {
    const ctx = C(q);
    const a = await obterAcompanhamento(q.tx, ctx, q.params.acompanhamentoId);
    await audit(q, 'LER', 'acompanhamento', a.id);
    return ok(await serAcompanhamento(q.tx, ctx, a), { ETag: etag(a.id, a.versao) });
  },
  acompanhamentosEditar: async (q) => {
    const ctx = C(q);
    const a = await obterAcompanhamento(q.tx, ctx, q.params.acompanhamentoId, true);
    if (!ehEquipeCtx(ctx)) throw negado();
    exigir(ctx, 'acompanhamento.acompanhamento.criar');
    const estado = await serAcompanhamento(q.tx, ctx, a);
    conferirIfMatch(q.headers['if-match'], a.id, a.versao, () => estado);
    if (a.status === 'CONCLUIDO' || a.status === 'ENCERRADO') throw invalido('status', 'Acompanhamento finalizado não pode ser editado.');
    let equipeIds: string[] = a.equipe_ids;
    if (q.body.equipeIds) {
      await validarEquipe(q.tx, ctx, q.body.equipeIds);
      equipeIds = [...new Set(q.body.equipeIds as string[])];
      if (a.conversa_id) for (const id of equipeIds) await adicionarParticipante(q.tx, q.org, a.conversa_id, id);
    }
    const r = await um(q.tx, `UPDATE acompanhamentos SET equipe_ids = $3, observacao = $4, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *`,
      [q.org.id, a.id, equipeIds, q.body.observacao !== undefined ? q.body.observacao : a.observacao]);
    await emitir(q.tx, q.org.id, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, [...await equipeAtiva(q.tx, q.org, equipeIds), ...await contasDoPaciente(q.tx, q.org, a.paciente_id)]);
    await audit(q, 'ALTERAR', 'acompanhamento', a.id);
    return ok(await serAcompanhamento(q.tx, ctx, r), { ETag: etag(r.id, r.versao) });
  },
  acompanhamentosEncerrar: async (q) => {
    const ctx = C(q);
    const a = await obterAcompanhamento(q.tx, ctx, q.params.acompanhamentoId, true);
    exigir(ctx, 'acompanhamento.acompanhamento.encerrar');
    if (a.status !== 'ATIVO' && a.status !== 'AGENDADO') throw invalido('status', 'Este acompanhamento já foi finalizado.');
    const r = await encerrarAcompanhamento(q.tx, q.org, a, q.body.motivo, ctx.usuario.id, q.log);
    await audit(q, 'ENCERRAR', 'acompanhamento', a.id);
    return ok(await serAcompanhamento(q.tx, ctx, r), { ETag: etag(r.id, r.versao) });
  },

  checkinsListar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.checkin.ler');
    const f = filtroPaciente(ctx, 'c.paciente_id');
    const params: unknown[] = [q.org.id, ...f.params];
    let where = f.sql;
    const add = (cond: string, v: unknown) => { params.push(v); where += ` AND ${cond.replace('?', `$${params.length}`)}`; };
    if (q.query.acompanhamentoId) add('c.acompanhamento_id = ?', q.query.acompanhamentoId);
    if (q.query.status) add('c.status = ?', q.query.status);
    if (q.query.data) { params.push(q.org.fuso); add(`(c.disponivel_em AT TIME ZONE $${params.length})::date = ?`, q.query.data); }
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const linhas = await todos(q.tx, `SELECT c.* FROM checkins c WHERE c.organizacao_id = $1${where} ORDER BY c.disponivel_em, c.id OFFSET ${inicio} LIMIT ${limite + 1}`, params);
    const p = pagina(linhas, inicio, limite);
    const nomes = await nomesPacientes(q.tx, q.org, p.itens.map((c) => c.paciente_id));
    return ok({ ...p, itens: await Promise.all(p.itens.map((c) => serCheckin(q.tx, ctx, c, false, nomes))) });
  },
  checkinsObter: async (q) => {
    const ctx = C(q);
    const c = await obterCheckin(q.tx, ctx, q.params.checkinId);
    await audit(q, 'LER', 'checkin', c.id);
    return ok(await serCheckin(q.tx, ctx, c, true));
  },
  checkinsResponder: async (q) => {
    const ctx = C(q);
    const c = await obterCheckin(q.tx, ctx, q.params.checkinId);
    if (ctx.perfil !== 'PACIENTE') throw negado('Só o paciente ou o responsável responde o check-in.');
    exigir(ctx, 'acompanhamento.checkin.responder');
    const r = await responderCheckin(q.tx, q.org, c.id, q.body.respostas, ctx.usuario.id, q.log);
    await audit(q, 'RESPONDER', 'checkin', c.id);
    return criado(await serCheckin(q.tx, ctx, r, true));
  },

  alertasListar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    exigir(ctx, 'acompanhamento.alerta.ler');
    const params: unknown[] = [q.org.id];
    let where = '';
    const add = (cond: string, v: unknown) => { params.push(v); where += ` AND ${cond.replace('?', `$${params.length}`)}`; };
    if (q.query.status) add('status = ?', q.query.status);
    if (q.query.acompanhamentoId) add('acompanhamento_id = ?', q.query.acompanhamentoId);
    if (q.query.severidade) add('severidade = ?', q.query.severidade);
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const linhas = await todos(q.tx, `SELECT * FROM alertas WHERE organizacao_id = $1${where}
      ORDER BY (status = 'ABERTO') DESC, CASE severidade WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, criado_em DESC, id OFFSET ${inicio} LIMIT ${limite + 1}`, params);
    const p = pagina(linhas, inicio, limite);
    const nomes = await nomesPacientes(q.tx, q.org, p.itens.map((x) => x.paciente_id));
    return ok({ ...p, itens: await Promise.all(p.itens.map((x) => serAlerta(q.tx, ctx, x, nomes))) });
  },
  alertasResolver: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'acompanhamento');
    if (!ctx.perms.has('acompanhamento.alerta.ler')) throw naoEncontrado('Alerta');
    const al = await um(q.tx, 'SELECT * FROM alertas WHERE organizacao_id = $1 AND id = $2', [q.org.id, q.params.alertaId]);
    if (!al) throw naoEncontrado('Alerta');
    exigir(ctx, 'acompanhamento.alerta.resolver');
    await resolverAlerta(q.tx, q.org, al.id, ctx.usuario.id, q.body?.nota ?? null);
    await audit(q, 'RESOLVER', 'alerta', al.id);
    return ok(await serAlerta(q.tx, ctx, await um(q.tx, 'SELECT * FROM alertas WHERE organizacao_id = $1 AND id = $2', [q.org.id, al.id])));
  },
};

/** Seções da tela inicial ligadas ao acompanhamento (equipe: alertas, check-ins do dia, ativos; paciente: o atual e os pendentes). */
export async function secoesInicioAcompanhamento(tx: Tx, ctx: Ctx) {
  const org = ctx.org;
  const secoes: any[] = [];
  if (!temModulo(org.modulos, 'acompanhamento')) return secoes;
  const hoje = partesLocais(Date.now(), org.fuso).data;
  if (ehEquipeCtx(ctx)) {
    if (ctx.perms.has('acompanhamento.alerta.ler')) {
      const total = (await um<{ n: number }>(tx, `SELECT count(*)::int AS n FROM alertas WHERE organizacao_id = $1 AND status = 'ABERTO'`, [org.id]))!.n;
      const itens = await todos(tx, `SELECT * FROM alertas WHERE organizacao_id = $1 AND status = 'ABERTO'
        ORDER BY CASE severidade WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, criado_em DESC LIMIT 5`, [org.id]);
      const nomes = await nomesPacientes(tx, org, itens.map((x) => x.paciente_id));
      secoes.push({ id: 'alertas', tipo: 'ALERTAS_ABERTOS', dados: { total, itens: await Promise.all(itens.map((x) => serAlerta(tx, ctx, x, nomes))) } });
    }
    if (ctx.perms.has('acompanhamento.checkin.ler')) {
      const doDia = await todos(tx, `SELECT * FROM checkins WHERE organizacao_id = $1 AND status <> 'CANCELADO' AND (disponivel_em AT TIME ZONE $2)::date = $3 ORDER BY disponivel_em, id`, [org.id, org.fuso, hoje]);
      const nomes = await nomesPacientes(tx, org, doDia.map((c) => c.paciente_id));
      secoes.push({ id: 'checkins-hoje', tipo: 'CHECKINS_DO_DIA', dados: {
        data: hoje, respondidos: doDia.filter((c) => c.status === 'RESPONDIDO').length,
        pendentes: doDia.filter((c) => c.status === 'DISPONIVEL' || c.status === 'AGENDADO').length,
        expirados: doDia.filter((c) => c.status === 'EXPIRADO').length,
        itens: doDia.map((c) => resumoCheckin(c, nomes)),
      } });
    }
    if (ctx.perms.has('acompanhamento.acompanhamento.ler')) {
      const total = (await um<{ n: number }>(tx, `SELECT count(*)::int AS n FROM acompanhamentos WHERE organizacao_id = $1 AND status = 'ATIVO'`, [org.id]))!.n;
      const ativos = await todos(tx, `SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND status = 'ATIVO' ORDER BY data_inicio DESC, criado_em DESC LIMIT 5`, [org.id]);
      secoes.push({ id: 'acompanhamentos-ativos', tipo: 'ACOMPANHAMENTOS_ATIVOS', dados: { total, itens: await Promise.all(ativos.map((a) => serAcompanhamento(tx, ctx, a))) } });
    }
    return secoes;
  }
  const meus = (await todos(tx, 'SELECT paciente_id FROM vinculos WHERE organizacao_id = $1 AND usuario_id = $2', [org.id, ctx.usuario.id])).map((v) => v.paciente_id);
  const nomes = await nomesPacientes(tx, org, meus);
  const acps = await todos(tx, `SELECT * FROM acompanhamentos WHERE organizacao_id = $1 AND paciente_id = ANY($2) AND status IN ('ATIVO','AGENDADO') ORDER BY data_inicio, id`, [org.id, meus]);
  for (const a of acps) {
    const dia = diferencaDias(a.data_inicio, hoje);
    const cks = await todos(tx, 'SELECT * FROM checkins WHERE organizacao_id = $1 AND acompanhamento_id = $2 ORDER BY dia, disponivel_em', [org.id, a.id]);
    const prox = cks.find((c) => c.status === 'DISPONIVEL') ?? cks.find((c) => c.status === 'AGENDADO') ?? null;
    const orientacao = (a.protocolo.orientacoes ?? []).filter((o: any) => o.dia === dia).map((o: any) => o.texto).join(' ') || null;
    secoes.push({ id: `acompanhamento-atual-${a.id}`, tipo: 'ACOMPANHAMENTO_ATUAL', ...(meus.length > 1 ? { titulo: nomes.get(a.paciente_id) } : {}), dados: {
      acompanhamentoId: a.id, pacienteId: a.paciente_id, titulo: a.protocolo.nome, diaAtual: dia, totalDias: a.protocolo.duracaoDias,
      status: a.status, proximoCheckin: prox ? resumoCheckin(prox, nomes) : null, orientacaoDoDia: orientacao,
    } });
  }
  const pendentes = await todos(tx, `SELECT * FROM checkins WHERE organizacao_id = $1 AND paciente_id = ANY($2) AND status = 'DISPONIVEL' ORDER BY disponivel_em, id`, [org.id, meus]);
  secoes.push({ id: 'checkins-pendentes', tipo: 'CHECKINS_PENDENTES', dados: { itens: pendentes.map((c) => resumoCheckin(c, nomes)) } });
  return secoes;
}
