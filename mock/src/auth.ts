// Autenticação do mock (seção 5): etapas, MFA por TOTP, código por e-mail, convites,
// token de acesso curto e token de renovação rotacionado com detecção de reuso.
import { createHmac } from 'node:crypto';
import { emitir, enviarEmail, ErroApi, invalido, novoId, tokenAleatorio, type Org, type Perfil, type Usuario } from './estado.ts';
import {
  adicionarParticipante, avisarContadores, BASE_PUBLICA, conversaAtivaDoPaciente, type Ctx, notificarU, permissoesDe,
  PRIORIDADE_PERFIL, temModulo, urlApi, usuarioEhEquipe,
} from './regras.ts';
import { agoraIso, agoraMs, DIA, iso, MINUTO } from './tempo.ts';

export const CODIGO_EMAIL_FIXO = process.env.MOCK_CODIGO_EMAIL ?? '123456';
export const TOTP_FIXO = process.env.MOCK_TOTP ?? '000000';
const ACESSO_MS = 15 * MINUTO;
const RENOVACAO_MS = { EQUIPE: 14 * DIA, PACIENTE: 90 * DIA }; // [DECISÃO 6]

// ─────────── TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos) ───────────
function base32(s: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += alfabeto.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totp(segredo: string, ms = Date.now()): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(ms / 30_000)));
  const h = createHmac('sha1', base32(segredo)).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
const totpValido = (segredo: string, codigo: string) =>
  codigo === TOTP_FIXO || [-1, 0, 1].some((j) => totp(segredo, Date.now() + j * 30_000) === codigo); // relógio real, como o app autenticador

// ─────────── Limites ───────────
export function limitar(org: Org, chave: string, max: number, janelaMs = 15 * MINUTO) {
  const agora = agoraMs();
  const lista = (org.tentativas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (lista.length >= max) throw new ErroApi('MUITAS_TENTATIVAS', 'Aguarde alguns minutos e tente de novo.', {}, 429);
  lista.push(agora);
  org.tentativas.set(chave, lista);
}

// ─────────── Desafios e etapas (5.2) ───────────
const mfaObrigatorio = (org: Org) => org.config.autenticacao.metodos.some((m: any) => m.tipo === 'SENHA' && m.mfa === 'OBRIGATORIO');

function novoDesafio(org: Org, u: Usuario, d: Partial<any> = {}) {
  const desafio = { id: novoId('dsf'), usuarioId: u.id, criadoEm: agoraMs(), mfaOk: false, tentativas: 0, nativo: false, ...d };
  org.desafios.set(desafio.id, desafio);
  return desafio;
}
export function obterDesafio(org: Org, id: string) {
  const d = org.desafios.get(id);
  if (!d || agoraMs() - d.criadoEm > 15 * MINUTO) throw new ErroApi('SESSAO_EXPIRADA', 'Comece o login de novo.');
  return d;
}

/** Decide a próxima etapa a partir do estado da conta e do desafio. */
export function proximaEtapa(org: Org, desafio: any, resposta: any = {}) {
  const u = org.usuarios.get(desafio.usuarioId)!;
  const equipe = usuarioEhEquipe(u);
  if (equipe && u.mfaSegredo && !desafio.mfaOk) return { etapa: 'MFA', desafioId: desafio.id, metodosMfa: ['TOTP', 'CODIGO_RECUPERACAO'], ...resposta };
  if (u.trocarSenha) return { etapa: 'TROCAR_SENHA', desafioId: desafio.id, ...resposta };
  if (equipe && !u.mfaSegredo && mfaObrigatorio(org)) return { etapa: 'CONFIGURAR_MFA', desafioId: desafio.id, ...resposta };
  const versao = org.config.autenticacao.termosVersao;
  if (u.termosAceitosVersao !== versao)
    return { etapa: 'ACEITAR_TERMOS', desafioId: desafio.id, termos: { versao, url: org.config.links.termosDeUso }, ...resposta };
  org.desafios.delete(desafio.id);
  return { ...resposta, ...criarSessao(org, u, desafio.nativo) };
}

// ─────────── Sessões e tokens ───────────
const cookiePath = (org: Org) => `${new URL(urlApi(org)).pathname}/v1/auth`;
const seguro = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE_PUBLICA);

