<script setup lang="ts">
// Detalhe do agendamento (equipe e paciente). Botões só pelo `acoesPermitidas` — o backend decide
// prazo de cancelamento, quem confirma, quando dá para realizar. Edição de local/observação com If-Match.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Activity, CalendarClock, MapPin, MessageCircle } from 'lucide-vue-next';
import type { Agendamento } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora, formatarHora } from '@/i18n/datas';
import { hojeNoFuso } from '@/i18n/dias';
import { artigo, capitalizar, flexao } from '@/i18n/termos';
import { comEtag } from '@/dados/etag';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Conflito from '@/ds/Conflito.vue';
import Dialogo from '@/ds/Dialogo.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import EscolherHorario from './EscolherHorario.vue';
import { ACAO_HISTORICO, diaNoFuso, paraUtc, STATUS } from './util';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const id = computed(() => rota.params.agendamentoId as string);
const q = useQuery({ queryKey: ['agendamento', id], queryFn: () => comEtag(api().GET('/v1/agendamentos/{agendamentoId}', { params: { path: { agendamentoId: id.value } } })) });
const a = computed(() => q.data.value?.dado);
const acoes = computed(() => new Set(a.value?.acoesPermitidas ?? []));
// Acompanhamento ligado (RN-AGE-008): status para avisar o que remarcar/cancelar faz com ele.
const acpId = computed(() => (sessao.modulos.has('acompanhamento') ? a.value?.acompanhamentoId ?? null : null));
const acp = useQuery({ queryKey: ['acompanhamento-resumo', acpId], queryFn: () => ok(api().GET('/v1/acompanhamentos/{acompanhamentoId}', { params: { path: { acompanhamentoId: acpId.value! } } })), enabled: computed(() => !!acpId.value) });
const acpEmAndamento = computed(() => acp.data.value?.status === 'AGENDADO' || acp.data.value?.status === 'ATIVO');
const tA = computed(() => termo.value('acompanhamento'));
const quando = computed(() => (a.value ? capitalizar(formatarDataHora(a.value.inicioEm, app.fuso, app.locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })) : ''));

const atualizar = async (novo: Agendamento) => {
  q.data.value && (q.data.value.dado = novo);
  await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['acompanhamento-resumo'] }), qc.invalidateQueries({ queryKey: ['acompanhamentos'] }), qc.invalidateQueries({ queryKey: ['agendamentos'] }), qc.invalidateQueries({ queryKey: ['inicio'] }), qc.invalidateQueries({ queryKey: ['agenda-horarios'] })]);
};
const caminho = (acao: 'confirmar' | 'realizar' | 'falta') => `/v1/agendamentos/{agendamentoId}/${acao}` as const;
const simples = useMutation({
  mutationFn: (acao: 'confirmar' | 'realizar' | 'falta') => ok(api().POST(caminho(acao), { params: { path: { agendamentoId: id.value } } })),
  onSuccess: atualizar,
});

// Cancelar: motivo obrigatório (vai para o histórico e para o aviso a quem foi afetado).
const cancelando = ref(false);
const motivo = ref('');
const cancelar = useMutation({
  mutationFn: () => ok(api().POST('/v1/agendamentos/{agendamentoId}/cancelar', { params: { path: { agendamentoId: id.value } }, body: { motivo: motivo.value.trim() } })),
  onSuccess: async (r) => { cancelando.value = false; motivo.value = ''; await atualizar(r); },
});
// 422 do paciente aqui é prazo vencido (o botão sumiria no próximo carregamento): orienta a falar com a equipe.
const foraDoPrazo = computed(() => sessao.ehPaciente && cancelar.error.value instanceof ErroApi && cancelar.error.value.status === 422);

