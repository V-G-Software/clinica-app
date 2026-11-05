import { computed } from 'vue';
import { useSessaoStore } from '@/sessao/store';
import { TERMOS_PADRAO, type Termo } from '@/i18n/termos';

/** Termo do domínio vindo do manifesto (com padrão antes de o manifesto chegar). */
export function useTermos() {
  const sessao = useSessaoStore();
  return computed(() => (k: string): Termo => ((sessao.termos as Record<string, Termo> | undefined)?.[k] ?? TERMOS_PADRAO[k]));
}
/** Chave de idempotência por ação do usuário: a mesma em todos os retries da mesma ação. */
export function criarChave() {
  let chave: string | null = null;
  return { obter: () => (chave ??= crypto.randomUUID()), concluir: () => { chave = null; } };
}
