// Manifesto da sessão (7), conta, contadores, exclusão de conta e tela inicial (8.1).
import { createHash } from 'node:crypto';
import { secoesInicioAcompanhamento } from './acompanhamento.ts';
import { secoesInicioChat } from './chat.ts';
import { secoesInicioAgenda } from './agenda.ts';
import { capacidadeUpload, secoesInicioExames } from '../servicos/exames.ts';
import { capacidadePush } from '../servicos/push.ts';
import { montarNavegacao, temModulo, type Termo } from '@clinica/dominio';
import { versaoContrato } from '@clinica/contrato-validador';
import { ErroApi, invalido, negado } from '../erros.ts';
import { C, ok, type Handler } from '../http.ts';
import { conferirIfMatch, ehEquipeCtx, etag, type Ctx } from '../nucleo.ts';
import { pacientesVinculados, perfisDisponiveis, serUsuario } from '../serializar.ts';
import { contadoresDe } from '../servicos/contadores.ts';
import { emitir } from '../eventos.ts';
import { revogarSessoesDoUsuario } from './auth.ts';
import type { Tx } from '../db.ts';

export async function manifesto(tx: Tx, ctx: Ctx) {
  const { org, usuario: u } = ctx;
  return {
    contrato: { versao: versaoContrato },
    organizacao: { id: org.id, slug: org.slug, nome: org.nome, fuso: org.fuso, locale: org.locale, contato: org.configuracao.contato },
    usuario: await serUsuario(tx, org, u),
    perfilAtivo: ctx.perfil,
    perfisDisponiveis: perfisDisponiveis(u),
    termos: org.termos,
    modulos: org.modulos,
    navegacao: montarNavegacao({ equipe: ehEquipeCtx(ctx), permissoes: ctx.perms, modulos: org.modulos, termos: org.termos as Record<string, Termo> }),
    permissoes: [...ctx.perms],
    capacidades: { ...org.capacidades, upload: capacidadeUpload(org), push: capacidadePush() },
    contadores: await contadoresDe(tx, org, u.id),
    ...(ctx.perfil === 'PACIENTE' ? { pacientesVinculados: await pacientesVinculados(tx, org, u.id) } : {}),
  };
}
async function conta(tx: Tx, ctx: Ctx) {
  return { ...(await serUsuario(tx, ctx.org, ctx.usuario)), perfis: ctx.usuario.perfis, pacientesVinculados: await pacientesVinculados(tx, ctx.org, ctx.usuario.id) };
}

