// Renovação do token de acesso (4.1).
// - Single-flight: várias chamadas que falham juntas esperam a MESMA renovação.
// - Entre abas: navigator.locks serializa as renovações. Como o cookie de renovação é do
//   navegador (compartilhado), a aba que entra depois já usa o cookie rotacionado — evita o
//   "reuso" que derrubaria a sessão inteira (detecção de reuso do backend).
export interface TokenRenovado { tokenAcesso: string; expiraEm: string }

export interface OpcoesRenovador {
  /** Chama POST /v1/auth/renovar; null se a sessão não pode ser renovada (401). */
  renovar: () => Promise<TokenRenovado | null>;
  chaveLock: string;
  locks?: Pick<LockManager, 'request'> | null;
}

export function criarRenovador(o: OpcoesRenovador) {
  let emAndamento: Promise<TokenRenovado | null> | null = null;
  return function renovar(): Promise<TokenRenovado | null> {
    emAndamento ??= (async () => {
      if (o.locks) return (await o.locks.request(o.chaveLock, () => o.renovar())) as TokenRenovado | null;
      return o.renovar();
    })().finally(() => { emAndamento = null; });
    return emAndamento;
  };
}

/** Implementação real: cookie HttpOnly (web), `credentials: include`. */
export function renovarPorCookie(urlApi: string, f: typeof fetch = fetch) {
  return async (): Promise<TokenRenovado | null> => {
    const r = await f(`${urlApi}/v1/auth/renovar`, { method: 'POST', credentials: 'include', headers: { 'X-Cliente': 'WEB' } });
    if (r.status === 200) return (await r.json()) as TokenRenovado;
    if (r.status === 401) return null;
    throw new Error(`renovação falhou: HTTP ${r.status}`);
  };
}