// Remarcar (equipe): horário livre ou qualquer horário, com encaixe explícito.
const remarcando = ref(false);
const modo = ref<'LIVRE' | 'OUTRO'>('LIVRE');
const livre = ref<{ inicioEm: string; profissionalId: string } | null>(null);
const data = ref('');
const hora = ref('');
const encaixe = ref(false);
const motivoRemarcar = ref('');
const novoInicio = computed(() => (modo.value === 'LIVRE' ? livre.value?.inicioEm : data.value && /^\d{2}:\d{2}$/.test(hora.value) ? paraUtc(data.value, hora.value, app.fuso) : undefined));
const abrirRemarcar = () => { modo.value = 'LIVRE'; livre.value = null; data.value = hojeNoFuso(app.agoraServidor(), app.fuso); hora.value = ''; encaixe.value = false; motivoRemarcar.value = ''; remarcar.reset(); remarcando.value = true; };
const remarcar = useMutation({
  mutationFn: () => ok(api().POST('/v1/agendamentos/{agendamentoId}/remarcar', { params: { path: { agendamentoId: id.value } }, body: {
    inicioEm: novoInicio.value!,
    profissionalId: modo.value === 'LIVRE' ? livre.value!.profissionalId : a.value!.profissional.usuarioId,
    ...(modo.value === 'OUTRO' && encaixe.value ? { encaixe: true } : {}),
    motivo: motivoRemarcar.value.trim() || null,
  } })),
  onSuccess: async (r) => { remarcando.value = false; await atualizar(r); },
});
const mudaDia = computed(() => !!(novoInicio.value && a.value && diaNoFuso(novoInicio.value, app.fuso) !== diaNoFuso(a.value.inicioEm, app.fuso)));
const remarcarOcupado = computed(() => remarcar.error.value instanceof ErroApi && remarcar.error.value.codigo === 'HORARIO_INDISPONIVEL');

// Editar local e observação interna (recurso versionado).
const editando = ref(false);
const local = ref('');
const observacao = ref('');
const conflito = ref(false);
watch(editando, (e) => { if (e && a.value) { local.value = a.value.local ?? ''; observacao.value = a.value.observacao ?? ''; conflito.value = false; } });
const editar = useMutation({
  mutationFn: () => comEtag(api().PATCH('/v1/agendamentos/{agendamentoId}', { params: { path: { agendamentoId: id.value }, header: { 'If-Match': q.data.value?.etag ?? '' } }, body: { local: local.value.trim() || null, observacao: observacao.value.trim() || null } })),
  onSuccess: async () => { editando.value = false; await q.refetch(); void qc.invalidateQueries({ queryKey: ['agendamentos'] }); },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; },
});

