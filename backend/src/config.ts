// Configuração por variáveis de ambiente. Segredos nunca no repositório (14.4).
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const e = process.env;
const producao = e.NODE_ENV === 'production';

function chaveJwt(): string {
  if (e.CHAVE_JWT_PRIVADA) return e.CHAVE_JWT_PRIVADA.replace(/\\n/g, '\n');
  if (producao) throw new Error('CHAVE_JWT_PRIVADA é obrigatória em produção');
  // Desenvolvimento: chave efêmera (tokens não sobrevivem a um reinício — renova pelo cookie).
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
function chaveCifra(): Buffer {
  if (e.CHAVE_CIFRA) return Buffer.from(e.CHAVE_CIFRA, 'base64');
  if (producao) throw new Error('CHAVE_CIFRA (32 bytes em base64) é obrigatória em produção');
  return Buffer.from('desenvolvimento-nao-use-em-prod!').subarray(0, 32);
}

function segredoAssinatura(): string {
  if (e.SEGREDO_ASSINATURA) return e.SEGREDO_ASSINATURA;
  // Sem segredo, URLs de arquivo assinadas com HMAC de chave vazia seriam forjáveis.
  if (producao) throw new Error('SEGREDO_ASSINATURA é obrigatório em produção');
  return randomBytes(32).toString('hex');
}

export const config = {
  producao,
  porta: Number(e.PORT ?? 4020),
  urlPublica: (e.URL_PUBLICA ?? `http://localhost:${e.PORT ?? 4020}`).replace(/\/$/, ''),
  bancoApp: e.DATABASE_URL ?? 'postgres://clinica_app:app_local@localhost:5432/clinica',
  bancoDono: e.DATABASE_URL_DONO ?? 'postgres://clinica_dono:dono_local@localhost:5432/clinica',
  chaveJwtPrivada: chaveJwt(),
  // Rotação: chaves anteriores (PEM, separadas por linha em branco ou `;`) ainda aceitas na verificação.
  chavesJwtAnteriores: (e.CHAVE_JWT_ANTERIOR ?? '').replace(/\\n/g, '\n').split(/;|\n\s*\n/).map((x) => x.trim()).filter(Boolean),
  chaveCifra: chaveCifra(),
  segredoAssinatura: segredoAssinatura(),
  storage: (e.STORAGE ?? 'local') as 'local' | 's3',
  storageDir: e.STORAGE_DIR ?? './.dados/arquivos',
  s3: { endpoint: e.S3_ENDPOINT, bucket: e.S3_BUCKET ?? 'clinica', regiao: e.S3_REGIAO ?? 'us-east-1' },
  email: (e.EMAIL ?? 'log') as 'log' | 'arquivo' | 'smtp',
  smtp: { url: e.SMTP_URL ?? null, remetente: e.EMAIL_REMETENTE ?? 'nao-responda@exemplo.com.br' },
  // Web Push: sem as três variáveis, o manifesto anuncia push NENHUM (o app usa e-mail e a central).
  push: e.VAPID_CHAVE_PUBLICA && e.VAPID_CHAVE_PRIVADA ? { publica: e.VAPID_CHAVE_PUBLICA, privada: e.VAPID_CHAVE_PRIVADA, assunto: e.VAPID_ASSUNTO ?? 'mailto:suporte@exemplo.com.br' } : null,
  dominioErros: e.DOMINIO_ERROS ?? 'https://exemplo.com.br/erros',
  modoTeste: { codigoEmail: e.MODO_TESTE_CODIGO_EMAIL ?? null, totp: e.MODO_TESTE_TOTP ?? null },
  validarResposta: e.VALIDAR_RESPOSTA ? e.VALIDAR_RESPOSTA === '1' : !producao,
  versaoMinimaFrontend: e.VERSAO_MINIMA_FRONTEND ?? '0.1.0',
  // Antivírus para PDF (ADR-0017): tcp://host:3310 (clamd) ou "teste" (EICAR; fora de produção). Sem ele, sem PDF.
  antivirus: e.ANTIVIRUS_URL || null,
};
if (config.producao && config.antivirus === 'teste') throw new Error('ANTIVIRUS_URL=teste não pode ser usado em produção');
if (config.producao && (config.modoTeste.codigoEmail || config.modoTeste.totp)) throw new Error('MODO_TESTE_* não pode ser usado em produção');
if (config.producao && !config.segredoAssinatura) throw new Error('SEGREDO_ASSINATURA é obrigatório em produção');
if (config.email === 'smtp' && !config.smtp.url) throw new Error('EMAIL=smtp exige SMTP_URL (ex.: smtp://usuario:senha@host:587)');
if (config.producao && config.email === 'arquivo') throw new Error('EMAIL=arquivo é só para desenvolvimento');
