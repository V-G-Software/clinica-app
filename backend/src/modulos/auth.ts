// Autenticação (seção 5): etapas, MFA por TOTP, código por e-mail, convites, token de acesso curto
// (JWT EdDSA) e token de renovação rotacionado com detecção de reuso. Tokens de renovação, códigos e
// tokens de convite/senha ficam no banco SOMENTE como hash.
import { ehEquipe, perfilPadrao, type Perfil } from '@clinica/dominio';
import { config } from '../config.ts';
import { assinarJwt, cifrar, conferirSenha, decifrar, hashSenha, iguais, janelaTotp, novoId, novoSegredoTotp, sha256, tokenAleatorio, totpValido } from '../cripto.ts';
import { um, type Tx } from '../db.ts';
import { emitir } from '../eventos.ts';
import { ErroApi, invalido } from '../erros.ts';
import { C, ok, vazio, type Handler, type Req, type Res } from '../http.ts';
import { auditar, autonoma, iso, limitar, zerarLimite, type Org, type Usuario } from '../nucleo.ts';
import { enviarEmail } from '../servicos/email.ts';
import { notificar } from '../servicos/notificar.ts';

const ACESSO_MIN = 15;
const RENOVACAO_DIAS = { EQUIPE: 14, PACIENTE: 90 }; // [DECISÃO 6]
const DESAFIO_MIN = 15;
const mfaObrigatorio = (org: Org) => org.configuracao.autenticacao.metodos.some((m: any) => m.tipo === 'SENHA' && m.mfa === 'OBRIGATORIO');
const termosVersao = (org: Org) => org.configuracao.autenticacao.termosVersao as string;
const caminhoCookie = (org: Org) => `${new URL(org.urlApi).pathname.replace(/\/$/, '')}/v1/auth`;
const seguro = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(config.urlPublica);
const cookie = (org: Org, valor: string, maxAge: number) => `renovacao=${valor}; Path=${caminhoCookie(org)}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${seguro ? '; Secure' : ''}`;
const hashCodigo = (org: Org, alvo: string, codigo: string) => sha256(`${org.id}|${alvo}|${codigo}`);
const mascarar = (email: string | null) => (email ? email.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : null);
const usuarioPorEmail = (tx: Tx, org: Org, email: string) => um<Usuario>(tx, 'SELECT * FROM usuarios WHERE organizacao_id = $1 AND email = $2', [org.id, email]);
const usuarioPorId = (tx: Tx, org: Org, id: string) => um<Usuario>(tx, 'SELECT * FROM usuarios WHERE organizacao_id = $1 AND id = $2', [org.id, id]);

// ─────────── Desafios e etapas (5.2) ───────────
async function novoDesafio(tx: Tx, org: Org, usuarioId: string | null, d: Record<string, unknown> = {}) {
  const id = novoId('dsf');
  await tx.query(`INSERT INTO desafios (organizacao_id, id, usuario_id, nativo, convite_id, email_pendente, codigo_hash, termos_versao, expira_em)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9))`,
    [org.id, id, usuarioId, !!d.nativo, d.conviteId ?? null, d.emailPendente ?? null, d.codigoHash ?? null, d.termosVersao ?? null, DESAFIO_MIN]);
  return (await obterDesafio(tx, org, id))!;
}
async function obterDesafio(tx: Tx, org: Org, id: string) {
  const d = await um(tx, 'SELECT * FROM desafios WHERE organizacao_id = $1 AND id = $2 AND expira_em > now()', [org.id, id]);
  if (!d) throw new ErroApi('SESSAO_EXPIRADA', 'Comece o login de novo.');
  return d;
}
/** Conta a tentativa num desafio em transação autônoma (sobrevive ao rollback do código errado). */
async function contarTentativa(_tx: Tx, org: Org, d: any) {
  const esgotou = await autonoma(org.id, async (t) => {
    const r = await um(t, 'UPDATE desafios SET tentativas = tentativas + 1 WHERE organizacao_id = $1 AND id = $2 RETURNING tentativas', [org.id, d.id]);
    if (r && r.tentativas > 5) { await t.query('DELETE FROM desafios WHERE organizacao_id = $1 AND id = $2', [org.id, d.id]); return true; }
    return false;
  });
  if (esgotou) throw new ErroApi('MUITAS_TENTATIVAS', 'Comece o login de novo.', {}, 429);
}

