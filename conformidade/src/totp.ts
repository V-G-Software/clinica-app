// TOTP (RFC 6238) para a suíte entrar como equipe sem depender de valor fixo do backend.
// Nunca reusa um código da mesma janela de 30 s (backends reais costumam bloquear reuso).
import { createHmac } from 'node:crypto';

function base32(s: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += alfabeto.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totp(segredo: string, janela: number): string {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(janela));
  const h = createHmac('sha1', base32(segredo)).update(c).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
const usadas = new Map<string, number>();
export function registrarJanelaUsada(segredo: string, janela: number) {
  usadas.set(segredo, Math.max(usadas.get(segredo) ?? 0, janela));
}
export const janelasUsadas = () => Object.fromEntries(usadas);
/** Código de uma janela ainda não usada; espera a próxima janela se preciso. */
export async function proximoCodigo(segredo: string): Promise<string> {
  for (;;) {
    const janela = Math.floor(Date.now() / 30_000);
    if (janela > (usadas.get(segredo) ?? -1)) {
      usadas.set(segredo, janela);
      return totp(segredo, janela);
    }
    await new Promise((ok) => setTimeout(ok, (janela + 1) * 30_000 - Date.now() + 200));
  }
}
