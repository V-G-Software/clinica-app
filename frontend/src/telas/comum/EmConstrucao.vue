<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Construction } from 'lucide-vue-next';
import type { DefinicaoTela } from '@/catalogo/telas';
const props = defineProps<{ fase?: string }>();
const { t } = useI18n();
const rota = useRoute();
const def = computed(() => rota.meta.tela as DefinicaoTela | undefined);
</script>
<template>
  <div class="flex flex-col items-center gap-3 py-16 text-center text-zinc-600 dark:text-zinc-300">
    <Construction class="size-10 text-marca-400" aria-hidden="true" />
    <p class="font-mono text-sm">{{ def?.tela ?? rota.name }}</p>
    <p>{{ t('sistema.emConstrucao', { fase: props.fase ?? def?.fase ?? 'FE1' }) }}</p>
  </div>
</template>
