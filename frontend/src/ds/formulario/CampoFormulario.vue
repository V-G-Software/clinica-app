<script setup lang="ts">
// Um componente por TipoCampo (9.2). Tipo desconhecido mostra aviso de atualização.
import { computed, ref, useId, watch } from 'vue';
import type { CampoFormulario } from '@clinica/contrato-tipos';
import { lerNumero, TIPOS_CONHECIDOS } from './regras';
import CampoFoto from './CampoFoto.vue';
import Aviso from '@/ds/Aviso.vue';

const props = defineProps<{ campo: CampoFormulario; erro?: string | null; grande?: boolean }>();
const valor = defineModel<unknown>();
const id = useId();
const c = computed(() => props.campo as CampoFormulario & { tipo: string });
const escala = computed(() => (c.value.tipo === 'ESCALA' ? Array.from({ length: (c.value.max ?? 10) - (c.value.min ?? 0) + 1 }, (_, i) => (c.value.min ?? 0) + i) : []));
const textoNumero = ref(typeof valor.value === 'number' ? String(valor.value).replace('.', ',') : '');
watch(textoNumero, (t) => (valor.value = lerNumero(t)));
function alternar(v: string) {
  const atual = Array.isArray(valor.value) ? (valor.value as string[]) : [];
  valor.value = atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v];
}
const opcao = 'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 text-left text-base font-medium';
const marcada = (sim: boolean) => (sim ? 'border-acao bg-marca-50 dark:bg-zinc-800' : 'border-zinc-300 dark:border-zinc-600');
</script>

<template>
  <fieldset class="flex flex-col gap-3" :aria-describedby="erro ? `${id}-erro` : undefined">
    <legend class="mb-1 font-bold" :class="grande ? 'text-xl' : 'text-base'">
      {{ c.rotulo }} <span v-if="!c.obrigatorio && c.tipo !== 'INFORMACAO'" class="text-sm font-normal text-zinc-500">(opcional)</span>
    </legend>
    <p v-if="c.ajuda || c.instrucao" class="text-sm text-zinc-600 dark:text-zinc-300">{{ c.ajuda ?? c.instrucao }}</p>

    <div v-if="c.tipo === 'ESCALA'" class="flex flex-col gap-2">
      <div class="grid grid-cols-6 gap-2 sm:grid-cols-11" role="radiogroup" :aria-label="c.rotulo">
        <button v-for="n in escala" :key="n" type="button" role="radio" :aria-checked="valor === n"
          class="min-h-12 rounded-xl border-2 text-lg font-bold" :class="valor === n ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300 dark:border-zinc-600'" @click="valor = n">{{ n }}</button>
      </div>
      <div v-if="c.rotuloMin || c.rotuloMax" class="flex justify-between text-sm text-zinc-600 dark:text-zinc-300"><span>{{ c.min }} = {{ c.rotuloMin }}</span><span>{{ c.max }} = {{ c.rotuloMax }}</span></div>
    </div>

    <div v-else-if="c.tipo === 'SIM_NAO'" class="grid grid-cols-2 gap-3" role="radiogroup" :aria-label="c.rotulo">
      <button v-for="[v, r] in [[true, 'Sim'], [false, 'Não']] as const" :key="r" type="button" role="radio" :aria-checked="valor === v" :class="[opcao, marcada(valor === v), 'justify-center']" @click="valor = v">{{ r }}</button>
    </div>

    <div v-else-if="c.tipo === 'ESCOLHA_UNICA'" class="flex flex-col gap-2" role="radiogroup" :aria-label="c.rotulo">
      <button v-for="o in c.opcoes" :key="o.valor" type="button" role="radio" :aria-checked="valor === o.valor" :class="[opcao, marcada(valor === o.valor)]" @click="valor = o.valor">
        <span class="size-5 shrink-0 rounded-full border-2" :class="valor === o.valor ? 'border-acao bg-acao' : 'border-zinc-400'" aria-hidden="true" /> {{ o.rotulo }}
      </button>
    </div>

    <div v-else-if="c.tipo === 'ESCOLHA_MULTIPLA'" class="flex flex-col gap-2">
      <button v-for="o in c.opcoes" :key="o.valor" type="button" role="checkbox" :aria-checked="Array.isArray(valor) && (valor as string[]).includes(o.valor)" :class="[opcao, marcada(Array.isArray(valor) && (valor as string[]).includes(o.valor))]" @click="alternar(o.valor)">
        <span class="size-5 shrink-0 rounded border-2" :class="Array.isArray(valor) && (valor as string[]).includes(o.valor) ? 'border-acao bg-acao' : 'border-zinc-400'" aria-hidden="true" /> {{ o.rotulo }}
      </button>
    </div>

    <div v-else-if="c.tipo === 'NUMERO'" class="flex items-center gap-2">
      <input :id="id" v-model="textoNumero" inputmode="decimal" :aria-label="c.rotulo" :aria-invalid="!!erro || undefined"
        class="min-h-14 w-40 rounded-xl border-2 border-zinc-300 bg-white px-4 text-xl dark:border-zinc-600 dark:bg-zinc-800" />
      <span v-if="c.unidade" class="text-lg">{{ c.unidade }}</span>
    </div>

    <input v-else-if="c.tipo === 'TEXTO'" :id="id" v-model="valor as string" :aria-label="c.rotulo" maxlength="300" class="min-h-12 rounded-xl border-2 border-zinc-300 bg-white px-4 dark:border-zinc-600 dark:bg-zinc-800" />
    <textarea v-else-if="c.tipo === 'TEXTO_LONGO'" :id="id" v-model="valor as string" :aria-label="c.rotulo" rows="4" maxlength="4000" class="rounded-xl border-2 border-zinc-300 bg-white p-4 dark:border-zinc-600 dark:bg-zinc-800" />
    <input v-else-if="c.tipo === 'DATA'" :id="id" v-model="valor as string" type="date" :aria-label="c.rotulo" class="min-h-12 rounded-xl border-2 border-zinc-300 bg-white px-4 dark:border-zinc-600 dark:bg-zinc-800" />
    <input v-else-if="c.tipo === 'HORA'" :id="id" v-model="valor as string" type="time" :aria-label="c.rotulo" class="min-h-12 rounded-xl border-2 border-zinc-300 bg-white px-4 dark:border-zinc-600 dark:bg-zinc-800" />
    <CampoFoto v-else-if="c.tipo === 'FOTO'" v-model="valor as string[]" :maximo="c.maximo" :rotulo="c.rotulo" />
    <template v-else-if="c.tipo === 'INFORMACAO'" />
    <Aviso v-else-if="!TIPOS_CONHECIDOS.has(c.tipo)" tipo="atencao">Esta pergunta precisa de uma versão mais nova do app.</Aviso>

    <p v-if="erro" :id="`${id}-erro`" class="text-sm font-medium text-erro dark:text-red-400" role="alert">{{ erro }}</p>
  </fieldset>
</template>
