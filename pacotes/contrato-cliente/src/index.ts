// Cliente HTTP tipado do contrato (openapi-fetch sobre os tipos gerados).
// Caminhos, parâmetros, corpos e respostas são checados em tempo de compilação.
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@clinica/contrato-tipos';

export interface OpcoesCliente {
  /** `urlApi` vindo do diretório. */
  urlApi: string;
  /** Devolve o token de acesso atual (mantido só em memória — nunca em localStorage). */
  token?: () => string | null | undefined;
  cliente?: 'WEB' | 'NATIVO';
  versao?: string;
  fetch?: typeof fetch;
}

export function criarClienteContrato(o: OpcoesCliente) {
  const api = createClient<paths>({ baseUrl: o.urlApi.replace(/\/$/, ''), fetch: o.fetch, credentials: 'include' });
  const cabecalhos: Middleware = {
    onRequest({ request }) {
      const t = o.token?.();
      if (t) request.headers.set('Authorization', `Bearer ${t}`);
      request.headers.set('X-Cliente', o.cliente ?? 'WEB');
      if (o.versao) request.headers.set('X-Cliente-Versao', o.versao);
      if (!request.headers.has('X-Request-Id')) request.headers.set('X-Request-Id', `web_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`);
      return request;
    },
  };
  api.use(cabecalhos);
  return api;
}
export type ClienteContrato = ReturnType<typeof criarClienteContrato>;
/** Chave de idempotência nova (4.7): gere uma por operação lógica e repita-a nos retries. */
export const novaChaveIdempotencia = () => crypto.randomUUID();
