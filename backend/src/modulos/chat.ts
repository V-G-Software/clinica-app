// Chat (9.7, RN-CHA). Só participante ativo vê a conversa (404 para os demais); histórico nunca é
// apagado (arquivar e remover participante só cortam o acesso dali em diante).
import { configModulo, normalizar } from '@clinica/dominio';
import { todos, um, type Tx } from '../db.ts';
import { ErroApi, invalido, naoEncontrado } from '../erros.ts';
import { emitir } from '../eventos.ts';
import { C, criado, ok, vazio, type Handler, type Req } from '../http.ts';
import { auditar, ehEquipeCtx, exigir, exigirModulo, iso, lerCursor, pagina, type Ctx } from '../nucleo.ts';
import { adicionarParticipante, criarConversa, dentroDoHorario, naoLidas, participantesAtivos, postarMensagem, proximaAbertura, resumoMensagem } from '../servicos/chat.ts';
import { avisarContadores } from '../servicos/notificar.ts';
import { arquivoResumo, contasDoPaciente, ehEquipeU, membroValido, nomesPacientes, refUsuario, usuariosPorId } from '../servicos/refs.ts';
import { obterPaciente } from './pacientes.ts';

const audit = (q: Req, acao: string, recurso: string, id: string) => auditar(q.tx, q.org.id, { usuarioId: q.ctx?.usuario.id ?? null, acao, recurso, recursoId: id, ip: q.ip, requestId: q.requestId });

/** Conversas em que o usuário é participante ativo (base de toda leitura). */
const SQL_VISIVEIS = `SELECT c.* FROM conversas c JOIN participantes p ON p.organizacao_id = c.organizacao_id AND p.conversa_id = c.id
                       AND p.usuario_id = $2 AND p.removido_em IS NULL WHERE c.organizacao_id = $1`;
async function obterConversa(tx: Tx, ctx: Ctx, id: string, travar = false) {
  exigirModulo(ctx.org, 'chat');
  const c = await um(tx, `${SQL_VISIVEIS} AND c.id = $3${travar ? ' FOR UPDATE OF c' : ''}`, [ctx.org.id, ctx.usuario.id, id]);
  if (!c || !ctx.perms.has('chat.conversa.ler')) throw naoEncontrado('Conversa');
  return c;
}

export async function serConversa(tx: Tx, ctx: Ctx, c: any) {
  const org = ctx.org;
  const equipe = ehEquipeCtx(ctx);
  const parts = await todos(tx, 'SELECT * FROM participantes WHERE organizacao_id = $1 AND conversa_id = $2 AND removido_em IS NULL ORDER BY entrou_em, usuario_id', [org.id, c.id]);
  const ultima = await um(tx, 'SELECT * FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 ORDER BY ordem DESC LIMIT 1', [org.id, c.id]);
  const usuarios = await usuariosPorId(tx, org, [...parts.map((p) => p.usuario_id), ...(ultima?.autor_id ? [ultima.autor_id] : [])]);
  const nomes = await nomesPacientes(tx, org, [c.paciente_id]);
  const souParticipante = parts.some((p) => p.usuario_id === ctx.usuario.id);
  const acoes: string[] = [];
  if (c.status === 'ATIVA' && souParticipante && ctx.perms.has('chat.mensagem.enviar')) acoes.push('ENVIAR');
  if (equipe && ctx.perms.has('chat.conversa.gerenciar')) acoes.push(...(c.status === 'ATIVA' ? ['ADICIONAR_PARTICIPANTE', 'REMOVER_PARTICIPANTE', 'ARQUIVAR'] : ['REABRIR']));
  const acp = await um(tx, `SELECT id FROM acompanhamentos WHERE organizacao_id = $1 AND conversa_id = $2 AND status IN ('ATIVO','AGENDADO') ORDER BY criado_em DESC LIMIT 1`, [org.id, c.id]);
  const nomePaciente = nomes.get(c.paciente_id) ?? '—';
  return {
    id: c.id,
    titulo: equipe ? nomePaciente : org.nome, // RN-CHA-003: calculado para quem vê
    paciente: { id: c.paciente_id, nome: nomePaciente },
    acompanhamentoAtivoId: acp?.id ?? null,
    status: c.status,
    participantes: parts.map((p) => ({ ...refUsuario(usuarios.get(p.usuario_id), p.usuario_id, p.perfil), lidoAte: p.lido_ate ?? null })),
    ultimaMensagem: ultima ? { id: ultima.id, resumo: resumoMensagem(ultima), autorNome: ultima.autor_id ? refUsuario(usuarios.get(ultima.autor_id), ultima.autor_id).nome : null, enviadoEm: iso(ultima.enviado_em) } : null,
    naoLidas: await naoLidas(tx, org, c.id, ctx.usuario.id),
    criadoEm: iso(c.criado_em),
    acoesPermitidas: acoes,
  };
}
async function serMensagens(tx: Tx, ctx: Ctx, msgs: any[]) {
  const usuarios = await usuariosPorId(tx, ctx.org, msgs.map((m) => m.autor_id).filter(Boolean));
  return Promise.all(msgs.map(async (m) => ({
    id: m.id, idCliente: m.id_cliente ?? null, conversaId: m.conversa_id, tipo: m.tipo,
    autor: m.autor_id ? refUsuario(usuarios.get(m.autor_id), m.autor_id, m.autor_perfil) : null,
    texto: m.texto ?? null, anexos: await Promise.all(m.anexos_ids.map((id: string) => arquivoResumo(tx, ctx.org, id))),
    referencia: m.referencia ?? null, enviadoEm: iso(m.enviado_em),
  })));
}
/** Ordem da lista: última atividade primeiro. */
const ORDEM = `ORDER BY COALESCE((SELECT max(m.enviado_em) FROM mensagens m WHERE m.organizacao_id = c.organizacao_id AND m.conversa_id = c.id), c.criado_em) DESC, c.id`;

