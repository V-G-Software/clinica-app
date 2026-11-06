<script setup lang="ts">
// Equipe: agenda do dia ou da semana, por profissional. Datas sempre no fuso da organização.
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarData, formatarHora } from '@/i18n/datas';
import { hojeNoFuso, somarDias } from '@/i18n/dias';
import { capitalizar, nenhum, novo } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { inicioDaSemana, listarPeriodo, porDia, STATUS } from './util';

const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const hoje = () => hojeNoFuso(app.agoraServidor(), app.fuso);
const visao = ref<'DIA' | 'SEMANA'>('DIA');
const data = ref(hoje());
const profissionalId = ref('');
const mostrarCancelados = ref(false);
const periodo = computed(() => (visao.value === 'DIA' ? { de: data.value, ate: data.value } : { de: inicioDaSemana(data.value), ate: somarDias(inicioDaSemana(data.value), 6) }));
const filtros = computed(() => ({ ...periodo.value, ...(profissionalId.value ? { profissionalId: profissionalId.value } : {}) }));
const q = useQuery({ queryKey: ['agendamentos', filtros], queryFn: () => listarPeriodo(filtros.value) });
// Profissionais vêm dos serviços: não depende do módulo equipe nem de permissão de ler membros.
const servicos = useQuery({ queryKey: ['agenda-servicos', 'ATIVO'], queryFn: () => ok(api().GET('/v1/agenda/servicos', { params: { query: { status: 'ATIVO' } } })) });
const profissionais = computed(() => {
  const m = new Map<string, string>();
  for (const s of servicos.data.value?.itens ?? []) for (const p of s.profissionais) m.set(p.usuarioId, p.nome);
  return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
});
const visiveis = computed(() => (q.data.value ?? []).filter((a) => mostrarCancelados.value || a.status !== 'CANCELADO'));
const dias = computed(() => porDia(visiveis.value, app.fuso));
const cancelados = computed(() => (q.data.value ?? []).filter((a) => a.status === 'CANCELADO').length);
const passo = (n: number) => { data.value = somarDias(data.value, visao.value === 'DIA' ? n : 7 * n); };
const titulo = computed(() => (visao.value === 'DIA'
  ? capitalizar(formatarData(data.value, app.locale, { weekday: 'long', day: 'numeric', month: 'long' }))
  : `${formatarData(periodo.value.de, app.locale, { day: 'numeric', month: 'short' })} a ${formatarData(periodo.value.ate, app.locale, { day: 'numeric', month: 'short' })}`));
const consulta = computed(() => termo.value('consulta'));
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">Agenda</h1>
      <RouterLink v-if="sessao.pode('agenda.agendamento.criar')" to="/agenda/novo"><Botao><Plus class="size-5" aria-hidden="true" /> {{ capitalizar(novo(consulta)) }}</Botao></RouterLink>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex gap-1" role="group" aria-label="Visão">
        <button v-for="[v, r] in [['DIA', 'Dia'], ['SEMANA', 'Semana']] as const" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="visao === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="visao === v" @click="visao = v">{{ r }}</button>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" class="rounded-lg p-2" :aria-label="visao === 'DIA' ? 'Dia anterior' : 'Semana anterior'" @click="passo(-1)"><ChevronLeft class="size-5" /></button>
        <button type="button" class="min-h-10 rounded-full border-2 border-zinc-300 px-4 text-sm font-medium" @click="data = hoje()">Hoje</button>
        <button type="button" class="rounded-lg p-2" :aria-label="visao === 'DIA' ? 'Próximo dia' : 'Próxima semana'" @click="passo(1)"><ChevronRight class="size-5" /></button>
      </div>
      <input v-model="data" type="date" aria-label="Ir para a data" class="min-h-10 rounded-lg border-2 border-zinc-300 bg-white px-2 dark:border-zinc-600 dark:bg-zinc-800" />
      <select v-if="profissionais.length > 1" v-model="profissionalId" aria-label="Profissional" class="min-h-10 rounded-lg border-2 border-zinc-300 bg-white px-2 dark:border-zinc-600 dark:bg-zinc-800">
        <option value="">Todos os profissionais</option>
        <option v-for="p in profissionais" :key="p.id" :value="p.id">{{ p.nome }}</option>
      </select>
    </div>
    <h2 class="text-lg font-semibold" aria-live="polite">{{ titulo }}</h2>
    <label v-if="cancelados" class="flex items-center gap-2 text-sm"><input v-model="mostrarCancelados" type="checkbox" class="size-5" /> Mostrar cancelados ({{ cancelados }})</label>
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" :vazio="!visiveis.length" :texto-vazio="`${capitalizar(nenhum(consulta))} neste período.`" @tentar="q.refetch()">
      <section v-for="d in dias" :key="d.dia" class="flex flex-col gap-2" :aria-label="formatarData(d.dia, app.locale, { weekday: 'long', day: 'numeric', month: 'long' })">
        <h3 v-if="visao === 'SEMANA'" class="mt-2 text-sm font-semibold text-secundario">{{ capitalizar(formatarData(d.dia, app.locale, { weekday: 'long', day: 'numeric', month: 'long' })) }}</h3>
        <RouterLink v-for="a in d.itens" :key="a.id" :to="`/agenda/${a.id}`" class="flex min-h-16 items-center gap-3 rounded-xl border px-4 py-2 hover:border-acao" :class="a.servico.categoria === 'PROCEDIMENTO' ? 'border-acao/60 border-l-4' : 'border-zinc-200 dark:border-zinc-700'">
          <div class="w-14 shrink-0 text-center">
            <p class="font-bold">{{ formatarHora(a.inicioEm, app.fuso, app.locale) }}</p>
            <p class="text-xs text-secundario">{{ formatarHora(a.fimEm, app.fuso, app.locale) }}</p>
          </div>
          <div class="min-w-0 flex-1" :class="a.status === 'CANCELADO' && 'line-through'">
            <p class="font-semibold">{{ a.paciente.nome }}</p>
            <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ a.servico.nome }} · {{ a.profissional.nome }}<template v-if="a.local"> · {{ a.local }}</template></p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[a.status].classe">{{ STATUS[a.status].rotulo }}</span>
            <span v-if="a.encaixe" class="text-xs text-secundario">encaixe</span>
          </div>
        </RouterLink>
      </section>
    </EstadoConsulta>
  </div>
</template>
