<script setup lang="ts">
// Paciente: próximas consultas (e as anteriores sob demanda) dos pacientes vinculados.
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { CalendarPlus } from 'lucide-vue-next';
import type { Agendamento } from '@clinica/contrato-tipos';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { hojeNoFuso, somarDias } from '@/i18n/dias';
import { capitalizar, flexao, nenhum } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { listarPeriodo, STATUS } from './util';

const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const consulta = computed(() => termo.value('consulta'));
const vinculados = computed(() => sessao.manifesto?.pacientesVinculados ?? []);
const selecionado = ref<string | null>(null);
const hoje = hojeNoFuso(app.agoraServidor(), app.fuso);
const proximas = useQuery({ queryKey: ['agendamentos', 'meus', 'proximos'], queryFn: () => listarPeriodo({ de: hoje, ate: somarDias(hoje, 365) }) });
const verAnteriores = ref(false);
const anteriores = useQuery({ queryKey: ['agendamentos', 'meus', 'anteriores'], queryFn: () => listarPeriodo({ de: somarDias(hoje, -365), ate: somarDias(hoje, -1) }), enabled: verAnteriores });
const doSelecionado = (l: Agendamento[] | undefined) => (l ?? []).filter((a) => !selecionado.value || a.paciente.id === selecionado.value);
// Hoje já passado (realizado, faltou) vai para "anteriores"; cancelado futuro fica visível, mas por último.
const futuras = computed(() => doSelecionado(proximas.data.value).filter((a) => a.fimEm > new Date(app.agoraServidor()).toISOString() || a.status === 'AGENDADO' || a.status === 'CONFIRMADO')
  .sort((a, b) => Number(a.status === 'CANCELADO') - Number(b.status === 'CANCELADO') || a.inicioEm.localeCompare(b.inicioEm)));
const passadas = computed(() => [...doSelecionado(anteriores.data.value), ...doSelecionado(proximas.data.value).filter((a) => !futuras.value.includes(a))].sort((a, b) => b.inicioEm.localeCompare(a.inicioEm)));
const quando = (iso: string) => capitalizar(formatarDataHora(iso, app.fuso, app.locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));
const titulo = computed(() => capitalizar(`${flexao(consulta.value, 'meus', 'minhas')} ${consulta.value.plural}`));
</script>
<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">{{ titulo }}</h1>
      <RouterLink v-if="sessao.pode('agenda.agendamento.criar')" to="/agenda/marcar"><Botao><CalendarPlus class="size-5" aria-hidden="true" /> Marcar {{ consulta.singular }}</Botao></RouterLink>
    </div>
    <div v-if="vinculados.length > 1" class="flex flex-wrap gap-2" role="group" :aria-label="capitalizar(termo('paciente').plural)">
      <button type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="!selecionado ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="!selecionado" @click="selecionado = null">Todos</button>
      <button v-for="p in vinculados" :key="p.id" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="selecionado === p.id ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="selecionado === p.id" @click="selecionado = p.id">{{ p.nome }}</button>
    </div>
    <EstadoConsulta :carregando="proximas.isPending.value" :erro="proximas.error.value" :vazio="!futuras.length" :texto-vazio="`${capitalizar(nenhum(consulta))} marcad${consulta.genero === 'F' ? 'a' : 'o'}.`" @tentar="proximas.refetch()">
      <RouterLink v-for="a in futuras" :key="a.id" :to="`/agenda/${a.id}`">
        <Cartao class="hover:border-acao" :class="a.status === 'CANCELADO' && 'border-dashed'">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm text-secundario">{{ a.servico.nome }}<template v-if="vinculados.length > 1"> · {{ a.paciente.nome }}</template></p>
            <span class="rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[a.status].classe">{{ STATUS[a.status].rotulo }}</span>
          </div>
          <h2 class="text-lg font-bold">{{ quando(a.inicioEm) }}</h2>
          <p>{{ a.profissional.nome }}<template v-if="a.local"> · {{ a.local }}</template></p>
          <p v-if="a.acoesPermitidas.includes('CONFIRMAR')" class="mt-1 font-semibold text-acao">Confirme sua presença</p>
        </Cartao>
      </RouterLink>
    </EstadoConsulta>
    <Botao v-if="!verAnteriores" variante="fantasma" @click="verAnteriores = true">Ver anteriores</Botao>
    <section v-else class="flex flex-col gap-2" aria-label="Anteriores">
      <h2 class="font-bold">Anteriores</h2>
      <EstadoConsulta :carregando="anteriores.isPending.value" :erro="anteriores.error.value" :vazio="!passadas.length" texto-vazio="Nada nos últimos 12 meses." @tentar="anteriores.refetch()">
        <RouterLink v-for="a in passadas" :key="a.id" :to="`/agenda/${a.id}`" class="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
          <span><span class="font-medium">{{ formatarDataHora(a.inicioEm, app.fuso, app.locale) }}</span> · {{ a.servico.nome }}</span>
          <span class="rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[a.status].classe">{{ STATUS[a.status].rotulo }}</span>
        </RouterLink>
      </EstadoConsulta>
    </section>
    <p v-if="!sessao.pode('agenda.agendamento.criar')" class="text-sm text-secundario">Para marcar, fale com a equipe.</p>
  </div>
</template>