export const handlersSessao: Record<string, Handler> = {
  sessaoObterManifesto: async (q) => {
    const m = await manifesto(q.tx, C(q));
    const tag = `"man-${createHash('sha1').update(JSON.stringify(m)).digest('hex').slice(0, 16)}"`;
    if (q.headers['if-none-match'] === tag) return { status: 304, headers: { ETag: tag } };
    return ok(m, { ETag: tag });
  },
  sessaoObterContadores: async (q) => ok(await contadoresDe(q.tx, q.org, C(q).usuario.id)),
  contaObter: async (q) => ok(await conta(q.tx, C(q)), { ETag: etag(C(q).usuario.id, C(q).usuario.versao) }),
  contaEditar: async (q) => {
    const ctx = C(q);
    const u = ctx.usuario;
    const atual = await conta(q.tx, ctx);
    conferirIfMatch(q.headers['if-match'], u.id, u.versao, () => atual);
    if (q.body.fotoArquivoId) {
      const a = await q.tx.query(`SELECT 1 FROM arquivos WHERE organizacao_id = $1 AND id = $2 AND dono_id = $3 AND status = 'DISPONIVEL' AND finalidade = 'PERFIL'`, [q.org.id, q.body.fotoArquivoId, u.id]);
      if (!a.rowCount) throw invalido('fotoArquivoId', 'Envie uma foto de perfil válida.');
    }
    const r = await q.tx.query(`UPDATE usuarios SET nome_exibicao = COALESCE($3, nome_exibicao),
        foto_arquivo_id = CASE WHEN $4::boolean THEN $5 ELSE foto_arquivo_id END,
        preferencias = preferencias || COALESCE($6::jsonb, '{}'), versao = versao + 1
      WHERE organizacao_id = $1 AND id = $2 RETURNING *`, [q.org.id, u.id, q.body.nomeExibicao ?? null, 'fotoArquivoId' in q.body, q.body.fotoArquivoId ?? null, q.body.preferencias ? JSON.stringify(q.body.preferencias) : null]);
    ctx.usuario = r.rows[0];
    await emitir(q.tx, q.org.id, 'sessao.manifesto.alterado', {}, [u.id]);
    return ok(await conta(q.tx, ctx), { ETag: etag(u.id, ctx.usuario.versao) });
  },
  contaSolicitarExclusao: async (q) => {
    const ctx = C(q);
    if (ehEquipeCtx(ctx) || ctx.usuario.perfis.some((p) => p !== 'PACIENTE')) throw negado('Membros da equipe são desligados pelo gestor da organização.');
    // Remove o acesso; os registros de atendimento ficam (guarda legal — decisão 7).
    await q.tx.query(`UPDATE usuarios SET status = 'DESLIGADO', versao = versao + 1 WHERE organizacao_id = $1 AND id = $2`, [q.org.id, ctx.usuario.id]);
    await q.tx.query('DELETE FROM inscricoes_push WHERE organizacao_id = $1 AND usuario_id = $2', [q.org.id, ctx.usuario.id]);
    await revogarSessoesDoUsuario(q.tx, q.org, ctx.usuario.id, 'CONTA_EXCLUIDA');
    return { status: 202, body: {
      mensagem: `Seu acesso ao app foi removido. ${q.org.nome} continua responsável pelos registros de atendimento, que a lei obriga a guardar.`,
      dadosRetidos: ['Check-ins respondidos e alertas', 'Histórico das conversas com a equipe', 'Fotos enviadas nos check-ins e conversas'],
    } };
  },
  inicioObter: async (q) => {
    const ctx = C(q);
    const org = q.org;
    const secoes: any[] = [];
    if (org.configuracao.avisoInicio) secoes.push({ id: 'aviso', tipo: 'AVISO', dados: org.configuracao.avisoInicio });
    secoes.push(...await secoesInicioAgenda(q.tx, ctx), ...await secoesInicioExames(q.tx, ctx), ...await secoesInicioAcompanhamento(q.tx, ctx), ...await secoesInicioChat(q.tx, ctx));
    if (ehEquipeCtx(ctx)) {
      const t = org.termos as Record<string, Termo>;
      const g = (x: Termo, m: string, f: string) => (x.genero === 'F' ? f : m);
      const atalhos: any[] = [];
      if (ctx.perms.has('pacientes.paciente.criar')) atalhos.push({ rotulo: `${g(t.paciente, 'Novo', 'Nova')} ${t.paciente.singular}`, icone: 'user-plus', destino: { tela: 'pacientes.novo' } });
      const consulta = t.consulta ?? { singular: 'consulta', plural: 'consultas', genero: 'F' };
      if (temModulo(org.modulos, 'agenda') && ctx.perms.has('agenda.agendamento.criar')) atalhos.push({ rotulo: `${g(consulta, 'Novo', 'Nova')} ${consulta.singular}`, icone: 'calendar-plus', destino: { tela: 'agenda.novo' } });
      if (ctx.perms.has('acompanhamento.acompanhamento.criar') && t.acompanhamento) atalhos.push({ rotulo: `${g(t.acompanhamento, 'Novo', 'Nova')} ${t.acompanhamento.singular}`, icone: 'activity', destino: { tela: 'acompanhamento.novo' } });
      if (atalhos.length) secoes.push({ id: 'atalhos', tipo: 'ATALHOS', dados: { itens: atalhos } });
    } else {
      secoes.push({ id: 'contato', tipo: 'CONTATO_ORGANIZACAO', dados: { telefone: org.configuracao.contato.telefone ?? null, endereco: org.configuracao.contato.endereco ?? null, mapaUrl: org.configuracao.mapaUrl ?? null } });
    }
    return ok({ secoes });
  },
};
