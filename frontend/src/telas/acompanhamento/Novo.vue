<script setup lang="ts">
// Iniciar acompanhamento: paciente, protocolo, data do procedimento (dia 0), equipe e prévia dos dias.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarData } from '@/i18n/datas';
import { hojeNoFuso, somarDias } from '@/i18n/dias';
import { capitalizar, novo } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Selecao from '@/ds/Selecao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const pacienteId = ref(typeof rota.query.pacienteId === 'string' ? rota.query.pacienteId : '');
const busca = ref('');
const protocoloId = ref('');
const dataInicio = ref(hojeNoFuso(app.agoraServidor(), app.fuso));
const observacao = ref('');
const eu = sessao.manifesto!.usuario.id;
const equipeIds = ref<string[]>([eu]);

const paciente = useQuery({ queryKey: ['paciente-resumo', pacienteId], queryFn: () => ok(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId.value } } })), enabled: computed(() => !!pacienteId.value) });
const resultados = useQuery({ queryKey: ['pacientes', 'busca', busca], queryFn: () => ok(api().POST('/v1/pacientes/busca', { body: { texto: busca.value.trim(), limite: 8 } })), enabled: computed(() => !pacienteId.value && busca.value.trim().length >= 2) });
const protocolos = useQuery({ queryKey: ['protocolos', 'ATIVO'], queryFn: () => ok(api().GET('/v1/protocolos', { params: { query: { status: 'ATIVO', limite: 100 } } })) });
const membros = useQuery({ queryKey: ['membros', 'ATIVO'], queryFn: () => ok(api().GET('/v1/equipe/membros', { params: { query: { status: 'ATIVO', limite: 100 } } })), enabled: computed(() => sessao.modulos.has('equipe') && sessao.pode('equipe.membro.ler')) });
const protocolo = computed(() => protocolos.data.value?.itens.find((p) => p.id === protocoloId.value));
watch(protocolos.data, (d) => { if (d?.itens.length === 1) protocoloId.value = d.itens[0].id; });
const previa = computed(() => {
  const p = protocolo.value;
  if (!p || !dataInicio.value) return [];
  const dias = new Set<number>(p.checkins.flatMap((c) => c.dias));
  return [...dias].sort((a, b) => a - b).map((d) => ({ dia: d, data: somarDias(dataInicio.value, d), orientacao: p.orientacoes.find((o) => o.dia === d)?.texto }));
});
const fim = computed(() => (protocolo.value && dataInicio.value ? somarDias(dataInicio.value, protocolo.value.duracaoDias) : null));
const retroativo = computed(() => dataInicio.value && dataInicio.value < hojeNoFuso(app.agoraServidor(), app.fuso));

const chave = criarChave();
const m = useMutation({
  mutationFn: () => ok(api().POST('/v1/acompanhamentos', { params: { header: { 'Idempotency-Key': chave.obter() } }, body: { pacienteId: pacienteId.value, protocoloId: protocoloId.value, dataInicio: dataInicio.value, equipeIds: equipeIds.value, observacao: observacao.value.trim() || null } })),
  onSuccess: async (a) => { chave.concluir(); await qc.invalidateQueries({ queryKey: ['acompanhamentos'] }); await router.replace(`/acompanhamentos/${a.id}`); },
  onError: (e) => { if (e instanceof ErroApi && e.status === 422) chave.concluir(); },
});
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ capitalizar(novo(termo('acompanhamento'))) }}</h1>
    <Aviso v-if="m.error.value" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>

    <Cartao v-if="pacienteId && paciente.data.value" class="flex items-center justify-between">
      <span><span class="text-sm text-zinc-500">{{ capitalizar(termo('paciente').singular) }}:</span> <strong>{{ paciente.data.value.nome }}</strong></span>
      <Botao variante="fantasma" @click="pacienteId = ''">Trocar</Botao>
    </Cartao>
    <div v-else class="flex flex-col gap-2">
      <CampoTexto v-model="busca" :rotulo="`Buscar ${termo('paciente').singular}`" autocomplete="off" />
      <button v-for="p in resultados.data.value?.itens ?? []" :key="p.id" type="button" class="min-h-12 rounded-xl border border-zinc-200 px-4 text-left hover:border-acao dark:border-zinc-700" @click="pacienteId = p.id">{{ p.nome }}</button>
    </div>

    <Selecao v-model="protocoloId" :rotulo="capitalizar(termo('protocolo').singular)" vazio="Escolha…" :opcoes="(protocolos.data.value?.itens ?? []).map((p) => ({ valor: p.id, rotulo: p.nome }))" />
    <CampoTexto v-model="dataInicio" :rotulo="`Data d${termo('procedimento').genero === 'F' ? 'a' : 'o'} ${termo('procedimento').singular} (dia 0)`" tipo="date" />
    <Aviso v-if="retroativo" tipo="atencao">Data no passado: os {{ termo('checkin').plural }} já vencidos ficam como não respondidos, sem gerar alerta.</Aviso>

    <fieldset v-if="membros.data.value" class="flex flex-col gap-2">
      <legend class="mb-1 text-sm font-medium">Equipe responsável</legend>
      <label v-for="mb in membros.data.value.itens" :key="mb.id" class="flex min-h-11 items-center gap-3">
        <input v-model="equipeIds" type="checkbox" :value="mb.id" class="size-5" /> {{ mb.nome }} <span class="text-sm text-zinc-500">{{ mb.perfis.join(', ').toLowerCase() }}</span>
      </label>
    </fieldset>
    <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Observação interna (opcional)</span>
      <textarea v-model="observacao" rows="2" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>

    <Cartao v-if="previa.length">
      <h2 class="mb-2 font-bold">Prévia</h2>
      <p class="mb-2 text-sm text-zinc-600 dark:text-zinc-300">{{ protocolo!.duracaoDias }} dias, até {{ formatarData(fim!, app.locale) }}.</p>
      <ol class="text-sm"><li v-for="d in previa" :key="d.dia" class="flex gap-3 border-t border-zinc-100 py-1.5 first:border-0 dark:border-zinc-700"><strong class="w-14">Dia {{ d.dia }}</strong><span class="w-24">{{ formatarData(d.data, app.locale) }}</span><span class="flex-1 text-zinc-600 dark:text-zinc-300">{{ d.orientacao ?? '' }}</span></li></ol>
    </Cartao>
    <Botao bloco :carregando="m.isPending.value" :desabilitado="!pacienteId || !protocoloId || !dataInicio || !equipeIds.length" @click="m.mutate()">Iniciar</Botao>
  </div>
</template>
