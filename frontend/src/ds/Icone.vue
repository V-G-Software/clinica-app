<script setup lang="ts">
import { computed } from 'vue';
import { iconePorNome } from '@/catalogo/icones';
const p = defineProps<{ nome?: string }>();
const c = computed(() => iconePorNome(p.nome));
</script>
<template><component :is="c" aria-hidden="true" /></template>
