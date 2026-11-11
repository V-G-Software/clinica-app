import { deflateSync } from 'node:zlib';
// Regras de negócio do mock: permissões (9.6), visibilidade (404 para o invisível), serialização
// para o formato do contrato e o motor de acompanhamento/chat (RN-ACO, RN-CHA).
import {
  agendar, cancelarJobsComPrefixo, emitir, ErroApi, invalido, naoEncontrado, negado, notificar, novoId, type Org,
  type Perfil, type Usuario,
} from './estado.ts';
import { agoraIso, agoraMs, diferencaDias, HORA, hojeLocal, iso, localParaUtc, MINUTO, partesLocais, somarDias } from './tempo.ts';
import * as agenda from './agenda.ts';
import * as exames from './exames.ts';
import * as documentos from './documentos.ts';
import * as prontuario from './prontuario.ts';

export const BASE_PUBLICA = (process.env.MOCK_URL_PUBLICA ?? `http://localhost:${process.env.PORT ?? 4010}`).replace(/\/$/, '');
export const urlApi = (org: Org) => `${BASE_PUBLICA}/o/${org.slug}`;

export interface Ctx {
  org: Org; usuario: Usuario; sessao: any; perfil: Perfil; perms: Set<string>; requestId: string;
}

// ─────────── Permissões (seção 9.6) ───────────
const TODAS = [
  'pacientes.paciente.ler', 'pacientes.paciente.criar', 'pacientes.paciente.editar', 'pacientes.paciente.convidar',
  'acompanhamento.protocolo.ler', 'acompanhamento.protocolo.gerenciar', 'acompanhamento.acompanhamento.ler',
  'acompanhamento.acompanhamento.criar', 'acompanhamento.acompanhamento.encerrar', 'acompanhamento.checkin.ler',
  'acompanhamento.checkin.responder', 'acompanhamento.alerta.ler', 'acompanhamento.alerta.resolver',
  'chat.conversa.ler', 'chat.conversa.criar', 'chat.conversa.gerenciar', 'chat.mensagem.enviar',
  'equipe.membro.ler', 'equipe.membro.gerenciar', 'organizacao.configuracao.editar',
  'agenda.agendamento.ler', 'agenda.agendamento.criar', 'agenda.agendamento.gerenciar', 'agenda.configuracao.gerenciar',
  'exames.exame.ler', 'exames.pedido.criar', 'exames.resultado.enviar', 'exames.resultado.revisar',
  'documentos.documento.ler', 'documentos.documento.emitir',
  'prontuario.prontuario.ler', 'prontuario.registro.escrever', 'prontuario.copia.atender', 'prontuario.copia.solicitar', 'prontuario.acesso.auditar',
];
const PERMISSOES: Record<Perfil, string[]> = {
  // Prontuário (ADR-0019): o gestor audita, não lê (sigilo é da equipe de saúde); quem lê é o profissional.
  GESTOR: TODAS.filter((p) => !['acompanhamento.checkin.responder', 'prontuario.prontuario.ler', 'prontuario.registro.escrever', 'prontuario.copia.atender', 'prontuario.copia.solicitar'].includes(p)),
  PROFISSIONAL: TODAS.filter((p) => !['acompanhamento.checkin.responder', 'equipe.membro.gerenciar', 'organizacao.configuracao.editar', 'agenda.configuracao.gerenciar', 'prontuario.copia.solicitar', 'prontuario.acesso.auditar'].includes(p)),
  // [DECISÃO 3] secretária vê check-ins e alertas por padrão.
  SECRETARIA: [
    'pacientes.paciente.ler', 'pacientes.paciente.criar', 'pacientes.paciente.editar', 'pacientes.paciente.convidar',
    'acompanhamento.protocolo.ler', 'acompanhamento.acompanhamento.ler', 'acompanhamento.acompanhamento.criar',
    'acompanhamento.checkin.ler', 'acompanhamento.alerta.ler', 'chat.conversa.ler', 'chat.conversa.criar',
    'chat.conversa.gerenciar', 'chat.mensagem.enviar', 'equipe.membro.ler',
    'agenda.agendamento.ler', 'agenda.agendamento.criar', 'agenda.agendamento.gerenciar', 'agenda.configuracao.gerenciar',
    // Pedir e revisar exame é ato do profissional (ADR-0017); a secretaria vê e anexa resultados.
    'exames.exame.ler', 'exames.resultado.enviar',
  ],
  PACIENTE: [
    'pacientes.paciente.ler', 'acompanhamento.acompanhamento.ler', 'acompanhamento.checkin.ler',
    'acompanhamento.checkin.responder', 'chat.conversa.ler', 'chat.mensagem.enviar', 'agenda.agendamento.ler',
    'exames.exame.ler', 'documentos.documento.ler', 'prontuario.copia.solicitar',
  ],
};
export const temModulo = (org: Org, id: string) => org.modulos.some((m) => m.id === id);
export const configModulo = (org: Org, id: string) => org.modulos.find((m) => m.id === id)?.config ?? {};

export function permissoesDe(org: Org, perfil: Perfil): string[] {
  const base = [...PERMISSOES[perfil]];
  if (perfil === 'PACIENTE' && configModulo(org, 'chat').pacientePodeIniciar) base.push('chat.conversa.criar');
  if (perfil === 'PACIENTE' && configModulo(org, 'agenda').autoagendamento) base.push('agenda.agendamento.criar');
  if (perfil === 'PACIENTE' && exames.cfgExames(org).pacienteEnviaResultados) base.push('exames.resultado.enviar');
  return base.filter((p) => {
    const modulo = p.split('.')[0];
    return modulo === 'organizacao' || temModulo(org, modulo);
  });
}
export function exigir(ctx: Ctx, perm: string, comoNaoEncontrado = false) {
  if (!ctx.perms.has(perm)) throw comoNaoEncontrado ? naoEncontrado() : negado();
}
export function exigirModulo(org: Org, id: string) {
  if (!temModulo(org, id)) throw new ErroApi('MODULO_NAO_CONTRATADO', `O módulo ${id} não está ativo nesta organização.`);
}
export const ehEquipe = (ctx: Ctx) => ctx.perfil !== 'PACIENTE';
export const usuarioEhEquipe = (u: Usuario) => u.perfis.some((p) => p !== 'PACIENTE');
export const PRIORIDADE_PERFIL: Perfil[] = ['PROFISSIONAL', 'SECRETARIA', 'GESTOR', 'PACIENTE'];

// ─────────── Visibilidade ───────────
export const pacientesDaConta = (u: Usuario) => new Set(u.vinculos.map((v) => v.pacienteId));
export function contasDoPaciente(org: Org, pacienteId: string): Usuario[] {
  return [...org.usuarios.values()].filter((u) => u.status === 'ATIVO' && u.vinculos.some((v) => v.pacienteId === pacienteId));
}
export function podeVerPaciente(ctx: Ctx, pacienteId: string): boolean {
  if (!ctx.org.pacientes.has(pacienteId)) return false;
  if (ehEquipe(ctx)) return ctx.perms.has('pacientes.paciente.ler') || ctx.perms.has('acompanhamento.acompanhamento.ler');
  return pacientesDaConta(ctx.usuario).has(pacienteId);
}
export function obterPaciente(ctx: Ctx, id: string) {
  exigirModulo(ctx.org, 'pacientes');
  if (!podeVerPaciente(ctx, id)) throw naoEncontrado('Paciente');
  return ctx.org.pacientes.get(id);
}
export function obterAcompanhamento(ctx: Ctx, id: string) {
  exigirModulo(ctx.org, 'acompanhamento');
  const a = ctx.org.acompanhamentos.get(id);
  if (!a || !ctx.perms.has('acompanhamento.acompanhamento.ler') || !podeVerPaciente(ctx, a.pacienteId)) throw naoEncontrado('Acompanhamento');
  return a;
}
export function obterCheckin(ctx: Ctx, id: string) {
  exigirModulo(ctx.org, 'acompanhamento');
  const c = ctx.org.checkins.get(id);
  if (!c || !ctx.perms.has('acompanhamento.checkin.ler') || !podeVerPaciente(ctx, c.pacienteId)) throw naoEncontrado('Check-in');
  return c;
}
export function obterAlerta(ctx: Ctx, id: string) {
  exigirModulo(ctx.org, 'acompanhamento');
  const a = ctx.org.alertas.get(id);
  if (!a || !ctx.perms.has('acompanhamento.alerta.ler')) throw naoEncontrado('Alerta');
  return a;
}
export const participa = (c: any, usuarioId: string) => c.participantes.some((p: any) => p.usuarioId === usuarioId && !p.removidoEm);
export function obterConversa(ctx: Ctx, id: string) {
  exigirModulo(ctx.org, 'chat');
  const c = ctx.org.conversas.get(id);
  if (!c || !participa(c, ctx.usuario.id)) throw naoEncontrado('Conversa');
  return c;
}
export function podeVerArquivo(ctx: Ctx, arq: any): boolean {
  if (arq.donoId === ctx.usuario.id) return true;
  if (arq.finalidade === 'ORGANIZACAO' || arq.finalidade === 'PERFIL') return true;
  // Documento assinado (ADR-0018): quem vê o documento vê o PDF (equipe com permissão; paciente vinculado).
  if (arq.copiaId) return prontuario.podeVerArquivoDeCopia(ctx, arq.copiaId);
  if (arq.documentoId) { const d = documentos.documentosDe(ctx.org).documentos.get(arq.documentoId); if (d && documentos.podeVerDocumento(ctx, d)) return true; }
  if (arq.conversaId) { const c = ctx.org.conversas.get(arq.conversaId); return !!c && participa(c, ctx.usuario.id); }
  if (arq.checkinId) { const c = ctx.org.checkins.get(arq.checkinId); return !!c && ctx.perms.has('acompanhamento.checkin.ler') && podeVerPaciente(ctx, c.pacienteId); }
  return false;
}