async function listar(q: Req, filtro: string, params: unknown[], limite: number, cursor: string | undefined, naoLidasFiltro?: boolean) {
  const ctx = C(q);
  exigirModulo(q.org, 'chat');
  exigir(ctx, 'chat.conversa.ler');
  const inicio = lerCursor(cursor);
  const linhas = await todos(q.tx, `${SQL_VISIVEIS}${filtro} ${ORDEM}`, [q.org.id, ctx.usuario.id, ...params]);
  let ser = await Promise.all(linhas.map((c) => serConversa(q.tx, ctx, c)));
  if (naoLidasFiltro !== undefined) ser = ser.filter((c) => (c.naoLidas > 0) === naoLidasFiltro);
  return pagina(ser.slice(inicio, inicio + limite + 1), inicio, limite);
}

export const handlersChat: Record<string, Handler> = {
  conversasListar: async (q) => {
    const params: unknown[] = [];
    let f = '';
    if (q.query.status) { params.push(q.query.status); f += ` AND c.status = $${params.length + 2}`; }
    if (q.query.pacienteId) { params.push(q.query.pacienteId); f += ` AND c.paciente_id = $${params.length + 2}`; }
    return ok(await listar(q, f, params, q.query.limite ?? 20, q.query.cursor, q.query.naoLidas));
  },
  conversasBuscar: async (q) => {
    // Busca no corpo (o nome do paciente não vai para URL nem log); compara sem acento.
    const texto = normalizar(q.body.texto);
    // Para o paciente o título é o nome da organização: se ele casa, todas as conversas dele casam.
    const pelaOrg = C(q).perfil === 'PACIENTE' && normalizar(q.org.nome).includes(texto);
    const f = pelaOrg ? ' AND $3::text IS NOT NULL'
      : ' AND EXISTS (SELECT 1 FROM pacientes x WHERE x.organizacao_id = c.organizacao_id AND x.id = c.paciente_id AND x.nome_busca LIKE $3)';
    await audit(q, 'BUSCAR', 'conversa', '-');
    return ok(await listar(q, f, [`%${texto.replace(/[%_\\]/g, '\\$&')}%`], q.body.limite ?? 20, q.body.cursor));
  },
  conversasCriar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'chat');
    const pac = await obterPaciente(q.tx, ctx, q.body.pacienteId);
    const existente = await um(q.tx, `SELECT * FROM conversas WHERE organizacao_id = $1 AND paciente_id = $2 AND status = 'ATIVA' FOR UPDATE`, [q.org.id, pac.id]);
    if (existente) {
      const ativos = await participantesAtivos(q.tx, q.org, existente.id);
      if (!ativos.includes(ctx.usuario.id)) {
        if (!ehEquipeCtx(ctx) || !ctx.perms.has('chat.conversa.gerenciar')) throw naoEncontrado('Conversa');
        await adicionarParticipante(q.tx, q.org, existente.id, ctx.usuario.id); // "clica no paciente e cai na conversa dele"
        await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: existente.id }, await participantesAtivos(q.tx, q.org, existente.id));
      }
      return ok(await serConversa(q.tx, ctx, existente));
    }
    exigir(ctx, 'chat.conversa.criar');
    const extras: string[] = q.body.participantesIds ?? [];
    for (const [i, id] of extras.entries()) if (!await membroValido(q.tx, q.org, id)) throw invalido(`participantesIds.${i}`, 'Membro da equipe inválido.');
    // Paciente que inicia (pacientePodeIniciar) fala com profissionais e secretaria ativos.
    const equipePadrao = ehEquipeCtx(ctx) ? [] : (await todos(q.tx, `SELECT id FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO' AND perfis && ARRAY['PROFISSIONAL','SECRETARIA']`, [q.org.id])).map((u) => u.id);
    const { conversa, criada } = await criarConversa(q.tx, q.org, pac.id, [ctx.usuario.id, ...extras, ...equipePadrao, ...await contasDoPaciente(q.tx, q.org, pac.id)]);
    await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: conversa.id }, await participantesAtivos(q.tx, q.org, conversa.id));
    await audit(q, 'CRIAR', 'conversa', conversa.id);
    const corpo = await serConversa(q.tx, ctx, conversa);
    return criada ? criado(corpo) : ok(corpo);
  },
  conversasObter: async (q) => {
    const c = await obterConversa(q.tx, C(q), q.params.conversaId);
    await audit(q, 'LER', 'conversa', c.id);
    return ok(await serConversa(q.tx, C(q), c));
  },
  mensagensListar: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId);
    const limite = q.query.limite ?? 20;
    const ordemDe = async (id: string, campo: string) => {
      const m = await um(q.tx, 'SELECT ordem FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 AND id = $3', [q.org.id, c.id, id]);
      if (!m) throw invalido(campo, 'Mensagem não encontrada nesta conversa.');
      return m.ordem;
    };
    let linhas: any[];
    if (q.query.depoisDe) {
      const o = await ordemDe(q.query.depoisDe, 'depoisDe');
      linhas = await todos(q.tx, `SELECT * FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 AND ordem > $3 ORDER BY ordem LIMIT ${limite + 1}`, [q.org.id, c.id, o]);
    } else {
      const o = q.query.antesDe ? await ordemDe(q.query.antesDe, 'antesDe') : Number.MAX_SAFE_INTEGER;
      linhas = (await todos(q.tx, `SELECT * FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 AND ordem < $3 ORDER BY ordem DESC LIMIT ${limite + 1}`, [q.org.id, c.id, o])).reverse();
    }
    const temMais = linhas.length > limite;
    const fatia = q.query.depoisDe ? linhas.slice(0, limite) : linhas.slice(linhas.length - Math.min(limite, linhas.length));
    await audit(q, 'LER', 'conversa', c.id);
    return ok({ itens: await serMensagens(q.tx, ctx, fatia), temMais });
  },
  mensagensEnviar: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId, true);
    exigir(ctx, 'chat.mensagem.enviar');
    // RN-CHA-007: o mesmo idCliente do mesmo autor devolve a mensagem já gravada (reenvio após queda de rede).
    const repetida = await um(q.tx, 'SELECT * FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 AND autor_id = $3 AND id_cliente = $4', [q.org.id, c.id, ctx.usuario.id, q.body.idCliente]);
    if (repetida) return criado((await serMensagens(q.tx, ctx, [repetida]))[0]);
    if (c.status !== 'ATIVA') throw new ErroApi('CONVERSA_ARQUIVADA', 'Esta conversa foi arquivada.');
    const anexos: string[] = q.body.anexosIds ?? [];
    if (q.body.tipo === 'TEXTO' && (!q.body.texto?.trim() || anexos.length)) throw invalido('texto', 'Escreva a mensagem.', 'OBRIGATORIO');
    if (q.body.tipo === 'ANEXO') {
      if (!configModulo(q.org.modulos, 'chat').anexosPermitidos) throw invalido('anexosIds', 'Esta organização não aceita anexos no chat.');
      if (!anexos.length) throw invalido('anexosIds', 'Envie ao menos uma foto.', 'OBRIGATORIO');
      const livres = new Set((await todos(q.tx, `SELECT id FROM arquivos WHERE organizacao_id = $1 AND id = ANY($2) AND dono_id = $3 AND status = 'DISPONIVEL' AND usado_em IS NULL FOR UPDATE`, [q.org.id, anexos, ctx.usuario.id])).map((a) => a.id));
      anexos.forEach((id, i) => { if (!livres.has(id)) throw invalido(`anexosIds.${i}`, 'Foto ainda não está disponível.'); });
    }
    const m = await postarMensagem(q.tx, q.org, c, { tipo: q.body.tipo, autorId: ctx.usuario.id, texto: q.body.texto ?? null, anexosIds: anexos, idCliente: q.body.idCliente }, q.log);
    // RN-CHA-006: aviso fora do horário, no máximo uma vez por período de atendimento.
    const cfg = configModulo(q.org.modulos, 'chat');
    if (ctx.perfil === 'PACIENTE' && cfg.mensagemForaDoHorario && !dentroDoHorario(q.org)) {
      const ultimo = c.ultimo_aviso_fora_horario_em ? new Date(c.ultimo_aviso_fora_horario_em).getTime() : null;
      if (ultimo === null || (proximaAbertura(q.org, ultimo) ?? Infinity) <= Date.now()) {
        await q.tx.query('UPDATE conversas SET ultimo_aviso_fora_horario_em = now() WHERE organizacao_id = $1 AND id = $2', [q.org.id, c.id]);
        await postarMensagem(q.tx, q.org, c, { tipo: 'SISTEMA', autorId: null, texto: cfg.mensagemForaDoHorario }, q.log);
      }
    }
    await audit(q, 'ENVIAR', 'conversa', c.id);
    return criado((await serMensagens(q.tx, ctx, [m]))[0]);
  },
  conversasMarcarLida: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId);
    const alvo = await um(q.tx, 'SELECT id, ordem FROM mensagens WHERE organizacao_id = $1 AND conversa_id = $2 AND id = $3', [q.org.id, c.id, q.body.ateMensagemId]);
    if (!alvo) throw invalido('ateMensagemId', 'Mensagem não encontrada nesta conversa.');
    // Só avança: marcar uma mensagem antiga não "desmarca" as mais novas.
    const r = await q.tx.query(`UPDATE participantes p SET lido_ate = $4 WHERE p.organizacao_id = $1 AND p.conversa_id = $2 AND p.usuario_id = $3
      AND COALESCE((SELECT l.ordem FROM mensagens l WHERE l.organizacao_id = p.organizacao_id AND l.id = p.lido_ate), 0) < $5`, [q.org.id, c.id, ctx.usuario.id, alvo.id, alvo.ordem]);
    if (r.rowCount) {
      await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: c.id }, await participantesAtivos(q.tx, q.org, c.id));
      await avisarContadores(q.tx, q.org, [ctx.usuario.id]);
    }
    return vazio();
  },
  conversasAdicionarParticipante: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId, true);
    exigir(ctx, 'chat.conversa.gerenciar');
    if (c.status !== 'ATIVA') throw new ErroApi('CONVERSA_ARQUIVADA', 'Esta conversa foi arquivada.');
    if (!await membroValido(q.tx, q.org, q.body.usuarioId)) throw invalido('usuarioId', 'Membro da equipe inválido.');
    if (await adicionarParticipante(q.tx, q.org, c.id, q.body.usuarioId)) {
      const u = (await usuariosPorId(q.tx, q.org, [q.body.usuarioId])).get(q.body.usuarioId)!;
      await postarMensagem(q.tx, q.org, c, { tipo: 'SISTEMA', autorId: null, texto: `${u.nome_exibicao} entrou na conversa.` }, q.log);
      await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: c.id }, await participantesAtivos(q.tx, q.org, c.id));
      await audit(q, 'ADICIONAR_PARTICIPANTE', 'conversa', c.id);
    }
    return ok(await serConversa(q.tx, ctx, c));
  },
  conversasRemoverParticipante: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId, true);
    exigir(ctx, 'chat.conversa.gerenciar');
    const p = await um(q.tx, 'SELECT * FROM participantes WHERE organizacao_id = $1 AND conversa_id = $2 AND usuario_id = $3 AND removido_em IS NULL', [q.org.id, c.id, q.params.usuarioId]);
    if (!p) throw naoEncontrado('Participante');
    const u = (await usuariosPorId(q.tx, q.org, [p.usuario_id])).get(p.usuario_id);
    if (!u || !ehEquipeU(u)) throw invalido('usuarioId', 'O paciente não pode ser removido da própria conversa.');
    // RN-CHA-004: corta o acesso dali em diante; o histórico fica.
    await q.tx.query('UPDATE participantes SET removido_em = now() WHERE organizacao_id = $1 AND conversa_id = $2 AND usuario_id = $3', [q.org.id, c.id, p.usuario_id]);
    await postarMensagem(q.tx, q.org, c, { tipo: 'SISTEMA', autorId: null, texto: `${u.nome_exibicao} saiu da conversa.` }, q.log);
    await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: c.id }, [...await participantesAtivos(q.tx, q.org, c.id), p.usuario_id]);
    await audit(q, 'REMOVER_PARTICIPANTE', 'conversa', c.id);
    return vazio();
  },
  conversasArquivar: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId, true);
    exigir(ctx, 'chat.conversa.gerenciar');
    if (c.status === 'ATIVA') {
      await q.tx.query(`UPDATE conversas SET status = 'ARQUIVADA' WHERE organizacao_id = $1 AND id = $2`, [q.org.id, c.id]); // RN-CHA-005: nunca apaga
      c.status = 'ARQUIVADA';
      const ativos = await participantesAtivos(q.tx, q.org, c.id);
      await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: c.id }, ativos);
      await avisarContadores(q.tx, q.org, ativos);
      await audit(q, 'ARQUIVAR', 'conversa', c.id);
    }
    return ok(await serConversa(q.tx, ctx, c));
  },
  conversasReabrir: async (q) => {
    const ctx = C(q);
    const c = await obterConversa(q.tx, ctx, q.params.conversaId, true);
    exigir(ctx, 'chat.conversa.gerenciar');
    if (c.status === 'ARQUIVADA') {
      const outra = await um(q.tx, `SELECT 1 FROM conversas WHERE organizacao_id = $1 AND paciente_id = $2 AND status = 'ATIVA'`, [q.org.id, c.paciente_id]);
      if (outra) throw invalido('status', 'O paciente já tem outra conversa ativa.');
      await q.tx.query(`UPDATE conversas SET status = 'ATIVA' WHERE organizacao_id = $1 AND id = $2`, [q.org.id, c.id]);
      c.status = 'ATIVA';
      const ativos = await participantesAtivos(q.tx, q.org, c.id);
      await emitir(q.tx, q.org.id, 'chat.conversa.atualizada', { conversaId: c.id }, ativos);
      await avisarContadores(q.tx, q.org, ativos);
      await audit(q, 'REABRIR', 'conversa', c.id);
    }
    return ok(await serConversa(q.tx, ctx, c));
  },
};

/** Seção "conversas recentes" da tela inicial: as 5 ativas com atividade mais recente. */
export async function secoesInicioChat(tx: Tx, ctx: Ctx) {
  if (!ctx.org.modulos.some((m) => m.id === 'chat') || !ctx.perms.has('chat.conversa.ler')) return [];
  const linhas = await todos(tx, `${SQL_VISIVEIS} AND c.status = 'ATIVA' ${ORDEM} LIMIT 5`, [ctx.org.id, ctx.usuario.id]);
  return [{ id: 'conversas-recentes', tipo: 'CONVERSAS_RECENTES', dados: { itens: await Promise.all(linhas.map((c) => serConversa(tx, ctx, c))) } }];
}