/** Próxima etapa a partir do estado da conta e do desafio. Ordem: MFA → TROCAR_SENHA → CONFIGURAR_MFA → ACEITAR_TERMOS. */
async function proximaEtapa(q: Req, desafio: any, extra: Record<string, unknown> = {}): Promise<Res> {
  const { tx, org } = q;
  const u = (await usuarioPorId(tx, org, desafio.usuario_id))!;
  const equipe = ehEquipe(u.perfis);
  const resp = (b: Record<string, unknown>): Res => ({ status: 200, body: { ...extra, ...b } });
  if (equipe && u.mfa_segredo_cifrado && !desafio.mfa_ok) return resp({ etapa: 'MFA', desafioId: desafio.id, metodosMfa: ['TOTP', 'CODIGO_RECUPERACAO'] });
  if (u.trocar_senha) return resp({ etapa: 'TROCAR_SENHA', desafioId: desafio.id });
  if (equipe && !u.mfa_segredo_cifrado && mfaObrigatorio(org)) return resp({ etapa: 'CONFIGURAR_MFA', desafioId: desafio.id });
  if (u.termos_aceitos_versao !== termosVersao(org)) return resp({ etapa: 'ACEITAR_TERMOS', desafioId: desafio.id, termos: { versao: termosVersao(org), url: org.configuracao.links.termosDeUso } });
  await tx.query('DELETE FROM desafios WHERE organizacao_id = $1 AND id = $2', [org.id, desafio.id]);
  const s = await criarSessao(q, u, desafio.nativo);
  return { status: 200, body: { ...extra, etapa: 'CONCLUIDO', ...s.corpo }, cookie: s.cookie };
}

// ─────────── Sessões e tokens (5.3) ───────────
function tokenAcesso(org: Org, sessaoId: string, usuarioId: string, perfil: Perfil) {
  const exp = Math.floor(Date.now() / 1000) + ACESSO_MIN * 60;
  return { tokenAcesso: assinarJwt({ org: org.id, ses: sessaoId, sub: usuarioId, perfil, exp }), expiraEm: iso(new Date(exp * 1000))! };
}
async function emitirRenovacao(q: Req, sessao: { id: string; validade_dias: number }, nativo: boolean) {
  const token = `rn.${tokenAleatorio(32)}`;
  await q.tx.query('INSERT INTO tokens_renovacao (organizacao_id, hash, sessao_id) VALUES ($1,$2,$3)', [q.org.id, sha256(token), sessao.id]);
  await q.tx.query(`UPDATE sessoes SET renovacao_expira_em = now() + validade_renovacao WHERE organizacao_id = $1 AND id = $2`, [q.org.id, sessao.id]);
  return nativo ? { corpo: { tokenRenovacao: token }, cookie: undefined } : { corpo: {}, cookie: cookie(q.org, token, sessao.validade_dias * 86400) };
}
async function criarSessao(q: Req, u: Usuario, nativo: boolean) {
  const perfil = perfilPadrao(u.perfis);
  const dias = ehEquipe(u.perfis) ? RENOVACAO_DIAS.EQUIPE : RENOVACAO_DIAS.PACIENTE;
  const id = novoId('ses');
  await q.tx.query(`INSERT INTO sessoes (organizacao_id, id, usuario_id, perfil_ativo, validade_renovacao, renovacao_expira_em)
                    VALUES ($1,$2,$3,$4, make_interval(days => $5), now() + make_interval(days => $5))`, [q.org.id, id, u.id, perfil, dias]);
  await q.tx.query('UPDATE usuarios SET ultimo_acesso_em = now() WHERE organizacao_id = $1 AND id = $2', [q.org.id, u.id]);
  await auditar(q.tx, q.org.id, { usuarioId: u.id, acao: 'ENTRAR', recurso: 'sessao', recursoId: id, ip: q.ip, requestId: q.requestId });
  const r = await emitirRenovacao(q, { id, validade_dias: dias }, nativo);
  return { corpo: { ...tokenAcesso(q.org, id, u.id, perfil), ...r.corpo }, cookie: r.cookie };
}
export async function revogarSessao(tx: Tx, org: Org, sessaoId: string, usuarioId: string, motivo: string) {
  const r = await tx.query('UPDATE sessoes SET revogada_em = now(), motivo_revogacao = $3 WHERE organizacao_id = $1 AND id = $2 AND revogada_em IS NULL', [org.id, sessaoId, motivo]);
  if (r.rowCount) await emitir(tx, org.id, 'sessao.encerrada', { motivo }, [usuarioId]);
}
export async function revogarSessoesDoUsuario(tx: Tx, org: Org, usuarioId: string, motivo: string) {
  const r = await tx.query('UPDATE sessoes SET revogada_em = now(), motivo_revogacao = $3 WHERE organizacao_id = $1 AND usuario_id = $2 AND revogada_em IS NULL', [org.id, usuarioId, motivo]);
  if (r.rowCount) await emitir(tx, org.id, 'sessao.encerrada', { motivo }, [usuarioId]);
}

