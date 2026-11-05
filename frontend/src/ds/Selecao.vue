<script setup lang="ts">
import { useId } from 'vue';
const modelo = defineModel<string>({ default: '' });
defineProps<{ rotulo: string; opcoes: Array<{ valor: string; rotulo: string }>; vazio?: string; erro?: string | null }>();
const id = useId();
</script>
<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium">{{ rotulo }}</label>
    <select :id="id" v-model="modelo" class="min-h-12 rounded-xl border-2 border-zinc-300 bg-white px-3 dark:border-zinc-600 dark:bg-zinc-800" :class="erro && 'border-erro'">
      <option v-if="vazio !== undefined" value="">{{ vazio }}</option>
      <option v-for="o in opcoes" :key="o.valor" :value="o.valor">{{ o.rotulo }}</option>
    </select>
    <p v-if="erro" class="text-sm text-erro" role="alert">{{ erro }}</p>
  </div>
</template>
