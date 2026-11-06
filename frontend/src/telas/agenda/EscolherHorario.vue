<script setup lang="ts">
// Horários livres de um serviço (GET /v1/agenda/horarios), 7 dias por vez, agrupados por dia local.
// O backend já desconta grade, bloqueios, ocupados, antecedência e janela (paciente) — aqui só exibimos.
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { formatarData, formatarHora } from '@/i18n/datas';
import { hojeNoFuso, somarDias } from '@/i18n/dias';
import { capitalizar } from '@/i18n/termos';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { porDia } from './util';

const props = defineProps<{ servicoId: string; profissionalId?: string; mostrarProfissional?: boolean }>();
const escolhido = defineModel<{ inicioEm: string; profissionalId: string } | null>({ default: null });
const app = useAppStore();
const hoje = hojeNoFuso(app.agoraServidor(), app.fuso);
const de = ref(hoje);
const ate = computed(() => somarDias(de.value, 6));
const chave = computed(() => ({ servicoId: props.servicoId, profissionalId: props.profissionalId || undefined, de: de.value, ate: ate.value }));
const q = useQuery({
  queryKey: ['agenda-horarios', chave],
  queryFn: () => ok(api().GET('/v1/agenda/horarios', { params: { query: { servicoId: chave.value.servicoId, de: chave.value.de, ate: chave.value.ate, ...(chave.value.profissionalId ? { profissionalId: chave.value.profissionalId } : {}) } } })),
  enabled: computed(() => !!props.servicoId),
  staleTime: 0,
});
watch(() => [props.servicoId, props.profissionalId], () => { escolhido.value = null; });
const dias = computed(() => porDia(q.data.value?.itens ?? [], app.fuso));
const igual = (h: { inicioEm: string; profissional: { usuarioId: string } }) => escolhido.value?.inicioEm === h.inicioEm && escolhido.value?.profissionalId === h.profissional.usuarioId;
</script>
<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <button type="button" class="rounded-lg p-2 disabled:opacity-40" :disabled="de <= hoje" aria-label="Semana anterior" @click="de = somarDias(de, -7)"><ChevronLeft class="size-5" /></button>
      <p class="text-sm font-medium" aria-live="polite">{{ formatarData(de, app.locale, { day: 'numeric', month: 'short' }) }} a {{ formatarData(ate, app.locale, { day: 'numeric', month: 'short' }) }}</p>
      <button type="button" class="rounded-lg p-2" aria-label="Próxima semana" @click="de = somarDias(de, 7)"><ChevronRight class="size-5" /></button>
    </div>
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" :vazio="!dias.length" texto-vazio="Nenhum horário livre nesta semana. Veja a próxima." @tentar="q.refetch()">
      <fieldset v-for="d in dias" :key="d.dia" class="flex flex-col gap-1.5">
        <legend class="mb-1 text-sm font-semibold">{{ capitalizar(formatarData(d.dia, app.locale, { weekday: 'long', day: 'numeric', month: 'long' })) }}</legend>
        <div class="flex flex-wrap gap-2">
          <button v-for="h in d.itens" :key="h.inicioEm + h.profissional.usuarioId" type="button" class="min-h-11 rounded-xl border-2 px-3 font-medium"
            :class="igual(h) ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300 hover:border-acao dark:border-zinc-600'" :aria-pressed="igual(h)"
            @click="escolhido = { inicioEm: h.inicioEm, profissionalId: h.profissional.usuarioId }">
            {{ formatarHora(h.inicioEm, app.fuso, app.locale) }}<span v-if="mostrarProfissional" class="ml-1 text-xs font-normal">· {{ h.profissional.nome }}</span>
          </button>
        </div>
      </fieldset>
    </EstadoConsulta>
  </div>
</template>
