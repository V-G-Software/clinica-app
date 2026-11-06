// Rotação da chave do JWT: depois de trocar CHAVE_JWT_PRIVADA, tokens da chave anterior continuam válidos
// só enquanto ela estiver em CHAVE_JWT_ANTERIOR; tokens forjados (alg none, kid trocado) nunca valem.
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const nova = () => generateKeyPairSync('ed25519');
const pem = (k: ReturnType<typeof nova>) => k.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = (k: ReturnType<typeof nova>) => k.publicKey.export({ type: 'spki', format: 'pem' }).toString();
async function carregar(atual: string, anterior?: string) {
  vi.resetModules();
  process.env.CHAVE_JWT_PRIVADA = atual;
  if (anterior) process.env.CHAVE_JWT_ANTERIOR = anterior; else delete process.env.CHAVE_JWT_ANTERIOR;
  return import('../src/cripto.ts');
}
const claims = { org: 'org_x', ses: 'ses_x', sub: 'usr_x', perfil: 'GESTOR', exp: Math.floor(Date.now() / 1000) + 900 };

describe('rotação da chave JWT', () => {
  const a = nova(), b = nova();

  it('token da chave anterior vale durante a rotação e deixa de valer quando ela sai', async () => {
    const tokenA = (await carregar(pem(a))).assinarJwt(claims);
    const comAnterior = await carregar(pem(b), pub(a));
    expect(comAnterior.lerJwt(tokenA)).toMatchObject({ sub: 'usr_x' });
    expect(comAnterior.lerJwt(comAnterior.assinarJwt(claims))).toMatchObject({ sub: 'usr_x' });
    expect((await carregar(pem(b))).lerJwt(tokenA)).toBeNull();
  });

  it('aceita a anterior em PEM privada também (o operador cola o que tiver no cofre)', async () => {
    const tokenA = (await carregar(pem(a))).assinarJwt(claims);
    expect((await carregar(pem(b), pem(a))).lerJwt(tokenA)).not.toBeNull();
  });

  it('recusa alg none e kid apontando para outra chave', async () => {
    const m = await carregar(pem(b), pub(a));
    const corpo = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(m.lerJwt(`${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${corpo}.`)).toBeNull();
    const [h, c, s] = m.assinarJwt(claims).split('.');
    const outroKid = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(h, 'base64url').toString()), kid: 'inexistente' })).toString('base64url');
    expect(m.lerJwt(`${outroKid}.${c}.${s}`)).toBeNull();
  });
});
