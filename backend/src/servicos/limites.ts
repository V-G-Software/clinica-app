// Limite de requisições (14.4) por IP, por conta e por organização — proteção contra abuso e contra um
// cliente com bug em laço. Força bruta de login tem limite próprio, persistido no banco (nucleo.limitar).
// Janela fixa de 1 minuto em memória: barato (nenhuma escrita no banco por requisição), mas POR
// INSTÂNCIA — com N instâncias o teto efetivo é N×. Para o piloto (1–2 instâncias) basta; com escala,
// mover para Redis ou para o balanceador (ADR-0015).
import { ErroApi } from '../erros.ts';

const num = (v: string | undefined, padrao: number) => (v && Number(v) > 0 ? Number(v) : padrao);
export const LIMITES = {
  ip: num(process.env.LIMITE_IP_POR_MIN, 1200),
  conta: num(process.env.LIMITE_CONTA_POR_MIN, 600),
  organizacao: num(process.env.LIMITE_ORG_POR_MIN, 6000),
};

const janelas = new Map<string, { inicio: number; n: number }>();
const JANELA_MS = 60_000;

/** Conta a requisição na janela da chave; acima do teto lança 429 (Retry-After até o fim da janela). */
export function contar(chave: string, teto: number, agora = Date.now()) {
  let j = janelas.get(chave);
  if (!j || agora - j.inicio >= JANELA_MS) { j = { inicio: agora, n: 0 }; janelas.set(chave, j); }
  if (++j.n > teto) {
    const e = new ErroApi('MUITAS_TENTATIVAS', 'Muitas requisições em pouco tempo. Aguarde um instante.', {}, 429);
    (e as any).retryAfter = Math.max(1, Math.ceil((j.inicio + JANELA_MS - agora) / 1000));
    throw e;
  }
}
export const zerarLimites = () => janelas.clear();

// Varre janelas vencidas: o mapa não cresce sem limite com IPs que aparecem uma vez.
setInterval(() => { const agora = Date.now(); for (const [k, j] of janelas) if (agora - j.inicio >= JANELA_MS) janelas.delete(k); }, JANELA_MS).unref();
