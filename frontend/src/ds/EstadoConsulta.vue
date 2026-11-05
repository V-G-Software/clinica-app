<script setup lang="ts">
// Estados obrigatórios de toda tela (PROMPT_FRONTEND 12): carregando (esqueleto), erro (com tentar de
// novo e código para o suporte) e vazio (texto com o termo do domínio). O conteúdo vai no slot.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMensagemErro } from '@/dados/erro';
import Aviso from './Aviso.vue';
import Botao from './Botao.vue';
const props = defineProps<{ carregando: boolean; erro?: unknown; vazio?: boolean; textoVazio?: string; linhas?: number }>();
const emit = defineEmits<{ tentar: [] }>();
const { t } = useI18n();
const msg = useMensagemErro();
const m = computed(() => (props.erro ? msg(props.erro) : null));
</script>
<template>
  <div v-if="carregando" class="flex flex-col gap-3" role="status" :aria-label="t('app.carregando')">
    <div v-for="i in linhas ?? 3" :key="i" class="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
  </div>
  <Aviso v-else-if="m" tipo="erro" :detalhe="m.suporte">
    {{ m.texto }}
    <div class="mt-2"><Botao variante="secundario" @click="emit('tentar')">{{ t('app.tentarDeNovo') }}</Botao></div>
  </Aviso>
  <p v-else-if="vazio" class="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-secundario dark:border-zinc-600">{{ textoVazio }}</p>
  <slot v-else />
</template>