function emitirTokens(org: Org, sessao: any, nativo: boolean) {
  const tokenAcesso = `ac.${tokenAleatorio(32)}`;
  const expira = agoraMs() + ACESSO_MS;
  org.tokensAcesso.set(tokenAcesso, { sessaoId: sessao.id, perfil: sessao.perfilAtivo, expiraEm: expira });
  const tokenRenovacao = `rn.${tokenAleatorio(32)}`;
  org.tokensRenovacao.set(tokenRenovacao, { sessaoId: sessao.id, usado: false });
  sessao.renovacaoExpiraEm = agoraMs() + sessao.validadeRenovacaoMs;
  const corpo: any = { tokenAcesso, expiraEm: iso(expira) };
  if (nativo) corpo.tokenRenovacao = tokenRenovacao;
  const maxAge = Math.floor(sessao.validadeRenovacaoMs / 1000);
  const cookie = `renovacao=${tokenRenovacao}; Path=${cookiePath(org)}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${seguro ? '; Secure' : ''}`;
  return { corpo, cookie: nativo ? undefined : cookie };
}
export const cookieLimpo = (org: Org) => `renovacao=; Path=${cookiePath(org)}; Max-Age=0; HttpOnly; SameSite=Strict${seguro ? '; Secure' : ''}`;

export function criarSessao(org: Org, u: Usuario, nativo: boolean) {
  const perfil = PRIORIDADE_PERFIL.find((p) => u.perfis.includes(p))!;
  const sessao = {
    id: novoId('ses'), usuarioId: u.id, perfilAtivo: perfil, criadoEm: agoraIso(), revogada: false,
    validadeRenovacaoMs: usuarioEhEquipe(u) ? RENOVACAO_MS.EQUIPE : RENOVACAO_MS.PACIENTE, renovacaoExpiraEm: 0,
  };
  org.sessoes.set(sessao.id, sessao);
  u.ultimoAcessoEm = agoraIso();
  const { corpo, cookie } = emitirTokens(org, sessao, nativo);
  return { etapa: 'CONCLUIDO', ...corpo, __cookie: cookie };
}

export function revogarSessao(org: Org, sessaoId: string, motivo: string) {
  const s = org.sessoes.get(sessaoId);
  if (!s || s.revogada) return;
  s.revogada = true;
  emitir(org, 'sessao.encerrada', { motivo }, [s.usuarioId]);
  for (const o of org.ouvintes) if (o.sessaoId === sessaoId) o.fechar();
}
export function revogarSessoesDoUsuario(org: Org, usuarioId: string, motivo: string) {
  for (const s of org.sessoes.values()) if (s.usuarioId === usuarioId) revogarSessao(org, s.id, motivo);
}

/** Valida o Bearer e monta o contexto da requisição. */
export function autenticar(org: Org, authorization: string | undefined, requestId: string): Ctx {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const t = token ? org.tokensAcesso.get(token) : undefined;
  if (!t || t.expiraEm <= agoraMs()) throw new ErroApi('SESSAO_EXPIRADA', 'Renove o token de acesso.');
  const sessao = org.sessoes.get(t.sessaoId);
  const usuario = sessao && org.usuarios.get(sessao.usuarioId);
  if (!sessao || sessao.revogada || !usuario || usuario.status !== 'ATIVO') throw new ErroApi('SESSAO_REVOGADA', 'Entre novamente.');
  if (org.config.status === 'SUSPENSA') throw new ErroApi('ORGANIZACAO_SUSPENSA');
  usuario.ultimoAcessoEm = agoraIso();
  // O perfil vai no token (como uma claim): trocar de perfil emite outro token; a sessão guarda o último para a renovação.
  const perfil: Perfil = usuario.perfis.includes(t.perfil) ? t.perfil : PRIORIDADE_PERFIL.find((p) => usuario.perfis.includes(p))!;
  return { org, usuario, sessao, perfil, perms: new Set(permissoesDe(org, perfil)), requestId };
}

