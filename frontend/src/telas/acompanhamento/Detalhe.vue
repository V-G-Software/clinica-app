<script setup lang="ts">
// Detalhe do acompanhamento: linha do tempo dos dias (respondido, pendente, expirado, agendado).
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { CalendarClock, CircleCheck, CircleDashed, CircleX, MessageCircle, PencilLine } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarData, formatarDataHora } from '@/i18n/datas';
import { capitalizar } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Cartao from '@/ds/Cartao.vue';
import Aviso from '@/ds/Aviso.vue';

const { t } = useI18n();
const rota = useRoute();
const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const id = computed(() => String(rota.params.acompanhamentoId));
const acp = useQuery({ queryKey: ['acompanhamento', id], queryFn: () => ok(api().GET('/v1/acompanhamentos/{acompanhamentoId}', { params: { path: { acompanhamentoId: id.value } } })) });
const cks = useQuery({ queryKey: ['checkins', { acompanhamentoId: id }], queryFn: () => ok(api().GET('/v1/checkins', { params: { query: { acompanhamentoId: id.value, limite: 100 } } })) });
const ICONE = { RESPONDIDO: CircleCheck, DISPONIVEL: PencilLine, EXPIRADO: CircleX, AGENDADO: CalendarClock, CANCELADO: CircleDashed } as Record<string, unknown>;
const ROTULO: Record<string, string> = { RESPONDIDO: 'Respondido', DISPONIVEL: 'Responder agora', EXPIRADO: 'Não respondido', AGENDADO: 'Agendado', CANCELADO: 'Cancelado' };
const COR: Record<string, string> = { RESPONDIDO: 'text-sucesso', DISPONIVEL: 'text-acao', EXPIRADO: 'text-zinc-400', AGENDADO: 'text-zinc-400', CANCELADO: 'text-zinc-400' };
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <p v-if="acp.isPending.value">{{ t('app.carregando') }}</p>
    <Aviso v-else-if="acp.error.value" tipo="erro">{{ t('erros.RECURSO_NAO_ENCONTRADO') }}</Aviso>
    <template v-else-if="acp.data.value">
      <header>
        <p class="text-sm text-zinc-500">{{ acp.data.value.paciente.nome }}</p>
        <h1 class="text-2xl font-bold">{{ acp.data.value.protocolo.nome }}</h1>
        <p>{{ capitalizar(termo('procedimento').singular) }} em {{ formatarData(acp.data.value.dataInicio, app.locale, { dateStyle: 'long' }) }}</p>
        <p v-if="acp.data.value.status === 'ATIVO'" class="font-semibold">Dia {{ acp.data.value.diaAtual }} de {{ acp.data.value.totalDias }}</p>
        <Aviso v-if="acp.data.value.status === 'ENCERRADO'" tipo="atencao">Encerrado{{ acp.data.value.motivoEncerramento ? `: ${acp.data.value.motivoEncerramento}` : '' }}</Aviso>
      </header>
      <RouterLink v-if="acp.data.value.conversaId && acp.data.value.acoesPermitidas.includes('ABRIR_CONVERSA')" :to="`/conversas/${acp.data.value.conversaId}`"
        class="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-acao font-semibold text-acao"><MessageCircle class="size-5" aria-hidden="true" /> Falar com a equipe</RouterLink>
      <Cartao v-if="!sessao.ehPaciente && acp.data.value.alertasAbertos"><strong class="text-erro">{{ acp.data.value.alertasAbertos }} alerta(s) aberto(s)</strong></Cartao>
      <ol class="flex flex-col gap-2" :aria-label="capitalizar(termo('checkin').plural)">
        <li v-for="c in cks.data.value?.itens ?? []" :key="c.id">
          <RouterLink :to="`/checkins/${c.id}`" class="flex min-h-14 items-center gap-3 rounded-xl border border-zinc-200 px-4 dark:border-zinc-700" :class="c.status === 'DISPONIVEL' && 'border-2 border-acao'">
            <component :is="ICONE[c.status] ?? CircleDashed" class="size-6 shrink-0" :class="COR[c.status]" aria-hidden="true" />
            <span class="flex-1"><strong>Dia {{ c.dia }}</strong> <span class="text-sm text-zinc-500">· {{ formatarDataHora(c.disponivelEm, app.fuso, app.locale, { day: '2-digit', month: '2-digit' }) }}</span></span>
            <span class="text-sm font-medium" :class="COR[c.status]">{{ ROTULO[c.status] ?? c.status }}</span>
          </RouterLink>
        </li>
      </ol>
    </template>
  </div>
</template>
