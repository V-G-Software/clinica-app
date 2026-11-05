// Gera as chaves do backend em formato de variável de ambiente. Em produção, guarde num cofre
// (nunca no repositório) e rotacione a de JWT com sobreposição (ver ADR-0013, limitações).
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
console.log(`CHAVE_JWT_PRIVADA="${pem.trim().replace(/\n/g, '\\n')}"`);
console.log(`CHAVE_CIFRA=${randomBytes(32).toString('base64')}`);
console.log(`SEGREDO_ASSINATURA=${randomBytes(32).toString('base64url')}`);
