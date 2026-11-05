<script setup lang="ts">
// Detalhe do acompanhamento: linha do tempo dos dias para todos; para a equipe, alertas (resolver),
// equipe e observação (If-Match) e encerramento com motivo. Ações só pelo `acoesPermitidas`.
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { CalendarClock, CircleCheck, CircleDashed, CircleX, MessageCircle, PencilLine } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { comEtag } from '@/dados/etag';
import { useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import { formatarData, formatarDataHora } from '@/i18n/datas';
import { capitalizar } from '@/i18n/termos';
import Cartao from '@/ds/Cartao.vue';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import Dialogo from '@/ds/Dialogo.vue';
import Conflito from '@/ds/Conflito.vue';

const { t } = useI18n();
const rota = useRoute();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const id = computed(() => String(rota.params.acompanhamentoId));
const q = useQuery({ queryKey: ['acompanhamento', id], queryFn: () => comEtag(api().GET('/v1/acompanhamentos/{acompanhamentoId}', { params: { path: { acompanhamentoId: id.value } } })) });
const a = computed(() => q.data.value?.dado);
const acoes = computed(() => new Set(a.value?.acoesPermitidas ?? []));
const cks = useQuery({ queryKey: ['checkins', { acompanhamentoId: id }], queryFn: () => ok(api().GET('/v1/checkins', { params: { query: { acompanhamentoId: id.value, limite: 100 } } })) });
const alertas = useQuery({
  queryKey: ['alertas', { acompanhamentoId: id }],
  queryFn: () => ok(api().GET('/v1/alertas', { params: { query: { acompanhamentoId: id.value, limite: 100 } } })),
  enabled: computed(() => !sessao.ehPaciente && sessao.pode('acompanhamento.alerta.ler')),
});
const invalidar = () => { void qc.invalidateQueries({ queryKey: ['acompanhamento', id] }); void qc.invalidateQueries({ queryKey: ['alertas'] }); void qc.invalidateQueries({ queryKey: ['inicio'] }); void qc.invalidateQueries({ queryKey: ['acompanhamentos'] }); };

// Resolver alerta.
const resolvendo = ref<{ id: string; mensagem: string } | null>(null);
const nota = ref('');
const resolver = useMutation({
  mutationFn: () => ok(api().POST('/v1/alertas/{alertaId}/resolver', { params: { path: { alertaId: resolvendo.value!.id } }, body: { nota: nota.value.trim() || null } })),
  onSuccess: () => { resolvendo.value = null; nota.value = ''; invalidar(); },
});

// Encerrar.
const encerrando = ref(false);
const motivo = ref('');
const encerrar = useMutation({
  mutationFn: () => ok(api().POST('/v1/acompanhamentos/{acompanhamentoId}/encerrar', { params: { path: { acompanhamentoId: id.value } }, body: { motivo: motivo.value.trim() } })),
  onSuccess: () => { encerrando.value = false; invalidar(); void qc.invalidateQueries({ queryKey: ['checkins'] }); },
});

// Editar equipe e observação (If-Match).
const editando = ref(false);
const conflito = ref(false);
const equipeIds = ref<string[]>([]);
const observacao = ref('');
const membros = useQuery({ queryKey: ['membros', 'ATIVO'], queryFn: () => ok(api().GET('/v1/equipe/membros', { params: { query: { status: 'ATIVO', limite: 100 } } })), enabled: computed(() => editando.value && sessao.modulos.has('equipe') && sessao.pode('equipe.membro.ler')) });
function abrirEdicao() { equipeIds.value = a.value!.equipe.map((e) => e.usuarioId); observacao.value = a.value!.observacao ?? ''; conflito.value = false; editando.value = true; }
const editar = useMutation({
  mutationFn: () => comEtag(api().PATCH('/v1/acompanhamentos/{acompanhamentoId}', { params: { path: { acompanhamentoId: id.value }, header: { 'If-Match': q.data.value?.etag ?? '' } }, body: { equipeIds: equipeIds.value, observacao: observacao.value.trim() || null } })),
  onSuccess: (r) => { qc.setQueryData(['acompanhamento', id], r); editando.value = false; },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; },
});
async function recarregar() { conflito.value = false; editar.reset(); await q.refetch(); abrirEdicao(); }

