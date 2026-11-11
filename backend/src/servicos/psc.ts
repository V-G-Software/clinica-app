// Provedores de assinatura em nuvem (PSC) — ADR-0018. Fluxo OAuth 2.0 authorization code com PKCE,
// conforme a API dos PSC da ICP-Brasil (DOC-ICP-17.01 / IN ITI 20/2020): /v0/oauth/authorize, /token e
// /signature (só hashes; `signature_format: CMS` devolve o PKCS#7 destacado para o PAdES).
//
// `teste` (PSC_TESTE=1): simulado no próprio backend — autoriza na hora (302 para o retorno com `code`),
// exige o PKCE e assina com certificado autoassinado. Recusado em produção.
// `iti`: genérico para PSC reais. ATENÇÃO: cada PSC exige cadastro do app e homologação; os detalhes
// (escopos, `lifetime`, formato do erro) podem variar e devem ser conferidos na homologação de cada um.
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.ts';
import { cmsDeTeste } from './pades.ts';

export interface Provedor {
  id: string; nome: string;
  urlAutorizacao(p: { state: string; desafio: string; redirectUri: string; quantidade: number }): string;
  trocarCodigo(p: { code: string; verificador: string; redirectUri: string }): Promise<string>;
  /** Um CMS (DER) por hash, na mesma ordem. */
  assinar(token: string, hashes: Buffer[]): Promise<Buffer[]>;
}
export class ErroPsc extends Error {}

export const pkce = () => {
  const verificador = randomBytes(32).toString('base64url');
  return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') };
};

// ─────────── PSC de teste ───────────
const codigosTeste = new Map<string, { desafio: string; redirectUri: string; expira: number }>();
const tokensTeste = new Map<string, number>();
const BASE_TESTE = () => `${config.urlPublica}/_psc-teste`;
/** Rota do "app do provedor" de teste (servidor.ts): autoriza na hora e volta ao retorno. */
export function autorizarNoPscTeste(q: { state?: string; code_challenge?: string; redirect_uri?: string }): string | null {
  if (!config.psc.teste || !q.state || !q.code_challenge || !q.redirect_uri) return null;
  if (!q.redirect_uri.startsWith(`${config.urlPublica}/o/`)) return null; // só o retorno deste backend
  const code = randomBytes(16).toString('hex');
  codigosTeste.set(code, { desafio: q.code_challenge, redirectUri: q.redirect_uri, expira: Date.now() + 5 * 60_000 });
  const u = new URL(q.redirect_uri);
  u.searchParams.set('code', code); u.searchParams.set('state', q.state);
  return u.toString();
}
const provedorTeste: Provedor = {
  id: 'teste', nome: 'Certificado de teste (simulado)',
  urlAutorizacao: ({ state, desafio, redirectUri }) => {
    const u = new URL(`${BASE_TESTE()}/autorizar`);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: 'clinica-teste', redirect_uri: redirectUri, scope: 'signature_session', state, code_challenge: desafio, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
    return u.toString();
  },
  async trocarCodigo({ code, verificador, redirectUri }) {
    const c = codigosTeste.get(code);
    codigosTeste.delete(code);
    if (!c || c.expira < Date.now() || c.redirectUri !== redirectUri) throw new ErroPsc('código inválido ou expirado');
    if (createHash('sha256').update(verificador).digest('base64url') !== c.desafio) throw new ErroPsc('PKCE não confere');
    const token = randomBytes(16).toString('hex');
    tokensTeste.set(token, Date.now() + 5 * 60_000);
    return token;
  },
  async assinar(token, hashes) {
    if ((tokensTeste.get(token) ?? 0) < Date.now()) throw new ErroPsc('token inválido');
    tokensTeste.delete(token);
    return hashes.map((h) => cmsDeTeste(h));
  },
};

// ─────────── PSC real (API do ITI) ───────────
function provedorIti(p: { id: string; nome: string; base: string; clientId: string; clientSecret: string }): Provedor {
  const base = p.base.replace(/\/$/, '');
  return {
    id: p.id, nome: p.nome,
    urlAutorizacao: ({ state, desafio, redirectUri, quantidade }) => {
      const u = new URL(`${base}/v0/oauth/authorize`);
      const q = { response_type: 'code', client_id: p.clientId, redirect_uri: redirectUri, scope: quantidade > 1 ? 'multi_signature' : 'single_signature', state, code_challenge: desafio, code_challenge_method: 'S256', lifetime: '600' };
      for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
      return u.toString();
    },
    async trocarCodigo({ code, verificador, redirectUri }) {
      const r = await fetch(`${base}/v0/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: p.clientId, client_secret: p.clientSecret, code, redirect_uri: redirectUri, code_verifier: verificador }),
      });
      const b: any = await r.json().catch(() => ({}));
      if (!r.ok || !b.access_token) throw new ErroPsc(`token recusado pelo PSC (HTTP ${r.status})`);
      return b.access_token;
    },
    async assinar(token, hashes) {
      const r = await fetch(`${base}/v0/oauth/signature`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ hashes: hashes.map((h, i) => ({ id: String(i), alias: `documento-${i + 1}`, hash: h.toString('base64'), hash_algorithm: '2.16.840.1.101.3.4.2.1', signature_format: 'CMS' })) }),
      });
      const b: any = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(b.signatures)) throw new ErroPsc(`assinatura recusada pelo PSC (HTTP ${r.status})`);
      return hashes.map((_, i) => {
        const s = b.signatures.find((x: any) => String(x.id) === String(i));
        if (!s?.raw_signature) throw new ErroPsc('PSC não devolveu todas as assinaturas');
        return Buffer.from(s.raw_signature, 'base64');
      });
    },
  };
}

export function provedores(): Provedor[] {
  return [...config.psc.provedores.map(provedorIti), ...(config.psc.teste ? [provedorTeste] : [])];
}
export const provedor = (id: string) => provedores().find((p) => p.id === id) ?? null;
