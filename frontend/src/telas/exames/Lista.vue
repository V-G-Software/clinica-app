<script setup lang="ts">
// Equipe: resultados para revisar (o que pede ação), todos os resultados e pedidos. Filtro opcional por
// paciente (?pacienteId=, vindo do detalhe do paciente). Paginação por cursor ("Ver mais").
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query';
import { FilePlus2, Upload, X } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { artigo, capitalizar } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { STATUS_PEDIDO, STATUS_RESULTADO } from './util';

type Aba = 'REVISAR' | 'RESULTADOS' | 'PEDIDOS';
const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const exame = computed(() => termo.value('exame'));
const podeRevisar = computed(() => sessao.pode('exames.resultado.revisar'));
const aba = ref<Aba>(podeRevisar.value ? 'REVISAR' : 'RESULTADOS');
const statusPedido = ref<'ABERTO' | 'CONCLUIDO' | 'CANCELADO' | ''>('ABERTO');
const pacienteId = computed(() => (typeof rota.query.pacienteId === 'string' ? rota.query.pacienteId : ''));
const paciente = useQuery({ queryKey: ['paciente-resumo', pacienteId], queryFn: () => ok(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId.value } } })), enabled: computed(() => !!pacienteId.value && sessao.modulos.has('pacientes')) });
const comPaciente = () => (pacienteId.value ? { pacienteId: pacienteId.value } : {});

