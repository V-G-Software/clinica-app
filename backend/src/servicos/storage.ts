// Storage de arquivos (8.3) por adaptador. O frontend só segue as instruções de envio.
// - local: disco + URLs assinadas por HMAC servidas pelo próprio backend (dev/teste; o contrato permite).
// - s3: URLs pré-assinadas (PUT para a quarentena, GET de visualização de até 5 minutos).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assinarUrl, iguais } from '../cripto.ts';
import { config } from '../config.ts';

export interface Storage {
  urlEnvio(chave: string, tipo: string, expiraEm: number): Promise<{ url: string; metodo: 'PUT'; cabecalhos: Record<string, string> }>;
  ler(chave: string): Promise<Buffer | null>;
  gravar(chave: string, bytes: Buffer, tipo: string): Promise<void>;
  urlVisualizacao(chave: string, expiraEm: number): Promise<string>;
}

class StorageLocal implements Storage {
  private caminho(chave: string) { return path.resolve(config.storageDir, chave.replace(/[^A-Za-z0-9_/.-]/g, '')); }
  async urlEnvio(chave: string, tipo: string, exp: number) {
    return { url: `${config.urlPublica}/_arquivos/envio/${chave}?exp=${exp}&ass=${assinarUrl(`PUT|${chave}|${exp}|${tipo}`)}`, metodo: 'PUT' as const, cabecalhos: { 'Content-Type': tipo } };
  }
  conferir(metodo: string, chave: string, exp: number, ass: string, tipo = '') { return exp > Date.now() && iguais(ass, assinarUrl(`${metodo}|${chave}|${exp}|${tipo}`)); }
  async ler(chave: string) { const p = this.caminho(chave); return existsSync(p) ? readFileSync(p) : null; }
  async gravar(chave: string, bytes: Buffer) { const p = this.caminho(chave); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, bytes); }
  async urlVisualizacao(chave: string, exp: number) { return `${config.urlPublica}/_arquivos/ver/${chave}?exp=${exp}&ass=${assinarUrl(`GET|${chave}|${exp}|`)}`; }
}

class StorageS3 implements Storage {
  private s3 = new S3Client({ region: config.s3.regiao, endpoint: config.s3.endpoint, forcePathStyle: !!config.s3.endpoint });
  async urlEnvio(chave: string, tipo: string, exp: number) {
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: config.s3.bucket, Key: chave, ContentType: tipo }), { expiresIn: Math.max(60, Math.floor((exp - Date.now()) / 1000)) });
    return { url, metodo: 'PUT' as const, cabecalhos: { 'Content-Type': tipo } };
  }
  async ler(chave: string) {
    try { const r = await this.s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: chave })); return Buffer.from(await r.Body!.transformToByteArray()); } catch { return null; }
  }
  async gravar(chave: string, bytes: Buffer, tipo: string) { await this.s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: chave, Body: bytes, ContentType: tipo })); }
  async urlVisualizacao(chave: string, exp: number) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: config.s3.bucket, Key: chave }), { expiresIn: Math.max(60, Math.floor((exp - Date.now()) / 1000)) });
  }
}

export const storageLocal = new StorageLocal();
export const storage: Storage = config.storage === 's3' ? new StorageS3() : storageLocal;
