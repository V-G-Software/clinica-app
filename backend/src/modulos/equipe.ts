// Equipe e organização (9.5).
import { novoId, sha256, tokenAleatorio } from '../cripto.ts';
import { config } from '../config.ts';
import { todos, um } from '../db.ts';
import { emitir, fecharOuvintesDoUsuario } from '../eventos.ts';
import { ErroApi, invalido, naoEncontrado } from '../erros.ts';
import { C, criado, ok, type Handler } from '../http.ts';
import { auditar, conferirIfMatch, esquecerOrg, etag, exigir, exigirModulo, iso, lerCursor, pagina, type Ctx, type Usuario } from '../nucleo.ts';
import { serMembro } from '../serializar.ts';
import { enviarEmail } from '../servicos/email.ts';
import { revogarSessoesDoUsuario } from './auth.ts';
import type { Tx } from '../db.ts';

const URL_FRONTEND = (process.env.URL_FRONTEND ?? 'http://localhost:5173').replace(/\/$/, '');
async function obterMembro(tx: Tx, ctx: Ctx, id: string): Promise<Usuario> {
  exigirModulo(ctx.org, 'equipe');
  exigir(ctx, 'equipe.membro.ler');
  const u = await um<Usuario>(tx, `SELECT * FROM usuarios WHERE organizacao_id = $1 AND id = $2 AND perfis && '{GESTOR,PROFISSIONAL,SECRETARIA}'`, [ctx.org.id, id]);
  if (!u) throw naoEncontrado('Membro');
  return u;
}
function orgConfig(ctx: Ctx) {
  const c = ctx.org.configuracao;
  const chat = ctx.org.modulos.find((m) => m.id === 'chat')?.config ?? {};
  const acomp = ctx.org.modulos.find((m) => m.id === 'acompanhamento');
  return {
    nome: ctx.org.nome, contato: c.contato, tema: { corMarca: c.tema.corMarca, logoUrl: c.tema.logoUrl ?? null }, textos: c.textos,
    chat: { horarioAtendimento: chat.horarioAtendimento ?? [], mensagemForaDoHorario: chat.mensagemForaDoHorario ?? null, avisoUrgencia: chat.avisoUrgencia ?? null },
    ...(acomp ? { acompanhamento: { resolverAlertasAoEncerrar: !!acomp.config?.resolverAlertasAoEncerrar } } : {}),
    acoesPermitidas: ctx.perms.has('organizacao.configuracao.editar') ? ['EDITAR'] : [],
  };
}

