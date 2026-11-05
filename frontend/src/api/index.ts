// Instância única do cliente do contrato para a organização atual.
// Middleware: em 401 SESSAO_EXPIRADA, renova (single-flight) e repete a chamada UMA vez.
import type { Middleware } from 'openapi-fetch';
import { criarClienteContrato, type ClienteContrato } from '@clinica/contrato-cliente';
import { criarRenovador, renovarPorCookie, type TokenRenovado } from './renovacao';
import { erroDeRede, erroDeResposta, ErroApi } from './erros';

export interface Ganchos {
  token: () => string | null;
  aoRenovar: (t: TokenRenovado) => void;
  aoPerderSessao: (codigo: string) => void;
}

let cliente: ClienteContrato | null = null;
let renovar: (() => Promise<TokenRenovado | null>) | null = null;

export function configurarApi(urlApi: string, slug: string, g: Ganchos, f: typeof fetch = (...a) => fetch(...a)) {
  renovar = criarRenovador({ renovar: renovarPorCookie(urlApi, f), chaveLock: `renovacao-${slug}`, locks: typeof navigator !== 'undefined' ? navigator.locks : null });
  const c = criarClienteContrato({ urlApi, token: g.token, cliente: 'WEB', versao: __VERSAO_APP__, fetch: f });
  const copias = new WeakMap<Request, Request>();
  const reexecucao: Middleware = {
    onRequest({ request }) {
      if (!new URL(request.url).pathname.endsWith('/v1/auth/renovar')) copias.set(request, request.clone());
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || request.headers.get('X-Repetida')) return response;
      const caminho = new URL(request.url).pathname;
      if (caminho.includes('/v1/auth/')) return response;
      const corpo = await response.clone().json().catch(() => ({}));
      if (corpo.codigo === 'SESSAO_REVOGADA') { g.aoPerderSessao('SESSAO_REVOGADA'); return response; }
      if (corpo.codigo !== 'SESSAO_EXPIRADA') return response;
      const novo = await renovar!().catch(() => null);
      if (!novo) { g.aoPerderSessao('SESSAO_EXPIRADA'); return response; }
      g.aoRenovar(novo);
      const copia = copias.get(request);
      if (!copia) return response;
      const repetida = new Request(copia, { headers: new Headers(copia.headers) });
      repetida.headers.set('Authorization', `Bearer ${novo.tokenAcesso}`);
      repetida.headers.set('X-Repetida', '1');
      return f(repetida);
    },
  };
  c.use(reexecucao);
  cliente = c;
  return c;
}

export const api = (): ClienteContrato => {
  if (!cliente) throw new Error('API ainda não configurada');
  return cliente;
};
export const renovarSessao = () => {
  if (!renovar) throw new Error('API ainda não configurada');
  return renovar();
};

/**
 * Desembrulha o resultado do openapi-fetch: devolve `data` ou lança ErroApi.
 * Uso: `const m = await ok(api().GET('/v1/sessao', {}))`.
 */
export async function ok<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let r;
  try { r = await p; } catch (e) { if (e instanceof ErroApi) throw e; throw erroDeRede(); }
  if (r.response.ok) return r.data as T;
  throw erroDeResposta(r.response.status, r.error, r.response.headers.get('X-Request-Id'));
}
