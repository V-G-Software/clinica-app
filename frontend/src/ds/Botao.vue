<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next';
withDefaults(defineProps<{ variante?: 'primario' | 'secundario' | 'fantasma'; tipo?: 'button' | 'submit'; carregando?: boolean; desabilitado?: boolean; bloco?: boolean }>(),
  { variante: 'primario', tipo: 'button' });
</script>
<template>
  <button :type="tipo" :disabled="desabilitado || carregando" :aria-busy="carregando || undefined"
    class="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition disabled:opacity-50"
    :class="[bloco && 'w-full',
      variante === 'primario' && 'bg-acao text-acao-texto hover:brightness-110',
      variante === 'secundario' && 'border-2 border-acao text-acao hover:bg-marca-50 dark:hover:bg-zinc-800',
      variante === 'fantasma' && 'text-acao hover:bg-marca-50 dark:hover:bg-zinc-800']">
    <Loader2 v-if="carregando" class="size-5 animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