const ICONE = { RESPONDIDO: CircleCheck, DISPONIVEL: PencilLine, EXPIRADO: CircleX, AGENDADO: CalendarClock, CANCELADO: CircleDashed } as Record<string, unknown>;
const ROTULO: Record<string, string> = { RESPONDIDO: 'Respondido', DISPONIVEL: 'Aguardando resposta', EXPIRADO: 'Não respondido', AGENDADO: 'Agendado', CANCELADO: 'Cancelado' };
const COR: Record<string, string> = { RESPONDIDO: 'text-sucesso', DISPONIVEL: 'text-acao', EXPIRADO: 'text-esmaecido', AGENDADO: 'text-esmaecido', CANCELADO: 'text-esmaecido' };
const rotulo = (s: string) => (s === 'DISPONIVEL' && sessao.ehPaciente ? 'Responder agora' : ROTULO[s] ?? s);
const SEV: Record<string, string> = { ALTA: 'text-erro', MEDIA: 'text-atencao', BAIXA: 'text-zinc-600 dark:text-zinc-300' };
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <p v-if="q.isPending.value">{{ t('app.carregando') }}</p>
    <Aviso v-else-if="q.error.value" tipo="erro">{{ msg(q.error.value)?.texto }}</Aviso>
    <template v-else-if="a">
      <header>
        <RouterLink v-if="!sessao.ehPaciente" :to="`/pacientes/${a.paciente.id}`" class="text-sm text-acao underline">{{ a.paciente.nome }}</RouterLink>
        <p v-else class="text-sm text-secundario">{{ a.paciente.nome }}</p>
        <h1 class="text-2xl font-bold">{{ a.protocolo.nome }}</h1>
        <p>{{ capitalizar(termo('procedimento').singular) }} em {{ formatarData(a.dataInicio, app.locale, { dateStyle: 'long' }) }}</p>
        <p v-if="a.status === 'ATIVO'" class="font-semibold">Dia {{ a.diaAtual }} de {{ a.totalDias }}</p>
        <p v-else-if="a.status === 'AGENDADO'" class="font-semibold">Começa em {{ -a.diaAtual }} dia(s)</p>
        <Aviso v-if="a.status === 'ENCERRADO'" tipo="atencao" class="mt-2">Encerrado{{ a.motivoEncerramento ? `: ${a.motivoEncerramento}` : '' }}</Aviso>
        <p v-if="a.status === 'CONCLUIDO'" class="font-semibold text-sucesso">Concluído</p>
      </header>

      <div class="flex flex-wrap gap-2">
        <RouterLink v-if="a.conversaId && acoes.has('ABRIR_CONVERSA')" :to="`/conversas/${a.conversaId}`" class="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-acao px-4 font-semibold text-acao"><MessageCircle class="size-5" aria-hidden="true" /> {{ sessao.ehPaciente ? 'Falar com a equipe' : capitalizar(termo('conversa').singular) }}</RouterLink>
        <Botao v-if="acoes.has('EDITAR')" variante="secundario" @click="abrirEdicao">Equipe e observação</Botao>
        <Botao v-if="acoes.has('ENCERRAR')" variante="fantasma" @click="encerrando = true">Encerrar</Botao>
      </div>

      <Cartao v-if="!sessao.ehPaciente && alertas.data.value?.itens.length">
        <h2 class="mb-2 font-bold">Alertas</h2>
        <ul class="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-700">
          <li v-for="al in alertas.data.value.itens" :key="al.id" class="flex flex-wrap items-center gap-2 py-2">
            <strong :class="SEV[al.severidade]">{{ al.severidade }}</strong>
            <span class="flex-1">{{ al.mensagem }} <span class="text-sm text-secundario">· {{ formatarDataHora(al.criadoEm, app.fuso, app.locale) }}</span>
              <span v-if="al.status === 'RESOLVIDO'" class="block text-sm text-secundario">Resolvido por {{ al.resolvidoPor?.nome }}{{ al.nota ? ` — ${al.nota}` : '' }}</span></span>
            <RouterLink v-if="al.checkinId" :to="`/checkins/${al.checkinId}`" class="text-sm text-acao underline">Ver respostas</RouterLink>
            <Botao v-if="al.acoesPermitidas.includes('RESOLVER')" variante="secundario" @click="resolvendo = { id: al.id, mensagem: al.mensagem }">Resolver</Botao>
          </li>
        </ul>
      </Cartao>

      <Cartao v-if="!sessao.ehPaciente && (a.observacao || a.equipe.length)">
        <p v-if="a.observacao" class="mb-2"><span class="text-sm text-secundario">Observação interna:</span> {{ a.observacao }}</p>
        <p class="text-sm"><span class="text-secundario">Equipe:</span> {{ a.equipe.map((e) => e.nome).join(', ') }}</p>
      </Cartao>

      <ol class="flex flex-col gap-2" :aria-label="capitalizar(termo('checkin').plural)">
        <li v-for="c in cks.data.value?.itens ?? []" :key="c.id">
          <RouterLink :to="`/checkins/${c.id}`" class="flex min-h-14 items-center gap-3 rounded-xl border border-zinc-200 px-4 dark:border-zinc-700" :class="c.status === 'DISPONIVEL' && sessao.ehPaciente && 'border-2 border-acao'">
            <component :is="ICONE[c.status] ?? CircleDashed" class="size-6 shrink-0" :class="COR[c.status]" aria-hidden="true" />
            <span class="flex-1"><strong>Dia {{ c.dia }}</strong> <span class="text-sm text-secundario">· {{ formatarDataHora(c.disponivelEm, app.fuso, app.locale, { day: '2-digit', month: '2-digit' }) }}</span></span>
            <span class="text-sm font-medium" :class="COR[c.status]">{{ rotulo(c.status) }}</span>
          </RouterLink>
        </li>
      </ol>

      <Dialogo :aberto="!!resolvendo" titulo="Resolver alerta" :descricao="resolvendo?.mensagem" @update:aberto="(v) => !v && (resolvendo = null)">
        <form class="flex flex-col gap-3" @submit.prevent="resolver.mutate()">
          <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Nota (opcional)</span><textarea v-model="nota" rows="3" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" placeholder="Ex.: liguei para o paciente." /></label>
          <Aviso v-if="resolver.error.value" tipo="erro">{{ msg(resolver.error.value)?.texto }}</Aviso>
          <Botao tipo="submit" bloco :carregando="resolver.isPending.value">Marcar como resolvido</Botao>
        </form>
      </Dialogo>
      <Dialogo v-model:aberto="encerrando" :titulo="`Encerrar ${termo('acompanhamento').singular}`" :descricao="`${capitalizar(termo('checkin').plural)} futuros serão cancelados. Nada é apagado.`">
        <form class="flex flex-col gap-3" @submit.prevent="encerrar.mutate()">
          <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Motivo</span><textarea v-model="motivo" rows="3" maxlength="1000" required class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
          <Aviso v-if="encerrar.error.value" tipo="erro">{{ msg(encerrar.error.value)?.texto }}</Aviso>
          <Botao tipo="submit" bloco :carregando="encerrar.isPending.value" :desabilitado="motivo.trim().length < 3">Encerrar</Botao>
        </form>
      </Dialogo>
      <Dialogo v-model:aberto="editando" titulo="Equipe e observação">
        <Conflito v-if="conflito" class="mb-3" @recarregar="recarregar" />
        <form class="flex flex-col gap-3" @submit.prevent="editar.mutate()">
          <fieldset v-if="membros.data.value" class="flex flex-col gap-1">
            <legend class="mb-1 text-sm font-medium">Equipe responsável</legend>
            <label v-for="mb in membros.data.value.itens" :key="mb.id" class="flex min-h-11 items-center gap-3"><input v-model="equipeIds" type="checkbox" :value="mb.id" class="size-5" /> {{ mb.nome }}</label>
          </fieldset>
          <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Observação interna</span><textarea v-model="observacao" rows="3" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
          <Botao tipo="submit" bloco :carregando="editar.isPending.value" :desabilitado="!equipeIds.length">Salvar</Botao>
        </form>
      </Dialogo>
    </template>
  </div>
</template>
