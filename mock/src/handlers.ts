// Handlers por operationId. Cada um recebe a requisição já validada contra o contrato e devolve
// { status, body, headers }. A resposta é validada de novo contra o contrato no servidor.
import { createHash } from 'node:crypto';
import * as auth from './auth.ts';
import { emitir, enviarEmail, ErroApi, eventoPublico, invalido, naoEncontrado, negado, novoId, tokenAleatorio, type Org, type Usuario } from './estado.ts';
import * as r from './regras.ts';
import { type Ctx } from './regras.ts';
import { agoraIso, agoraMs, DIA, HORA, iso, MINUTO, partesLocais } from './tempo.ts';

export interface Req {
  org: Org; ctx: Ctx | null; params: Record<string, string>; query: Record<string, any>; body: any;
  headers: Record<string, any>; ip: string; nativo: boolean; cookieRenovacao?: string;
}
export interface Res { status: number; body?: any; headers?: Record<string, string>; cookie?: string }
type Handler = (q: Req) => Res;
const ok = (body: any, headers?: Record<string, string>): Res => ({ status: 200, body, headers });
const criado = (body: any, headers?: Record<string, string>): Res => ({ status: 201, body, headers });
const vazio = (status = 204): Res => ({ status });
const C = (q: Req) => q.ctx!;
export const URL_FRONTEND = (process.env.MOCK_URL_FRONTEND ?? 'http://localhost:5173').replace(/\/$/, '');
const linkConvite = (org: Org, token: string) => `${URL_FRONTEND}/convite/${token}?org=${org.slug}`;

// ─────────── Pacientes ───────────
function validarPaciente(org: Org, p: any) {
  const contatos = [p.contato?.email, p.contato?.celular, ...(p.responsaveis ?? []).flatMap((x: any) => [x.contato?.email, x.contato?.celular])];
  if (!contatos.some(Boolean)) throw invalido('contato', 'Informe ao menos um e-mail ou celular (do paciente ou de um responsável).', 'OBRIGATORIO');
  const relacoes: string[] = r.configModulo(org, 'pacientes').relacoesPermitidas ?? [];
  if (p.tipo === 'ANIMAL' && !relacoes.includes('ANIMAL')) throw invalido('tipo', 'Esta organização não atende animais.');
  if (p.tipo === 'PESSOA' && !relacoes.some((x) => x !== 'ANIMAL')) throw invalido('tipo', 'Esta organização atende apenas animais.');
  if (p.tipo === 'ANIMAL' && !(p.responsaveis ?? []).length) throw invalido('responsaveis', 'Informe o tutor.', 'OBRIGATORIO');
  const formId = r.configModulo(org, 'pacientes').formularioCadastroId;
  const form = formId ? r.obterFormularioVersao(org, formId) : null;
  if (form) r.validarRespostas(org, form, p.camposAdicionais ?? {}, '', 'camposAdicionais');
  else if (Object.keys(p.camposAdicionais ?? {}).length) throw invalido('camposAdicionais', 'Esta organização não usa campos adicionais.');
}
const ordenarPorNome = <T extends { nome: string }>(xs: T[]) => xs.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
function pacientesVisiveis(ctx: Ctx) {
  r.exigirModulo(ctx.org, 'pacientes');
  r.exigir(ctx, 'pacientes.paciente.ler');
  const todos = [...ctx.org.pacientes.values()];
  return r.ehEquipe(ctx) ? todos : todos.filter((p) => r.pacientesDaConta(ctx.usuario).has(p.id));
}
const etagPaciente = (p: any) => r.etag(p.id, p._v);

// ─────────── Conversas ───────────
function conversasVisiveis(ctx: Ctx) {
  r.exigirModulo(ctx.org, 'chat');
  r.exigir(ctx, 'chat.conversa.ler');
  return [...ctx.org.conversas.values()].filter((c) => r.participa(c, ctx.usuario.id));
}
const ordenarConversas = (xs: any[]) => xs.sort((a, b) => (b.ultimaMensagem?.enviadoEm ?? b.criadoEm).localeCompare(a.ultimaMensagem?.enviadoEm ?? a.criadoEm));

// ─────────── Formulários e protocolos ───────────
function validarFormulario(f: any) {
  const ids = new Set<string>();
  f.campos.forEach((c: any, i: number) => {
    if (ids.has(c.id)) throw invalido(`campos.${i}.id`, 'Identificador repetido.');
    if (c.visivelSe && !ids.has(c.visivelSe.campo)) throw invalido(`campos.${i}.visivelSe.campo`, 'A condição deve citar um campo anterior.');
    if (c.opcoes && new Set(c.opcoes.map((o: any) => o.valor)).size !== c.opcoes.length) throw invalido(`campos.${i}.opcoes`, 'Valores de opção repetidos.');
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) throw invalido(`campos.${i}.min`, 'min maior que max.');
    ids.add(c.id);
  });
}
function validarProtocolo(org: Org, p: any) {
  const campos = new Set<string>();
  p.checkins.forEach((ck: any, i: number) => {
    const f = r.obterFormularioVersao(org, ck.formulario.id, ck.formulario.versao);
    if (!f) throw invalido(`checkins.${i}.formulario`, 'Formulário ou versão inexistente.');
    if (f.finalidade === 'CADASTRO') throw invalido(`checkins.${i}.formulario`, 'Use um formulário de check-in.');
    if (ck.dias.some((d: number) => d > p.duracaoDias)) throw invalido(`checkins.${i}.dias`, 'Dia além da duração do protocolo.');
    f.campos.forEach((c: any) => campos.add(c.id));
  });
  (p.orientacoes ?? []).forEach((o: any, i: number) => { if (o.dia > p.duracaoDias) throw invalido(`orientacoes.${i}.dia`, 'Dia além da duração do protocolo.'); });
  (p.regrasAlerta ?? []).forEach((ra: any, i: number) => {
    if (ra.tipo === 'RESPOSTA' && !campos.has(ra.campo)) throw invalido(`regrasAlerta.${i}.campo`, 'Campo não existe nos formulários do protocolo.');
  });
  if (new Set((p.regrasAlerta ?? []).map((x: any) => x.id)).size !== (p.regrasAlerta ?? []).length) throw invalido('regrasAlerta', 'Identificadores repetidos.');
}