export const handlersEquipe: Record<string, Handler> = {
  equipeListarMembros: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'equipe');
    exigir(ctx, 'equipe.membro.ler');
    const limite = q.query.limite ?? 20;
    const inicio = lerCursor(q.query.cursor);
    const linhas = await todos<Usuario>(q.tx, `SELECT * FROM usuarios WHERE organizacao_id = $1 AND perfis && '{GESTOR,PROFISSIONAL,SECRETARIA}' ${q.query.status ? 'AND status = $2' : ''}
      ORDER BY nome_exibicao, id OFFSET ${inicio} LIMIT ${limite + 1}`, q.query.status ? [q.org.id, q.query.status] : [q.org.id]);
    const p = pagina(linhas, inicio, limite);
    return ok({ ...p, itens: p.itens.map((u) => serMembro(ctx, u)) });
  },
  equipeObterMembro: async (q) => { const u = await obterMembro(q.tx, C(q), q.params.membroId); return ok(serMembro(C(q), u), { ETag: etag(u.id, u.versao) }); },
  equipeEditarMembro: async (q) => {
    const ctx = C(q);
    const u = await obterMembro(q.tx, ctx, q.params.membroId);
    exigir(ctx, 'equipe.membro.gerenciar');
    conferirIfMatch(q.headers['if-match'], u.id, u.versao, () => serMembro(ctx, u));
    const perfis: string[] = q.body.perfis ?? u.perfis;
    const status: string = q.body.status ?? u.status;
    if (status === 'CONVIDADO' && u.status !== 'CONVIDADO') throw invalido('status', 'Status inválido.');
    // RN-EQP-001: trava as linhas dos gestores para dois gestores não se removerem ao mesmo tempo.
    const gestores = await todos(q.tx, `SELECT id FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO' AND 'GESTOR' = ANY(perfis) FOR UPDATE`, [q.org.id]);
    const deixaDeSerGestor = u.perfis.includes('GESTOR') && u.status === 'ATIVO' && (!perfis.includes('GESTOR') || status !== 'ATIVO');
    if (deixaDeSerGestor && gestores.length <= 1) throw new ErroApi('ULTIMO_GESTOR', 'Defina outro gestor antes.');
    const r = await um<Usuario>(q.tx, 'UPDATE usuarios SET perfis = $3, status = $4, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING *', [q.org.id, u.id, perfis, status]);
    let depois: (() => void) | undefined;
    if (status !== u.status && (status === 'SUSPENSO' || status === 'DESLIGADO')) {
      await revogarSessoesDoUsuario(q.tx, q.org, u.id, `MEMBRO_${status}`); // RN-EQP-002: na hora
      depois = () => fecharOuvintesDoUsuario(q.org.id, u.id);
    }
    await emitir(q.tx, q.org.id, 'sessao.manifesto.alterado', {}, [u.id]);
    await auditar(q.tx, q.org.id, { usuarioId: ctx.usuario.id, acao: 'ALTERAR', recurso: 'membro', recursoId: u.id, ip: q.ip, requestId: q.requestId });
    return { ...ok(serMembro(ctx, r!), { ETag: etag(r!.id, r!.versao) }), depoisDoCommit: depois };
  },
  equipeConvidar: async (q) => {
    const ctx = C(q);
    exigirModulo(q.org, 'equipe');
    exigir(ctx, 'equipe.membro.gerenciar');
    if (await um(q.tx, 'SELECT 1 FROM usuarios WHERE organizacao_id = $1 AND email = $2', [q.org.id, q.body.email])) throw invalido('email', 'Já existe uma conta com este e-mail.');
    const uid = novoId('usr');
    await q.tx.query(`INSERT INTO usuarios (organizacao_id, id, email, nome, nome_exibicao, perfis, status) VALUES ($1,$2,$3,$4,$4,$5,'CONVIDADO')`, [q.org.id, uid, q.body.email, q.body.nome, q.body.perfis]);
    const token = tokenAleatorio(18);
    const id = novoId('cnt');
    const c = await um(q.tx, `INSERT INTO convites (organizacao_id, id, token_hash, tipo, usuario_id, email, nome, criado_por, expira_em)
      VALUES ($1,$2,$3,'EQUIPE',$4,$5,$6,$7, now() + interval '72 hours') RETURNING expira_em`, [q.org.id, id, sha256(token), uid, q.body.email, q.body.nome, ctx.usuario.id]);
    const link = `${URL_FRONTEND}/convite/${token}?org=${q.org.slug}`;
    enviarEmail({ org: q.org.slug, para: q.body.email, assunto: `Convite para a equipe — ${q.org.nome}`, texto: `Você foi convidado para a equipe. Acesse: ${link}` }, q.log);
    return criado({ id, token, link, conteudoQr: link, expiraEm: iso(c!.expira_em), emailEnviado: true });
  },
  organizacaoObter: async (q) => {
    exigir(C(q), 'organizacao.configuracao.editar', true);
    return ok(orgConfig(C(q)), { ETag: etag(q.org.id, q.org.versao) });
  },
  organizacaoEditar: async (q) => {
    const ctx = C(q);
    exigir(ctx, 'organizacao.configuracao.editar', true);
    conferirIfMatch(q.headers['if-match'], q.org.id, q.org.versao, () => orgConfig(ctx));
    const c = structuredClone(q.org.configuracao);
    const modulos = structuredClone(q.org.modulos);
    if (q.body.contato) c.contato = q.body.contato;
    if (q.body.textos) c.textos = { ...c.textos, ...q.body.textos };
    if (q.body.tema?.corMarca) { c.tema.corMarca = q.body.tema.corMarca; c.pwa.corTema = q.body.tema.corMarca; }
    if (q.body.tema && 'logoArquivoId' in q.body.tema) {
      if (q.body.tema.logoArquivoId === null) c.tema.logoUrl = null;
      else {
        const a = await um(q.tx, `SELECT 1 FROM arquivos WHERE organizacao_id = $1 AND id = $2 AND status = 'DISPONIVEL' AND finalidade = 'ORGANIZACAO'`, [q.org.id, q.body.tema.logoArquivoId]);
        if (!a) throw invalido('tema.logoArquivoId', 'Envie o logo como arquivo da organização.');
        c.tema.logoUrl = `${config.urlPublica}/_arquivos/publico/${q.org.id}/${q.body.tema.logoArquivoId}`; // logo é público (não é dado clínico)
      }
    }
    if (q.body.chat) {
      const chat = modulos.find((m) => m.id === 'chat');
      if (!chat) throw new ErroApi('MODULO_NAO_CONTRATADO');
      Object.assign(chat.config, q.body.chat);
    }
    if (q.body.acompanhamento) {
      const acomp = modulos.find((m) => m.id === 'acompanhamento');
      if (!acomp) throw new ErroApi('MODULO_NAO_CONTRATADO');
      acomp.config = { ...acomp.config, ...q.body.acompanhamento };
    }
    // UPDATE com versão (otimista): concorrência entre dois gestores vira 412.
    const r = await q.tx.query('UPDATE organizacoes SET nome = $2, configuracao = $3, modulos = $4, versao = versao + 1 WHERE id = $1 AND versao = $5 RETURNING versao',
      [q.org.id, q.body.nome ?? q.org.nome, c, JSON.stringify(modulos), q.org.versao]);
    if (!r.rowCount) throw new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual: orgConfig(ctx) });
    Object.assign(q.org, { nome: q.body.nome ?? q.org.nome, configuracao: c, modulos, versao: r.rows[0].versao });
    esquecerOrg(q.org.slug);
    const todosUsuarios = await todos(q.tx, `SELECT id FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO'`, [q.org.id]);
    await emitir(q.tx, q.org.id, 'sessao.manifesto.alterado', {}, todosUsuarios.map((x) => x.id)); // RN-EQP-004
    await auditar(q.tx, q.org.id, { usuarioId: ctx.usuario.id, acao: 'ALTERAR', recurso: 'organizacao', recursoId: q.org.id, ip: q.ip, requestId: q.requestId });
    return ok(orgConfig(ctx), { ETag: etag(q.org.id, q.org.versao) });
  },
};
