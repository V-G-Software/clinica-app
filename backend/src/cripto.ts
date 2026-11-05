// Ids, tokens, hash de senha, JWT (EdDSA), cifra do segredo TOTP e TOTP.
import { createHash, createHmac, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv, randomBytes, sign, verify, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { config } from './config.ts';

/** UUIDv7 (ordenável pelo tempo) com prefixo legível: pac_0190f3…  (4.4) */
export function novoId(prefixo: string): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return `${prefixo}_${b.toString('hex')}`;
}
export const tokenAleatorio = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const iguais = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// Senhas: argon2id (14.4).
export const hashSenha = (s: string) => argon2Hash(s, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const conferirSenha = (h: string, s: string) => argon2Verify(h, s).catch(() => false);

// JWT EdDSA (Ed25519). Claims: org, ses, sub, perfil, exp.
const privada = createPrivateKey(config.chaveJwtPrivada);
const publica = createPublicKey(privada);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function assinarJwt(claims: Record<string, unknown>): string {
  const corpo = `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64(claims)}`;
  return `${corpo}.${sign(null, Buffer.from(corpo), privada).toString('base64url')}`;
}
export function lerJwt<T = Record<string, unknown>>(token: string): T | null {
  const [h, c, s] = token.split('.');
  if (!h || !c || !s) return null;
  try {
    if (JSON.parse(Buffer.from(h, 'base64url').toString()).alg !== 'EdDSA') return null;
    if (!verify(null, Buffer.from(`${h}.${c}`), publica, Buffer.from(s, 'base64url'))) return null;
    return JSON.parse(Buffer.from(c, 'base64url').toString()) as T;
  } catch { return null; }
}

// Cifra simétrica (AES-256-GCM) para o segredo TOTP em repouso.
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', config.chaveCifra, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), dados].map((x) => x.toString('base64url')).join('.');
}
export function decifrar(cifrado: string): string {
  const [iv, tag, dados] = cifrado.split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', config.chaveCifra, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
}

// TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos) com tolerância de ±1 janela.
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const novoSegredoTotp = () => Array.from(randomBytes(20), (x) => ALFABETO[x % 32]).join('');
function base32(s: string): Buffer {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += ALFABETO.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totp(segredo: string, janela: number): string {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(janela));
  const h = createHmac('sha1', base32(segredo)).update(c).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
/** Janela TOTP aceita (±1 por desvio de relógio) ou null. Só aceita janela posterior à última usada (sem reuso). */
export function janelaTotp(segredo: string, codigo: string, ultimaUsada = 0): number | null {
  const j = Math.floor(Date.now() / 30_000);
  if (config.modoTeste.totp && codigo === config.modoTeste.totp) return j;
  for (const d of [-1, 0, 1]) if (j + d > ultimaUsada && iguais(totp(segredo, j + d), codigo)) return j + d;
  return null;
}
export const totpValido = (segredo: string, codigo: string) => janelaTotp(segredo, codigo) !== null;

/** Assinatura HMAC para URLs de arquivo do driver local. */
export const assinarUrl = (dados: string) => createHmac('sha256', config.segredoAssinatura).update(dados).digest('base64url');