// ─────────── Termos e textos ───────────
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const termo = (org: Org, chave: string) => org.termos[chave];
const flex = (genero: string, m: string, f: string) => (genero === 'F' ? f : m);

// ─────────── Versões / ETag ───────────
export const etag = (id: string, v: number) => `"${id}-${v}"`;
export function conferirIfMatch(ifMatch: string | undefined, id: string, v: number, estadoAtual: () => unknown) {
  if (ifMatch !== '*' && ifMatch !== etag(id, v))
    throw new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual: estadoAtual() });
}

// ─────────── Paginação ───────────
export function paginar<T>(itens: T[], cursor: string | undefined, limite = 20) {
  let inicio = 0;
  if (cursor) {
    try {
      inicio = JSON.parse(Buffer.from(cursor, 'base64url').toString()).o;
    } catch {
      throw invalido('cursor', 'Cursor inválido.');
    }
    if (typeof inicio !== 'number' || inicio < 0) throw invalido('cursor', 'Cursor inválido.');
  }
  const pagina = itens.slice(inicio, inicio + limite);
  const fim = inicio + limite >= itens.length;
  return { itens: pagina, proximoCursor: fim ? null : Buffer.from(JSON.stringify({ o: inicio + limite })).toString('base64url') };
}
export const normalizar = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ─────────── Serialização ───────────
export const refPaciente = (org: Org, id: string) => ({ id, nome: org.pacientes.get(id)?.nome ?? '—' });
export function refUsuario(org: Org, id: string, perfil?: Perfil) {
  const u = org.usuarios.get(id)!;
  const p = perfil ?? (u.perfis.includes('PROFISSIONAL') ? 'PROFISSIONAL' : u.perfis[0]);
  return { usuarioId: id, nome: u.perfis.includes('PACIENTE') ? u.nome : u.nomeExibicao, perfil: p };
}
export function conversaAtivaDoPaciente(org: Org, pacienteId: string) {
  return [...org.conversas.values()].find((c) => c.pacienteId === pacienteId && c.status === 'ATIVA') ?? null;
}

export function serPaciente(ctx: Ctx, p: any) {
  const org = ctx.org;
  const contas = contasDoPaciente(org, p.id);
  const temPush = contas.some((u) => [...org.inscricoesPush.values()].some((i) => i.usuarioId === u.id));
  const convitePendente = [...org.convites.values()].some((c) => c.tipo === 'PACIENTE' && c.pacienteId === p.id && !c.usadoEm && Date.parse(c.expiraEm) > agoraMs());
  const ativos = [...org.acompanhamentos.values()].filter((a) => a.pacienteId === p.id && (a.status === 'ATIVO' || a.status === 'AGENDADO')).length;
  const conversa = temModulo(org, 'chat') ? conversaAtivaDoPaciente(org, p.id) : null;
  const acoes: string[] = [];
  if (ehEquipe(ctx)) {
    if (ctx.perms.has('pacientes.paciente.editar')) acoes.push('EDITAR', p.status === 'ATIVO' ? 'INATIVAR' : 'REATIVAR');
    if (p.status === 'ATIVO' && ctx.perms.has('pacientes.paciente.convidar')) acoes.push('CONVIDAR');
    if (p.status === 'ATIVO' && ctx.perms.has('acompanhamento.acompanhamento.criar')) acoes.push('INICIAR_ACOMPANHAMENTO');
    if (temModulo(org, 'chat') && (conversa ? participa(conversa, ctx.usuario.id) || ctx.perms.has('chat.conversa.gerenciar') : ctx.perms.has('chat.conversa.criar'))) acoes.push('ABRIR_CONVERSA');
  } else if (conversa && participa(conversa, ctx.usuario.id)) acoes.push('ABRIR_CONVERSA');
  return {
    id: p.id, tipo: p.tipo, nome: p.nome, nomeSocial: p.nomeSocial ?? null, dataNascimento: p.dataNascimento ?? null,
    contato: { email: p.contato?.email ?? null, celular: p.contato?.celular ?? null },
    camposAdicionais: p.camposAdicionais ?? {}, responsaveis: p.responsaveis ?? [], status: p.status,
    acessoApp: {
      status: contas.length ? 'ATIVO' : convitePendente ? 'CONVITE_PENDENTE' : 'SEM_ACESSO',
      ultimoAcessoEm: contas.map((u) => u.ultimoAcessoEm).filter(Boolean).sort().pop() ?? null,
      notificacoes: !contas.length ? 'NENHUMA' : temPush ? 'PUSH' : 'EMAIL',
    },
    acompanhamentosAtivos: ativos,
    conversaAtivaId: conversa && (participa(conversa, ctx.usuario.id) || ehEquipe(ctx)) ? conversa.id : null,
    criadoEm: p.criadoEm,
    acoesPermitidas: acoes,
  };
}

export const ultimaVersao = <T>(versoes: T[] | undefined): T | undefined => versoes?.[versoes.length - 1];
export function serFormulario(ctx: Ctx | null, f: any) {
  const { _v, ...resto } = f;
  return { ...resto, ...(ctx ? { acoesPermitidas: ctx.perms.has('acompanhamento.protocolo.gerenciar') ? ['EDITAR'] : [] } : {}) };
}
export function serProtocolo(ctx: Ctx, p: any) {
  const { _v, publicadoEm, ...resto } = p;
  const acoes: string[] = [];
  if (ctx.perms.has('acompanhamento.protocolo.gerenciar')) acoes.push('EDITAR', ...(p.status === 'ATIVO' ? ['ARQUIVAR'] : []));
  if (p.status === 'ATIVO' && ctx.perms.has('acompanhamento.acompanhamento.criar')) acoes.push('INICIAR_ACOMPANHAMENTO');
  return { ...resto, descricao: p.descricao ?? null, orientacoes: p.orientacoes ?? [], regrasAlerta: p.regrasAlerta ?? [], acoesPermitidas: acoes };
}
export const checkinsDoAcompanhamento = (org: Org, acpId: string) =>
  [...org.checkins.values()].filter((c) => c.acompanhamentoId === acpId).sort((a, b) => a.dia - b.dia || Date.parse(a.disponivelEm) - Date.parse(b.disponivelEm));
