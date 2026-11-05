<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Archive } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { tempoRelativo } from '@/i18n/datas';
import { capitalizar, nenhum } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Badge from '@/ds/Badge.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';

const { t } = useI18n();
const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const { data, isPending, error, refetch } = useQuery({ queryKey: ['conversas'], queryFn: () => ok(api().GET('/v1/conversas', { params: { query: { limite: 50 } } })) });
// RN-CHA-003 com mais de um paciente vinculado fica ambíguo: mostra o nome do paciente (QUESTION-016).
const varios = computed(() => (sessao.manifesto?.pacientesVinculados?.length ?? 0) > 1);
const titulo = (c: { titulo: string; paciente: { nome: string } }) => (sessao.ehPaciente && varios.value ? c.paciente.nome : c.titulo);
</script>
<template>
  <div class="flex flex-col gap-2">
    <h1 class="mb-2 text-2xl font-bold">{{ capitalizar(termo('conversa').plural) }}</h1>
    <EstadoConsulta :carregando="isPending" :erro="error" :vazio="!data?.itens.length" :texto-vazio="`${capitalizar(nenhum(termo('conversa')))} ainda.`" @tentar="refetch()" />
    <RouterLink v-for="c in data?.itens ?? []" :key="c.id" :to="`/conversas/${c.id}`" class="flex min-h-16 items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2 dark:border-zinc-700">
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-2 font-semibold" :class="c.naoLidas > 0 && 'text-acao'">{{ titulo(c) }} <Archive v-if="c.status === 'ARQUIVADA'" class="size-4 text-zinc-400" aria-label="arquivada" /></p>
        <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ c.ultimaMensagem?.resumo ?? '' }}</p>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span v-if="c.ultimaMensagem" class="text-xs text-secundario">{{ tempoRelativo(c.ultimaMensagem.enviadoEm, app.agoraServidor(), app.fuso, app.locale) }}</span>
        <Badge :valor="c.naoLidas" :rotulo="`${c.naoLidas} não lidas`" />
      </div>
    </RouterLink>
  </div>
</template>
