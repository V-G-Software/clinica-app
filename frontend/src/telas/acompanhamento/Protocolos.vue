<script setup lang="ts">
import { ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Plus } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useSessaoStore } from '@/sessao/store';
import { capitalizar, novo } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';

const { t } = useI18n();
const sessao = useSessaoStore();
const termo = useTermos();
const status = ref<'ATIVO' | 'ARQUIVADO'>('ATIVO');
const q = useQuery({ queryKey: ['protocolos', status], queryFn: () => ok(api().GET('/v1/protocolos', { params: { query: { status: status.value, limite: 100 } } })) });
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">{{ capitalizar(termo('protocolo').plural) }}</h1>
      <RouterLink v-if="sessao.pode('acompanhamento.protocolo.gerenciar')" to="/protocolos/novo"><Botao><Plus class="size-5" aria-hidden="true" /> {{ capitalizar(novo(termo('protocolo'))) }}</Botao></RouterLink>
    </div>
    <div class="flex gap-2" role="group" aria-label="Status">
      <button v-for="[v, r] in [['ATIVO', 'Ativos'], ['ARQUIVADO', 'Arquivados']] as const" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="status === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" @click="status = v">{{ r }}</button>
    </div>
    <p v-if="q.isPending.value">{{ t('app.carregando') }}</p>
    <RouterLink v-for="p in q.data.value?.itens ?? []" :key="p.id" :to="`/protocolos/${p.id}`" class="rounded-xl border border-zinc-200 px-4 py-3 hover:border-acao dark:border-zinc-700">
      <p class="font-semibold">{{ p.nome }} <span class="text-sm font-normal text-zinc-500">· versão {{ p.versao }}</span></p>
      <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ p.duracaoDias }} dias · {{ p.regrasAlerta.length }} regra(s) de alerta</p>
    </RouterLink>
  </div>
</template>