// ─────────── Handlers ───────────
type R = { status: number; body?: any; headers?: Record<string, string>; cookie?: string };
const etapa = (r: any): R => {
  const { __cookie, ...body } = r;
  return { status: 200, body, cookie: __cookie };
};
const usuarioPorEmail = (org: Org, email: string) => [...org.usuarios.values()].find((u) => u.email === email);

export function entrar(org: Org, body: any, ip: string, nativo: boolean): R {
  limitar(org, `entrar:ip:${ip}`, 30);
  limitar(org, `entrar:email:${body.email}`, 5);
  const u = usuarioPorEmail(org, body.email);
  if (!u || !u.senha || u.senha !== body.senha || u.status !== 'ATIVO' || !usuarioEhEquipe(u))
    throw new ErroApi('AUTENTICACAO_INVALIDA', 'Confira o e-mail e a senha.');
  org.tentativas.delete(`entrar:email:${body.email}`);
  return etapa(proximaEtapa(org, novoDesafio(org, u, { nativo })));
}

export function solicitarCodigo(org: Org, body: any, ip: string) {
  limitar(org, `codigo:ip:${ip}`, 30);
  limitar(org, `codigo:email:${body.email}`, 5);
  const u = usuarioPorEmail(org, body.email);
  if (u && u.status === 'ATIVO' && u.perfis.includes('PACIENTE')) {
    org.codigosEmail.set(body.email, { codigo: CODIGO_EMAIL_FIXO, expiraEm: agoraMs() + 10 * MINUTO, tentativas: 0 });
    enviarEmail(org, body.email, `Seu código de acesso — ${org.config.nome}`, `Seu código é ${CODIGO_EMAIL_FIXO}. Ele vale por 10 minutos.`);
  }
  return { status: 202 };
}

export function verificarCodigo(org: Org, body: any, nativo: boolean): R {
  // Confirmação de e-mail diferente no aceite de convite.
  if (body.desafioId) {
    const d = obterDesafio(org, body.desafioId);
    if (d.emailPendente !== body.email) throw new ErroApi('CODIGO_INVALIDO');
    if (++d.tentativas > 5) throw new ErroApi('MUITAS_TENTATIVAS', undefined, {}, 429);
    if (body.codigo !== d.codigo) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código e tente de novo.');
    return etapa(concluirConvite(org, org.convites.get(d.conviteToken), body.email, d.termosVersao, nativo));
  }
  const reg = org.codigosEmail.get(body.email);
  if (!reg) throw new ErroApi('CODIGO_INVALIDO', 'Peça um novo código.');
  if (reg.expiraEm <= agoraMs()) { org.codigosEmail.delete(body.email); throw new ErroApi('CODIGO_EXPIRADO', 'Peça um novo código.'); }
  if (++reg.tentativas > 5) { org.codigosEmail.delete(body.email); throw new ErroApi('MUITAS_TENTATIVAS', 'Peça um novo código.', {}, 429); }
  if (reg.codigo !== body.codigo) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código e tente de novo.');
  org.codigosEmail.delete(body.email);
  return etapa(proximaEtapa(org, novoDesafio(org, usuarioPorEmail(org, body.email)!, { nativo })));
}

