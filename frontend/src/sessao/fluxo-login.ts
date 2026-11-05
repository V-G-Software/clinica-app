// Etapa de login pendente vinda de outra tela (aceite de convite), continuada em /entrar.
import { defineStore } from 'pinia';
import type { RespostaEtapa } from '@clinica/contrato-tipos';

export const useFluxoLoginStore = defineStore('fluxoLogin', {
  state: () => ({ pendente: null as null | { resposta: RespostaEtapa; email: string; destino: string } }),
  actions: {
    consumir() { const p = this.pendente; this.pendente = null; return p; },
  },
});
