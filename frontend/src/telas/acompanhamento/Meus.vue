<script setup lang="ts">
// Paciente: acompanhamentos dos pacientes vinculados, com seletor quando há mais de um (tutora com dois pets).
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { api, ok } from '@/api';
import { useSessaoStore } from '@/sessao/store';
import { capitalizar, nenhum } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';

const { t } = useI18n();
const sessao = useSessaoStore();
const termo = useTermos();
const vinculados = computed(() => sessao.manifesto?.pacientesVinculados ?? []);
const selecionado = ref<string | null>(null);
const { data, isPending, error, refetch } = useQuery({ queryKey: ['acompanhamentos', 'meus'], queryFn: () => ok(api().GET('/v1/acompanhamentos', { params: { query: { limite: 50 } } })) });
const lista = computed(() => (data.value?.itens ?? []).filter((a) => !selecionado.value || a.paciente.id === selecionado.value));
const STATUS: Record<string, string> = { AGENDADO: 'Agendado', ATIVO: 'Em andamento', CONCLUIDO: 'Concluído', ENCERRADO: 'Encerrado' };
</script>
<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ capitalizar(termo('acompanhamento').plural) }}</h1>
    <div v-if="vinculados.length > 1" class="flex flex-wrap gap-2" role="group" :aria-label="capitalizar(termo('paciente').plural)">
      <button type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="!selecionado ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" @click="selecionado = null">Todos</button>
      <button v-for="p in vinculados" :key="p.id" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="selecionado === p.id ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" @click="selecionado = p.id">{{ p.nome }}</button>
    </div>
    <EstadoConsulta :carregando="isPending" :erro="error" :vazio="!lista.length" :texto-vazio="`${capitalizar(nenhum(termo('acompanhamento')))} por aqui.`" @tentar="refetch()" />
    <RouterLink v-for="a in lista" :key="a.id" :to="`/acompanhamentos/${a.id}`">
      <Cartao class="hover:border-acao">
        <p class="text-sm text-secundario">{{ a.paciente.nome }} · {{ STATUS[a.status] ?? a.status }}</p>
        <h2 class="text-lg font-bold">{{ a.protocolo.nome }}</h2>
        <p v-if="a.status === 'ATIVO'">Dia {{ a.diaAtual }} de {{ a.totalDias }}</p>
        <p v-if="a.resumoCheckins.pendentes" class="font-semibold text-acao">{{ a.resumoCheckins.pendentes }} para responder</p>
      </Cartao>
    </RouterLink>
  </div>
</template>