export function obterConvite(org: Org, token: string) {
  const c = org.convites.get(token);
  if (!c || c.usadoEm || c.revogadoEm) throw new ErroApi('CONVITE_INVALIDO', 'Este convite não é válido.');
  if (Date.parse(c.expiraEm) <= agoraMs()) throw new ErroApi('CONVITE_EXPIRADO', 'Peça um novo convite à equipe.');
  return c;
}
const mascarar = (email: string | null) => (email ? email.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : null);
export function conviteParcial(org: Org, token: string) {
  const c = obterConvite(org, token);
  const partes = c.nome.trim().split(/\s+/);
  return {
    tipo: c.tipo, organizacao: { slug: org.slug, nome: org.config.nome },
    nomeParcial: partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0],
    emailMascarado: mascarar(c.email), expiraEm: c.expiraEm,
  };
}

function concluirConvite(org: Org, c: any, email: string, termosVersao: string, nativo: boolean) {
  c.usadoEm = agoraIso();
  if (c.tipo === 'EQUIPE') {
    const u = org.usuarios.get(c.usuarioId)!;
    u.status = 'ATIVO'; u.email = email; u.termosAceitosVersao = termosVersao; u.trocarSenha = true;
    for (const g of [...org.usuarios.values()].filter((x) => x.perfis.includes('GESTOR') && x.status === 'ATIVO'))
      notificarU(org, g.id, { tipo: 'CONVITE_ACEITO', titulo: 'Convite aceito', texto: `${u.nomeExibicao} entrou na equipe.`, destino: { tela: 'equipe.lista' } });
    return proximaEtapa(org, novoDesafio(org, u, { nativo }));
  }
  // Paciente: cria a conta ou vincula a uma conta existente com o mesmo e-mail (tutora com dois pets).
  let u = usuarioPorEmail(org, email);
  if (u && !u.perfis.includes('PACIENTE')) throw invalido('email', 'Este e-mail pertence a um membro da equipe.');
  if (!u) {
    u = novaContaPaciente(org, { nome: c.nomeConta, email });
    org.usuarios.set(u.id, u);
  }
  if (!u.vinculos.some((v) => v.pacienteId === c.pacienteId)) u.vinculos.push({ pacienteId: c.pacienteId, relacao: c.relacao });
  u.termosAceitosVersao = termosVersao;
  if (temModulo(org, 'chat')) {
    const conversa = conversaAtivaDoPaciente(org, c.pacienteId);
    if (conversa) adicionarParticipante(org, conversa, u.id);
  }
  if (c.criadoPor && org.usuarios.has(c.criadoPor))
    notificarU(org, c.criadoPor, { tipo: 'CONVITE_ACEITO', titulo: 'Convite aceito', texto: `${org.pacientes.get(c.pacienteId)?.nome} ativou o acesso ao app.`, destino: { tela: 'pacientes.detalhe', parametros: { pacienteId: c.pacienteId } } });
  emitir(org, 'sessao.manifesto.alterado', {}, [u.id]);
  avisarContadores(org)(u.id);
  return proximaEtapa(org, novoDesafio(org, u, { nativo }));
}
export function novaContaPaciente(org: Org, d: { id?: string; nome: string; email: string }): Usuario {
  return {
    id: d.id ?? novoId('usr'), nome: d.nome, nomeExibicao: d.nome, email: d.email, senha: null, perfis: ['PACIENTE'], status: 'ATIVO',
    mfaSegredo: null, codigosRecuperacao: [], trocarSenha: false, termosAceitosVersao: null, rotulosPerfis: {}, profissional: null,
    preferencias: { tema: 'SISTEMA', densidade: 'CONFORTAVEL' }, fotoArquivoId: null, vinculos: [], ultimoAcessoEm: null,
    criadoEm: agoraIso(), _v: 1, preferenciasNotificacao: {},
  };
}

