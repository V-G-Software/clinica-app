// Tipos e peças comuns: organização, contexto autenticado, idempotência, auditoria, paginação, ETag.
import { createHash } from 'node:crypto';
import { permissoesDe, type ModuloAtivo, type Perfil } from '@clinica/dominio';
import type { Termo } from '@clinica/dominio';
import { lerJwt } from './cripto.ts';
import { comOrg, global, um, type Tx } from './db.ts';
import { ErroApi, invalido } from './erros.ts';

export interface Org {
  id: string; slug: string; nome: string; fuso: string; locale: string; status: 'ATIVA' | 'MANUTENCAO' | 'SUSPENSA'; mensagemStatus: string | null;
  dominios: string[]; urlApi: string; configuracao: any; termos: Record<string, Termo>; modulos: ModuloAtivo[]; capacidades: any; versao: number;
}
const cacheOrgs = new Map<string, { org: Org | null; em: number }>();
const linhaParaOrg = (r: any): Org => ({ id: r.id, slug: r.slug, nome: r.nome, fuso: r.fuso, locale: r.locale, status: r.status, mensagemStatus: r.mensagem_status, dominios: r.dominios, urlApi: r.url_api, configuracao: r.configuracao, termos: r.termos, modulos: r.modulos, capacidades: r.capacidades, versao: r.versao });
export async function orgPorSlug(slug: string): Promise<Org | null> {
  const c = cacheOrgs.get(slug);
  if (c && Date.now() - c.em < 10_000) return c.org;
  const r = await global('SELECT * FROM organizacoes WHERE slug = $1', [slug]);
  const org = r.rows[0] ? linhaParaOrg(r.rows[0]) : null;
  cacheOrgs.set(slug, { org, em: Date.now() });
  return org;
}
export async function orgPorDominio(dominio: string): Promise<Org | null> {
  const r = await global('SELECT * FROM organizacoes WHERE $1 = ANY(dominios)', [dominio.toLowerCase()]);
  return r.rows[0] ? linhaParaOrg(r.rows[0]) : null;
}
export const esquecerOrg = (slug: string) => cacheOrgs.delete(slug);

export interface Usuario {
  id: string; email: string; nome: string; nome_exibicao: string; senha_hash: string | null; perfis: string[]; status: string;
  mfa_segredo_cifrado: string | null; codigos_recuperacao_hash: string[]; trocar_senha: boolean; termos_aceitos_versao: string | null;
  rotulos_perfis: Record<string, string>; profissional: any; preferencias: any; preferencias_notificacao: Record<string, { push: boolean; email: boolean }>;
  foto_arquivo_id: string | null; ultimo_acesso_em: Date | null; versao: number; criado_em: Date;
}
export interface Ctx { org: Org; usuario: Usuario; sessaoId: string; perfil: Perfil; perms: Set<string> }

export interface ClaimsAcesso { org: string; ses: string; sub: string; perfil: Perfil; exp: number }

/** Bearer → contexto. A sessão é conferida no banco a cada requisição: revogação vale na hora (RN-EQP-002). */
export async function autenticar(tx: Tx, org: Org, authorization: string | undefined): Promise<Ctx> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const c = token ? lerJwt<ClaimsAcesso>(token) : null;
  // Token de outra organização é tratado como inválido: a organização vem do token, nunca de entrada livre.
  if (!c || c.org !== org.id || c.exp * 1000 <= Date.now()) throw new ErroApi('SESSAO_EXPIRADA', 'Renove o token de acesso.');
  const s = await um(tx, `SELECT s.revogada_em, u.* FROM sessoes s JOIN usuarios u ON u.organizacao_id = s.organizacao_id AND u.id = s.usuario_id
                           WHERE s.id = $1 AND s.usuario_id = $2`, [c.ses, c.sub]);
  if (!s || s.revogada_em || s.status !== 'ATIVO') throw new ErroApi('SESSAO_REVOGADA', 'Entre novamente.');
  if (org.status === 'SUSPENSA') throw new ErroApi('ORGANIZACAO_SUSPENSA');
  const perfil: Perfil = s.perfis.includes(c.perfil) ? c.perfil : (s.perfis[0] as Perfil);
  if (!s.ultimo_acesso_em || Date.now() - new Date(s.ultimo_acesso_em).getTime() > 5 * 60_000)
    await tx.query('UPDATE usuarios SET ultimo_acesso_em = now() WHERE organizacao_id = $1 AND id = $2', [org.id, s.id]);
  return { org, usuario: s as Usuario, sessaoId: c.ses, perfil, perms: new Set(permissoesDe(org.modulos, perfil)) };
}