export function resumoCheckin(org: Org, c: any) {
  return { id: c.id, acompanhamentoId: c.acompanhamentoId, paciente: refPaciente(org, c.pacienteId), dia: c.dia, status: c.status, disponivelEm: c.disponivelEm, expiraEm: c.expiraEm };
}
export function proximoCheckin(org: Org, acpId: string) {
  const lista = checkinsDoAcompanhamento(org, acpId);
  return lista.find((c) => c.status === 'DISPONIVEL') ?? lista.find((c) => c.status === 'AGENDADO') ?? null;
}
export function diaAtual(org: Org, a: any) {
  return diferencaDias(a.dataInicio, hojeLocal(org.config.fuso));
}
export function serAcompanhamento(ctx: Ctx, a: any) {
  const org = ctx.org;
  const lista = checkinsDoAcompanhamento(org, a.id);
  const conta = (s: string) => lista.filter((c) => c.status === s).length;
  const prox = proximoCheckin(org, a.id);
  const conversa = temModulo(org, 'chat') ? org.conversas.get(a.conversaId) : null;
  const acoes: string[] = [];
  const emAndamento = a.status === 'ATIVO' || a.status === 'AGENDADO';
  if (ehEquipe(ctx) && emAndamento && ctx.perms.has('acompanhamento.acompanhamento.criar')) acoes.push('EDITAR');
  if (ehEquipe(ctx) && emAndamento && ctx.perms.has('acompanhamento.acompanhamento.encerrar')) acoes.push('ENCERRAR');
  if (conversa && (participa(conversa, ctx.usuario.id) || (ehEquipe(ctx) && ctx.perms.has('chat.conversa.gerenciar')))) acoes.push('ABRIR_CONVERSA');
  return {
    id: a.id, paciente: refPaciente(org, a.pacienteId),
    protocolo: { id: a.protocolo.id, versao: a.protocolo.versao, nome: a.protocolo.nome },
    dataInicio: a.dataInicio, diaAtual: diaAtual(org, a), totalDias: a.protocolo.duracaoDias, status: a.status,
    equipe: a.equipeIds.filter((id: string) => org.usuarios.has(id)).map((id: string) => refUsuario(org, id)),
    conversaId: conversa && (participa(conversa, ctx.usuario.id) || ehEquipe(ctx)) ? conversa.id : null,
    agendamentoId: a.agendamentoId ?? null,
    resumoCheckins: { respondidos: conta('RESPONDIDO'), pendentes: conta('DISPONIVEL'), expirados: conta('EXPIRADO'), agendados: conta('AGENDADO') },
    alertasAbertos: ehEquipe(ctx) ? [...org.alertas.values()].filter((x) => x.acompanhamentoId === a.id && x.status === 'ABERTO').length : 0,
    proximoCheckin: prox ? resumoCheckin(org, prox) : null,
    observacao: ehEquipe(ctx) ? a.observacao ?? null : null,
    motivoEncerramento: a.motivoEncerramento ?? null,
    criadoEm: a.criadoEm,
    acoesPermitidas: acoes,
  };
}
export function serAlerta(ctx: Ctx, a: any) {
  const org = ctx.org;
  const acoes: string[] = [];
  if (a.status === 'ABERTO' && ctx.perms.has('acompanhamento.alerta.resolver')) acoes.push('RESOLVER');
  const acp = org.acompanhamentos.get(a.acompanhamentoId);
  const conversa = acp && temModulo(org, 'chat') ? org.conversas.get(acp.conversaId) : null;
  if (conversa && (participa(conversa, ctx.usuario.id) || ctx.perms.has('chat.conversa.gerenciar'))) acoes.push('ABRIR_CONVERSA');
  return {
    id: a.id, acompanhamentoId: a.acompanhamentoId, checkinId: a.checkinId, paciente: refPaciente(org, a.pacienteId),
    regraId: a.regraId, severidade: a.severidade, mensagem: a.mensagem, status: a.status, criadoEm: a.criadoEm,
    resolvidoEm: a.resolvidoEm, resolvidoPor: a.resolvidoPor ? { usuarioId: a.resolvidoPor, nome: refUsuario(org, a.resolvidoPor).nome } : null,
    nota: a.nota, acoesPermitidas: acoes,
  };
}
export function urlsArquivo(org: Org, arq: any) {
  if (arq.status !== 'DISPONIVEL') return { urlVisualizacao: null, urlMiniatura: null, urlsExpiramEm: null };
  const exp = agoraMs() + 5 * MINUTO;
  const assinatura = `${exp.toString(36)}.${arq.id.slice(-6)}`;
  const base = `${BASE_PUBLICA}/__mock/arquivos/${org.slug}/${arq.id}?exp=${exp}&assinatura=${assinatura}`;
  // PDF não tem miniatura no MVP (ADR-0017): o app mostra um ícone e baixa como anexo.
  return { urlVisualizacao: base, urlMiniatura: arq.tipo === 'application/pdf' ? null : `${base}&miniatura=1`, urlsExpiramEm: iso(exp) };
}
export function serArquivo(org: Org, arq: any) {
  return {
    id: arq.id, nome: arq.nome, tipo: arq.tipo, tamanhoBytes: arq.tamanhoBytes, finalidade: arq.finalidade, status: arq.status,
    motivoRejeicao: arq.motivoRejeicao ?? null, ...urlsArquivo(org, arq), criadoEm: arq.criadoEm,
  };
}
export const serArquivoResumo = (org: Org, id: string) => {
  const arq = org.arquivos.get(id);
  return arq ? { id, status: arq.status, ...urlsArquivo(org, arq) } : { id, status: 'REJEITADO', urlVisualizacao: null, urlMiniatura: null, urlsExpiramEm: null };
};
export function serCheckin(ctx: Ctx, c: any, detalhe: boolean) {
  const org = ctx.org;
  const fotos: string[] = [];
  if (detalhe && c.respostas) {
    for (const campo of c.formulario.campos) if (campo.tipo === 'FOTO' && Array.isArray(c.respostas[campo.id])) fotos.push(...c.respostas[campo.id]);
  }
  const podeResponder = ctx.perfil === 'PACIENTE' && ctx.perms.has('acompanhamento.checkin.responder') && c.status === 'DISPONIVEL';
  return {
    id: c.id, acompanhamentoId: c.acompanhamentoId, paciente: refPaciente(org, c.pacienteId), dia: c.dia, status: c.status,
    disponivelEm: c.disponivelEm, expiraEm: c.expiraEm, respondidoEm: c.respondidoEm,
    ...(detalhe ? { formulario: serFormulario(null, c.formulario), anexos: fotos.map((id) => serArquivoResumo(org, id)) } : {}),
    respostas: c.respostas,
    alertas: ehEquipe(ctx) && ctx.perms.has('acompanhamento.alerta.ler')
      ? [...org.alertas.values()].filter((a) => a.checkinId === c.id).map((a) => serAlerta(ctx, a)) : [],
    acoesPermitidas: podeResponder ? ['RESPONDER'] : [],
  };
}
export function naoLidasPara(org: Org, conversa: any, usuarioId: string) {
  const p = conversa.participantes.find((x: any) => x.usuarioId === usuarioId && !x.removidoEm);
  if (!p) return 0;
  const msgs = org.mensagens.get(conversa.id) ?? [];
  const idx = p.lidoAte ? msgs.findIndex((m) => m.id === p.lidoAte) : -1;
  return msgs.slice(idx + 1).filter((m) => m.autorId !== usuarioId).length;
}
export function resumoMensagem(m: any) {
  if (m.tipo === 'CHECKIN') return m.referencia?.resumo ?? 'Check-in respondido';
  if (m.referencia?.tipo === 'DOCUMENTO') return `📄 ${m.referencia.resumo}`;
  if (m.tipo === 'ANEXO') return m.texto ? `📷 ${m.texto}` : '📷 Foto';
  return (m.texto ?? '').slice(0, 120);
}
export function serConversa(ctx: Ctx, c: any) {
  const org = ctx.org;
  const msgs = org.mensagens.get(c.id) ?? [];
  const ultima = msgs[msgs.length - 1];
  const acoes: string[] = [];
  const souParticipante = participa(c, ctx.usuario.id);
  if (c.status === 'ATIVA' && souParticipante && ctx.perms.has('chat.mensagem.enviar')) acoes.push('ENVIAR');
  if (ehEquipe(ctx) && ctx.perms.has('chat.conversa.gerenciar')) {
    if (c.status === 'ATIVA') acoes.push('ADICIONAR_PARTICIPANTE', 'REMOVER_PARTICIPANTE', 'ARQUIVAR');
    else acoes.push('REABRIR');
  }
  const acpAtivo = [...org.acompanhamentos.values()].find((a) => a.conversaId === c.id && (a.status === 'ATIVO' || a.status === 'AGENDADO'));
  return {
    id: c.id,
    titulo: ehEquipe(ctx) ? org.pacientes.get(c.pacienteId)?.nome ?? '—' : org.config.nome, // RN-CHA-003
    paciente: refPaciente(org, c.pacienteId),
    acompanhamentoAtivoId: acpAtivo?.id ?? null,
    status: c.status,
    participantes: c.participantes.filter((p: any) => !p.removidoEm).map((p: any) => ({ ...refUsuario(org, p.usuarioId, p.perfil), lidoAte: p.lidoAte ?? null })),
    ultimaMensagem: ultima ? { id: ultima.id, resumo: resumoMensagem(ultima), autorNome: ultima.autorId ? refUsuario(org, ultima.autorId).nome : null, enviadoEm: ultima.enviadoEm } : null,
    naoLidas: naoLidasPara(org, c, ctx.usuario.id),
    criadoEm: c.criadoEm,
    acoesPermitidas: acoes,
  };
}
export function serMensagem(org: Org, m: any) {
  return {
    id: m.id, idCliente: m.idCliente ?? null, conversaId: m.conversaId, tipo: m.tipo,
    autor: m.autorId ? refUsuario(org, m.autorId, m.autorPerfil) : null,
    texto: m.texto ?? null, anexos: (m.anexosIds ?? []).map((id: string) => serArquivoResumo(org, id)),
    referencia: m.referencia ?? null, enviadoEm: m.enviadoEm,
  };
}
export function serMembro(ctx: Ctx, u: Usuario) {
  const acoes: string[] = [];
  if (ctx.perms.has('equipe.membro.gerenciar') && u.status !== 'DESLIGADO') {
    acoes.push('EDITAR');
    if (u.status === 'ATIVO') acoes.push('SUSPENDER');
    if (u.status === 'SUSPENSO') acoes.push('REATIVAR');
    acoes.push('DESLIGAR');
  }
  return {
    id: u.id, nome: u.nomeExibicao, email: u.email, perfis: u.perfis.filter((p) => p !== 'PACIENTE'), status: u.status,
    profissional: u.perfis.includes('PROFISSIONAL') ? u.profissional ?? null : null, acoesPermitidas: acoes,
  };
}

