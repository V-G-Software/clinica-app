// Erro da API no formato RFC 9457 (4.5). A interface escolhe a mensagem pelo `codigo`, nunca pelo `detail`.
import type { Problema } from '@clinica/contrato-tipos';

export class ErroApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    public requestId: string | null,
    public campos: NonNullable<Problema['campos']> = [],
    public estadoAtual?: unknown,
    public detalhe?: string,
  ) {
    super(`${status} ${codigo}`);
  }
  /** Erros por campo, com o prefixo removido: `respostas.dor` → `dor` (prefixo "respostas"). */
  porCampo(prefixo = ''): Record<string, string> {
    const r: Record<string, string> = {};
    for (const c of this.campos) {
      const nome = prefixo && c.campo.startsWith(`${prefixo}.`) ? c.campo.slice(prefixo.length + 1) : c.campo;
      r[nome] ??= c.mensagem;
    }
    return r;
  }
}

export function erroDeResposta(status: number, corpo: unknown, requestIdCabecalho: string | null): ErroApi {
  const p = (corpo ?? {}) as Partial<Problema>;
  return new ErroApi(status, typeof p.codigo === 'string' ? p.codigo : status >= 500 ? 'INDISPONIVEL_TEMPORARIAMENTE' : 'DESCONHECIDO',
    (p.requestId as string) ?? requestIdCabecalho, p.campos ?? [], p.estadoAtual, p.detail);
}
export const erroDeRede = () => new ErroApi(0, 'REDE', null);