export function exigir(ctx: Ctx, perm: string, comoNaoEncontrado = false) {
  if (!ctx.perms.has(perm)) throw comoNaoEncontrado ? new ErroApi('RECURSO_NAO_ENCONTRADO', 'Recurso não encontrado.') : new ErroApi('PERMISSAO_NEGADA', 'Você não pode fazer isso.');
}
export function exigirModulo(org: Org, id: string) {
  if (!org.modulos.some((m) => m.id === id)) throw new ErroApi('MODULO_NAO_CONTRATADO', `O módulo ${id} não está ativo nesta organização.`);
}
export const ehEquipeCtx = (ctx: Ctx) => ctx.perfil !== 'PACIENTE';

// ETag / If-Match (4.7).
export const etag = (id: string, versao: number) => `"${id}-${versao}"`;
export function conferirIfMatch(ifMatch: string | undefined, id: string, versao: number, estadoAtual: () => unknown) {
  if (ifMatch !== etag(id, versao)) throw new ErroApi('CONFLITO_VERSAO', 'Recarregue e tente de novo.', { estadoAtual: estadoAtual() });
}

// Paginação por cursor opaco (keyset quando possível; aqui offset assinado por consulta simples).
export function lerCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = JSON.parse(Buffer.from(cursor, 'base64url').toString()).o;
    if (Number.isInteger(o) && o >= 0) return o;
  } catch { /* cai no erro abaixo */ }
  throw invalido('cursor', 'Cursor inválido.');
}
export function pagina<T>(linhas: T[], inicio: number, limite: number) {
  const mais = linhas.length > limite;
  return { itens: linhas.slice(0, limite), proximoCursor: mais ? Buffer.from(JSON.stringify({ o: inicio + limite })).toString('base64url') : null };
}

/**
 * Limite por chave numa janela (14.4: por IP, por conta e por organização).
 * A tentativa é gravada numa transação AUTÔNOMA: a requisição que falha (senha errada) faz rollback
 * da própria transação, e o registro da tentativa não pode ir junto — senão o limite nunca acumula.
 */
export async function limitar(_tx: Tx, orgId: string, chave: string, max: number, janelaMin = 15) {
  await comOrg(orgId, async (t) => {
    const r = await um<{ n: number }>(t, `SELECT count(*)::int AS n FROM tentativas WHERE organizacao_id = $1 AND chave = $2 AND em > now() - make_interval(mins => $3)`, [orgId, chave, janelaMin]);
    if ((r?.n ?? 0) >= max) throw new ErroApi('MUITAS_TENTATIVAS', 'Aguarde alguns minutos e tente de novo.', {}, 429);
    await t.query('INSERT INTO tentativas (organizacao_id, chave) VALUES ($1, $2)', [orgId, chave]);
  });
}
export const zerarLimite = (tx: Tx, orgId: string, chave: string) => tx.query('DELETE FROM tentativas WHERE organizacao_id = $1 AND chave = $2', [orgId, chave]);
/** Executa fora da transação da requisição (sobrevive ao rollback dela). */
export const autonoma = <T>(orgId: string, fn: (t: Tx) => Promise<T>) => comOrg(orgId, fn);

/** Trilha de auditoria append-only (14.4): quem leu ou alterou, quando e de onde. */
export async function auditar(tx: Tx, orgId: string, a: { usuarioId: string | null; acao: string; recurso: string; recursoId?: string | null; ip?: string; requestId?: string }) {
  await tx.query('INSERT INTO auditoria (organizacao_id, usuario_id, acao, recurso, recurso_id, ip, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [orgId, a.usuarioId, a.acao, a.recurso, a.recursoId ?? null, a.ip ?? null, a.requestId ?? null]);
}

export const hashCorpo = (corpo: unknown, caminho: string) => createHash('sha1').update(JSON.stringify(corpo ?? null) + caminho).digest('hex');
export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
