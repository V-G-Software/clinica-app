// Antivírus para arquivos que não são recodificados (PDF; ADR-0017). Falha fechada: sem antivírus
// configurado, o PDF nem é oferecido (capacidades) e é recusado no envio.
//  - ANTIVIRUS_URL=tcp://host:3310 → clamd, protocolo INSTREAM (o arquivo vai em blocos; nada em disco).
//  - ANTIVIRUS_URL=teste           → só fora de produção: reconhece a assinatura de teste EICAR.
import { connect } from 'node:net';
import { config } from '../config.ts';

export type ResultadoVerificacao = { limpo: true } | { limpo: false; assinatura: string };
export class AntivirusIndisponivel extends Error {}

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1');
const BLOCO = 64 * 1024;

/** clamd INSTREAM: "zINSTREAM\0", blocos [tamanho uint32 BE][dados], bloco vazio no fim; resposta "stream: OK". */
export function verificarClamd(url: string, bytes: Buffer, timeoutMs = 30_000): Promise<ResultadoVerificacao> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const s = connect({ host: u.hostname, port: Number(u.port || 3310) });
    const partes: Buffer[] = [];
    const falhar = (e: unknown) => { s.destroy(); reject(new AntivirusIndisponivel(String((e as Error)?.message ?? e))); };
    s.setTimeout(timeoutMs, () => falhar('tempo esgotado'));
    s.on('error', falhar);
    s.on('data', (d) => partes.push(d));
    s.on('end', () => {
      const resposta = Buffer.concat(partes).toString('utf8').replace(/\0/g, '').trim();
      if (/: OK$/.test(resposta)) resolve({ limpo: true });
      else if (/ FOUND$/.test(resposta)) resolve({ limpo: false, assinatura: resposta.replace(/^stream: /, '').replace(/ FOUND$/, '') });
      else reject(new AntivirusIndisponivel(`resposta inesperada do clamd: ${resposta.slice(0, 120)}`));
    });
    s.on('connect', () => {
      s.write('zINSTREAM\0');
      for (let i = 0; i < bytes.length; i += BLOCO) {
        const bloco = bytes.subarray(i, i + BLOCO);
        const tam = Buffer.alloc(4); tam.writeUInt32BE(bloco.length);
        s.write(tam); s.write(bloco);
      }
      s.end(Buffer.alloc(4));
    });
  });
}

export const antivirusConfigurado = () => !!config.antivirus;
export async function verificar(bytes: Buffer): Promise<ResultadoVerificacao> {
  const a = config.antivirus;
  if (!a) throw new AntivirusIndisponivel('antivírus não configurado');
  if (a === 'teste') return bytes.includes(EICAR) ? { limpo: false, assinatura: 'Eicar-Test-Signature' } : { limpo: true };
  return verificarClamd(a, bytes);
}