// ─────────── Membros ───────────
const membros = (org: Org) => [...org.usuarios.values()].filter((u) => r.usuarioEhEquipe(u));
function obterMembro(ctx: Ctx, id: string) {
  r.exigirModulo(ctx.org, 'equipe');
  r.exigir(ctx, 'equipe.membro.ler');
  const u = ctx.org.usuarios.get(id);
  if (!u || !r.usuarioEhEquipe(u)) throw naoEncontrado('Membro');
  return u;
}
function orgConfig(ctx: Ctx) {
  const o = ctx.org.config;
  const chat = r.configModulo(ctx.org, 'chat');
  return {
    nome: o.nome, contato: o.contato, tema: { corMarca: o.tema.corMarca, logoUrl: o.tema.logoUrl ?? null }, textos: o.textos,
    chat: { horarioAtendimento: chat.horarioAtendimento ?? [], mensagemForaDoHorario: chat.mensagemForaDoHorario ?? null, avisoUrgencia: chat.avisoUrgencia ?? null },
    acoesPermitidas: ctx.perms.has('organizacao.configuracao.editar') ? ['EDITAR'] : [],
  };
}
const etagOrg = (org: Org) => r.etag(org.id, org._vConfig);
const avisarManifesto = (org: Org) => emitir(org, 'sessao.manifesto.alterado', {}, [...org.usuarios.values()].filter((u) => u.status === 'ATIVO').map((u) => u.id));

function obterArquivoProprio(ctx: Ctx, id: string) {
  const a = ctx.org.arquivos.get(id);
  if (!a || !r.podeVerArquivo(ctx, a)) throw naoEncontrado('Arquivo');
  return a;
}

// Assinaturas de tipo de arquivo (magic bytes).
const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};