// ─────────── Convites ───────────
export async function obterConvite(tx: Tx, org: Org, token: string) {
  const c = await um(tx, 'SELECT * FROM convites WHERE organizacao_id = $1 AND token_hash = $2', [org.id, sha256(token)]);
  if (!c || c.usado_em || c.revogado_em) throw new ErroApi('CONVITE_INVALIDO', 'Este convite não é válido.');
  if (new Date(c.expira_em).getTime() <= Date.now()) throw new ErroApi('CONVITE_EXPIRADO', 'Peça um novo convite à equipe.');
  return c;
}
export function convitePublico(org: Org, c: any) {
  const partes = String(c.nome).trim().split(/\s+/);
  return {
    tipo: c.tipo, organizacao: { slug: org.slug, nome: org.nome },
    nomeParcial: partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0],
    emailMascarado: mascarar(c.email), expiraEm: iso(c.expira_em),
  };
}
async function concluirConvite(q: Req, c: any, email: string, termos: string): Promise<Res> {
  const { tx, org } = q;
  await tx.query('UPDATE convites SET usado_em = now() WHERE organizacao_id = $1 AND id = $2', [org.id, c.id]);
  if (c.tipo === 'EQUIPE') {
    await tx.query(`UPDATE usuarios SET status = 'ATIVO', email = $3, termos_aceitos_versao = $4, trocar_senha = true, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2`, [org.id, c.usuario_id, email, termos]);
    const gestores = await tx.query(`SELECT id FROM usuarios WHERE organizacao_id = $1 AND status = 'ATIVO' AND 'GESTOR' = ANY(perfis)`, [org.id]);
    for (const g of gestores.rows) await notificar(tx, org, g.id, { tipo: 'CONVITE_ACEITO', titulo: 'Convite aceito', texto: `${c.nome} entrou na equipe.`, destino: { tela: 'equipe.lista' } }, q.log);
    return proximaEtapa(q, await novoDesafio(tx, org, c.usuario_id, { nativo: q.nativo }));
  }
  // Paciente: cria a conta ou vincula a uma existente com o mesmo e-mail (tutora com dois pets — ADR-0005).
  let u = await usuarioPorEmail(tx, org, email);
  if (u && !u.perfis.includes('PACIENTE')) throw invalido('email', 'Este e-mail pertence a um membro da equipe.');
  if (!u) {
    const id = novoId('usr');
    await tx.query(`INSERT INTO usuarios (organizacao_id, id, email, nome, nome_exibicao, perfis, status, termos_aceitos_versao) VALUES ($1,$2,$3,$4,$4,'{PACIENTE}','ATIVO',$5)`,
      [org.id, id, email, c.nome_conta ?? c.nome, termos]);
    u = (await usuarioPorId(tx, org, id))!;
  } else await tx.query('UPDATE usuarios SET termos_aceitos_versao = $3, status = $4 WHERE organizacao_id = $1 AND id = $2', [org.id, u.id, termos, 'ATIVO']);
  await tx.query('INSERT INTO vinculos (organizacao_id, usuario_id, paciente_id, relacao) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [org.id, u.id, c.paciente_id, c.relacao]);
  if (c.criado_por) await notificar(tx, org, c.criado_por, { tipo: 'CONVITE_ACEITO', titulo: 'Convite aceito', texto: 'Um paciente ativou o acesso ao app.', destino: { tela: 'pacientes.detalhe', parametros: { pacienteId: c.paciente_id } } }, q.log);
  await emitir(tx, org.id, 'sessao.manifesto.alterado', {}, [u.id]);
  return proximaEtapa(q, await novoDesafio(tx, org, u.id, { nativo: q.nativo }));
}
const senhaForte = (s: string) => s.length >= 10 && /[A-Za-z]/.test(s) && /\d/.test(s);

// ─────────── Handlers ───────────
export const handlersAuth: Record<string, Handler> = {
  authEntrar: async (q) => {
    const email = q.body.email as string;
    await limitar(q.tx, q.org.id, `entrar:ip:${q.ip}`, 30);
    await limitar(q.tx, q.org.id, `entrar:email:${email}`, 5);
    const u = await usuarioPorEmail(q.tx, q.org, email);
    // Mesma resposta e custo parecido para conta inexistente (não revela quem tem conta).
    const senhaOk = u?.senha_hash ? await conferirSenha(u.senha_hash, q.body.senha) : (await hashSenha('x'), false);
    if (!u || !senhaOk || u.status !== 'ATIVO' || !ehEquipe(u.perfis)) throw new ErroApi('AUTENTICACAO_INVALIDA', 'Confira o e-mail e a senha.');
    await zerarLimite(q.tx, q.org.id, `entrar:email:${email}`);
    return proximaEtapa(q, await novoDesafio(q.tx, q.org, u.id, { nativo: q.nativo }));
  },
  authSolicitarCodigo: async (q) => {
    const email = q.body.email as string;
    await limitar(q.tx, q.org.id, `codigo:ip:${q.ip}`, 30);
    await limitar(q.tx, q.org.id, `codigo:email:${email}`, 5);
    const u = await usuarioPorEmail(q.tx, q.org, email);
    if (u && u.status === 'ATIVO' && u.perfis.includes('PACIENTE')) {
      const codigo = config.modoTeste.codigoEmail ?? String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      await q.tx.query(`INSERT INTO codigos_email (organizacao_id, email, codigo_hash, expira_em) VALUES ($1,$2,$3, now() + interval '10 minutes')
                        ON CONFLICT (organizacao_id, email) DO UPDATE SET codigo_hash = EXCLUDED.codigo_hash, tentativas = 0, expira_em = EXCLUDED.expira_em`, [q.org.id, email, hashCodigo(q.org, email, codigo)]);
      enviarEmail({ org: q.org.slug, para: email, assunto: `Seu código de acesso — ${q.org.nome}`, texto: `Seu código é ${codigo}. Ele vale por 10 minutos.` }, q.log);
    }
    return { status: 202 }; // sempre 202: não revela se o e-mail existe
  },
  authVerificarCodigo: async (q) => {
    const { email, codigo, desafioId } = q.body;
    if (desafioId) { // confirmação de e-mail diferente no aceite de convite
      const d = await obterDesafio(q.tx, q.org, desafioId);
      if (d.email_pendente !== email) throw new ErroApi('CODIGO_INVALIDO');
      await contarTentativa(q.tx, q.org, d);
      if (!iguais(d.codigo_hash, hashCodigo(q.org, email, codigo))) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código e tente de novo.');
      const c = await um(q.tx, 'SELECT * FROM convites WHERE organizacao_id = $1 AND id = $2 AND usado_em IS NULL', [q.org.id, d.convite_id]);
      if (!c) throw new ErroApi('CONVITE_INVALIDO');
      await q.tx.query('DELETE FROM desafios WHERE organizacao_id = $1 AND id = $2', [q.org.id, d.id]);
      return concluirConvite(q, c, email, d.termos_versao);
    }
    const reg = await um(q.tx, 'SELECT * FROM codigos_email WHERE organizacao_id = $1 AND email = $2', [q.org.id, email]);
    if (!reg) throw new ErroApi('CODIGO_INVALIDO', 'Peça um novo código.');
    const apagar = () => autonoma(q.org.id, (t) => t.query('DELETE FROM codigos_email WHERE organizacao_id = $1 AND email = $2', [q.org.id, email]));
    if (new Date(reg.expira_em).getTime() <= Date.now()) { await apagar(); throw new ErroApi('CODIGO_EXPIRADO', 'Peça um novo código.'); }
    if (reg.tentativas >= 5) { await apagar(); throw new ErroApi('MUITAS_TENTATIVAS', 'Peça um novo código.', {}, 429); }
    if (!iguais(reg.codigo_hash, hashCodigo(q.org, email, codigo))) {
      await autonoma(q.org.id, (t) => t.query('UPDATE codigos_email SET tentativas = tentativas + 1 WHERE organizacao_id = $1 AND email = $2', [q.org.id, email]));
      throw new ErroApi('CODIGO_INVALIDO', 'Confira o código e tente de novo.');
    }
    await q.tx.query('DELETE FROM codigos_email WHERE organizacao_id = $1 AND email = $2', [q.org.id, email]);
    const u = (await usuarioPorEmail(q.tx, q.org, email))!;
    return proximaEtapa(q, await novoDesafio(q.tx, q.org, u.id, { nativo: q.nativo }));
  },
  authAceitarConvite: async (q) => {
    const c = await obterConvite(q.tx, q.org, q.params.token);
    if (q.body.termosVersao !== termosVersao(q.org)) throw invalido('termosVersao', 'Os termos foram atualizados. Recarregue a página.');
    if (!c.email || c.email === q.body.email) return concluirConvite(q, c, q.body.email, q.body.termosVersao);
    if (c.tipo === 'EQUIPE') throw invalido('email', 'Use o e-mail que recebeu o convite.');
    const codigo = config.modoTeste.codigoEmail ?? String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const d = await novoDesafio(q.tx, q.org, null, { conviteId: c.id, emailPendente: q.body.email, codigoHash: hashCodigo(q.org, q.body.email, codigo), termosVersao: q.body.termosVersao, nativo: q.nativo });
    enviarEmail({ org: q.org.slug, para: q.body.email, assunto: `Confirme seu e-mail — ${q.org.nome}`, texto: `Seu código é ${codigo}. Ele vale por 10 minutos.` }, q.log);
    return ok({ etapa: 'CODIGO_ENVIADO', desafioId: d.id, emailMascarado: mascarar(q.body.email) });
  },
  authVerificarMfa: async (q) => {
    const d = await obterDesafio(q.tx, q.org, q.body.desafioId);
    const u = d.usuario_id ? await usuarioPorId(q.tx, q.org, d.usuario_id) : null;
    if (!u?.mfa_segredo_cifrado) throw new ErroApi('CODIGO_INVALIDO');
    await contarTentativa(q.tx, q.org, d);
    const codigo = String(q.body.codigo).trim();
    const h = sha256(`${u.id}|${codigo.toUpperCase()}`);
    if (u.codigos_recuperacao_hash.includes(h)) {
      await q.tx.query('UPDATE usuarios SET codigos_recuperacao_hash = array_remove(codigos_recuperacao_hash, $3) WHERE organizacao_id = $1 AND id = $2', [q.org.id, u.id, h]); // uso único
    } else {
      const janela = janelaTotp(decifrar(u.mfa_segredo_cifrado), codigo, Number((u as any).mfa_ultima_janela ?? 0));
      if (janela === null) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código do autenticador.');
      await q.tx.query('UPDATE usuarios SET mfa_ultima_janela = $3 WHERE organizacao_id = $1 AND id = $2', [q.org.id, u.id, janela]);
    }
    await q.tx.query('UPDATE desafios SET mfa_ok = true WHERE organizacao_id = $1 AND id = $2', [q.org.id, d.id]);
    return proximaEtapa(q, { ...d, mfa_ok: true });
  },
  authIniciarTotp: async (q) => {
    const d = await obterDesafio(q.tx, q.org, q.body.desafioId);
    const u = d.usuario_id ? await usuarioPorId(q.tx, q.org, d.usuario_id) : null;
    if (!u || u.mfa_segredo_cifrado) throw new ErroApi('VALIDACAO_FALHOU', 'O autenticador já está configurado.');
    const segredo = novoSegredoTotp();
    await q.tx.query('UPDATE desafios SET segredo_pendente_cifrado = $3 WHERE organizacao_id = $1 AND id = $2', [q.org.id, d.id, cifrar(segredo)]);
    const emissor = encodeURIComponent(q.org.configuracao.pwa.nomeCurto);
    return ok({ uriOtpauth: `otpauth://totp/${emissor}:${encodeURIComponent(u.email)}?secret=${segredo}&issuer=${emissor}&digits=6&period=30`, segredo });
  },
  authConfirmarTotp: async (q) => {
    const d = await obterDesafio(q.tx, q.org, q.body.desafioId);
    if (!d.segredo_pendente_cifrado) throw new ErroApi('VALIDACAO_FALHOU', 'Inicie a configuração do autenticador.');
    await contarTentativa(q.tx, q.org, d);
    if (!totpValido(decifrar(d.segredo_pendente_cifrado), q.body.codigo)) throw new ErroApi('CODIGO_INVALIDO', 'Confira o código do autenticador.');
    const codigos = Array.from({ length: 8 }, () => tokenAleatorio(6).replace(/[^A-Za-z0-9]/g, 'X').slice(0, 8).toUpperCase().replace(/(.{4})/, '$1-'));
    await q.tx.query('UPDATE usuarios SET mfa_segredo_cifrado = $3, codigos_recuperacao_hash = $4, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2',
      [q.org.id, d.usuario_id, d.segredo_pendente_cifrado, codigos.map((c) => sha256(`${d.usuario_id}|${c}`))]);
    await q.tx.query('UPDATE desafios SET mfa_ok = true WHERE organizacao_id = $1 AND id = $2', [q.org.id, d.id]);
    return proximaEtapa(q, { ...d, mfa_ok: true }, { codigosRecuperacao: codigos });
  },
  authTrocarSenha: async (q) => {
    const d = await obterDesafio(q.tx, q.org, q.body.desafioId);
    const u = d.usuario_id ? await usuarioPorId(q.tx, q.org, d.usuario_id) : null;
    if (!u?.trocar_senha) throw new ErroApi('VALIDACAO_FALHOU', 'Não há troca de senha pendente.');
    if (!senhaForte(q.body.novaSenha) || (u.senha_hash && (await conferirSenha(u.senha_hash, q.body.novaSenha)))) throw invalido('novaSenha', 'Use ao menos 10 caracteres, com letras e números, diferente da atual.');
    await q.tx.query('UPDATE usuarios SET senha_hash = $3, trocar_senha = false, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2', [q.org.id, u.id, await hashSenha(q.body.novaSenha)]);
    return proximaEtapa(q, d);
  },
  authAceitarTermos: async (q) => {
    const d = await obterDesafio(q.tx, q.org, q.body.desafioId);
    if (q.body.termosVersao !== termosVersao(q.org)) throw invalido('termosVersao', 'Versão dos termos desatualizada.');
    await q.tx.query('UPDATE usuarios SET termos_aceitos_versao = $3 WHERE organizacao_id = $1 AND id = $2', [q.org.id, d.usuario_id, q.body.termosVersao]);
    return proximaEtapa(q, d);
  },
  authEsqueciSenha: async (q) => {
    await limitar(q.tx, q.org.id, `esqueci:email:${q.body.email}`, 3);
    await limitar(q.tx, q.org.id, `esqueci:ip:${q.ip}`, 20);
    const u = await usuarioPorEmail(q.tx, q.org, q.body.email);
    if (u?.senha_hash && u.status === 'ATIVO') {
      const token = tokenAleatorio(24);
      await q.tx.query(`INSERT INTO tokens_senha (organizacao_id, hash, usuario_id, expira_em) VALUES ($1,$2,$3, now() + interval '1 hour')`, [q.org.id, sha256(token), u.id]);
      enviarEmail({ org: q.org.slug, para: u.email, assunto: `Redefinir senha — ${q.org.nome}`, texto: `Use este token em até 1 hora: ${token}` }, q.log);
    }
    return { status: 202 };
  },
  authRedefinirSenha: async (q) => {
    const t = await um(q.tx, 'SELECT * FROM tokens_senha WHERE organizacao_id = $1 AND hash = $2 AND usado_em IS NULL AND expira_em > now()', [q.org.id, sha256(q.body.token)]);
    if (!t) throw new ErroApi('CODIGO_EXPIRADO', 'Peça um novo link de redefinição.');
    if (!senhaForte(q.body.novaSenha)) throw invalido('novaSenha', 'Use ao menos 10 caracteres, com letras e números.');
    await q.tx.query('UPDATE usuarios SET senha_hash = $3, trocar_senha = false, versao = versao + 1 WHERE organizacao_id = $1 AND id = $2', [q.org.id, t.usuario_id, await hashSenha(q.body.novaSenha)]);
    await q.tx.query('UPDATE tokens_senha SET usado_em = now() WHERE organizacao_id = $1 AND hash = $2', [q.org.id, t.hash]);
    await revogarSessoesDoUsuario(q.tx, q.org, t.usuario_id, 'SENHA_REDEFINIDA');
    return vazio();
  },
  authRenovar: async (q) => {
    const token = q.nativo ? q.body?.tokenRenovacao : q.cookieRenovacao ?? q.body?.tokenRenovacao;
    const reg = token ? await um(q.tx, 'SELECT * FROM tokens_renovacao WHERE organizacao_id = $1 AND hash = $2', [q.org.id, sha256(token)]) : null;
    if (!reg) throw new ErroApi('SESSAO_EXPIRADA', 'Entre novamente.');
    const s = await um(q.tx, `SELECT s.*, extract(day from s.validade_renovacao)::int AS validade_dias FROM sessoes s WHERE organizacao_id = $1 AND id = $2`, [q.org.id, reg.sessao_id]);
    if (!s || s.revogada_em) throw new ErroApi('SESSAO_REVOGADA', 'Entre novamente.');
    if (reg.usado_em) {
      // Reuso de token de renovação: sinal de roubo. Revoga a sessão inteira (5.3).
      await revogarSessao(q.tx, q.org, s.id, s.usuario_id, 'REUSO_DE_TOKEN');
      await auditar(q.tx, q.org.id, { usuarioId: s.usuario_id, acao: 'REUSO_TOKEN_RENOVACAO', recurso: 'sessao', recursoId: s.id, ip: q.ip, requestId: q.requestId });
      return { status: 401, body: new ErroApi('SESSAO_REVOGADA', 'Por segurança, entre novamente.').problema(q.requestId), headers: { 'Content-Type': 'application/problem+json' }, depoisDoCommit: undefined };
    }
    if (new Date(s.renovacao_expira_em).getTime() <= Date.now()) throw new ErroApi('SESSAO_EXPIRADA', 'Entre novamente.');
    const u = await usuarioPorId(q.tx, q.org, s.usuario_id);
    if (!u || u.status !== 'ATIVO') throw new ErroApi('SESSAO_REVOGADA', 'Entre novamente.');
    await q.tx.query('UPDATE tokens_renovacao SET usado_em = now() WHERE organizacao_id = $1 AND hash = $2', [q.org.id, reg.hash]);
    const r = await emitirRenovacao(q, { id: s.id, validade_dias: s.validade_dias }, q.nativo);
    return { status: 200, body: { ...tokenAcesso(q.org, s.id, s.usuario_id, s.perfil_ativo), ...r.corpo }, cookie: r.cookie };
  },
  authSair: async (q) => {
    const ctx = C(q);
    if (q.body?.todas) await revogarSessoesDoUsuario(q.tx, q.org, ctx.usuario.id, 'SAIDA_TODOS_APARELHOS');
    else await q.tx.query('UPDATE sessoes SET revogada_em = now(), motivo_revogacao = $3 WHERE organizacao_id = $1 AND id = $2', [q.org.id, ctx.sessaoId, 'SAIDA']);
    return { status: 204, cookie: cookie(q.org, '', 0) };
  },
  sessaoTrocarPerfil: async (q) => {
    const ctx = C(q);
    if (!ctx.usuario.perfis.includes(q.body.perfil)) throw invalido('perfil', 'Você não tem este perfil.');
    // O perfil vai no token (ADR-0008); a sessão guarda o último para a renovação.
    await q.tx.query('UPDATE sessoes SET perfil_ativo = $3 WHERE organizacao_id = $1 AND id = $2', [q.org.id, ctx.sessaoId, q.body.perfil]);
    return ok(tokenAcesso(q.org, ctx.sessaoId, ctx.usuario.id, q.body.perfil));
  },
};
