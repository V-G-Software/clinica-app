<script setup lang="ts">
defineProps<{ valor: number; rotulo: string }>();
</script>
<template>
  <span v-if="valor > 0" class="inline-flex min-w-5 items-center justify-center rounded-full bg-red-700 px-1.5 text-xs font-bold text-white" :aria-label="rotulo">
    {{ valor > 99 ? '99+' : valor }}
  </span>
</template>
