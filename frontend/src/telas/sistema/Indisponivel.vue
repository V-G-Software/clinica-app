<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Botao from '@/ds/Botao.vue';
const { t } = useI18n();
</script>
<template>
  <div class="flex flex-col items-center gap-3 py-16 text-center">
    <h1 class="text-xl font-bold">{{ t('sistema.indisponivelTitulo') }}</h1>
    <p class="text-zinc-600 dark:text-zinc-300">{{ t('sistema.indisponivelTexto') }}</p>
    <RouterLink to="/"><Botao variante="secundario">{{ t('app.voltar') }}</Botao></RouterLink>
  </div>
</template>
