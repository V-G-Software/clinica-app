<script setup lang="ts">
// Check-in do paciente (10): uma pergunta por tela, progresso, revisão antes de enviar.
// Nada é persistido no aparelho ([DECISÃO 2]): fechar o app recomeça o formulário.
import { computed, ref } from 'vue';
import type { CampoFormulario } from '@clinica/contrato-tipos';
import { camposVisiveis, limparRespostas, validarCampo, validarTudo, type Respostas } from './regras';
import CampoFormularioC from './CampoFormulario.vue';
import RespostasLeitura from './RespostasLeitura.vue';
import Botao from '@/ds/Botao.vue';

const props = defineProps<{ campos: CampoFormulario[]; titulo: string; enviando?: boolean; errosServidor?: Record<string, string> }>();
const emit = defineEmits<{ enviar: [Respostas] }>();
const respostas = ref<Respostas>({});
const indice = ref(0);
const erroAtual = ref<string | null>(null);
const visiveis = computed(() => camposVisiveis(props.campos, respostas.value));
const revisando = computed(() => indice.value >= visiveis.value.length);
const atual = computed(() => visiveis.value[indice.value]);
const total = computed(() => visiveis.value.length);

function avancar() {
  erroAtual.value = validarCampo(atual.value, respostas.value[atual.value.id]);
  if (!erroAtual.value) indice.value++;
}
function voltar() { erroAtual.value = null; indice.value = Math.max(0, indice.value - 1); }
function editar(id: string) { indice.value = visiveis.value.findIndex((c) => c.id === id); }
function enviar() {
  const erros = validarTudo(props.campos, respostas.value);
  const primeiro = Object.keys(erros)[0];
  if (primeiro) { editar(primeiro); erroAtual.value = erros[primeiro]; return; }
  emit('enviar', limparRespostas(props.campos, respostas.value));
}
// Erro do servidor (422): volta para o primeiro campo apontado.
defineExpose({ irParaErro(campo: string, msg: string) { const i = visiveis.value.findIndex((c) => c.id === campo); if (i >= 0) { indice.value = i; erroAtual.value = msg; } } });
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ titulo }}</p>
      <div class="mt-2 flex items-center gap-3">
        <div class="h-2 flex-1 rounded-full bg-marca-100 dark:bg-zinc-700"><div class="h-2 rounded-full bg-acao transition-all" :style="{ width: `${(Math.min(indice, total) / Math.max(total, 1)) * 100}%` }" /></div>
        <span class="text-sm font-medium" aria-live="polite">{{ revisando ? 'Revisão' : `${indice + 1} de ${total}` }}</span>
      </div>
    </div>

    <form v-if="!revisando && atual" :key="atual.id" class="flex flex-col gap-6" @submit.prevent="avancar">
      <CampoFormularioC v-model="respostas[atual.id]" :campo="atual" :erro="erroAtual ?? errosServidor?.[atual.id]" grande />
      <div class="flex gap-3">
        <Botao v-if="indice > 0" variante="secundario" @click="voltar">Voltar</Botao>
        <Botao tipo="submit" bloco>{{ indice === total - 1 ? 'Revisar' : 'Próxima' }}</Botao>
      </div>
    </form>

    <div v-else class="flex flex-col gap-4">
      <h2 class="text-xl font-bold">Confira suas respostas</h2>
      <RespostasLeitura :campos="visiveis" :respostas="limparRespostas(campos, respostas)" />
      <div class="flex flex-wrap gap-2">
        <Botao v-for="c in visiveis.filter((x) => x.tipo !== 'INFORMACAO')" :key="c.id" variante="fantasma" @click="editar(c.id)">Alterar “{{ c.rotulo.slice(0, 28) }}{{ c.rotulo.length > 28 ? '…' : '' }}”</Botao>
      </div>
      <div class="flex gap-3">
        <Botao variante="secundario" @click="voltar">Voltar</Botao>
        <Botao bloco :carregando="enviando" @click="enviar">Enviar para a equipe</Botao>
      </div>
    </div>
  </div>
</template>