// ─────────── Contadores ───────────
export function contadores(org: Org, u: Usuario): Record<string, number> {
  const equipe = usuarioEhEquipe(u);
  const vinculados = pacientesDaConta(u);
  const r: Record<string, number> = {};
  r['notificacoes.naoLidas'] = (org.notificacoes.get(u.id) ?? []).filter((n) => !n.lidoEm).length;
  if (temModulo(org, 'chat'))
    r['chat.naoLidas'] = [...org.conversas.values()].filter((c) => c.status === 'ATIVA' && participa(c, u.id)).reduce((s, c) => s + naoLidasPara(org, c, u.id), 0);
  if (temModulo(org, 'acompanhamento')) {
    r['acompanhamento.alertasAbertos'] = equipe ? [...org.alertas.values()].filter((a) => a.status === 'ABERTO').length : 0;
    r['acompanhamento.checkinsPendentes'] = [...org.checkins.values()].filter((c) => c.status === 'DISPONIVEL' && (equipe || vinculados.has(c.pacienteId))).length;
  }
  if (temModulo(org, 'exames')) {
    const perms = new Set(u.perfis.filter((p) => p !== 'PACIENTE').flatMap((p) => permissoesDe(org, p)));
    r['exames.resultadosParaRevisar'] = exames.contadorParaRevisar(org, perms);
  }
  if (temModulo(org, 'documentos')) {
    const perms = new Set(u.perfis.filter((p) => p !== 'PACIENTE').flatMap((p) => permissoesDe(org, p)));
    r['documentos.paraAssinar'] = documentos.contadorParaAssinar(org, u.id, perms);
  }
  if (temModulo(org, 'prontuario')) {
    const perms = new Set(u.perfis.filter((p) => p !== 'PACIENTE').flatMap((p) => permissoesDe(org, p)));
    r['prontuario.copiasPendentes'] = prontuario.contadorCopiasPendentes(org, perms);
  }
  return r;
}
export const avisarContadores = (org: Org) => (usuarioId: string) => {
  const u = org.usuarios.get(usuarioId);
  if (u) emitir(org, 'contadores.alterados', contadores(org, u), [usuarioId]);
};
export const notificarU = (org: Org, usuarioId: string, n: Parameters<typeof notificar>[2]) => notificar(org, usuarioId, n, avisarContadores(org));
const equipeAtivaDe = (org: Org, a: any): string[] => a.equipeIds.filter((id: string) => org.usuarios.get(id)?.status === 'ATIVO');
export const contasIdsDoPaciente = (org: Org, pacienteId: string) => contasDoPaciente(org, pacienteId).map((u) => u.id);

// ─────────── Chat (RN-CHA) ───────────
export function criarConversa(org: Org, pacienteId: string, participantesIds: string[], em = agoraIso()) {
  const c = {
    id: novoId('cnv'), pacienteId, status: 'ATIVA', criadoEm: em, ultimoAvisoForaHorarioEm: null as string | null,
    participantes: [...new Set(participantesIds)].filter((id) => org.usuarios.has(id)).map((id) => ({ usuarioId: id, perfil: refUsuario(org, id).perfil, lidoAte: null, entrouEm: em })),
  };
  org.conversas.set(c.id, c);
  org.mensagens.set(c.id, []);
  return c;
}
export function adicionarParticipante(org: Org, c: any, usuarioId: string) {
  const existente = c.participantes.find((p: any) => p.usuarioId === usuarioId);
  if (existente && !existente.removidoEm) return false;
  if (existente) { existente.removidoEm = undefined; existente.entrouEm = agoraIso(); }
  else c.participantes.push({ usuarioId, perfil: refUsuario(org, usuarioId).perfil, lidoAte: (org.mensagens.get(c.id) ?? []).at(-1)?.id ?? null, entrouEm: agoraIso() });
  return true;
}
export const participantesAtivos = (c: any): string[] => c.participantes.filter((p: any) => !p.removidoEm).map((p: any) => p.usuarioId);

export function postarMensagem(org: Org, c: any, m: { tipo: string; autorId: string | null; texto?: string | null; anexosIds?: string[]; referencia?: any; idCliente?: string | null }) {
  const autor = m.autorId ? org.usuarios.get(m.autorId) : null;
  const msg = {
    id: novoId('msg'), conversaId: c.id, tipo: m.tipo, autorId: m.autorId,
    autorPerfil: autor ? (c.participantes.find((p: any) => p.usuarioId === autor.id)?.perfil ?? refUsuario(org, autor.id).perfil) : null,
    texto: m.texto ?? null, anexosIds: m.anexosIds ?? [], referencia: m.referencia ?? null, idCliente: m.idCliente ?? null, enviadoEm: agoraIso(),
  };
  org.mensagens.get(c.id)!.push(msg);
  for (const id of msg.anexosIds) { const a = org.arquivos.get(id); if (a) a.conversaId = c.id; }
  if (m.autorId) { const p = c.participantes.find((x: any) => x.usuarioId === m.autorId); if (p) p.lidoAte = msg.id; }
  const todos = participantesAtivos(c);
  emitir(org, 'chat.mensagem.criada', { conversaId: c.id, mensagemId: msg.id }, todos);
  // RN-CHA-008: notifica os outros participantes (exceto mensagens SISTEMA).
  if (msg.tipo !== 'SISTEMA') {
    const nomePaciente = org.pacientes.get(c.pacienteId)?.nome ?? '';
    for (const uid of todos) {
      if (uid === m.autorId) continue;
      const destinatario = org.usuarios.get(uid)!;
      const deQuem = autor ? refUsuario(org, autor.id).nome : org.config.nome;
      notificarU(org, uid, {
        tipo: 'CHAT_MENSAGEM', agrupar: c.id,
        titulo: usuarioEhEquipe(destinatario) ? nomePaciente : org.config.nome,
        texto: `${deQuem}: ${resumoMensagem(msg)}`.slice(0, 160),
        destino: { tela: 'chat.conversa', parametros: { conversaId: c.id } },
      });
    }
  } else {
    for (const uid of todos) avisarContadores(org)(uid);
  }
  return msg;
}

/** RN-CHA-006: dentro do horário de atendimento no fuso da organização? */
export function dentroDoHorario(org: Org, ms = agoraMs()) {
  const cfg = configModulo(org, 'chat');
  const l = partesLocais(ms, org.config.fuso);
  return (cfg.horarioAtendimento ?? []).some((h: any) => h.diaSemana === l.diaSemana && l.hora >= h.inicio && l.hora < h.fim);
}
/** Próxima abertura do atendimento depois de `ms` (para avisar no máximo uma vez por período). */
export function proximaAbertura(org: Org, ms: number): number | null {
  const cfg = configModulo(org, 'chat');
  const base = partesLocais(ms, org.config.fuso).data;
  let melhor: number | null = null;
  for (let d = 0; d < 8; d++) {
    const data = somarDias(base, d);
    for (const h of cfg.horarioAtendimento ?? []) {
      const t = localParaUtc(data, h.inicio, org.config.fuso);
      if (partesLocais(t, org.config.fuso).diaSemana === h.diaSemana && t > ms && (melhor === null || t < melhor)) melhor = t;
    }
  }
  return melhor;
}

// ─────────── Acompanhamento (RN-ACO) ───────────
export function obterProtocoloVersao(org: Org, id: string, versao?: number) {
  const versoes = org.protocolos.get(id);
  return versao ? versoes?.find((p) => p.versao === versao) : ultimaVersao(versoes);
}
export function obterFormularioVersao(org: Org, id: string, versao?: number) {
  const versoes = org.formularios.get(id);
  return versao ? versoes?.find((f) => f.versao === versao) : ultimaVersao(versoes);
}