export const handlers: Record<string, Handler> = {
  // ─────────── Público ───────────
  publicoObterConfiguracao: (q) => {
    const o = q.org.config;
    const corpo = {
      contrato: { versao: q.org.cenario.__versaoContrato }, status: o.status, mensagemStatus: o.mensagemStatus ?? null,
      frontend: { versaoMinima: o.versaoMinimaFrontend ?? '0.1.0' },
      organizacao: { slug: o.slug, nome: o.nome, fuso: o.fuso, locale: o.locale },
      tema: o.tema, pwa: o.pwa, autenticacao: o.autenticacao, textos: o.textos, links: o.links,
    };
    const etag = `"cfg-${createHash('sha1').update(JSON.stringify(corpo)).digest('hex').slice(0, 16)}"`;
    if (q.headers['if-none-match'] === etag) return { status: 304, headers: { ETag: etag } };
    return ok(corpo, { ETag: etag, 'Cache-Control': 'max-age=300' });
  },
  publicoObterConvite: (q) => ok(auth.conviteParcial(q.org, q.params.token)),
  publicoObterSaude: (q) => ok({ status: 'OK', contrato: { versao: q.org.cenario.__versaoContrato }, agora: agoraIso() }),

  // ─────────── Auth ───────────
  authEntrar: (q) => auth.entrar(q.org, q.body, q.ip, q.nativo),
  authSolicitarCodigo: (q) => auth.solicitarCodigo(q.org, q.body, q.ip),
  authVerificarCodigo: (q) => auth.verificarCodigo(q.org, q.body, q.nativo),
  authAceitarConvite: (q) => auth.aceitarConvite(q.org, q.params.token, q.body, q.nativo),
  authVerificarMfa: (q) => auth.verificarMfa(q.org, q.body),
  authIniciarTotp: (q) => auth.iniciarTotp(q.org, q.body),
  authConfirmarTotp: (q) => auth.confirmarTotp(q.org, q.body),
  authTrocarSenha: (q) => auth.trocarSenha(q.org, q.body),
  authAceitarTermos: (q) => auth.aceitarTermos(q.org, q.body),
  authEsqueciSenha: (q) => auth.esqueciSenha(q.org, q.body, q.ip),
  authRedefinirSenha: (q) => auth.redefinirSenha(q.org, q.body),
  authRenovar: (q) => auth.renovar(q.org, q.cookieRenovacao, q.body, q.nativo),
  authSair: (q) => auth.sair(C(q), q.body),

  // ─────────── Sessão e conta ───────────
  sessaoObterManifesto: (q) => {
    const m = r.manifesto(C(q));
    const etag = `"man-${createHash('sha1').update(JSON.stringify(m)).digest('hex').slice(0, 16)}"`;
    if (q.headers['if-none-match'] === etag) return { status: 304, headers: { ETag: etag } };
    return ok(m, { ETag: etag });
  },
  sessaoTrocarPerfil: (q) => auth.trocarPerfil(C(q), q.body, q.nativo),
  sessaoObterContadores: (q) => ok(r.contadores(q.org, C(q).usuario)),
  contaObter: (q) => {
    const u = C(q).usuario;
    return ok({ ...r.serUsuario(q.org, u), perfis: u.perfis, pacientesVinculados: r.pacientesVinculados(q.org, u) }, { ETag: r.etag(u.id, u._v) });
  },
  contaEditar: (q) => {
    const u = C(q).usuario;
    r.conferirIfMatch(q.headers['if-match'], u.id, u._v, () => handlers.contaObter(q).body);
    if (q.body.fotoArquivoId) {
      const a = q.org.arquivos.get(q.body.fotoArquivoId);
      if (!a || a.donoId !== u.id || a.status !== 'DISPONIVEL' || a.finalidade !== 'PERFIL') throw invalido('fotoArquivoId', 'Envie uma foto de perfil válida.');
    }
    if (q.body.nomeExibicao !== undefined) u.nomeExibicao = q.body.nomeExibicao;
    if (q.body.fotoArquivoId !== undefined) u.fotoArquivoId = q.body.fotoArquivoId;
    if (q.body.preferencias) u.preferencias = { ...u.preferencias, ...q.body.preferencias };
    u._v++;
    emitir(q.org, 'sessao.manifesto.alterado', {}, [u.id]);
    return handlers.contaObter(q);
  },
  contaSolicitarExclusao: (q) => {
    const ctx = C(q);
    if (r.usuarioEhEquipe(ctx.usuario)) throw negado('Membros da equipe são desligados pelo gestor da organização.');
    ctx.usuario.status = 'DESLIGADO';
    for (const c of q.org.conversas.values()) { const p = c.participantes.find((x: any) => x.usuarioId === ctx.usuario.id); if (p) p.removidoEm = agoraIso(); }
    for (const i of [...q.org.inscricoesPush.values()]) if (i.usuarioId === ctx.usuario.id) q.org.inscricoesPush.delete(i.id);
    auth.revogarSessoesDoUsuario(q.org, ctx.usuario.id, 'CONTA_EXCLUIDA');
    return { status: 202, body: {
      mensagem: `Seu acesso ao app foi removido. ${q.org.config.nome} continua responsável pelos registros de atendimento, que a lei obriga a guardar.`,
      dadosRetidos: ['Check-ins respondidos e alertas', 'Histórico das conversas com a equipe', 'Fotos enviadas nos check-ins e conversas'],
    } };
  },
  inicioObter: (q) => ok(r.telaInicial(C(q))),

  // ─────────── Notificações ───────────
  notificacoesListar: (q) => {
    let lista = q.org.notificacoes.get(C(q).usuario.id) ?? [];
    if (q.query.naoLidas === true) lista = lista.filter((n) => !n.lidoEm);
    if (q.query.naoLidas === false) lista = lista.filter((n) => n.lidoEm);
    const p = r.paginar(lista, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map(({ _agrupar, ...n }: any) => n) });
  },
  notificacoesMarcarLidas: (q) => {
    const lista = q.org.notificacoes.get(C(q).usuario.id) ?? [];
    const ids = new Set(q.body.ids ?? []);
    for (const n of lista) if (!n.lidoEm && (q.body.todas || ids.has(n.id))) n.lidoEm = agoraIso();
    r.avisarContadores(q.org)(C(q).usuario.id);
    return vazio();
  },
  notificacoesObterPreferencias: (q) => {
    const u = C(q).usuario;
    const tipos = ['CHAT_MENSAGEM', 'CHECKIN_DISPONIVEL', 'CHECKIN_LEMBRETE', 'ALERTA_CRIADO', 'ACOMPANHAMENTO_INICIADO', 'ACOMPANHAMENTO_CONCLUIDO', 'CONVITE_ACEITO', 'SISTEMA'];
    return ok({ itens: tipos.map((tipo) => ({ tipo, ...(u.preferenciasNotificacao[tipo] ?? { push: true, email: true }) })) });
  },
  notificacoesSalvarPreferencias: (q) => {
    const u = C(q).usuario;
    for (const i of q.body.itens) u.preferenciasNotificacao[i.tipo] = { push: i.push, email: i.email };
    return handlers.notificacoesObterPreferencias(q);
  },
  pushInscrever: (q) => {
    const u = C(q).usuario;
    const existente = [...q.org.inscricoesPush.values()].find((i) => i.endpoint === q.body.inscricao.endpoint);
    if (existente) q.org.inscricoesPush.delete(existente.id);
    const i = { id: novoId('psi'), usuarioId: u.id, endpoint: q.body.inscricao.endpoint, keys: q.body.inscricao.keys, dispositivo: q.body.dispositivo ?? null, criadoEm: agoraIso() };
    q.org.inscricoesPush.set(i.id, i);
    return criado({ id: i.id, dispositivo: i.dispositivo, criadoEm: i.criadoEm });
  },
  pushRemoverInscricao: (q) => {
    const i = q.org.inscricoesPush.get(q.params.inscricaoId);
    if (!i || i.usuarioId !== C(q).usuario.id) throw naoEncontrado('Inscrição');
    q.org.inscricoesPush.delete(i.id);
    return vazio();
  },

  // ─────────── Arquivos ───────────
  arquivosIniciarEnvio: (q) => {
    const cap = q.org.capacidades.upload;
    if (!cap.tiposPermitidos.includes(q.body.tipo)) throw new ErroApi('TIPO_ARQUIVO_NAO_PERMITIDO', `Envie ${cap.tiposPermitidos.join(', ')}.`);
    if (q.body.tamanhoBytes > cap.tamanhoMaximoBytes) throw new ErroApi('ARQUIVO_MUITO_GRANDE', `O limite é ${Math.floor(cap.tamanhoMaximoBytes / 1048576)} MB.`);
    if (q.body.finalidade === 'ORGANIZACAO') r.exigir(C(q), 'organizacao.configuracao.editar');
    const id = novoId('arq');
    const expira = agoraMs() + 15 * MINUTO;
    q.org.arquivos.set(id, { id, nome: q.body.nome, tipo: q.body.tipo, tamanhoBytes: q.body.tamanhoBytes, finalidade: q.body.finalidade, status: 'AGUARDANDO_ENVIO', motivoRejeicao: null, criadoEm: agoraIso(), donoId: C(q).usuario.id, bytes: null, assinatura: tokenAleatorio(12) });
    return criado({ arquivoId: id, envio: { url: `${r.BASE_PUBLICA}/__mock/envios/${q.org.slug}/${id}?assinatura=${q.org.arquivos.get(id).assinatura}&exp=${expira}`, metodo: 'PUT', cabecalhos: { 'Content-Type': q.body.tipo } }, expiraEm: iso(expira) });
  },
  arquivosConcluirEnvio: (q) => {
    const a = q.org.arquivos.get(q.params.arquivoId);
    if (!a || a.donoId !== C(q).usuario.id) throw naoEncontrado('Arquivo');
    if (a.status !== 'AGUARDANDO_ENVIO') return ok(r.serArquivo(q.org, a));
    a.status = 'PROCESSANDO';
    const org = q.org;
    setTimeout(() => {
      // Simula validação: bytes recebidos, tamanho declarado e assinatura do tipo (magic bytes).
      // No backend real: recodificar a imagem e remover EXIF.
      if (!a.bytes) { a.status = 'REJEITADO'; a.motivoRejeicao = 'Arquivo não recebido.'; }
      else if (a.bytes.length > org.capacidades.upload.tamanhoMaximoBytes) { a.status = 'REJEITADO'; a.motivoRejeicao = 'Arquivo maior que o permitido.'; }
      else if (!ASSINATURAS[a.tipo]?.(a.bytes)) { a.status = 'REJEITADO'; a.motivoRejeicao = 'O conteúdo não corresponde ao tipo informado.'; }
      else { a.status = 'DISPONIVEL'; a.tamanhoBytes = a.bytes.length; }
      emitir(org, 'arquivo.processado', { arquivoId: a.id, status: a.status }, [a.donoId]);
    }, 150);
    return ok(r.serArquivo(q.org, a));
  },
  arquivosObter: (q) => ok(r.serArquivo(q.org, obterArquivoProprio(C(q), q.params.arquivoId))),

  // ─────────── Eventos ───────────
  eventosListar: (q) => {
    const u = C(q).usuario.id;
    const meus = q.org.eventos.filter((e) => e.para.has(u));
    const ultimo = q.org.eventos.length ? q.org.eventos[q.org.eventos.length - 1].id : null;
    if (!q.query.depois) return ok({ itens: [], ultimoEventoId: ultimo });
    const seq = Number(String(q.query.depois).replace(/^evt_/, ''));
    const maisAntigo = q.org.eventos[0]?.seq ?? q.org.seqEvento + 1;
    if (!Number.isFinite(seq) || seq > q.org.seqEvento || (seq < maisAntigo - 1 && q.org.eventos.length)) throw new ErroApi('CURSOR_EXPIRADO', 'Recarregue as listas.');
    const itens = meus.filter((e) => e.seq > seq).slice(0, q.query.limite ?? 100);
    return ok({ itens: itens.map(eventoPublico), ultimoEventoId: itens.length ? itens[itens.length - 1].id : String(q.query.depois) });
  },

  // ─────────── Pacientes ───────────
  pacientesListar: (q) => {
    let lista = pacientesVisiveis(C(q));
    if (q.query.status) lista = lista.filter((p) => p.status === q.query.status);
    const p = r.paginar(ordenarPorNome(lista), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((x) => r.serPaciente(C(q), x)) });
  },
  pacientesBuscar: (q) => {
    const t = r.normalizar(q.body.texto);
    const digitos = q.body.texto.replace(/\D/g, '');
    const lista = pacientesVisiveis(C(q)).filter((p) =>
      r.normalizar(p.nome).includes(t) || r.normalizar(p.nomeSocial).includes(t) || r.normalizar(p.contato?.email).includes(t) ||
      (digitos.length >= 4 && (p.contato?.celular ?? '').includes(digitos)) ||
      (p.responsaveis ?? []).some((x: any) => r.normalizar(x.nome).includes(t)));
    const p = r.paginar(ordenarPorNome(lista), q.body.cursor, q.body.limite);
    return ok({ ...p, itens: p.itens.map((x) => r.serPaciente(C(q), x)) });
  },
  pacientesCriar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'pacientes');
    r.exigir(ctx, 'pacientes.paciente.criar');
    validarPaciente(q.org, q.body);
    const p = { ...q.body, id: novoId('pac'), nomeSocial: q.body.nomeSocial ?? null, dataNascimento: q.body.dataNascimento ?? null, camposAdicionais: q.body.camposAdicionais ?? {}, responsaveis: q.body.responsaveis ?? [], status: 'ATIVO', criadoEm: agoraIso(), _v: 1 };
    q.org.pacientes.set(p.id, p);
    return criado(r.serPaciente(ctx, p), { ETag: etagPaciente(p) });
  },
  pacientesObter: (q) => {
    const p = r.obterPaciente(C(q), q.params.pacienteId);
    return ok(r.serPaciente(C(q), p), { ETag: etagPaciente(p) });
  },
  pacientesEditar: (q) => {
    const ctx = C(q);
    const p = r.obterPaciente(ctx, q.params.pacienteId);
    r.exigir(ctx, 'pacientes.paciente.editar');
    r.conferirIfMatch(q.headers['if-match'], p.id, p._v, () => r.serPaciente(ctx, p));
    const novo = { ...p, ...q.body };
    validarPaciente(q.org, novo);
    Object.assign(p, q.body);
    p._v++;
    return ok(r.serPaciente(ctx, p), { ETag: etagPaciente(p) });
  },
  pacientesConvidar: (q) => {
    const ctx = C(q);
    const p = r.obterPaciente(ctx, q.params.pacienteId);
    r.exigir(ctx, 'pacientes.paciente.convidar');
    if (p.status !== 'ATIVO') throw invalido('status', 'Reative o paciente antes de convidar.');
    const email = q.body.email ?? p.contato?.email ?? p.responsaveis?.find((x: any) => x.contato?.email)?.contato.email ?? null;
    if (q.body.enviarEmail && !email) throw invalido('email', 'Informe um e-mail para enviar o convite.', 'OBRIGATORIO');
    const deResponsavel = (p.responsaveis ?? []).find((x: any) => x.contato?.email && x.contato.email === email);
    const relacao = p.tipo === 'ANIMAL' ? 'ANIMAL' : deResponsavel || (p.responsaveis?.length && email !== p.contato?.email) ? 'DEPENDENTE' : 'PROPRIO';
    if (!(r.configModulo(q.org, 'pacientes').relacoesPermitidas ?? []).includes(relacao)) throw invalido('email', `Vínculo ${relacao} não permitido nesta organização.`);
    for (const c of q.org.convites.values()) if (c.pacienteId === p.id && !c.usadoEm) c.revogadoEm = agoraIso();
    const token = tokenAleatorio(18);
    const c = { id: novoId('cnt'), token, tipo: 'PACIENTE', pacienteId: p.id, email, relacao, nome: p.nome, nomeConta: deResponsavel?.nome ?? p.nome, criadoPor: ctx.usuario.id, criadoEm: agoraIso(), expiraEm: iso(agoraMs() + 7 * DIA), usadoEm: null };
    q.org.convites.set(token, c);
    const link = linkConvite(q.org, token);
    if (q.body.enviarEmail) enviarEmail(q.org, email, `Convite — ${q.org.config.nome}`, `Você foi convidado para o app da ${q.org.config.nome}. Acesse: ${link}`);
    return criado({ id: c.id, token, link, conteudoQr: link, expiraEm: c.expiraEm, emailEnviado: !!q.body.enviarEmail });
  },

  // ─────────── Formulários ───────────
  formulariosListar: (q) => {
    r.exigir(C(q), 'acompanhamento.protocolo.ler');
    const lista = [...q.org.formularios.values()].map((v) => r.ultimaVersao(v)!);
    const p = r.paginar(lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR')), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((f) => r.serFormulario(C(q), f)) });
  },
  formulariosCriar: (q) => {
    r.exigir(C(q), 'acompanhamento.protocolo.gerenciar');
    validarFormulario(q.body);
    const f = { id: novoId('frm'), versao: 1, finalidade: 'CHECKIN', ...q.body, publicadoEm: agoraIso(), _v: 1 };
    q.org.formularios.set(f.id, [f]);
    return criado(r.serFormulario(C(q), f), { ETag: r.etag(f.id, f.versao) });
  },
  formulariosObter: (q) => {
    if (!r.ehEquipe(C(q))) throw naoEncontrado('Formulário');
    const f = r.obterFormularioVersao(q.org, q.params.formularioId, q.query.versao);
    if (!f) throw naoEncontrado('Formulário');
    return ok(r.serFormulario(C(q), f), { ETag: r.etag(f.id, r.ultimaVersao(q.org.formularios.get(f.id))!.versao) });
  },
  formulariosPublicarVersao: (q) => {
    r.exigir(C(q), 'acompanhamento.protocolo.gerenciar');
    const versoes = q.org.formularios.get(q.params.formularioId);
    if (!versoes) throw naoEncontrado('Formulário');
    const atual = r.ultimaVersao(versoes)!;
    r.conferirIfMatch(q.headers['if-match'], atual.id, atual.versao, () => r.serFormulario(C(q), atual));
    validarFormulario(q.body);
    const f = { finalidade: atual.finalidade, ...q.body, id: atual.id, versao: atual.versao + 1, publicadoEm: agoraIso() }; // RN-FRM-001
    versoes.push(f);
    return ok(r.serFormulario(C(q), f), { ETag: r.etag(f.id, f.versao) });
  },

  // ─────────── Protocolos ───────────
  protocolosListar: (q) => {
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(C(q), 'acompanhamento.protocolo.ler');
    let lista = [...q.org.protocolos.values()].map((v) => r.ultimaVersao(v)!);
    if (q.query.status) lista = lista.filter((p) => p.status === q.query.status);
    const p = r.paginar(ordenarPorNome(lista), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((x) => r.serProtocolo(C(q), x)) });
  },
  protocolosCriar: (q) => {
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(C(q), 'acompanhamento.protocolo.gerenciar');
    validarProtocolo(q.org, q.body);
    const p = { descricao: null, orientacoes: [], regrasAlerta: [], ...q.body, id: novoId('prt'), versao: 1, status: 'ATIVO' };
    q.org.protocolos.set(p.id, [p]);
    return criado(r.serProtocolo(C(q), p), { ETag: r.etag(p.id, 1) });
  },
  protocolosObter: (q) => {
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(C(q), 'acompanhamento.protocolo.ler', true);
    const p = r.obterProtocoloVersao(q.org, q.params.protocoloId, q.query.versao);
    if (!p) throw naoEncontrado('Protocolo');
    return ok(r.serProtocolo(C(q), p), { ETag: r.etag(p.id, r.ultimaVersao(q.org.protocolos.get(p.id))!.versao) });
  },
  protocolosPublicarVersao: (q) => {
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(C(q), 'acompanhamento.protocolo.gerenciar');
    const versoes = q.org.protocolos.get(q.params.protocoloId);
    if (!versoes) throw naoEncontrado('Protocolo');
    const atual = r.ultimaVersao(versoes)!;
    r.conferirIfMatch(q.headers['if-match'], atual.id, atual.versao, () => r.serProtocolo(C(q), atual));
    validarProtocolo(q.org, q.body);
    const p = { descricao: null, orientacoes: [], regrasAlerta: [], ...q.body, id: atual.id, versao: atual.versao + 1, status: atual.status };
    versoes.push(p); // RN-ACO-003: acompanhamentos em andamento mantêm a versão antiga
    return ok(r.serProtocolo(C(q), p), { ETag: r.etag(p.id, p.versao) });
  },
  protocolosArquivar: (q) => {
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(C(q), 'acompanhamento.protocolo.gerenciar');
    const versoes = q.org.protocolos.get(q.params.protocoloId);
    if (!versoes) throw naoEncontrado('Protocolo');
    for (const v of versoes) v.status = 'ARQUIVADO';
    return ok(r.serProtocolo(C(q), r.ultimaVersao(versoes)));
  },

  // ─────────── Acompanhamentos ───────────
  acompanhamentosListar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(ctx, 'acompanhamento.acompanhamento.ler');
    let lista = [...q.org.acompanhamentos.values()].filter((a) => r.podeVerPaciente(ctx, a.pacienteId));
    if (q.query.status) lista = lista.filter((a) => a.status === q.query.status);
    if (q.query.pacienteId) lista = lista.filter((a) => a.pacienteId === q.query.pacienteId);
    if (q.query.profissionalId) lista = lista.filter((a) => a.equipeIds.includes(q.query.profissionalId));
    if (q.query.comAlertaAberto !== undefined) {
      const com = new Set([...q.org.alertas.values()].filter((x) => x.status === 'ABERTO').map((x) => x.acompanhamentoId));
      lista = lista.filter((a) => com.has(a.id) === q.query.comAlertaAberto);
    }
    lista.sort((a, b) => b.dataInicio.localeCompare(a.dataInicio) || b.criadoEm.localeCompare(a.criadoEm));
    const p = r.paginar(lista, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((a) => r.serAcompanhamento(ctx, a)) });
  },
  acompanhamentosCriar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(ctx, 'acompanhamento.acompanhamento.criar');
    const pac = r.obterPaciente(ctx, q.body.pacienteId);
    if (pac.status !== 'ATIVO') throw invalido('pacienteId', 'Paciente inativo.');
    const prot = r.obterProtocoloVersao(q.org, q.body.protocoloId);
    if (!prot) throw invalido('protocoloId', 'Protocolo não encontrado.');
    if (prot.status !== 'ATIVO') throw invalido('protocoloId', 'Protocolo arquivado.');
    const equipeIds: string[] = q.body.equipeIds?.length ? q.body.equipeIds : [ctx.usuario.id];
    equipeIds.forEach((id, i) => {
      const u = q.org.usuarios.get(id);
      if (!u || u.status !== 'ATIVO' || !r.usuarioEhEquipe(u)) throw invalido(`equipeIds.${i}`, 'Membro da equipe inválido.');
    });
    const a = r.criarAcompanhamento(q.org, { pacienteId: pac.id, protocoloId: prot.id, dataInicio: q.body.dataInicio, equipeIds, criadoPor: ctx.usuario.id, observacao: q.body.observacao ?? null });
    return criado(r.serAcompanhamento(ctx, a), { ETag: r.etag(a.id, a._v) });
  },
  acompanhamentosObter: (q) => {
    const a = r.obterAcompanhamento(C(q), q.params.acompanhamentoId);
    return ok(r.serAcompanhamento(C(q), a), { ETag: r.etag(a.id, a._v) });
  },
  acompanhamentosEditar: (q) => {
    const ctx = C(q);
    const a = r.obterAcompanhamento(ctx, q.params.acompanhamentoId);
    if (!r.ehEquipe(ctx)) throw negado();
    r.exigir(ctx, 'acompanhamento.acompanhamento.criar');
    r.conferirIfMatch(q.headers['if-match'], a.id, a._v, () => r.serAcompanhamento(ctx, a));
    if (a.status === 'CONCLUIDO' || a.status === 'ENCERRADO') throw invalido('status', 'Acompanhamento finalizado não pode ser editado.');
    if (q.body.equipeIds) {
      q.body.equipeIds.forEach((id: string, i: number) => {
        const u = q.org.usuarios.get(id);
        if (!u || u.status !== 'ATIVO' || !r.usuarioEhEquipe(u)) throw invalido(`equipeIds.${i}`, 'Membro da equipe inválido.');
      });
      a.equipeIds = [...new Set(q.body.equipeIds as string[])];
      const conversa = q.org.conversas.get(a.conversaId);
      if (conversa) for (const id of a.equipeIds) r.adicionarParticipante(q.org, conversa, id);
    }
    if (q.body.observacao !== undefined) a.observacao = q.body.observacao;
    a._v++;
    emitir(q.org, 'acompanhamento.acompanhamento.atualizado', { acompanhamentoId: a.id }, [...a.equipeIds, ...r.contasIdsDoPaciente(q.org, a.pacienteId)]);
    return ok(r.serAcompanhamento(ctx, a), { ETag: r.etag(a.id, a._v) });
  },
  acompanhamentosEncerrar: (q) => {
    const ctx = C(q);
    const a = r.obterAcompanhamento(ctx, q.params.acompanhamentoId);
    r.exigir(ctx, 'acompanhamento.acompanhamento.encerrar');
    if (a.status !== 'ATIVO' && a.status !== 'AGENDADO') throw invalido('status', 'Este acompanhamento já foi finalizado.');
    r.encerrarAcompanhamento(q.org, a, q.body.motivo, ctx.usuario.id);
    return ok(r.serAcompanhamento(ctx, a));
  },

  // ─────────── Check-ins e alertas ───────────
  checkinsListar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(ctx, 'acompanhamento.checkin.ler');
    let lista = [...q.org.checkins.values()].filter((c) => r.podeVerPaciente(ctx, c.pacienteId));
    if (q.query.acompanhamentoId) lista = lista.filter((c) => c.acompanhamentoId === q.query.acompanhamentoId);
    if (q.query.status) lista = lista.filter((c) => c.status === q.query.status);
    if (q.query.data) lista = lista.filter((c) => partesLocais(Date.parse(c.disponivelEm), q.org.config.fuso).data === q.query.data);
    lista.sort((a, b) => a.disponivelEm.localeCompare(b.disponivelEm));
    const p = r.paginar(lista, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((c) => r.serCheckin(ctx, c, false)) });
  },
  checkinsObter: (q) => ok(r.serCheckin(C(q), r.obterCheckin(C(q), q.params.checkinId), true)),
  checkinsResponder: (q) => {
    const ctx = C(q);
    const c = r.obterCheckin(ctx, q.params.checkinId);
    if (ctx.perfil !== 'PACIENTE') throw negado('Só o paciente ou o responsável responde o check-in.');
    r.exigir(ctx, 'acompanhamento.checkin.responder');
    r.responderCheckin(q.org, c, q.body.respostas, ctx.usuario.id);
    return criado(r.serCheckin(ctx, c, true));
  },
  alertasListar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'acompanhamento');
    r.exigir(ctx, 'acompanhamento.alerta.ler');
    let lista = [...q.org.alertas.values()];
    if (q.query.status) lista = lista.filter((a) => a.status === q.query.status);
    if (q.query.acompanhamentoId) lista = lista.filter((a) => a.acompanhamentoId === q.query.acompanhamentoId);
    if (q.query.severidade) lista = lista.filter((a) => a.severidade === q.query.severidade);
    const ordem: Record<string, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
    lista.sort((a, b) => (a.status === b.status ? 0 : a.status === 'ABERTO' ? -1 : 1) || ordem[a.severidade] - ordem[b.severidade] || b.criadoEm.localeCompare(a.criadoEm));
    const p = r.paginar(lista, q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((a) => r.serAlerta(ctx, a)) });
  },
  alertasResolver: (q) => {
    const ctx = C(q);
    const a = r.obterAlerta(ctx, q.params.alertaId);
    r.exigir(ctx, 'acompanhamento.alerta.resolver');
    if (a.status === 'ABERTO') r.resolverAlerta(q.org, a, ctx.usuario.id, q.body?.nota ?? null);
    return ok(r.serAlerta(ctx, a));
  },

  // ─────────── Chat ───────────
  conversasListar: (q) => {
    const ctx = C(q);
    let lista = conversasVisiveis(ctx);
    if (q.query.status) lista = lista.filter((c) => c.status === q.query.status);
    if (q.query.pacienteId) lista = lista.filter((c) => c.pacienteId === q.query.pacienteId);
    let ser = ordenarConversas(lista.map((c) => r.serConversa(ctx, c)));
    if (q.query.naoLidas !== undefined) ser = ser.filter((c) => (c.naoLidas > 0) === q.query.naoLidas);
    return ok(r.paginar(ser, q.query.cursor, q.query.limite));
  },
  conversasBuscar: (q) => {
    const ctx = C(q);
    const t = r.normalizar(q.body.texto);
    const ser = ordenarConversas(conversasVisiveis(ctx).map((c) => r.serConversa(ctx, c)).filter((c) => r.normalizar(c.titulo).includes(t) || r.normalizar(c.paciente.nome).includes(t)));
    return ok(r.paginar(ser, q.body.cursor, q.body.limite));
  },
  conversasCriar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'chat');
    const pac = r.obterPaciente(ctx, q.body.pacienteId);
    const existente = r.conversaAtivaDoPaciente(q.org, pac.id);
    if (existente) {
      if (!r.participa(existente, ctx.usuario.id)) {
        if (!r.ehEquipe(ctx) || !ctx.perms.has('chat.conversa.gerenciar')) throw naoEncontrado('Conversa');
        r.adicionarParticipante(q.org, existente, ctx.usuario.id); // "clica no paciente e cai na conversa dele"
        emitir(q.org, 'chat.conversa.atualizada', { conversaId: existente.id }, r.participantesAtivos(existente));
      }
      return ok(r.serConversa(ctx, existente));
    }
    r.exigir(ctx, 'chat.conversa.criar');
    const extras: string[] = q.body.participantesIds ?? [];
    extras.forEach((id, i) => { const u = q.org.usuarios.get(id); if (!u || u.status !== 'ATIVO' || !r.usuarioEhEquipe(u)) throw invalido(`participantesIds.${i}`, 'Membro da equipe inválido.'); });
    const equipePadrao = r.ehEquipe(ctx) ? [] : membros(q.org).filter((u) => u.status === 'ATIVO' && (u.perfis.includes('PROFISSIONAL') || u.perfis.includes('SECRETARIA'))).map((u) => u.id);
    const c = r.criarConversa(q.org, pac.id, [ctx.usuario.id, ...extras, ...equipePadrao, ...r.contasIdsDoPaciente(q.org, pac.id)]);
    emitir(q.org, 'chat.conversa.atualizada', { conversaId: c.id }, r.participantesAtivos(c));
    return criado(r.serConversa(ctx, c));
  },
  conversasObter: (q) => ok(r.serConversa(C(q), r.obterConversa(C(q), q.params.conversaId))),
  mensagensListar: (q) => {
    const c = r.obterConversa(C(q), q.params.conversaId);
    const todas = q.org.mensagens.get(c.id)!;
    const limite = q.query.limite ?? 20;
    let fatia: any[]; let temMais: boolean;
    if (q.query.depoisDe) {
      const i = todas.findIndex((m) => m.id === q.query.depoisDe);
      if (i < 0) throw invalido('depoisDe', 'Mensagem não encontrada nesta conversa.');
      fatia = todas.slice(i + 1, i + 1 + limite); temMais = i + 1 + limite < todas.length;
    } else {
      const fim = q.query.antesDe ? todas.findIndex((m) => m.id === q.query.antesDe) : todas.length;
      if (fim < 0) throw invalido('antesDe', 'Mensagem não encontrada nesta conversa.');
      fatia = todas.slice(Math.max(0, fim - limite), fim); temMais = fim - limite > 0;
    }
    return ok({ itens: fatia.map((m) => r.serMensagem(q.org, m)), temMais });
  },
  mensagensEnviar: (q) => {
    const ctx = C(q);
    const c = r.obterConversa(ctx, q.params.conversaId);
    r.exigir(ctx, 'chat.mensagem.enviar');
    const msgs = q.org.mensagens.get(c.id)!;
    const repetida = msgs.find((m) => m.idCliente === q.body.idCliente && m.autorId === ctx.usuario.id); // RN-CHA-007
    if (repetida) return criado(r.serMensagem(q.org, repetida));
    if (c.status !== 'ATIVA') throw new ErroApi('CONVERSA_ARQUIVADA', 'Esta conversa foi arquivada.');
    const anexos: string[] = q.body.anexosIds ?? [];
    if (q.body.tipo === 'TEXTO' && (!q.body.texto?.trim() || anexos.length)) throw invalido('texto', 'Escreva a mensagem.', 'OBRIGATORIO');
    if (q.body.tipo === 'ANEXO') {
      if (!r.configModulo(q.org, 'chat').anexosPermitidos) throw invalido('anexosIds', 'Esta organização não aceita anexos no chat.');
      if (!anexos.length) throw invalido('anexosIds', 'Envie ao menos uma foto.', 'OBRIGATORIO');
      anexos.forEach((id, i) => {
        const a = q.org.arquivos.get(id);
        if (!a || a.donoId !== ctx.usuario.id || a.status !== 'DISPONIVEL' || a.usadoEm) throw invalido(`anexosIds.${i}`, 'Foto ainda não está disponível.');
      });
      anexos.forEach((id) => (q.org.arquivos.get(id).usadoEm = agoraIso()));
    }
    const m = r.postarMensagem(q.org, c, { tipo: q.body.tipo, autorId: ctx.usuario.id, texto: q.body.texto ?? null, anexosIds: anexos, idCliente: q.body.idCliente });
    // RN-CHA-006: aviso fora do horário, no máximo uma vez por período.
    const cfg = r.configModulo(q.org, 'chat');
    if (ctx.perfil === 'PACIENTE' && cfg.mensagemForaDoHorario && !r.dentroDoHorario(q.org)) {
      const ultimo = c.ultimoAvisoForaHorarioEm ? Date.parse(c.ultimoAvisoForaHorarioEm) : null;
      const reabriu = ultimo === null || (r.proximaAbertura(q.org, ultimo) ?? Infinity) <= agoraMs();
      if (reabriu) {
        c.ultimoAvisoForaHorarioEm = agoraIso();
        r.postarMensagem(q.org, c, { tipo: 'SISTEMA', autorId: null, texto: cfg.mensagemForaDoHorario });
      }
    }
    return criado(r.serMensagem(q.org, m));
  },
  conversasMarcarLida: (q) => {
    const ctx = C(q);
    const c = r.obterConversa(ctx, q.params.conversaId);
    const msgs = q.org.mensagens.get(c.id)!;
    const alvo = msgs.findIndex((m) => m.id === q.body.ateMensagemId);
    if (alvo < 0) throw invalido('ateMensagemId', 'Mensagem não encontrada nesta conversa.');
    const p = c.participantes.find((x: any) => x.usuarioId === ctx.usuario.id && !x.removidoEm);
    const atual = p.lidoAte ? msgs.findIndex((m) => m.id === p.lidoAte) : -1;
    if (alvo > atual) {
      p.lidoAte = q.body.ateMensagemId;
      emitir(q.org, 'chat.conversa.atualizada', { conversaId: c.id }, r.participantesAtivos(c));
      r.avisarContadores(q.org)(ctx.usuario.id);
    }
    return vazio();
  },
  conversasAdicionarParticipante: (q) => {
    const ctx = C(q);
    const c = r.obterConversa(ctx, q.params.conversaId);
    r.exigir(ctx, 'chat.conversa.gerenciar');
    if (c.status !== 'ATIVA') throw new ErroApi('CONVERSA_ARQUIVADA');
    const u = q.org.usuarios.get(q.body.usuarioId);
    if (!u || u.status !== 'ATIVO' || !r.usuarioEhEquipe(u)) throw invalido('usuarioId', 'Membro da equipe inválido.');
    if (r.adicionarParticipante(q.org, c, u.id)) {
      r.postarMensagem(q.org, c, { tipo: 'SISTEMA', autorId: null, texto: `${u.nomeExibicao} entrou na conversa.` });
      emitir(q.org, 'chat.conversa.atualizada', { conversaId: c.id }, r.participantesAtivos(c));
    }
    return ok(r.serConversa(ctx, c));
  },
  conversasRemoverParticipante: (q) => {
    const ctx = C(q);
    const c = r.obterConversa(ctx, q.params.conversaId);
    r.exigir(ctx, 'chat.conversa.gerenciar');
    const p = c.participantes.find((x: any) => x.usuarioId === q.params.usuarioId && !x.removidoEm);
    if (!p) throw naoEncontrado('Participante');
    if (!r.usuarioEhEquipe(q.org.usuarios.get(p.usuarioId)!)) throw invalido('usuarioId', 'O paciente não pode ser removido da própria conversa.');
    p.removidoEm = agoraIso(); // RN-CHA-004: corta o acesso dali em diante; histórico fica
    r.postarMensagem(q.org, c, { tipo: 'SISTEMA', autorId: null, texto: `${q.org.usuarios.get(p.usuarioId)!.nomeExibicao} saiu da conversa.` });
    emitir(q.org, 'chat.conversa.atualizada', { conversaId: c.id }, [...r.participantesAtivos(c), p.usuarioId]);
    return vazio();
  },
  conversasArquivar: (q) => {
    const ctx = C(q);
    const c = r.obterConversa(ctx, q.params.conversaId);
    r.exigir(ctx, 'chat.conversa.gerenciar');
    if (c.status === 'ATIVA') {
      c.status = 'ARQUIVADA'; // RN-CHA-005: nunca apaga
      emitir(q.org, 'chat.conversa.atualizada', { conversaId: c.id }, r.participantesAtivos(c));
      for (const uid of r.participantesAtivos(c)) r.avisarContadores(q.org)(uid);
    }
    return ok(r.serConversa(ctx, c));
  },
  conversasReabrir: (q) => {
    const ctx = C(q);
    const c = r.obterConversa(ctx, q.params.conversaId);
    r.exigir(ctx, 'chat.conversa.gerenciar');
    if (c.status === 'ARQUIVADA') {
      if (r.conversaAtivaDoPaciente(q.org, c.pacienteId)) throw invalido('status', 'O paciente já tem outra conversa ativa.');
      c.status = 'ATIVA';
      emitir(q.org, 'chat.conversa.atualizada', { conversaId: c.id }, r.participantesAtivos(c));
    }
    return ok(r.serConversa(ctx, c));
  },

  // ─────────── Equipe e organização ───────────
  equipeListarMembros: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'equipe');
    r.exigir(ctx, 'equipe.membro.ler');
    let lista = membros(q.org);
    if (q.query.status) lista = lista.filter((u) => u.status === q.query.status);
    const p = r.paginar(lista.sort((a, b) => a.nomeExibicao.localeCompare(b.nomeExibicao, 'pt-BR')), q.query.cursor, q.query.limite);
    return ok({ ...p, itens: p.itens.map((u) => r.serMembro(ctx, u)) });
  },
  equipeObterMembro: (q) => {
    const u = obterMembro(C(q), q.params.membroId);
    return ok(r.serMembro(C(q), u), { ETag: r.etag(u.id, u._v) });
  },
  equipeEditarMembro: (q) => {
    const ctx = C(q);
    const u = obterMembro(ctx, q.params.membroId);
    r.exigir(ctx, 'equipe.membro.gerenciar');
    r.conferirIfMatch(q.headers['if-match'], u.id, u._v, () => r.serMembro(ctx, u));
    const perfisNovos: string[] = q.body.perfis ?? u.perfis;
    const statusNovo = q.body.status ?? u.status;
    const gestoresAtivos = membros(q.org).filter((x) => x.status === 'ATIVO' && x.perfis.includes('GESTOR'));
    const deixaDeSerGestor = u.perfis.includes('GESTOR') && u.status === 'ATIVO' && (!perfisNovos.includes('GESTOR') || statusNovo !== 'ATIVO');
    if (deixaDeSerGestor && gestoresAtivos.length <= 1) throw new ErroApi('ULTIMO_GESTOR', 'Defina outro gestor antes.'); // RN-EQP-001
    if (statusNovo === 'CONVIDADO' && u.status !== 'CONVIDADO') throw invalido('status', 'Status inválido.');
    u.perfis = perfisNovos as any;
    if (statusNovo !== u.status) {
      u.status = statusNovo;
      if (statusNovo === 'SUSPENSO' || statusNovo === 'DESLIGADO') auth.revogarSessoesDoUsuario(q.org, u.id, `MEMBRO_${statusNovo}`); // RN-EQP-002
      if (statusNovo === 'DESLIGADO')
        for (const c of q.org.conversas.values()) { const p = c.participantes.find((x: any) => x.usuarioId === u.id && !x.removidoEm); if (p) p.removidoEm = agoraIso(); }
    }
    u._v++;
    emitir(q.org, 'sessao.manifesto.alterado', {}, [u.id]);
    return ok(r.serMembro(ctx, u), { ETag: r.etag(u.id, u._v) });
  },
  equipeConvidar: (q) => {
    const ctx = C(q);
    r.exigirModulo(q.org, 'equipe');
    r.exigir(ctx, 'equipe.membro.gerenciar');
    if ([...q.org.usuarios.values()].some((u) => u.email === q.body.email)) throw invalido('email', 'Já existe uma conta com este e-mail.');
    const u: Usuario = { ...auth.novaContaPaciente(q.org, { nome: q.body.nome, email: q.body.email }), perfis: q.body.perfis, status: 'CONVIDADO', nomeExibicao: q.body.nome };
    q.org.usuarios.set(u.id, u);
    const token = tokenAleatorio(18);
    const c = { id: novoId('cnt'), token, tipo: 'EQUIPE', usuarioId: u.id, email: u.email, nome: u.nome, criadoPor: ctx.usuario.id, criadoEm: agoraIso(), expiraEm: iso(agoraMs() + 72 * HORA), usadoEm: null };
    q.org.convites.set(token, c);
    const link = linkConvite(q.org, token);
    enviarEmail(q.org, u.email, `Convite para a equipe — ${q.org.config.nome}`, `Você foi convidado para a equipe. Acesse: ${link}`);
    return criado({ id: c.id, token, link, conteudoQr: link, expiraEm: c.expiraEm, emailEnviado: true });
  },
  organizacaoObter: (q) => {
    r.exigir(C(q), 'organizacao.configuracao.editar', true);
    return ok(orgConfig(C(q)), { ETag: etagOrg(q.org) });
  },
  organizacaoEditar: (q) => {
    const ctx = C(q);
    r.exigir(ctx, 'organizacao.configuracao.editar', true);
    r.conferirIfMatch(q.headers['if-match'], q.org.id, q.org._vConfig, () => orgConfig(ctx));
    const o = q.org.config;
    if (q.body.nome) o.nome = q.body.nome;
    if (q.body.contato) o.contato = q.body.contato;
    if (q.body.textos) o.textos = { ...o.textos, ...q.body.textos };
    if (q.body.tema?.corMarca) { o.tema.corMarca = q.body.tema.corMarca; o.pwa.corTema = q.body.tema.corMarca; }
    if (q.body.tema && 'logoArquivoId' in q.body.tema) {
      if (q.body.tema.logoArquivoId === null) o.tema.logoUrl = null;
      else {
        const a = q.org.arquivos.get(q.body.tema.logoArquivoId);
        if (!a || a.status !== 'DISPONIVEL' || a.finalidade !== 'ORGANIZACAO') throw invalido('tema.logoArquivoId', 'Envie o logo como arquivo da organização.');
        o.tema.logoUrl = `${r.BASE_PUBLICA}/__mock/arquivos/${q.org.slug}/${a.id}?publico=1`;
        a.publico = true;
      }
    }
    if (q.body.chat) {
      if (!r.temModulo(q.org, 'chat')) throw new ErroApi('MODULO_NAO_CONTRATADO');
      Object.assign(q.org.modulos.find((m) => m.id === 'chat').config, q.body.chat);
    }
    q.org._vConfig++;
    avisarManifesto(q.org); // RN-EQP-004
    return ok(orgConfig(ctx), { ETag: etagOrg(q.org) });
  },
};