export function aceitarConvite(org: Org, token: string, body: any, nativo: boolean): R {
  const c = obterConvite(org, token);
  if (body.termosVersao !== org.config.autenticacao.termosVersao) throw invalido('termosVersao', 'Os termos foram atualizados. Recarregue a página.');
  if (!c.email || c.email === body.email) return etapa(concluirConvite(org, c, body.email, body.termosVersao, nativo));
  if (c.tipo === 'EQUIPE') throw invalido('email', 'Use o e-mail que recebeu o convite.');
  // E-mail diferente: confirma a posse antes de vincular.
  const tmp = { id: 'pendente' } as any;
  const d = novoDesafio(org, tmp, { conviteToken: token, emailPendente: body.email, codigo: CODIGO_EMAIL_FIXO, termosVersao: body.termosVersao, nativo });
  enviarEmail(org, body.email, `Confirme seu e-mail — ${org.config.nome}`, `Seu código é ${CODIGO_EMAIL_FIXO}. Ele vale por 10 minutos.`);
  return { status: 200, body: { etapa: 'CODIGO_ENVIADO', desafioId: d.id, emailMascarado: mascarar(body.email)! } };
}

export function verificarMfa(org: Org, body: any): R {
  const d = obterDesafio(org, body.desafioId);
  const u = org.usuarios.get(d.usuarioId)!;
  if (!u.mfaSegredo) throw new ErroApi('CODIGO_INVALIDO');
  if (++d.tentativas > 5) { org.desafios.delete(d.id); throw new ErroApi('MUITAS_TENTATIVAS', 'Comece o login de novo.', {}, 429); }
  const recuperacao = u.codigosRecuperacao.indexOf(body.codigo.toUpperCase());
  if (recuperacao >= 0) u.codigosRecuperacao.splice(recuperacao, 1); // uso único
  else if (!totpValido(u.mfaSegredo, body.codigo)) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código do autenticador.');
  d.mfaOk = true;
  return etapa(proximaEtapa(org, d));
}

export function iniciarTotp(org: Org, body: any) {
  const d = obterDesafio(org, body.desafioId);
  const u = org.usuarios.get(d.usuarioId)!;
  if (u.mfaSegredo) throw new ErroApi('VALIDACAO_FALHOU', 'O autenticador já está configurado.');
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  d.segredoPendente = Array.from({ length: 32 }, () => alfabeto[Math.floor(Math.random() * 32)]).join('');
  const rotulo = encodeURIComponent(`${org.config.pwa.nomeCurto}:${u.email}`);
  return { status: 200, body: { uriOtpauth: `otpauth://totp/${rotulo}?secret=${d.segredoPendente}&issuer=${encodeURIComponent(org.config.pwa.nomeCurto)}&digits=6&period=30`, segredo: d.segredoPendente } };
}
export function confirmarTotp(org: Org, body: any): R {
  const d = obterDesafio(org, body.desafioId);
  if (!d.segredoPendente) throw new ErroApi('VALIDACAO_FALHOU', 'Inicie a configuração do autenticador.');
  if (!totpValido(d.segredoPendente, body.codigo)) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código do autenticador.');
  const u = org.usuarios.get(d.usuarioId)!;
  u.mfaSegredo = d.segredoPendente;
  u.codigosRecuperacao = Array.from({ length: 8 }, () => tokenAleatorio(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 4) + '-' + tokenAleatorio(6).toUpperCase().replace(/[^A-Z0-9]/g, 'Y').slice(0, 4));
  d.mfaOk = true;
  return etapa(proximaEtapa(org, d, { codigosRecuperacao: [...u.codigosRecuperacao] }));
}
const senhaForte = (s: string) => s.length >= 10 && /[A-Za-z]/.test(s) && /\d/.test(s);
export function trocarSenha(org: Org, body: any): R {
  const d = obterDesafio(org, body.desafioId);
  const u = org.usuarios.get(d.usuarioId)!;
  if (!u.trocarSenha) throw new ErroApi('VALIDACAO_FALHOU', 'Não há troca de senha pendente.');
  if (!senhaForte(body.novaSenha) || body.novaSenha === u.senha) throw invalido('novaSenha', 'Use ao menos 10 caracteres, com letras e números, diferente da atual.');
  u.senha = body.novaSenha; u.trocarSenha = false;
  return etapa(proximaEtapa(org, d));
}
export function aceitarTermos(org: Org, body: any): R {
  const d = obterDesafio(org, body.desafioId);
  if (body.termosVersao !== org.config.autenticacao.termosVersao) throw invalido('termosVersao', 'Versão dos termos desatualizada.');
  org.usuarios.get(d.usuarioId)!.termosAceitosVersao = body.termosVersao;
  return etapa(proximaEtapa(org, d));
}
export function esqueciSenha(org: Org, body: any, ip: string) {
  limitar(org, `esqueci:email:${body.email}`, 3);
  limitar(org, `esqueci:ip:${ip}`, 20);
  const u = usuarioPorEmail(org, body.email);
  if (u && u.senha && u.status === 'ATIVO') {
    const token = tokenAleatorio(24);
    org.tokensSenha.set(token, { usuarioId: u.id, expiraEm: agoraMs() + 60 * MINUTO });
    enviarEmail(org, u.email, `Redefinir senha — ${org.config.nome}`, `Use o token ${token} (válido por 1 hora).`);
  }
  return { status: 202 };
}
export function redefinirSenha(org: Org, body: any) {
  const t = org.tokensSenha.get(body.token);
  if (!t || t.expiraEm <= agoraMs()) throw new ErroApi('CODIGO_EXPIRADO', 'Peça um novo link de redefinição.');
  if (!senhaForte(body.novaSenha)) throw invalido('novaSenha', 'Use ao menos 10 caracteres, com letras e números.');
  const u = org.usuarios.get(t.usuarioId)!;
  u.senha = body.novaSenha; u.trocarSenha = false;
  org.tokensSenha.delete(body.token);
  revogarSessoesDoUsuario(org, u.id, 'SENHA_REDEFINIDA');
  return { status: 204 };
}