export function criarAcompanhamento(
  org: Org,
  d: { id?: string; pacienteId: string; protocoloId: string; dataInicio: string; equipeIds: string[]; criadoPor: string; observacao: string | null; agendamentoId?: string | null; seed?: any },
) {
  const protocolo = structuredClone(obterProtocoloVersao(org, d.protocoloId)); // RN-ACO-003: congela a versão
  const fuso = org.config.fuso;
  const a: any = {
    id: d.id ?? novoId('acp'), pacienteId: d.pacienteId, protocolo, dataInicio: d.dataInicio, equipeIds: [...new Set(d.equipeIds)],
    status: 'AGENDADO', observacao: d.observacao, agendamentoId: d.agendamentoId ?? null, motivoEncerramento: null, criadoEm: agoraIso(), criadoPor: d.criadoPor, conversaId: null, _v: 1, seed: d.seed,
  };
  org.acompanhamentos.set(a.id, a);
  const agora = agoraMs();
  let fimMs = localParaUtc(somarDias(d.dataInicio, protocolo.duracaoDias + 1), '00:00', fuso);

  // RN-ACO-002: gera todos os check-ins já com disponivelEm e expiraEm.
  for (const prog of protocolo.checkins) {
    const formulario = structuredClone(obterFormularioVersao(org, prog.formulario.id, prog.formulario.versao));
    for (const dia of [...prog.dias].sort((x: number, y: number) => x - y)) {
      const disp = localParaUtc(somarDias(d.dataInicio, dia), prog.horario, fuso);
      const exp = disp + prog.expiraAposHoras * HORA;
      fimMs = Math.max(fimMs, exp);
      const c: any = {
        id: novoId('chk'), acompanhamentoId: a.id, pacienteId: a.pacienteId, dia, status: 'AGENDADO',
        disponivelEm: iso(disp), expiraEm: iso(exp), respondidoEm: null, respostas: null, formulario,
        lembreteAposHoras: prog.lembreteAposHoras ?? null, respondidoPor: null,
      };
      org.checkins.set(c.id, c);
      if (exp <= agora && !d.seed) {
        c.status = 'EXPIRADO'; // retroativo já vencido: registra sem gerar alerta nem notificação
        continue;
      }
      if (disp <= agora && !d.seed) c.status = 'DISPONIVEL'; // nasce disponível (data retroativa)
      agendar(`checkin:${c.id}:abrir`, disp, () => abrirCheckin(org, c.id));
      agendar(`checkin:${c.id}:expirar`, exp, () => expirarCheckin(org, c.id));
      if (c.lembreteAposHoras) agendar(`checkin:${c.id}:lembrete`, disp + c.lembreteAposHoras * HORA, () => lembrarCheckin(org, c.id));
    }
  }
  for (const [i, o] of (protocolo.orientacoes ?? []).entries()) {
    const em = localParaUtc(somarDias(d.dataInicio, o.dia), o.horario, fuso);
    if (em > agora || d.seed) agendar(`acompanhamento:${a.id}:orientacao:${i}`, em, () => publicarOrientacao(org, a.id, i));
  }
  const inicio = localParaUtc(d.dataInicio, '00:00', fuso);
  if (inicio <= agora) a.status = 'ATIVO';
  else agendar(`acompanhamento:${a.id}:ativar`, inicio, () => ativarAcompanhamento(org, a.id));
  agendar(`acompanhamento:${a.id}:concluir`, Math.max(fimMs, agora), () => concluirAcompanhamento(org, a.id));

  // RN-CHA-001: liga à conversa ativa do paciente (cria se não houver) e registra mensagem SISTEMA.
  const contas = contasIdsDoPaciente(org, a.pacienteId);
  if (temModulo(org, 'chat')) {
    let c = conversaAtivaDoPaciente(org, a.pacienteId);
    if (!c) c = criarConversa(org, a.pacienteId, [...a.equipeIds, ...contas]);
    else for (const id of [...a.equipeIds, ...contas]) adicionarParticipante(org, c, id);
    a.conversaId = c.id;
    const t = termo(org, 'acompanhamento');
    postarMensagem(org, c, { tipo: 'SISTEMA', autorId: null, texto: `${cap(t.singular)} ${flex(t.genero, 'iniciado', 'iniciada')}: ${protocolo.nome}.`, referencia: { tipo: 'ACOMPANHAMENTO', id: a.id, resumo: protocolo.nome, temAlerta: false } });
  }
  const para = [...equipeAtivaDe(org, a), ...contas];
  emitir(org, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, para);
  for (const uid of contas)
    notificarU(org, uid, { tipo: 'ACOMPANHAMENTO_INICIADO', titulo: protocolo.nome, texto: 'A equipe iniciou o seu acompanhamento.', destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } });
  for (const c of checkinsDoAcompanhamento(org, a.id)) if (c.status === 'DISPONIVEL') avisarCheckinDisponivel(org, a, c);
  return a;
}

function avisarCheckinDisponivel(org: Org, a: any, c: any) {
  const contas = contasIdsDoPaciente(org, a.pacienteId);
  emitir(org, 'acompanhamento.checkin.disponivel', { checkinId: c.id, acompanhamentoId: a.id }, contas);
  const t = termo(org, 'checkin');
  for (const uid of contas)
    notificarU(org, uid, { tipo: 'CHECKIN_DISPONIVEL', titulo: `${cap(t.singular)} disponível`, texto: `${flex(t.genero, 'O', 'A')} ${t.singular} de hoje já pode ser respondid${flex(t.genero, 'o', 'a')}.`, destino: { tela: 'acompanhamento.checkin', parametros: { checkinId: c.id } } });
}

export function abrirCheckin(org: Org, id: string) {
  const c = org.checkins.get(id);
  if (!c || (c.status !== 'AGENDADO' && c.status !== 'DISPONIVEL')) return;
  const a = org.acompanhamentos.get(c.acompanhamentoId);
  if (!a || a.status === 'ENCERRADO') return;
  if (c.status === 'AGENDADO') {
    c.status = 'DISPONIVEL';
    avisarCheckinDisponivel(org, a, c);
    for (const uid of equipeAtivaDe(org, a)) avisarContadores(org)(uid);
  }
  // Cenário de exemplo: respostas programadas no seed.
  const r = a.seed?.respostas?.[String(c.dia)];
  if (r) agendar(`seed:${c.id}:responder`, Date.parse(c.disponivelEm) + (r.aposMinutos ?? 30) * MINUTO, () => {
    const conta = contasIdsDoPaciente(org, a.pacienteId)[0];
    const respostas = Object.fromEntries(Object.entries(r.respostas).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (x === '@foto' ? fotoDeExemplo(org, conta) : x)) : v]));
    responderCheckin(org, c, respostas, conta);
  });
}
export function lembrarCheckin(org: Org, id: string) {
  const c = org.checkins.get(id);
  if (!c || c.status !== 'DISPONIVEL') return;
  const t = termo(org, 'checkin');
  for (const uid of contasIdsDoPaciente(org, c.pacienteId))
    notificarU(org, uid, { tipo: 'CHECKIN_LEMBRETE', titulo: `Lembrete de ${t.singular}`, texto: `Você ainda não respondeu ${flex(t.genero, 'o', 'a')} ${t.singular} de hoje.`, destino: { tela: 'acompanhamento.checkin', parametros: { checkinId: c.id } } });
}
export function expirarCheckin(org: Org, id: string) {
  const c = org.checkins.get(id);
  if (!c || c.status !== 'DISPONIVEL') return;
  c.status = 'EXPIRADO';
  const a = org.acompanhamentos.get(c.acompanhamentoId);
  for (const regra of a.protocolo.regrasAlerta ?? []) if (regra.tipo === 'CHECKIN_EXPIRADO') criarAlerta(org, a, c, regra);
  emitir(org, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, [...equipeAtivaDe(org, a), ...contasIdsDoPaciente(org, a.pacienteId)]);
  for (const uid of [...equipeAtivaDe(org, a), ...contasIdsDoPaciente(org, a.pacienteId)]) avisarContadores(org)(uid);
}
export function publicarOrientacao(org: Org, acpId: string, i: number) {
  const a = org.acompanhamentos.get(acpId);
  if (!a || a.status === 'ENCERRADO' || !temModulo(org, 'chat') || !configModulo(org, 'acompanhamento').publicarCheckinNaConversa) return;
  const c = org.conversas.get(a.conversaId);
  if (c && c.status === 'ATIVA') postarMensagem(org, c, { tipo: 'ORIENTACAO', autorId: null, texto: a.protocolo.orientacoes[i].texto });
}
export function ativarAcompanhamento(org: Org, id: string) {
  const a = org.acompanhamentos.get(id);
  if (!a || a.status !== 'AGENDADO') return;
  a.status = 'ATIVO'; a._v++;
  emitir(org, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, [...equipeAtivaDe(org, a), ...contasIdsDoPaciente(org, a.pacienteId)]);
}
export function concluirAcompanhamento(org: Org, id: string) {
  const a = org.acompanhamentos.get(id);
  if (!a || (a.status !== 'ATIVO' && a.status !== 'AGENDADO')) return;
  a.status = 'CONCLUIDO'; a._v++;
  resolverAlertasAoFinalizar(org, a, null, 'Acompanhamento concluído.');
  const contas = contasIdsDoPaciente(org, a.pacienteId);
  emitir(org, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, [...equipeAtivaDe(org, a), ...contas]);
  for (const uid of contas)
    notificarU(org, uid, { tipo: 'ACOMPANHAMENTO_CONCLUIDO', titulo: a.protocolo.nome, texto: 'Seu acompanhamento foi concluído. Obrigado por responder!', destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } });
}
export function encerrarAcompanhamento(org: Org, a: any, motivo: string, porId: string) {
  a.status = 'ENCERRADO'; a.motivoEncerramento = motivo; a.encerradoPor = porId; a._v++;
  resolverAlertasAoFinalizar(org, a, porId, 'Acompanhamento encerrado.');
  cancelarJobsComPrefixo(`acompanhamento:${a.id}:`);
  for (const c of checkinsDoAcompanhamento(org, a.id)) {
    if (c.status === 'AGENDADO' || c.status === 'DISPONIVEL') { c.status = 'CANCELADO'; cancelarJobsComPrefixo(`checkin:${c.id}:`); }
  }
  const c = temModulo(org, 'chat') ? org.conversas.get(a.conversaId) : null;
  const t = termo(org, 'acompanhamento');
  if (c && c.status === 'ATIVA') postarMensagem(org, c, { tipo: 'SISTEMA', autorId: null, texto: `${cap(t.singular)} ${flex(t.genero, 'encerrado', 'encerrada')} pela equipe.` });
  const para = [...equipeAtivaDe(org, a), ...contasIdsDoPaciente(org, a.pacienteId)];
  emitir(org, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, para);
  for (const uid of para) avisarContadores(org)(uid);
}