const chaveConversa = criarChave();
const abrirConversa = useMutation({
  mutationFn: () => ok(api().POST('/v1/conversas', { params: { header: { 'Idempotency-Key': chaveConversa.obter() } }, body: { pacienteId: a.value!.paciente.id } })),
  onSuccess: (c) => { chaveConversa.concluir(); void router.push(`/conversas/${c.id}`); },
});
const erroAcao = computed(() => simples.error.value ?? abrirConversa.error.value);
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" @tentar="q.refetch()">
      <template v-if="a">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="text-sm text-secundario">{{ a.servico.nome }}</p>
            <h1 class="text-2xl font-bold">{{ sessao.ehPaciente ? capitalizar(termo(a.servico.categoria === 'PROCEDIMENTO' ? 'procedimento' : 'consulta').singular) : a.paciente.nome }}</h1>
          </div>
          <span class="rounded-full px-3 py-1 text-sm font-semibold" :class="STATUS[a.status].classe">{{ STATUS[a.status].rotulo }}</span>
        </div>
        <Aviso v-if="erroAcao" tipo="erro" :detalhe="msg(erroAcao)?.suporte">{{ msg(erroAcao)?.texto }}</Aviso>

        <Cartao class="flex flex-col gap-2">
          <p class="flex items-center gap-2 text-lg font-semibold"><CalendarClock class="size-5 shrink-0" aria-hidden="true" /> {{ quando }} – {{ formatarHora(a.fimEm, app.fuso, app.locale) }}</p>
          <p>{{ capitalizar(termo('profissional').singular) }}: <strong>{{ a.profissional.nome }}</strong></p>
          <p v-if="sessao.ehPaciente && (sessao.manifesto?.pacientesVinculados?.length ?? 0) > 1">{{ capitalizar(termo('paciente').singular) }}: <strong>{{ a.paciente.nome }}</strong></p>
          <p v-if="a.local" class="flex items-center gap-2"><MapPin class="size-5 shrink-0" aria-hidden="true" /> {{ a.local }}</p>
          <p v-if="a.encaixe && !sessao.ehPaciente" class="text-sm text-secundario">Encaixe</p>
          <p v-if="a.status === 'CANCELADO' && a.motivoCancelamento" class="text-sm">Motivo do cancelamento: {{ a.motivoCancelamento }}</p>
        </Cartao>
        <RouterLink v-if="acpId" :to="`/acompanhamentos/${acpId}`" class="flex min-h-12 items-center gap-3 rounded-xl border-2 border-acao px-4 py-2 font-semibold text-acao">
          <Activity class="size-5 shrink-0" aria-hidden="true" />
          <span class="flex-1">{{ capitalizar(tA.singular) }}<span v-if="acp.data.value" class="block text-sm font-normal text-secundario">{{ acp.data.value.protocolo.nome }} · {{ { AGENDADO: 'agendado', ATIVO: 'em andamento', CONCLUIDO: 'concluído', ENCERRADO: 'encerrado' }[acp.data.value.status] }}</span></span>
        </RouterLink>
        <Aviso v-if="a.orientacoes && (a.status === 'AGENDADO' || a.status === 'CONFIRMADO')" tipo="atencao"><strong>Preparo:</strong> {{ a.orientacoes }}</Aviso>
        <Cartao v-if="!sessao.ehPaciente && (a.observacao || acoes.has('EDITAR'))" class="flex flex-col gap-2">
          <div class="flex items-center justify-between"><h2 class="font-bold">Observação interna</h2><Botao v-if="acoes.has('EDITAR') && !editando" variante="fantasma" @click="editando = true">Editar</Botao></div>
          <form v-if="editando" class="flex flex-col gap-3" @submit.prevent="editar.mutate()">
            <Conflito v-if="conflito" @recarregar="q.refetch().then(() => { editando = false; })" />
            <Aviso v-else-if="editar.error.value" tipo="erro">{{ msg(editar.error.value)?.texto }}</Aviso>
            <CampoTexto v-model="local" rotulo="Local" :maxlength="200" />
            <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Observação</span><textarea v-model="observacao" rows="3" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
            <div class="flex gap-2"><Botao tipo="submit" :carregando="editar.isPending.value">Salvar</Botao><Botao variante="fantasma" @click="editando = false">Descartar</Botao></div>
          </form>
          <p v-else class="whitespace-pre-line text-sm">{{ a.observacao ?? 'Sem observação.' }}</p>
        </Cartao>

        <div class="flex flex-wrap gap-2">
          <Botao v-if="acoes.has('CONFIRMAR')" :carregando="simples.isPending.value && simples.variables.value === 'confirmar'" @click="simples.mutate('confirmar')">{{ sessao.ehPaciente ? 'Confirmar presença' : 'Confirmar' }}</Botao>
          <Botao v-if="acoes.has('REALIZAR')" :carregando="simples.isPending.value && simples.variables.value === 'realizar'" @click="simples.mutate('realizar')">Marcar como realizado</Botao>
          <Botao v-if="acoes.has('REGISTRAR_FALTA')" variante="secundario" :carregando="simples.isPending.value && simples.variables.value === 'falta'" @click="simples.mutate('falta')">Registrar falta</Botao>
          <Botao v-if="acoes.has('REMARCAR')" variante="secundario" @click="abrirRemarcar">Remarcar</Botao>
          <Botao v-if="acoes.has('CANCELAR')" variante="secundario" @click="cancelar.reset(); cancelando = true">Cancelar</Botao>
          <Botao v-if="acoes.has('ABRIR_CONVERSA')" variante="secundario" :carregando="abrirConversa.isPending.value" @click="abrirConversa.mutate()"><MessageCircle class="size-5" aria-hidden="true" /> {{ sessao.ehPaciente ? 'Falar com a equipe' : capitalizar(termo('conversa').singular) }}</Botao>
        </div>
        <p v-if="sessao.ehPaciente && !acoes.has('CANCELAR') && (a.status === 'AGENDADO' || a.status === 'CONFIRMADO')" class="text-sm text-secundario">Precisa desmarcar? Fale com a equipe pela conversa.</p>

        <Cartao>
          <h2 class="mb-2 font-bold">Histórico</h2>
          <ol class="flex flex-col gap-1.5 text-sm">
            <li v-for="(h, i) in a.historico" :key="i" class="flex flex-wrap gap-x-2">
              <span class="text-secundario">{{ formatarDataHora(h.ocorridoEm, app.fuso, app.locale) }}</span>
              <strong>{{ ACAO_HISTORICO[h.acao] ?? h.acao }}</strong>
              <span>{{ h.por ? `por ${h.por.nome}` : 'automaticamente' }}</span>
              <span v-if="h.detalhe" class="w-full text-zinc-600 dark:text-zinc-300">“{{ h.detalhe }}”</span>
            </li>
          </ol>
        </Cartao>
      </template>
    </EstadoConsulta>

    <Dialogo v-model:aberto="cancelando" :titulo="`Cancelar ${termo('consulta').singular}`" descricao="O motivo fica no histórico e vai no aviso.">
      <form class="flex flex-col gap-3" @submit.prevent="cancelar.mutate()">
        <Aviso v-if="acpEmAndamento && !sessao.ehPaciente" tipo="atencao">{{ capitalizar(artigo(tA)) }} {{ tA.singular }} ligad{{ artigo(tA) }} será {{ flexao(tA, 'encerrado', 'encerrada') }} com este motivo.</Aviso>
        <Aviso v-if="foraDoPrazo" tipo="erro">Pelo app, o prazo para cancelar já passou. Fale com a equipe pela conversa.</Aviso>
        <Aviso v-else-if="cancelar.error.value" tipo="erro" :detalhe="msg(cancelar.error.value)?.suporte">{{ msg(cancelar.error.value)?.texto }}</Aviso>
        <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Motivo</span><textarea v-model="motivo" rows="3" maxlength="1000" required class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
        <Botao tipo="submit" bloco :carregando="cancelar.isPending.value" :desabilitado="motivo.trim().length < 3">Confirmar cancelamento</Botao>
      </form>
    </Dialogo>

    <Dialogo v-if="a" v-model:aberto="remarcando" :titulo="`Remarcar ${termo('consulta').singular}`">
      <div class="flex flex-col gap-3">
        <div class="flex gap-2" role="group" aria-label="Como escolher o horário">
          <button v-for="[v, r] in [['LIVRE', 'Horários livres'], ['OUTRO', 'Outro horário']] as const" :key="v" type="button" class="min-h-11 flex-1 rounded-xl border-2 px-3 font-medium" :class="modo === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="modo === v" @click="modo = v">{{ r }}</button>
        </div>
        <EscolherHorario v-if="modo === 'LIVRE'" v-model="livre" :servico-id="a.servico.id" :profissional-id="a.profissional.usuarioId" />
        <template v-else>
          <div class="grid grid-cols-2 gap-3"><CampoTexto v-model="data" rotulo="Data" tipo="date" /><CampoTexto v-model="hora" rotulo="Hora" tipo="time" /></div>
          <label class="flex items-center gap-3"><input v-model="encaixe" type="checkbox" class="size-5" /> Encaixe (pode sobrepor)</label>
        </template>
        <CampoTexto v-model="motivoRemarcar" rotulo="Motivo (opcional)" :maxlength="1000" />
        <Aviso v-if="acpEmAndamento && mudaDia" tipo="atencao">Outro dia: {{ artigo(tA) }} {{ tA.singular }} atual será {{ flexao(tA, 'encerrado', 'encerrada') }} e {{ flexao(tA, 'um novo', 'uma nova') }} começa no novo dia, com {{ artigo(termo('protocolo')) }} mesm{{ artigo(termo('protocolo')) }} {{ termo('protocolo').singular }} e a mesma equipe.</Aviso>
        <Aviso v-if="remarcarOcupado" tipo="erro">Esse horário já está ocupado. Escolha outro{{ modo === 'OUTRO' ? ' ou marque como encaixe' : '' }}.</Aviso>
        <Aviso v-else-if="remarcar.error.value" tipo="erro" :detalhe="msg(remarcar.error.value)?.suporte">{{ msg(remarcar.error.value)?.texto }}</Aviso>
        <Botao bloco :carregando="remarcar.isPending.value" :desabilitado="!novoInicio" @click="remarcar.mutate()">Remarcar</Botao>
      </div>
    </Dialogo>
  </div>
</template>
