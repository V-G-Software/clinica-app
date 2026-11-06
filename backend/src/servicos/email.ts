// E-mail por adaptador (14.1). `log` registra só o fato (nunca o conteúdo nem o destinatário completo);
// `arquivo` grava em .dados/emails.jsonl para desenvolvimento (proibido em produção); `smtp` envia por
// SMTP (Mailpit em desenvolvimento; SES/Resend/qualquer provedor SMTP em produção — QUESTION-023).
// O envio SMTP é assíncrono, com 3 tentativas em memória: e-mail aqui carrega código de login ou link
// de convite, e por isso NÃO vai para a tabela de jobs (o segredo não fica em repouso no banco). Se o
// processo cair no meio, o usuário pede outro código — aceitável para o piloto (ADR-0014).
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.ts';

export interface Email { para: string; assunto: string; texto: string; org: string }
type Log = { info: (o: unknown, m: string) => void; warn?: (o: unknown, m: string) => void; error?: (o: unknown, m: string) => void };

const transporte = config.email === 'smtp' && config.smtp.url ? nodemailer.createTransport(config.smtp.url) : null;

export function enviarEmail(e: Email, log: Log) {
  const dominio = e.para.split('@')[1];
  if (config.email === 'arquivo' && !config.producao) {
    const arq = path.resolve('.dados/emails.jsonl');
    mkdirSync(path.dirname(arq), { recursive: true });
    appendFileSync(arq, JSON.stringify({ ...e, enviadoEm: new Date().toISOString() }) + '\n');
    return;
  }
  if (transporte) {
    const tentar = async (n: number): Promise<void> => {
      try {
        await transporte.sendMail({ from: config.smtp.remetente, to: e.para, subject: e.assunto, text: e.texto });
        log.info({ org: e.org, dominio }, 'e-mail enviado');
      } catch (err: any) {
        if (n >= 3) { (log.error ?? log.info)({ org: e.org, dominio, err: err?.code ?? err?.message }, 'e-mail não enviado'); return; }
        setTimeout(() => void tentar(n + 1), 2 ** n * 1000).unref();
      }
    };
    void tentar(1);
    return;
  }
  log.info({ org: e.org, dominio }, 'e-mail enfileirado'); // sem destinatário completo nem conteúdo
}