// ─────────── Formulário: visibilidade e validação (RN-FRM-002/003) ───────────
export function compara(valor: any, operador: string, alvo: any): boolean {
  if (valor === undefined || valor === null) return false;
  switch (operador) {
    case 'IGUAL': return valor === alvo;
    case 'DIFERENTE': return valor !== alvo;
    case 'MAIOR_OU_IGUAL': return typeof valor === 'number' && valor >= alvo;
    case 'MENOR_OU_IGUAL': return typeof valor === 'number' && valor <= alvo;
    case 'CONTEM': return Array.isArray(valor) ? valor.includes(alvo) : typeof valor === 'string' && valor.includes(String(alvo));
    default: return false;
  }
}
export const campoVisivel = (campo: any, respostas: any) => !campo.visivelSe || compara(respostas[campo.visivelSe.campo], campo.visivelSe.operador, campo.visivelSe.valor);

export function validarRespostas(org: Org, formulario: any, respostas: Record<string, any>, usuarioId: string, prefixo = 'respostas') {
  const erros: any[] = [];
  const err = (campo: string, codigo: string, mensagem: string) => erros.push({ campo: `${prefixo}.${campo}`, codigo, mensagem });
  const ids = new Set(formulario.campos.map((c: any) => c.id));
  for (const k of Object.keys(respostas)) if (!ids.has(k)) err(k, 'DESCONHECIDO', 'Campo não existe neste formulário.');
  for (const campo of formulario.campos) {
    const v = respostas[campo.id];
    const visivel = campoVisivel(campo, respostas);
    if (campo.tipo === 'INFORMACAO') { if (v !== undefined) err(campo.id, 'INVALIDO', 'Campo informativo não recebe valor.'); continue; }
    const vazio = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (vazio) { if (campo.obrigatorio && visivel) err(campo.id, 'OBRIGATORIO', `Informe: ${campo.rotulo}`); continue; }
    if (!visivel) { err(campo.id, 'INVALIDO', 'Campo não está visível para estas respostas.'); continue; }
    const tipoErrado = () => err(campo.id, 'TIPO_INVALIDO', `Valor inválido para ${campo.rotulo}.`);
    switch (campo.tipo) {
      case 'TEXTO': case 'TEXTO_LONGO':
        if (typeof v !== 'string') tipoErrado(); else if (v.length > (campo.tipo === 'TEXTO' ? 300 : 4000)) err(campo.id, 'MUITO_LONGO', 'Texto muito longo.');
        break;
      case 'NUMERO': case 'ESCALA':
        if (typeof v !== 'number' || (campo.tipo === 'ESCALA' && !Number.isInteger(v))) { tipoErrado(); break; }
        if ((campo.min !== undefined && v < campo.min) || (campo.max !== undefined && v > campo.max)) err(campo.id, 'FORA_DO_INTERVALO', `Informe um valor entre ${campo.min} e ${campo.max}.`);
        if (campo.tipo === 'NUMERO' && campo.casasDecimais !== undefined && Math.round(v * 10 ** campo.casasDecimais) / 10 ** campo.casasDecimais !== v) err(campo.id, 'CASAS_DECIMAIS', `Use até ${campo.casasDecimais} casas decimais.`);
        break;
      case 'SIM_NAO': if (typeof v !== 'boolean') tipoErrado(); break;
      case 'ESCOLHA_UNICA': if (!campo.opcoes.some((o: any) => o.valor === v)) tipoErrado(); break;
      case 'ESCOLHA_MULTIPLA': if (!Array.isArray(v) || !v.every((x) => campo.opcoes.some((o: any) => o.valor === x))) tipoErrado(); break;
      case 'DATA': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) tipoErrado(); break;
      case 'HORA': if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) tipoErrado(); break;
      case 'FOTO':
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) { tipoErrado(); break; }
        if (campo.maximo && v.length > campo.maximo) err(campo.id, 'MUITOS_ITENS', `Envie no máximo ${campo.maximo}.`);
        for (const id of v) {
          const arq = org.arquivos.get(id);
          if (!arq || arq.donoId !== usuarioId || arq.status !== 'DISPONIVEL' || arq.usadoEm) err(campo.id, 'ARQUIVO_INDISPONIVEL', 'Foto ainda não está disponível.');
        }
        break;
    }
  }
  if (erros.length) throw new ErroApi('VALIDACAO_FALHOU', 'Alguns campos precisam de correção.', { campos: erros });
}

function criarAlerta(org: Org, a: any, c: any, regra: any) {
  const alerta = {
    id: novoId('alr'), acompanhamentoId: a.id, checkinId: c?.id ?? null, pacienteId: a.pacienteId, regraId: regra.id,
    severidade: regra.severidade, mensagem: regra.mensagem, status: 'ABERTO', criadoEm: agoraIso(),
    resolvidoEm: null, resolvidoPor: null, nota: null,
  };
  org.alertas.set(alerta.id, alerta);
  const equipe = equipeAtivaDe(org, a).filter((id) => permissoesDe(org, perfilEquipe(org.usuarios.get(id)!)).includes('acompanhamento.alerta.ler'));
  emitir(org, 'acompanhamento.alerta.criado', { alertaId: alerta.id, acompanhamentoId: a.id }, equipe);
  for (const uid of equipe)
    notificarU(org, uid, { tipo: 'ALERTA_CRIADO', titulo: regra.mensagem, texto: `${org.pacientes.get(a.pacienteId)?.nome}: ${regra.mensagem}.`, destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: a.id } } });
  return alerta;
}
export const perfilEquipe = (u: Usuario): Perfil => PRIORIDADE_PERFIL.find((p) => u.perfis.includes(p)) ?? u.perfis[0];

function valorLegivel(campo: any, v: any): string {
  if (campo.opcoes) return (Array.isArray(v) ? v : [v]).map((x) => campo.opcoes.find((o: any) => o.valor === x)?.rotulo ?? x).join(', ').toLowerCase();
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  return String(v);
}
export function resumoRespostas(c: any) {
  const partes = [`Dia ${c.dia}`];
  for (const campo of c.formulario.campos) {
    if (partes.length >= 4) break;
    const v = c.respostas[campo.id];
    if (v === undefined || !['ESCALA', 'NUMERO', 'ESCOLHA_UNICA'].includes(campo.tipo)) continue;
    partes.push(`${campo.id.replace(/[A-Z]/g, (l: string) => ` ${l.toLowerCase()}`)} ${valorLegivel(campo, v)}`);
  }
  return partes.join(' · ');
}

export function responderCheckin(org: Org, c: any, respostas: Record<string, any>, usuarioId: string) {
  if (c.status === 'RESPONDIDO') throw new ErroApi('CHECKIN_JA_RESPONDIDO', 'Este check-in já foi respondido. Para completar, use a conversa.');
  if (c.status !== 'DISPONIVEL') throw new ErroApi('CHECKIN_INDISPONIVEL', 'Este check-in não está disponível para resposta.');
  validarRespostas(org, c.formulario, respostas, usuarioId);
  const visiveis = Object.fromEntries(Object.entries(respostas).filter(([k]) => campoVisivel(c.formulario.campos.find((x: any) => x.id === k), respostas)));
  c.respostas = visiveis; c.status = 'RESPONDIDO'; c.respondidoEm = agoraIso(); c.respondidoPor = usuarioId;
  for (const campo of c.formulario.campos)
    if (campo.tipo === 'FOTO') for (const id of visiveis[campo.id] ?? []) { const arq = org.arquivos.get(id); arq.usadoEm = agoraIso(); arq.checkinId = c.id; }
  const a = org.acompanhamentos.get(c.acompanhamentoId);
  // RN-ACO-005: regras avaliadas pelo backend; alertas são informativos.
  const alertas = (a.protocolo.regrasAlerta ?? []).filter((r: any) => r.tipo === 'RESPOSTA' && compara(visiveis[r.campo], r.operador, r.valor)).map((r: any) => criarAlerta(org, a, c, r));
  const equipe = equipeAtivaDe(org, a);
  emitir(org, 'acompanhamento.checkin.respondido', { checkinId: c.id, acompanhamentoId: a.id }, equipe);
  // RN-ACO-007
  if (temModulo(org, 'chat') && configModulo(org, 'acompanhamento').publicarCheckinNaConversa) {
    const conversa = org.conversas.get(a.conversaId);
    if (conversa && conversa.status === 'ATIVA')
      postarMensagem(org, conversa, { tipo: 'CHECKIN', autorId: usuarioId, referencia: { tipo: 'CHECKIN', id: c.id, resumo: resumoRespostas(c), temAlerta: alertas.length > 0 } });
  }
  for (const uid of [...equipe, ...contasIdsDoPaciente(org, a.pacienteId)]) avisarContadores(org)(uid);
  return c;
}
/** QUESTION-019: com `resolverAlertasAoEncerrar`, o fim do acompanhamento resolve os alertas abertos (autor = quem encerrou; null na conclusão automática). */
function resolverAlertasAoFinalizar(org: Org, a: any, porId: string | null, nota: string) {
  if (!configModulo(org, 'acompanhamento').resolverAlertasAoEncerrar) return;
  for (const al of org.alertas.values()) if (al.acompanhamentoId === a.id && al.status === 'ABERTO') resolverAlerta(org, al, porId, nota);
}
export function resolverAlerta(org: Org, alerta: any, porId: string | null, nota: string | null) {
  alerta.status = 'RESOLVIDO'; alerta.resolvidoEm = agoraIso(); alerta.resolvidoPor = porId; alerta.nota = nota ?? null;
  const a = org.acompanhamentos.get(alerta.acompanhamentoId);
  const equipe = equipeAtivaDe(org, a);
  emitir(org, 'acompanhamento.alerta.resolvido', { alertaId: alerta.id }, equipe);
  for (const uid of equipe) avisarContadores(org)(uid);
}

