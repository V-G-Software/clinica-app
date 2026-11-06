// Conexão de tempo real (ADR-0003): SSE por fetch (envia Authorization), reconexão com
// Last-Event-ID e backoff com jitter; 3 falhas seguidas ou modo POLLING → GET /v1/eventos.
// Uma conexão por organização no navegador: a aba que obtém o lock é a líder e repassa os
// eventos às outras por BroadcastChannel.
import { criarParserSse } from './sse';
import type { EventoApp } from './invalidacoes';

export interface OpcoesTempoReal {
  urlApi: string; slug: string; modo: 'SSE' | 'POLLING'; intervaloPollingSegundos: number;
  token: () => string | null;
  /** Renova a sessão quando o stream responde 401; false = sessão perdida. */
  renovar: () => Promise<boolean>;
  aoEvento: (e: EventoApp) => void;
  /** Histórico além da janela de 24 h: recarregar tudo. */
  aoCursorExpirado: () => void;
  aoEstado?: (estado: 'conectado' | 'reconectando' | 'polling' | 'seguidora') => void;
}

const espera = (ms: number, sinal: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); sinal.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true }); });
const backoff = (n: number) => Math.min(30_000, 1000 * 2 ** n) * (0.5 + Math.random() / 2);

export function iniciarTempoReal(o: OpcoesTempoReal) {
  const parar = new AbortController();
  const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`eventos-${o.slug}`) : null;
  const vistos = new Set<string>();
  const entregar = (e: EventoApp, repassar: boolean) => {
    if (vistos.has(e.id)) return;
    vistos.add(e.id);
    if (vistos.size > 500) vistos.delete(vistos.values().next().value as string);
    o.aoEvento(e);
    if (repassar) canal?.postMessage({ tipo: 'evento', evento: e });
  };
  if (canal) canal.onmessage = (m) => {
    if (m.data?.tipo === 'evento') entregar(m.data.evento, false);
    if (m.data?.tipo === 'cursor-expirado') o.aoCursorExpirado();
  };
  const cursorExpirado = () => { o.aoCursorExpirado(); canal?.postMessage({ tipo: 'cursor-expirado' }); };

  let ultimoId: string | null = null;

  async function sse(): Promise<'falhou' | 'parado'> {
    const token = o.token();
    if (!token) return 'falhou';
    const r = await fetch(`${o.urlApi}/v1/eventos/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...(ultimoId ? { 'Last-Event-ID': ultimoId } : {}) },
      signal: parar.signal,
    });
    if (r.status === 401) { if (!(await o.renovar())) parar.abort(); return 'falhou'; }
    if (!r.ok || !r.body) return 'falhou';
    o.aoEstado?.('conectado');
    // Sem cursor (primeira conexão, ou queda antes de qualquer evento) o servidor só manda o que vier
    // DAQUI EM DIANTE: o que aconteceu entre a tela carregar e o stream abrir se perderia. Ressincroniza
    // uma vez agora que o stream está aberto — daqui para frente nada escapa.
    if (!ultimoId) cursorExpirado();
    const parser = criarParserSse((m) => {
      if (m.event === 'erro' && m.data.includes('CURSOR_EXPIRADO')) { ultimoId = null; cursorExpirado(); return; }
      try { const e = JSON.parse(m.data) as EventoApp; if (m.id) ultimoId = m.id; if (e?.id && e.tipo) entregar(e, true); } catch { /* evento malformado: ignora */ }
    });
    const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) return parar.signal.aborted ? 'parado' : 'falhou';
      parser(value);
    }
  }

  async function polling() {
    o.aoEstado?.('polling');
    const ms = Math.max(5, o.intervaloPollingSegundos) * 1000;
    while (!parar.signal.aborted) {
      if (typeof document !== 'undefined' && document.hidden) { await espera(1000, parar.signal); continue; }
      const token = o.token();
      try {
        const q = ultimoId ? `?depois=${encodeURIComponent(ultimoId)}` : '';
        const r = await fetch(`${o.urlApi}/v1/eventos${q}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: parar.signal });
        if (r.status === 401) { if (!(await o.renovar())) return; continue; }
        if (r.status === 410) { ultimoId = null; cursorExpirado(); continue; }
        if (r.ok) {
          const corpo = await r.json();
          for (const e of corpo.itens ?? []) entregar(e, true);
          ultimoId = corpo.ultimoEventoId ?? ultimoId;
        }
      } catch { /* rede: tenta no próximo ciclo */ }
      await espera(ms, parar.signal);
    }
  }

  async function lider() {
    if (o.modo === 'POLLING') return polling();
    let falhas = 0;
    while (!parar.signal.aborted) {
      const r = await sse().catch(() => 'falhou' as const);
      if (r === 'parado' || parar.signal.aborted) return;
      if (++falhas >= 3) return polling(); // SSE bloqueado (proxy, rede): cai para polling
      o.aoEstado?.('reconectando');
      await espera(backoff(falhas), parar.signal);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks) {
    o.aoEstado?.('seguidora');
    void navigator.locks.request(`tempo-real-${o.slug}`, { signal: parar.signal }, () => lider()).catch(() => undefined);
  } else void lider();

  return () => { parar.abort(); canal?.close(); };
}
