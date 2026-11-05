// E-mail por adaptador (14.1). `log` registra só o fato (nunca o conteúdo); `arquivo` grava em
// .dados/emails.jsonl para desenvolvimento local (proibido em produção); `smtp` fica para a F3.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

export interface Email { para: string; assunto: string; texto: string; org: string }
export function enviarEmail(e: Email, log: { info: (o: unknown, m: string) => void }) {
  if (config.email === 'arquivo' && !config.producao) {
    const arq = path.resolve('.dados/emails.jsonl');
    mkdirSync(path.dirname(arq), { recursive: true });
    appendFileSync(arq, JSON.stringify({ ...e, enviadoEm: new Date().toISOString() }) + '\n');
    return;
  }
  log.info({ org: e.org, dominio: e.para.split('@')[1] }, 'e-mail enfileirado'); // sem destinatário completo nem conteúdo
}