// Imagem PNG 8x8 de exemplo para as respostas "@foto" do seed.
function gerarPng(lado: number, rgb: [number, number, number]): Buffer {
  const crcTabela = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTabela[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (tipo: string, dados: Buffer) => { const t = Buffer.from(tipo); const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: lado }, () => rgb).flat())]);
  const bruto = Buffer.concat(Array.from({ length: lado }, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(bruto)), bloco('IEND', Buffer.alloc(0))]);
}
const PNG_EXEMPLO = gerarPng(64, [214, 160, 140]);
/** Arquivo de exemplo já processado, de qualquer finalidade (seed de resultados de exame). */
export function arquivoDeExemplo(org: Org, donoId: string, finalidade: string) {
  const id = novoId('arq');
  org.arquivos.set(id, { id, nome: 'resultado.png', tipo: 'image/png', tamanhoBytes: PNG_EXEMPLO.length, finalidade, status: 'DISPONIVEL', motivoRejeicao: null, criadoEm: agoraIso(), donoId, bytes: PNG_EXEMPLO });
  return id;
}
export function fotoDeExemplo(org: Org, donoId: string) {
  const id = novoId('arq');
  org.arquivos.set(id, { id, nome: 'foto.png', tipo: 'image/png', tamanhoBytes: PNG_EXEMPLO.length, finalidade: 'CHECKIN', status: 'DISPONIVEL', motivoRejeicao: null, criadoEm: agoraIso(), donoId, bytes: PNG_EXEMPLO });
  return id;
}

// ─────────── Manifesto e tela inicial ───────────
const ROTULOS_PERFIL: Record<Perfil, string> = { GESTOR: 'Gestão', PROFISSIONAL: 'Profissional', SECRETARIA: 'Secretaria', PACIENTE: 'Paciente' };

export function navegacao(ctx: Ctx) {
  const { org, perms } = ctx;
  const t = (k: string) => termo(org, k);
  const itens: any[] = [{ id: 'inicio', rotulo: 'Início', icone: 'house', grupo: 'PRINCIPAL', destino: { tela: 'inicio' } }];
  const animal = (configModulo(org, 'pacientes').relacoesPermitidas ?? []).every((r: string) => r === 'ANIMAL');
  const consulta = t('consulta') ?? { singular: 'consulta', plural: 'consultas', genero: 'F' };
  if (ehEquipe(ctx)) {
    if (perms.has('agenda.agendamento.ler')) itens.push({ id: 'agenda', rotulo: 'Agenda', icone: 'calendar', grupo: 'PRINCIPAL', destino: { tela: 'agenda.lista' } });
    if (perms.has('acompanhamento.acompanhamento.ler'))
      itens.push({ id: 'acompanhamentos', rotulo: cap(t('acompanhamento').plural), icone: 'activity', grupo: 'PRINCIPAL', destino: { tela: 'acompanhamento.lista' }, ...(perms.has('acompanhamento.alerta.ler') ? { contador: 'acompanhamento.alertasAbertos' } : {}) });
    if (perms.has('chat.conversa.ler')) itens.push({ id: 'conversas', rotulo: cap(t('conversa').plural), icone: 'message-circle', grupo: 'PRINCIPAL', destino: { tela: 'chat.lista' }, contador: 'chat.naoLidas' });
    if (perms.has('pacientes.paciente.ler')) itens.push({ id: 'pacientes', rotulo: cap(t('paciente').plural), icone: animal ? 'paw-print' : 'users', grupo: 'PRINCIPAL', destino: { tela: 'pacientes.lista' } });
    if (perms.has('exames.exame.ler')) itens.push({ id: 'exames', rotulo: cap(t('exame').plural), icone: 'flask-conical', grupo: 'PRINCIPAL', destino: { tela: 'exames.lista' }, ...(perms.has('exames.resultado.revisar') ? { contador: 'exames.resultadosParaRevisar' } : {}) });
    if (perms.has('documentos.documento.ler')) itens.push({ id: 'documentos', rotulo: 'Documentos', icone: 'file-pen-line', grupo: 'PRINCIPAL', destino: { tela: 'documentos.lista' }, ...(perms.has('documentos.documento.emitir') ? { contador: 'documentos.paraAssinar' } : {}) });
    if (perms.has('prontuario.copia.atender')) itens.push({ id: 'prontuario-copias', rotulo: 'Cópias de prontuário', icone: 'notebook-pen', grupo: 'SECUNDARIO', destino: { tela: 'prontuario.copias' }, contador: 'prontuario.copiasPendentes' });
    itens.push({ id: 'notificacoes', rotulo: 'Notificações', icone: 'bell', grupo: 'SECUNDARIO', destino: { tela: 'notificacoes' }, contador: 'notificacoes.naoLidas' });
    if (perms.has('acompanhamento.protocolo.ler')) itens.push({ id: 'protocolos', rotulo: cap(t('protocolo').plural), icone: 'clipboard-list', grupo: 'SECUNDARIO', destino: { tela: 'acompanhamento.protocolos' } });
    if (perms.has('agenda.configuracao.gerenciar')) itens.push({ id: 'agenda-servicos', rotulo: 'Serviços e horários', icone: 'calendar-clock', grupo: 'SECUNDARIO', destino: { tela: 'agenda.servicos' } });
    if (perms.has('equipe.membro.gerenciar')) itens.push({ id: 'equipe', rotulo: 'Equipe', icone: 'stethoscope', grupo: 'SECUNDARIO', destino: { tela: 'equipe.lista' } });
    if (perms.has('organizacao.configuracao.editar')) itens.push({ id: 'organizacao', rotulo: `Configurações ${flex(t('organizacao').genero, 'do', 'da')} ${t('organizacao').singular}`, icone: 'settings', grupo: 'SECUNDARIO', destino: { tela: 'organizacao.configuracao' } });
  } else {
    const a = t('acompanhamento');
    if (perms.has('acompanhamento.acompanhamento.ler')) itens.push({ id: 'meus-acompanhamentos', rotulo: `${flex(a.genero, 'Meu', 'Minha')} ${a.singular}`, icone: 'heart-pulse', grupo: 'PRINCIPAL', destino: { tela: 'acompanhamento.meus' }, contador: 'acompanhamento.checkinsPendentes' });
    if (perms.has('agenda.agendamento.ler')) itens.push({ id: 'minhas-consultas', rotulo: `${flex(consulta.genero, 'Meus', 'Minhas')} ${consulta.plural}`, icone: 'calendar', grupo: 'PRINCIPAL', destino: { tela: 'agenda.meus' } });
    if (perms.has('chat.conversa.ler')) itens.push({ id: 'conversas', rotulo: cap(t('conversa').plural), icone: 'message-circle', grupo: 'PRINCIPAL', destino: { tela: 'chat.lista' }, contador: 'chat.naoLidas' });
    // Exames depois de Conversas: na barra do celular (5 lugares), o chat é o canal principal do paciente.
    if (perms.has('exames.exame.ler')) itens.push({ id: 'meus-exames', rotulo: `${flex(t('exame').genero, 'Meus', 'Minhas')} ${t('exame').plural}`, icone: 'flask-conical', grupo: 'PRINCIPAL', destino: { tela: 'exames.meus' } });
    if (perms.has('prontuario.copia.solicitar')) itens.push({ id: 'minhas-copias', rotulo: 'Cópia do prontuário', icone: 'notebook-pen', grupo: 'SECUNDARIO', destino: { tela: 'prontuario.minhas-copias' } });
    if (perms.has('documentos.documento.ler')) itens.push({ id: 'meus-documentos', rotulo: 'Meus documentos', icone: 'file-pen-line', grupo: 'PRINCIPAL', destino: { tela: 'documentos.meus' } });
    itens.push({ id: 'notificacoes', rotulo: 'Notificações', icone: 'bell', grupo: 'PRINCIPAL', destino: { tela: 'notificacoes' }, contador: 'notificacoes.naoLidas' });
  }
  itens.push({ id: 'perfil', rotulo: 'Meu perfil', icone: 'user', grupo: ehEquipe(ctx) ? 'SECUNDARIO' : 'PRINCIPAL', destino: { tela: 'perfil' } });
  // No máximo 5 itens PRINCIPAL (barra inferior do celular): os últimos vão para "Mais", na ordem.
  const principais = itens.filter((i) => i.grupo === 'PRINCIPAL');
  for (const i of principais.slice(5)) i.grupo = 'SECUNDARIO';
  return itens;
}

