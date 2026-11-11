<script setup lang="ts">
// Paciente: receitas e atestados assinados (e anulados, sinalizados) dos pacientes vinculados.
// Rascunho nunca aparece aqui: o backend só entrega documento assinado (ADR-0018).
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Download } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { capitalizar } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { intervaloRenovacao } from '@/telas/exames/util';
import { resumo, STATUS, TIPO } from './util';

const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const vinculados = computed(() => sessao.manifesto?.pacientesVinculados ?? []);
const selecionado = ref<string | null>(null);
const q = useQuery({
  queryKey: ['documentos', 'meus', selecionado],
  queryFn: () => ok(api().GET('/v1/documentos', { params: { query: { ...(selecionado.value ? { pacienteId: selecionado.value } : {}), limite: 50 } } })),
  refetchInterval: (c) => intervaloRenovacao(c.state.data?.itens.map((d) => d.arquivo?.urlsExpiramEm).filter(Boolean).sort()[0], app.agoraServidor()),
});
const quando = (iso: string) => formatarDataHora(iso, app.fuso, app.locale, { dateStyle: 'short' });
</script>
<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">Meus documentos</h1>
    <p class="text-secundario">Receitas e atestados assinados digitalmente pela equipe. Leve o PDF à farmácia ou ao trabalho; quem receber pode conferir pelo código de validação.</p>
    <div v-if="vinculados.length > 1" class="flex flex-wrap gap-2" role="group" :aria-label="capitalizar(termo('paciente').plural)">
      <button type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="!selecionado ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="!selecionado" @click="selecionado = null">Todos</button>
      <button v-for="p in vinculados" :key="p.id" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="selecionado === p.id ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="selecionado === p.id" @click="selecionado = p.id">{{ p.nome }}</button>
    </div>
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" :vazio="!q.data.value?.itens.length" texto-vazio="Nenhum documento ainda." @tentar="q.refetch()">
      <Cartao v-for="d in q.data.value?.itens ?? []" :key="d.id" class="flex flex-col gap-2" :class="d.status === 'ANULADO' && 'border-dashed'">
        <div class="flex items-start justify-between gap-2">
          <RouterLink :to="`/documentos/${d.id}`" class="min-w-0 hover:underline">
            <p class="text-sm text-secundario">{{ d.assinadoEm ? quando(d.assinadoEm) : '' }} · {{ d.emissor.nome }}<template v-if="vinculados.length > 1"> · {{ d.paciente.nome }}</template></p>
            <h2 class="text-lg font-bold">{{ TIPO[d.tipo] }}</h2>
            <p class="text-sm">{{ resumo(d) }}</p>
          </RouterLink>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[d.status].classe">{{ STATUS[d.status].rotulo }}</span>
        </div>
        <p v-if="d.status === 'ANULADO'" class="text-sm font-semibold text-erro">Anulado pela equipe: não use este documento.</p>
        <a v-else-if="d.arquivo?.urlVisualizacao" :href="d.arquivo.urlVisualizacao" rel="noopener noreferrer" class="flex min-h-11 items-center gap-2 self-start font-semibold text-acao underline"><Download class="size-5" aria-hidden="true" /> Baixar PDF</a>
      </Cartao>
    </EstadoConsulta>
  </div>
</template>