export function renovar(org: Org, tokenCookie: string | undefined, body: any, nativo: boolean): R {
  const token = nativo ? body?.tokenRenovacao : tokenCookie ?? body?.tokenRenovacao;
  const reg = token ? org.tokensRenovacao.get(token) : undefined;
  if (!reg) throw new ErroApi('SESSAO_EXPIRADA', 'Entre novamente.');
  const sessao = org.sessoes.get(reg.sessaoId);
  if (!sessao || sessao.revogada) throw new ErroApi('SESSAO_REVOGADA', 'Entre novamente.');
  if (reg.usado) {
    revogarSessao(org, sessao.id, 'REUSO_DE_TOKEN'); // detecção de reuso: revoga a sessão inteira
    throw new ErroApi('SESSAO_REVOGADA', 'Por segurança, entre novamente.');
  }
  if (sessao.renovacaoExpiraEm <= agoraMs()) throw new ErroApi('SESSAO_EXPIRADA', 'Entre novamente.');
  reg.usado = true;
  const { corpo, cookie } = emitirTokens(org, sessao, nativo);
  return { status: 200, body: corpo, cookie };
}

export function sair(ctx: Ctx, body: any): R {
  if (body?.todas) revogarSessoesDoUsuario(ctx.org, ctx.usuario.id, 'SAIDA_TODOS_APARELHOS');
  else { ctx.sessao.revogada = true; for (const o of ctx.org.ouvintes) if (o.sessaoId === ctx.sessao.id) o.fechar(); }
  return { status: 204, cookie: cookieLimpo(ctx.org) };
}

export function trocarPerfil(ctx: Ctx, body: any, nativo: boolean): R {
  if (!ctx.usuario.perfis.includes(body.perfil as Perfil)) throw invalido('perfil', 'Você não tem este perfil.');
  ctx.sessao.perfilAtivo = body.perfil;
  const tokenAcesso = `ac.${tokenAleatorio(32)}`;
  const expira = agoraMs() + ACESSO_MS;
  ctx.org.tokensAcesso.set(tokenAcesso, { sessaoId: ctx.sessao.id, perfil: body.perfil, expiraEm: expira });
  return { status: 200, body: { tokenAcesso, expiraEm: iso(expira) } };
}