const resultados = useInfiniteQuery({
  queryKey: ['exames-resultados', { aba, pacienteId }],
  queryFn: ({ pageParam }) => ok(api().GET('/v1/exames/resultados', { params: { query: { ...comPaciente(), ...(aba.value === 'REVISAR' ? { status: 'AGUARDANDO_REVISAO' as const } : {}), limite: 30, ...(pageParam ? { cursor: pageParam } : {}) } } })),
  initialPageParam: '' as string,
  getNextPageParam: (p) => p.proximoCursor ?? undefined,
  enabled: computed(() => aba.value !== 'PEDIDOS'),
});
const pedidos = useInfiniteQuery({
  queryKey: ['exames-pedidos', { statusPedido, pacienteId }],
  queryFn: ({ pageParam }) => ok(api().GET('/v1/exames/pedidos', { params: { query: { ...comPaciente(), ...(statusPedido.value ? { status: statusPedido.value } : {}), limite: 30, ...(pageParam ? { cursor: pageParam } : {}) } } })),
  initialPageParam: '' as string,
  getNextPageParam: (p) => p.proximoCursor ?? undefined,
  enabled: computed(() => aba.value === 'PEDIDOS'),
});
// "Para revisar" do mais antigo para o mais novo (fila); as demais, do mais recente.
const listaResultados = computed(() => {
  const l = (resultados.data.value?.pages ?? []).flatMap((p) => p.itens);
  return aba.value === 'REVISAR' ? [...l].reverse() : l;
});
const listaPedidos = computed(() => (pedidos.data.value?.pages ?? []).flatMap((p) => p.itens));
const ABAS = computed(() => ([...(podeRevisar.value ? [['REVISAR', 'Para revisar']] : []), ['RESULTADOS', 'Resultados'], ['PEDIDOS', 'Pedidos']] as Array<[Aba, string]>));
const contador = computed(() => (sessao.manifesto?.contadores as Record<string, number> | undefined)?.['exames.resultadosParaRevisar'] ?? 0);
const limparPaciente = () => router.replace({ query: {} });
const sufixo = computed(() => (pacienteId.value ? `?pacienteId=${encodeURIComponent(pacienteId.value)}` : ''));
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">{{ capitalizar(exame.plural) }}</h1>
      <div class="flex flex-wrap gap-2">
        <RouterLink v-if="sessao.pode('exames.resultado.enviar')" :to="`/exames/enviar${sufixo}`"><Botao variante="secundario"><Upload class="size-5" aria-hidden="true" /> Enviar resultado</Botao></RouterLink>
        <RouterLink v-if="sessao.pode('exames.pedido.criar')" :to="`/exames/novo${sufixo}`"><Botao><FilePlus2 class="size-5" aria-hidden="true" /> Pedir {{ exame.singular }}</Botao></RouterLink>
      </div>
    </div>
    <p v-if="pacienteId" class="flex flex-wrap items-center gap-2 text-sm">
      {{ capitalizar(termo('paciente').singular) }}: <strong>{{ paciente.data.value?.nome ?? '…' }}</strong>
      <button type="button" class="flex min-h-10 items-center gap-1 rounded-full border-2 border-zinc-300 px-3" @click="limparPaciente"><X class="size-4" aria-hidden="true" /> Ver todos</button>
    </p>
    <div class="flex flex-wrap gap-1" role="group" aria-label="Mostrar">
      <button v-for="[v, r] in ABAS" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="aba === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="aba === v" @click="aba = v">
        {{ r }}<template v-if="v === 'REVISAR' && contador && !pacienteId"> ({{ contador }})</template>
      </button>
    </div>

    <template v-if="aba !== 'PEDIDOS'">
      <EstadoConsulta :carregando="resultados.isPending.value" :erro="resultados.error.value" :vazio="!listaResultados.length" :texto-vazio="aba === 'REVISAR' ? 'Nenhum resultado aguardando revisão.' : 'Nenhum resultado enviado.'" @tentar="resultados.refetch()">
        <RouterLink v-for="r in listaResultados" :key="r.id" :to="`/exames/resultados/${r.id}`" class="flex min-h-16 items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ r.paciente.nome }}</p>
            <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ r.titulo }} · {{ r.arquivos.length }} arquivo{{ r.arquivos.length === 1 ? '' : 's' }}</p>
            <p class="text-xs text-secundario">Enviado {{ r.origem === 'PACIENTE' ? `pel${artigo(termo('paciente'))} ${termo('paciente').singular}` : `por ${r.enviadoPor.nome}` }} em {{ formatarDataHora(r.criadoEm, app.fuso, app.locale) }}</p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS_RESULTADO[r.status].classe">{{ STATUS_RESULTADO[r.status].rotulo }}</span>
        </RouterLink>
      </EstadoConsulta>
      <Botao v-if="resultados.hasNextPage.value" variante="fantasma" :carregando="resultados.isFetchingNextPage.value" @click="resultados.fetchNextPage()">Ver mais</Botao>
    </template>

    <template v-else>
      <label class="flex items-center gap-2 text-sm">Situação
        <select v-model="statusPedido" class="min-h-10 rounded-lg border-2 border-zinc-300 bg-white px-2 dark:border-zinc-600 dark:bg-zinc-800">
          <option value="ABERTO">Abertos</option><option value="CONCLUIDO">Concluídos</option><option value="CANCELADO">Cancelados</option><option value="">Todos</option>
        </select>
      </label>
      <EstadoConsulta :carregando="pedidos.isPending.value" :erro="pedidos.error.value" :vazio="!listaPedidos.length" :texto-vazio="`Nenhum pedido de ${exame.singular}.`" @tentar="pedidos.refetch()">
        <RouterLink v-for="p in listaPedidos" :key="p.id" :to="`/exames/pedidos/${p.id}`" class="flex min-h-16 items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ p.paciente.nome }}</p>
            <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ p.itens.map((i) => i.nome).join(', ') }}</p>
            <p class="text-xs text-secundario">{{ formatarDataHora(p.criadoEm, app.fuso, app.locale, { dateStyle: 'short' }) }} · {{ p.solicitante.nome }} · {{ p.resultados.length ? `${p.resultados.length} resultado${p.resultados.length === 1 ? '' : 's'}` : 'sem resultado' }}</p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS_PEDIDO[p.status].classe">{{ STATUS_PEDIDO[p.status].rotulo }}</span>
        </RouterLink>
      </EstadoConsulta>
      <Botao v-if="pedidos.hasNextPage.value" variante="fantasma" :carregando="pedidos.isFetchingNextPage.value" @click="pedidos.fetchNextPage()">Ver mais</Botao>
    </template>
  </div>
</template>
