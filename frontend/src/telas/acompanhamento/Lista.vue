<script setup lang="ts">
import { computed, ref } from 'vue';
import { useInfiniteQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Plus } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarData } from '@/i18n/datas';
import { capitalizar, nenhum, novo } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';

const { t } = useI18n();
const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const status = ref<'ATIVO' | 'AGENDADO' | 'CONCLUIDO' | 'ENCERRADO'>('ATIVO');
const comAlerta = ref(false);
const meus = ref(false);
const filtros = computed(() => ({ status: status.value, ...(comAlerta.value ? { comAlertaAberto: true } : {}), ...(meus.value ? { profissionalId: sessao.manifesto?.usuario.id } : {}) }));
const q = useInfiniteQuery({
  queryKey: ['acompanhamentos', filtros],
  queryFn: ({ pageParam }) => ok(api().GET('/v1/acompanhamentos', { params: { query: { ...filtros.value, limite: 30, ...(pageParam ? { cursor: pageParam } : {}) } } })),
  initialPageParam: '' as string,
  getNextPageParam: (p) => p.proximoCursor ?? undefined,
});
const itens = computed(() => q.data.value?.pages.flatMap((p) => p.itens) ?? []);
const STATUS = [['ATIVO', 'Em andamento'], ['AGENDADO', 'Agendados'], ['CONCLUIDO', 'Concluídos'], ['ENCERRADO', 'Encerrados']] as const;
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">{{ capitalizar(termo('acompanhamento').plural) }}</h1>
      <RouterLink v-if="sessao.pode('acompanhamento.acompanhamento.criar')" to="/acompanhamentos/novo"><Botao><Plus class="size-5" aria-hidden="true" /> {{ capitalizar(novo(termo('acompanhamento'))) }}</Botao></RouterLink>
    </div>
    <div class="flex flex-wrap gap-2" role="group" aria-label="Status">
      <button v-for="[v, r] in STATUS" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="status === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" @click="status = v">{{ r }}</button>
    </div>
    <div class="flex flex-wrap gap-4 text-sm">
      <label class="flex items-center gap-2"><input v-model="comAlerta" type="checkbox" class="size-5" /> Só com alerta aberto</label>
      <label class="flex items-center gap-2"><input v-model="meus" type="checkbox" class="size-5" /> Só os meus</label>
    </div>
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" :vazio="!itens.length" :texto-vazio="`${capitalizar(nenhum(termo('acompanhamento')))} aqui.`" @tentar="q.refetch()" />
    <RouterLink v-for="a in itens" :key="a.id" :to="`/acompanhamentos/${a.id}`" class="flex min-h-16 items-center gap-3 rounded-xl border px-4 py-2 hover:border-acao" :class="a.alertasAbertos ? 'border-red-300 dark:border-red-800' : 'border-zinc-200 dark:border-zinc-700'">
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{{ a.paciente.nome }}</p>
        <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ a.protocolo.nome }} · {{ formatarData(a.dataInicio, app.locale) }}</p>
      </div>
      <div class="text-right text-sm">
        <p v-if="a.status === 'ATIVO'">Dia {{ a.diaAtual }}/{{ a.totalDias }}</p>
        <p v-if="a.resumoCheckins.pendentes" class="text-secundario">{{ a.resumoCheckins.pendentes }} pendente(s)</p>
        <p v-if="a.alertasAbertos" class="font-bold text-erro">{{ a.alertasAbertos }} alerta(s)</p>
      </div>
    </RouterLink>
    <Botao v-if="q.hasNextPage.value" variante="secundario" :carregando="q.isFetchingNextPage.value" @click="q.fetchNextPage()">Ver mais</Botao>
  </div>
</template>
