// Cache de consultas (TanStack Query) acessível também fora dos componentes (tempo real, logout).
import { QueryClient } from '@tanstack/vue-query';
import type { ErroApi } from '@/api/erros';

export const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Só repete falha de rede e 5xx; 4xx é resposta definitiva.
      retry: (n, e) => n < 2 && ((e as unknown as ErroApi)?.status === 0 || (e as unknown as ErroApi)?.status >= 500),
    },
    mutations: { retry: false },
  },
});
