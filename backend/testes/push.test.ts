// Web Push de ponta a ponta contra um serviço de push falso (HTTPS local): o job assina com VAPID,
// cifra (aes128gcm, RFC 8291), o conteúdo decifrado é discreto (RN-NOT-002) e inscrição morta (410) é
// apagada. As chaves VAPID são definidas ANTES de carregar a configuração (só neste arquivo de teste).
import { createECDH, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_CHAVE_PUBLICA = vapid.publicKey;
process.env.VAPID_CHAVE_PRIVADA = vapid.privateKey;
process.env.VAPID_ASSUNTO = 'mailto:teste@exemplo.com';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // só o serviço de push falso, com certificado autoassinado

const { comOrg, pool } = await import('../src/db.ts');
const { orgPorSlug } = await import('../src/nucleo.ts');
const { notificar } = await import('../src/servicos/notificar.ts');
const { executarVencidos } = await import('../src/servicos/jobs.ts');
const { capacidadePush } = await import('../src/servicos/push.ts');
const { novoId } = await import('../src/cripto.ts');

const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
let servidor: Server;
let porta = 0;
let resposta = 201;
const recebidos: Array<{ headers: Record<string, any>; corpo: Buffer }> = [];

/** Decifra aes128gcm (RFC 8188/8291) com a chave privada do "navegador". */
function decifrar(corpo: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const hmac = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
  const salt = corpo.subarray(0, 16), idlen = corpo[20], asPub = corpo.subarray(21, 21 + idlen), cifrado = corpo.subarray(21 + idlen);
  const segredo = ua.computeSecret(asPub);
  const ikm = hmac(hmac(auth, segredo), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
  return claro.subarray(0, claro.lastIndexOf(2)).toString('utf8');
}

async function contaComInscricao(org: any) {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = randomBytes(16);
  const sufixo = novoId('p').slice(-10);
  const usr = `usr_push_${sufixo}`;
  await comOrg(org.id, async (tx) => {
    await tx.query(`INSERT INTO usuarios (organizacao_id, id, email, nome, nome_exibicao, perfis, status) VALUES ($1,$2,$3,'Paciente Push','Paciente Push','{PACIENTE}','ATIVO')`, [org.id, usr, `${sufixo}@exemplo.com`]);
    await tx.query(`INSERT INTO inscricoes_push (organizacao_id, id, usuario_id, endpoint, chaves) VALUES ($1,$2,$3,$4,$5)`,
      [org.id, novoId('psh'), usr, `https://127.0.0.1:${porta}/push/${sufixo}`, { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }]);
  });
  return { usr, ua, auth };
}

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'push-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  servidor = createServer({ key: readFileSync(path.join(dir, 'k.pem')), cert: readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => { recebidos.push({ headers: req.headers, corpo: Buffer.concat(partes) }); res.writeHead(resposta).end(); });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
  porta = (servidor.address() as any).port;
});
afterAll(async () => { servidor.close(); await pool.end(); });

describe('Web Push (VAPID)', () => {
  it('manifesto anuncia WEB_PUSH com a chave pública do servidor (não a do cenário)', () => {
    expect(capacidadePush()).toEqual({ modo: 'WEB_PUSH', chavePublicaVapid: vapid.publicKey });
  });

  it('notificação vira job; o push sai assinado, cifrado e com conteúdo discreto', async () => {
    const org = (await orgPorSlug('modelo-otorrino'))!;
    const { usr, ua, auth } = await contaComInscricao(org);
    resposta = 201;
    await comOrg(org.id, (tx) => notificar(tx, org, usr, { tipo: 'ALERTA_CRIADO', titulo: 'Dor 8 ou mais relatada', texto: 'Marcos Souza: Dor 8 ou mais relatada.', destino: { tela: 'acompanhamento.detalhe', parametros: { acompanhamentoId: 'acp_x' } } }, log));
    const antes = recebidos.length;
    while (await executarVencidos(log) > 0);
    expect(recebidos.length).toBe(antes + 1);
    const { headers, corpo } = recebidos.at(-1)!;
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(headers.urgency).toBe('high');
    const conteudo = JSON.parse(decifrar(corpo, ua, auth));
    expect(conteudo).toMatchObject({ titulo: org.nome, tipo: 'ALERTA_CRIADO', destino: { tela: 'acompanhamento.detalhe' } });
    // RN-NOT-002: nada do conteúdo clínico nem nome do paciente sai pelo push.
    expect(JSON.stringify(conteudo)).not.toMatch(/Marcos|Dor 8/);
  });

  it('inscrição que o serviço diz não existir mais (410) é apagada; o job não fica tentando', async () => {
    const org = (await orgPorSlug('modelo-otorrino'))!;
    const { usr } = await contaComInscricao(org);
    resposta = 410;
    await comOrg(org.id, (tx) => notificar(tx, org, usr, { tipo: 'CHECKIN_DISPONIVEL', titulo: 'x', texto: 'x', destino: null }, log));
    while (await executarVencidos(log) > 0);
    const restantes = await comOrg(org.id, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM inscricoes_push WHERE organizacao_id = $1 AND usuario_id = $2', [org.id, usr])).rows[0].n);
    expect(restantes).toBe(0);
    const jobs = await comOrg(org.id, async (tx) => (await tx.query(`SELECT count(*)::int AS n FROM jobs WHERE organizacao_id = $1 AND tipo = 'push.enviar'`, [org.id])).rows[0].n);
    expect(jobs).toBe(0);
  });
});
