<script setup lang="ts">
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { caminhoDe } from '@/catalogo/telas';
import { tempoRelativo } from '@/i18n/datas';
import Botao from '@/ds/Botao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';

const { t } = useI18n();
const app = useAppStore();
const router = useRouter();
const qc = useQueryClient();
const q = useInfiniteQuery({
  queryKey: ['notificacoes'],
  queryFn: ({ pageParam }) => ok(api().GET('/v1/notificacoes', { params: { query: { limite: 20, ...(pageParam ? { cursor: pageParam } : {}) } } })),
  initialPageParam: '' as string,
  getNextPageParam: (p) => p.proximoCursor ?? undefined,
});
const itens = computed(() => q.data.value?.pages.flatMap((p) => p.itens) ?? []);
const marcar = useMutation({
  mutationFn: (corpo: { ids?: string[]; todas?: boolean }) => ok(api().POST('/v1/notificacoes/leitura', { body: corpo })),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['notificacoes'] }),
});
async function abrir(n: (typeof itens.value)[number]) {
  if (!n.lidoEm) marcar.mutate({ ids: [n.id] });
  const destino = n.destino ? caminhoDe(n.destino.tela as string, (n.destino.parametros ?? {}) as Record<string, string>) : null;
  if (destino) await router.push(destino);
}
</script>
<template>
  <div class="flex flex-col gap-2">
    <div class="mb-2 flex items-center justify-between">
      <h1 class="text-2xl font-bold">Notificações</h1>
      <Botao v-if="itens.some((n) => !n.lidoEm)" variante="fantasma" :carregando="marcar.isPending.value" @click="marcar.mutate({ todas: true })">Marcar todas como lidas</Botao>
    </div>
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" :vazio="!itens.length" texto-vazio="Nenhuma notificação." @tentar="q.refetch()" />
    <button v-for="n in itens" :key="n.id" type="button" class="flex min-h-16 w-full items-start gap-3 rounded-xl border px-4 py-3 text-left" :class="n.lidoEm ? 'border-zinc-200 dark:border-zinc-700' : 'border-acao bg-marca-50 dark:bg-zinc-800'" @click="abrir(n)">
      <span v-if="!n.lidoEm" class="mt-2 size-2.5 shrink-0 rounded-full bg-acao" aria-label="não lida" />
      <span class="flex-1"><strong class="block">{{ n.titulo }}</strong><span class="text-sm text-zinc-600 dark:text-zinc-300">{{ n.texto }}</span></span>
      <span class="text-xs text-secundario">{{ tempoRelativo(n.criadoEm, app.agoraServidor(), app.fuso, app.locale) }}</span>
    </button>
    <Botao v-if="q.hasNextPage.value" variante="secundario" :carregando="q.isFetchingNextPage.value" @click="q.fetchNextPage()">Ver mais</Botao>
  </div>
</template>