export function pacientesVinculados(org: Org, u: Usuario) {
  return u.vinculos.filter((v) => org.pacientes.has(v.pacienteId)).map((v) => ({ id: v.pacienteId, nome: org.pacientes.get(v.pacienteId).nome, tipo: org.pacientes.get(v.pacienteId).tipo, relacao: v.relacao }));
}
export function serUsuario(org: Org, u: Usuario) {
  const foto = u.fotoArquivoId ? org.arquivos.get(u.fotoArquivoId) : null;
  return {
    id: u.id, nome: u.nome, nomeExibicao: u.nomeExibicao, email: u.email,
    fotoUrl: foto ? urlsArquivo(org, foto).urlMiniatura : null,
    preferencias: u.preferencias ?? { tema: 'SISTEMA', densidade: 'CONFORTAVEL' },
  };
}

export function manifesto(ctx: Ctx) {
  const { org, usuario: u } = ctx;
  return {
    contrato: { versao: org.cenario.__versaoContrato },
    organizacao: { id: org.id, slug: org.slug, nome: org.config.nome, fuso: org.config.fuso, locale: org.config.locale, contato: org.config.contato },
    usuario: serUsuario(org, u),
    perfilAtivo: ctx.perfil,
    perfisDisponiveis: PRIORIDADE_PERFIL.filter((p) => u.perfis.includes(p)).map((p) => ({ id: p, rotulo: u.rotulosPerfis?.[p] ?? ROTULOS_PERFIL[p] })),
    termos: org.termos,
    modulos: org.modulos,
    navegacao: navegacao(ctx),
    permissoes: [...ctx.perms],
    // Assinatura só para quem emite (ADR-0018): provedores vazios = não há como assinar.
    capacidades: temModulo(org, 'documentos') && ctx.perms.has('documentos.documento.emitir') ? { ...org.capacidades, assinatura: { provedores: documentos.provedores(org) } } : org.capacidades,
    contadores: contadores(org, u),
    ...(ctx.perfil === 'PACIENTE' ? { pacientesVinculados: pacientesVinculados(org, u) } : {}),
  };
}

export function telaInicial(ctx: Ctx) {
  const { org, usuario: u } = ctx;
  const secoes: any[] = [];
  const hoje = hojeLocal(org.config.fuso);
  if (org.config.avisoInicio) secoes.push({ id: 'aviso', tipo: 'AVISO', dados: org.config.avisoInicio });
  secoes.push(...agenda.secoesInicio(ctx));
  secoes.push(...exames.secoesInicio(ctx));
  secoes.push(...documentos.secoesInicio(ctx));
  secoes.push(...prontuario.secoesInicio(ctx));
  if (ehEquipe(ctx)) {
    if (temModulo(org, 'acompanhamento') && ctx.perms.has('acompanhamento.alerta.ler')) {
      const ordem: Record<string, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
      const abertos = [...org.alertas.values()].filter((a) => a.status === 'ABERTO').sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || b.criadoEm.localeCompare(a.criadoEm));
      secoes.push({ id: 'alertas', tipo: 'ALERTAS_ABERTOS', dados: { total: abertos.length, itens: abertos.slice(0, 5).map((a) => serAlerta(ctx, a)) } });
    }
    if (temModulo(org, 'acompanhamento') && ctx.perms.has('acompanhamento.checkin.ler')) {
      const doDia = [...org.checkins.values()].filter((c) => partesLocais(Date.parse(c.disponivelEm), org.config.fuso).data === hoje && c.status !== 'CANCELADO');
      secoes.push({ id: 'checkins-hoje', tipo: 'CHECKINS_DO_DIA', dados: {
        data: hoje, respondidos: doDia.filter((c) => c.status === 'RESPONDIDO').length,
        pendentes: doDia.filter((c) => c.status === 'DISPONIVEL' || c.status === 'AGENDADO').length,
        expirados: doDia.filter((c) => c.status === 'EXPIRADO').length,
        itens: doDia.sort((a, b) => a.disponivelEm.localeCompare(b.disponivelEm)).map((c) => resumoCheckin(org, c)),
      } });
    }
    if (temModulo(org, 'acompanhamento') && ctx.perms.has('acompanhamento.acompanhamento.ler')) {
      const ativos = [...org.acompanhamentos.values()].filter((a) => a.status === 'ATIVO').sort((a, b) => b.dataInicio.localeCompare(a.dataInicio));
      secoes.push({ id: 'acompanhamentos-ativos', tipo: 'ACOMPANHAMENTOS_ATIVOS', dados: { total: ativos.length, itens: ativos.slice(0, 5).map((a) => serAcompanhamento(ctx, a)) } });
    }
  } else if (temModulo(org, 'acompanhamento')) {
    const meus = pacientesDaConta(u);
    for (const a of [...org.acompanhamentos.values()].filter((x) => meus.has(x.pacienteId) && (x.status === 'ATIVO' || x.status === 'AGENDADO'))) {
      const dia = diaAtual(org, a);
      const prox = proximoCheckin(org, a.id);
      const orientacao = (a.protocolo.orientacoes ?? []).filter((o: any) => o.dia === dia).map((o: any) => o.texto).join(' ') || null;
      const varios = meus.size > 1;
      secoes.push({ id: `acompanhamento-atual-${a.id}`, tipo: 'ACOMPANHAMENTO_ATUAL', ...(varios ? { titulo: org.pacientes.get(a.pacienteId).nome } : {}), dados: {
        acompanhamentoId: a.id, pacienteId: a.pacienteId, titulo: a.protocolo.nome, diaAtual: dia, totalDias: a.protocolo.duracaoDias,
        status: a.status, proximoCheckin: prox ? resumoCheckin(org, prox) : null, orientacaoDoDia: orientacao,
      } });
    }
    const pendentes = [...org.checkins.values()].filter((c) => meus.has(c.pacienteId) && c.status === 'DISPONIVEL');
    secoes.push({ id: 'checkins-pendentes', tipo: 'CHECKINS_PENDENTES', dados: { itens: pendentes.map((c) => resumoCheckin(org, c)) } });
  }
  if (temModulo(org, 'chat') && ctx.perms.has('chat.conversa.ler')) {
    const conversas = [...org.conversas.values()].filter((c) => c.status === 'ATIVA' && participa(c, u.id))
      .map((c) => serConversa(ctx, c)).sort((a, b) => (b.ultimaMensagem?.enviadoEm ?? b.criadoEm).localeCompare(a.ultimaMensagem?.enviadoEm ?? a.criadoEm));
    secoes.push({ id: 'conversas-recentes', tipo: 'CONVERSAS_RECENTES', dados: { itens: conversas.slice(0, 5) } });
  }
  if (ehEquipe(ctx)) {
    const atalhos: any[] = [];
    if (ctx.perms.has('pacientes.paciente.criar')) atalhos.push({ rotulo: `${flex(termo(org, 'paciente').genero, 'Novo', 'Nova')} ${termo(org, 'paciente').singular}`, icone: 'user-plus', destino: { tela: 'pacientes.novo' } });
    if (temModulo(org, 'agenda') && ctx.perms.has('agenda.agendamento.criar')) { const c = termo(org, 'consulta') ?? { singular: 'consulta', genero: 'F' }; atalhos.push({ rotulo: `${flex(c.genero, 'Novo', 'Nova')} ${c.singular}`, icone: 'calendar-plus', destino: { tela: 'agenda.novo' } }); }
    if (ctx.perms.has('acompanhamento.acompanhamento.criar')) atalhos.push({ rotulo: `${flex(termo(org, 'acompanhamento').genero, 'Novo', 'Nova')} ${termo(org, 'acompanhamento').singular}`, icone: 'activity', destino: { tela: 'acompanhamento.novo' } });
    if (atalhos.length) secoes.push({ id: 'atalhos', tipo: 'ATALHOS', dados: { itens: atalhos } });
  } else {
    secoes.push({ id: 'contato', tipo: 'CONTATO_ORGANIZACAO', dados: { telefone: org.config.contato.telefone, endereco: org.config.contato.endereco, mapaUrl: org.config.mapaUrl ?? null } });
  }
  return { secoes };
}
