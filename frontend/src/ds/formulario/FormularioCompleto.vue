<script setup lang="ts">
// Todos os campos visíveis de uma vez (cadastro, campos adicionais). Valor = objeto de respostas.
import type { CampoFormulario } from '@clinica/contrato-tipos';
import { camposVisiveis, type Respostas } from './regras';
import CampoFormularioC from './CampoFormulario.vue';
const props = defineProps<{ campos: CampoFormulario[]; erros?: Record<string, string> }>();
const valores = defineModel<Respostas>({ default: () => ({}) });
void props;
</script>
<template>
  <div class="flex flex-col gap-5">
    <CampoFormularioC v-for="c in camposVisiveis(campos, valores)" :key="c.id" v-model="valores[c.id]" :campo="c" :erro="erros?.[c.id]" />
  </div>
</template>
