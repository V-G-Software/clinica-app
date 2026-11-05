<script setup lang="ts">
// Pacientes: lista paginada por cursor; busca com o texto no CORPO (POST /busca), nunca na URL.
import { computed, ref, watch } from 'vue';
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Search, UserPlus } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useSessaoStore } from '@/sessao/store';
import { capitalizar, nenhum, novo } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';

const { t } = useI18n();
const sessao = useSessaoStore();
const termo = useTermos();
const status = ref<'ATIVO' | 'INATIVO'>('ATIVO');
const busca = ref('');
const buscaAtiva = ref('');
let temporizador: ReturnType<typeof setTimeout>;
watch(busca, (v) => { clearTimeout(temporizador); temporizador = setTimeout(() => (buscaAtiva.value = v.trim().length >= 2 ? v.trim() : ''), 300); });

const lista = useInfiniteQuery({
  queryKey: ['pacientes', { status }],
  queryFn: ({ pageParam }) => ok(api().GET('/v1/pacientes', { params: { query: { status: status.value, limite: 30, ...(pageParam ? { cursor: pageParam } : {}) } } })),
  initialPageParam: '' as string,
  getNextPageParam: (p) => p.proximoCursor ?? undefined,
  enabled: computed(() => !buscaAtiva.value),
});
const resultado = useQuery({
  queryKey: ['pacientes', 'busca', buscaAtiva],
  queryFn: () => ok(api().POST('/v1/pacientes/busca', { body: { texto: buscaAtiva.value, limite: 50 } })),
  enabled: computed(() => !!buscaAtiva.value),
});
const itens = computed(() => (buscaAtiva.value ? (resultado.data.value?.itens ?? []).filter((p) => p.status === status.value) : lista.data.value?.pages.flatMap((p) => p.itens) ?? []));
const carregando = computed(() => (buscaAtiva.value ? resultado.isPending.value : lista.isPending.value));
const ACESSO: Record<string, [string, string]> = { ATIVO: ['Usa o app', 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200'], CONVITE_PENDENTE: ['Convite pendente', 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'], SEM_ACESSO: ['Sem acesso', 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'] };
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">{{ capitalizar(termo('paciente').plural) }}</h1>
      <RouterLink v-if="sessao.pode('pacientes.paciente.criar')" to="/pacientes/novo"><Botao><UserPlus class="size-5" aria-hidden="true" /> {{ capitalizar(novo(termo('paciente'))) }}</Botao></RouterLink>
    </div>
    <div class="relative">
      <Search class="pointer-events-none absolute top-3.5 left-3 size-5 text-zinc-400" aria-hidden="true" />
      <input v-model="busca" type="search" :aria-label="`Buscar ${termo('paciente').plural}`" placeholder="Nome, e-mail ou celular" autocomplete="off"
        class="min-h-12 w-full rounded-xl border-2 border-zinc-300 bg-white pr-4 pl-10 dark:border-zinc-600 dark:bg-zinc-800" />
    </div>
    <div class="flex gap-2" role="group" aria-label="Status">
      <button v-for="[v, r] in [['ATIVO', 'Ativos'], ['INATIVO', 'Inativos']] as const" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="status === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" @click="status = v">{{ r }}</button>
    </div>
    <EstadoConsulta :carregando="carregando" :erro="buscaAtiva ? resultado.error.value : lista.error.value" :vazio="!itens.length"
      :texto-vazio="`${capitalizar(nenhum(termo('paciente')))} encontrad${termo('paciente').genero === 'F' ? 'a' : 'o'}.`" @tentar="buscaAtiva ? resultado.refetch() : lista.refetch()" />
    <RouterLink v-for="p in itens" :key="p.id" :to="`/pacientes/${p.id}`" class="flex min-h-16 items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{{ p.nomeSocial ?? p.nome }}</p>
        <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ p.responsaveis[0]?.nome ? `${capitalizar(termo('responsavel').singular)}: ${p.responsaveis[0].nome}` : (p.contato.email ?? '') }}</p>
      </div>
      <span v-if="p.acompanhamentosAtivos" class="text-sm font-medium text-acao">{{ p.acompanhamentosAtivos }} {{ p.acompanhamentosAtivos === 1 ? termo('acompanhamento').singular : termo('acompanhamento').plural }}</span>
      <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="ACESSO[p.acessoApp.status]?.[1]">{{ ACESSO[p.acessoApp.status]?.[0] ?? p.acessoApp.status }}</span>
    </RouterLink>
    <Botao v-if="!buscaAtiva && lista.hasNextPage.value" variante="secundario" :carregando="lista.isFetchingNextPage.value" @click="lista.fetchNextPage()">Ver mais</Botao>
  </div>
</template>
