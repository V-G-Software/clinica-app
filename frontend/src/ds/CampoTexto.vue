<script setup lang="ts">
import { useId } from 'vue';
const modelo = defineModel<string>({ default: '' });
defineProps<{ rotulo: string; tipo?: string; erro?: string | null; ajuda?: string; autocomplete?: string; inputmode?: 'text' | 'email' | 'numeric' | 'tel'; obrigatorio?: boolean; autofocus?: boolean; maxlength?: number; classeEntrada?: string }>();
const id = useId();
</script>
<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium">{{ rotulo }}</label>
    <input :id="id" v-model="modelo" :type="tipo ?? 'text'" :autocomplete="autocomplete" :inputmode="inputmode" :required="obrigatorio"
      :autofocus="autofocus" :maxlength="maxlength" :aria-invalid="!!erro || undefined" :aria-describedby="erro ? `${id}-erro` : ajuda ? `${id}-ajuda` : undefined"
      class="min-h-12 rounded-xl border-2 border-zinc-300 bg-white px-4 text-base outline-none focus:border-acao dark:border-zinc-600 dark:bg-zinc-800"
      :class="[erro && 'border-erro', classeEntrada]" />
    <p v-if="erro" :id="`${id}-erro`" class="text-sm text-erro dark:text-red-400" role="alert">{{ erro }}</p>
    <p v-else-if="ajuda" :id="`${id}-ajuda`" class="text-sm text-zinc-500 dark:text-zinc-400">{{ ajuda }}</p>
  </div>
</template>
