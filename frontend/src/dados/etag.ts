// Recursos editáveis (4.7): guarda o ETag junto com o dado e envia em If-Match na edição.
import { erroDeRede, erroDeResposta, ErroApi } from '@/api/erros';

export interface ComEtag<T> { dado: T; etag: string | null }
export async function comEtag<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<ComEtag<T>> {
  let r;
  try { r = await p; } catch (e) { if (e instanceof ErroApi) throw e; throw erroDeRede(); }
  if (!r.response.ok) throw erroDeResposta(r.response.status, r.error, r.response.headers.get('X-Request-Id'));
  return { dado: r.data as T, etag: r.response.headers.get('ETag') };
}
