// Estado da inicialização: organização, configuração pública e relógio do backend.
import { defineStore } from 'pinia';
import type { ConfiguracaoPublica, OrganizacaoDiretorio } from '@clinica/contrato-tipos';

export type EstadoApp = 'carregando' | 'pronto' | 'escolher-organizacao' | 'nao-encontrada' | 'manutencao' | 'suspensa' | 'atualizar' | 'erro';

export const useAppStore = defineStore('app', {
  state: () => ({
    estado: 'carregando' as EstadoApp,
    organizacao: null as OrganizacaoDiretorio | null,
    config: null as ConfiguracaoPublica | null,
    /** relógio do backend − relógio do aparelho (ms), medido em /v1/publico/saude. */
    desvioRelogioMs: 0,
    mensagem: null as string | null,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  }),
  getters: {
    fuso: (s) => s.config?.organizacao.fuso ?? 'America/Sao_Paulo',
    locale: (s) => s.config?.organizacao.locale ?? 'pt-BR',
    nome: (s) => s.config?.organizacao.nome ?? '',
  },
  actions: {
    agoraServidor() { return Date.now() + this.desvioRelogioMs; },
  },
});
