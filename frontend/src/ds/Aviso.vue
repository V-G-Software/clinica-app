<script setup lang="ts">
import { CircleAlert, Info, TriangleAlert } from 'lucide-vue-next';
defineProps<{ tipo?: 'informacao' | 'atencao' | 'erro'; detalhe?: string | null }>();
</script>
<template>
  <div role="status" class="flex gap-3 rounded-xl border p-3 text-sm"
    :class="{ 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100': !tipo || tipo === 'informacao',
              'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100': tipo === 'atencao',
              'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100': tipo === 'erro' }">
    <component :is="tipo === 'erro' ? CircleAlert : tipo === 'atencao' ? TriangleAlert : Info" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
    <div><slot /><p v-if="detalhe" class="mt-1 text-xs">{{ detalhe }}</p></div>
  </div>
</template>
