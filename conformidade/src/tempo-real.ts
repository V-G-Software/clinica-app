// Ouvinte de eventos para a suíte: SSE via fetch (com Authorization) ou polling em GET /v1/eventos.
import { appendFileSync } from 'node:fs';
import { type Cliente, esperar } from './cliente.ts';
import { validarSchema } from '@clinica/contrato-validador';

export interface Ouvinte { eventos: any[]; esperarEvento(f: (e: any) => boolean, ms: number): Promise<any>; fechar(): void }

export async function ouvirSse(api: Cliente, token: string, ultimoId?: string): Promise<Ouvinte> {
  const ctrl = new AbortController();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
  if (ultimoId) headers['Last-Event-ID'] = ultimoId;
  const res = await fetch(`${api.urlApi}/v1/eventos/stream`, { headers, signal: ctrl.signal });
  if (process.env.CONF_COBERTURA_ARQ) appendFileSync(process.env.CONF_COBERTURA_ARQ, JSON.stringify({ operationId: 'eventosStream', status: res.status }) + '\n');
  if (res.status !== 200 || !/text\/event-stream/.test(res.headers.get('content-type') ?? '')) throw new Error(`SSE: HTTP ${res.status} ${res.headers.get('content-type')}`);
  const eventos: any[] = [];
  const espera = new Set<() => void>();
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const parte of res.body as any) {
        buf += dec.decode(parte, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = bloco.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          const id = bloco.split('\n').find((l) => l.startsWith('id:'))?.slice(3).trim();
          const tipo = bloco.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim();
          if (!data || !id) continue;
          const ev = JSON.parse(data);
          const v = validarSchema('Evento', ev);
          if (!v.ok) throw new Error(`evento SSE fora do contrato: ${v.erros.map((e) => e.mensagem).join('; ')}`);
          if (ev.id !== id || ev.tipo !== tipo) throw new Error('SSE: id/event diferentes do corpo do evento');
          eventos.push(ev);
          for (const f of espera) f();
        }
      }
    } catch (e: any) { if (e.name !== 'AbortError') eventos.push({ erro: String(e) }); }
  })();
  return criarOuvinte(eventos, espera, () => ctrl.abort());
}

export async function ouvirPolling(api: Cliente, token: string, intervaloMs = 1000): Promise<Ouvinte> {
  const inicio = esperar(await api.chamar('GET', '/v1/eventos', { token }), 200).body;
  let cursor = inicio.ultimoEventoId;
  const eventos: any[] = [];
  const espera = new Set<() => void>();
  let ativo = true;
  (async () => {
    while (ativo) {
      const r = esperar(await api.chamar('GET', '/v1/eventos', { token, query: { depois: cursor ?? undefined } }), 200).body;
      if (r.itens.length) { eventos.push(...r.itens); cursor = r.ultimoEventoId; for (const f of espera) f(); }
      else if (!cursor) cursor = r.ultimoEventoId;
      await new Promise((ok) => setTimeout(ok, intervaloMs));
    }
  })().catch((e) => eventos.push({ erro: String(e) }));
  return criarOuvinte(eventos, espera, () => { ativo = false; });
}

function criarOuvinte(eventos: any[], espera: Set<() => void>, fechar: () => void): Ouvinte {
  return {
    eventos, fechar,
    esperarEvento: (f, ms) => new Promise((ok, falha) => {
      const tentar = () => { const e = eventos.find(f); if (e) { espera.delete(tentar); clearTimeout(t); ok(e); } };
      const t = setTimeout(() => { espera.delete(tentar); falha(new Error(`evento não chegou em ${ms} ms; recebidos: ${JSON.stringify(eventos.map((x) => x.tipo ?? x.erro))}`)); }, ms);
      espera.add(tentar);
      tentar();
    }),
  };
}
