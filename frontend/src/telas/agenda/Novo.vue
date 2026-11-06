<script setup lang="ts">
// Equipe marca consulta ou procedimento: horário livre da grade ou qualquer horário (RN-AGE-003),
// com encaixe explícito para sobrepor (RN-AGE-001). Idempotency-Key por ação: retry não duplica.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { hojeNoFuso } from '@/i18n/dias';
import { capitalizar, novo } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Selecao from '@/ds/Selecao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import EscolherHorario from './EscolherHorario.vue';
import { paraUtc } from './util';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const pacienteId = ref(typeof rota.query.pacienteId === 'string' ? rota.query.pacienteId : '');
const busca = ref('');
const servicoId = ref('');
const profissionalId = ref('');
const modo = ref<'LIVRE' | 'OUTRO'>('LIVRE');
const livre = ref<{ inicioEm: string; profissionalId: string } | null>(null);
const data = ref(hojeNoFuso(app.agoraServidor(), app.fuso));
const hora = ref('');
const duracao = ref('');
const encaixe = ref(false);
const local = ref('');
const observacao = ref('');

const paciente = useQuery({ queryKey: ['paciente-resumo', pacienteId], queryFn: () => ok(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId.value } } })), enabled: computed(() => !!pacienteId.value) });
const resultados = useQuery({ queryKey: ['pacientes', 'busca', busca], queryFn: () => ok(api().POST('/v1/pacientes/busca', { body: { texto: busca.value.trim(), limite: 8 } })), enabled: computed(() => !pacienteId.value && busca.value.trim().length >= 2) });
const servicos = useQuery({ queryKey: ['agenda-servicos', 'ATIVO'], queryFn: () => ok(api().GET('/v1/agenda/servicos', { params: { query: { status: 'ATIVO' } } })) });
const servico = computed(() => servicos.data.value?.itens.find((s) => s.id === servicoId.value));
watch(servico, (s) => {
  profissionalId.value = s?.profissionais.length === 1 ? s.profissionais[0].usuarioId : '';
  duracao.value = s ? String(s.duracaoMinutos) : '';
});
const procedimento = computed(() => servico.value?.categoria === 'PROCEDIMENTO');

const inicioEm = computed(() => (modo.value === 'LIVRE' ? livre.value?.inicioEm : data.value && /^\d{2}:\d{2}$/.test(hora.value) ? paraUtc(data.value, hora.value, app.fuso) : undefined));
const prof = computed(() => (modo.value === 'LIVRE' ? livre.value?.profissionalId : profissionalId.value));
const duracaoValida = computed(() => modo.value === 'LIVRE' || (Number(duracao.value) >= 5 && Number(duracao.value) <= 720));
const pronto = computed(() => !!(pacienteId.value && servico.value && inicioEm.value && prof.value && duracaoValida.value));

const chave = criarChave();
const m = useMutation({
  mutationFn: () => ok(api().POST('/v1/agendamentos', {
    params: { header: { 'Idempotency-Key': chave.obter() } },
    body: {
      pacienteId: pacienteId.value, servicoId: servicoId.value, profissionalId: prof.value!, inicioEm: inicioEm.value!,
      ...(modo.value === 'OUTRO' && Number(duracao.value) !== servico.value!.duracaoMinutos ? { duracaoMinutos: Number(duracao.value) } : {}),
      ...(modo.value === 'OUTRO' && encaixe.value ? { encaixe: true } : {}),
      local: local.value.trim() || null, observacao: observacao.value.trim() || null,
    },
  })),
  onSuccess: async (a) => { chave.concluir(); await qc.invalidateQueries({ queryKey: ['agendamentos'] }); await qc.invalidateQueries({ queryKey: ['inicio'] }); await router.replace(`/agenda/${a.id}`); },
  // 4xx é resposta definitiva: a próxima tentativa é outra ação (outro horário, encaixe) e precisa de outra chave.
  onError: (e) => { if (e instanceof ErroApi && e.status >= 400 && e.status < 500) chave.concluir(); },
});
const indisponivel = computed(() => m.error.value instanceof ErroApi && m.error.value.codigo === 'HORARIO_INDISPONIVEL');
watch([inicioEm, prof, encaixe], () => m.reset());
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ capitalizar(novo(termo('consulta'))) }}</h1>

    <Cartao v-if="pacienteId && paciente.data.value" class="flex items-center justify-between">
      <span><span class="text-sm text-secundario">{{ capitalizar(termo('paciente').singular) }}:</span> <strong>{{ paciente.data.value.nome }}</strong></span>
      <Botao variante="fantasma" @click="pacienteId = ''">Trocar</Botao>
    </Cartao>
    <div v-else class="flex flex-col gap-2">
      <CampoTexto v-model="busca" :rotulo="`Buscar ${termo('paciente').singular}`" autocomplete="off" />
      <button v-for="p in resultados.data.value?.itens ?? []" :key="p.id" type="button" class="min-h-12 rounded-xl border border-zinc-200 px-4 text-left hover:border-acao dark:border-zinc-700" @click="pacienteId = p.id">{{ p.nome }}</button>
    </div>

    <Selecao v-model="servicoId" rotulo="Serviço" vazio="Escolha…" :opcoes="(servicos.data.value?.itens ?? []).map((s) => ({ valor: s.id, rotulo: `${s.nome} (${s.duracaoMinutos} min)` }))" />
    <template v-if="servico">
      <Selecao v-if="servico.profissionais.length > 1" v-model="profissionalId" :rotulo="capitalizar(termo('profissional').singular)" :vazio="modo === 'LIVRE' ? 'Qualquer um' : 'Escolha…'" :opcoes="servico.profissionais.map((p) => ({ valor: p.usuarioId, rotulo: p.nome }))" />
      <div class="flex gap-2" role="group" aria-label="Como escolher o horário">
        <button v-for="[v, r] in [['LIVRE', 'Horários livres'], ['OUTRO', 'Outro horário']] as const" :key="v" type="button" class="min-h-11 flex-1 rounded-xl border-2 px-3 font-medium" :class="modo === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="modo === v" @click="modo = v">{{ r }}</button>
      </div>
      <EscolherHorario v-if="modo === 'LIVRE'" v-model="livre" :servico-id="servico.id" :profissional-id="profissionalId" :mostrar-profissional="!profissionalId && servico.profissionais.length > 1" />
      <Cartao v-else class="flex flex-col gap-3">
        <p class="text-sm text-secundario">A equipe pode marcar fora da grade (por exemplo, {{ termo('procedimento').singular }} num sábado).</p>
        <div class="grid grid-cols-2 gap-3">
          <CampoTexto v-model="data" rotulo="Data" tipo="date" />
          <CampoTexto v-model="hora" rotulo="Hora" tipo="time" />
        </div>
        <CampoTexto v-model="duracao" rotulo="Duração (minutos)" tipo="number" inputmode="numeric" :erro="duracaoValida ? null : 'Entre 5 e 720 minutos.'" />
        <label class="flex items-start gap-3"><input v-model="encaixe" type="checkbox" class="mt-0.5 size-5 shrink-0" />
          <span>Encaixe <span class="block text-sm text-secundario">Permite sobrepor outro horário do mesmo profissional. Use só quando combinado com ele.</span></span></label>
      </Cartao>
      <CampoTexto v-model="local" :rotulo="procedimento ? 'Local (hospital, sala)' : 'Local (opcional)'" :maxlength="200" />
      <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Observação interna (o {{ termo('paciente').singular }} não vê)</span>
        <textarea v-model="observacao" rows="2" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
      <Aviso v-if="servico.orientacoes">Orientação enviada ao {{ termo('paciente').singular }}: {{ servico.orientacoes }}</Aviso>
    </template>

    <Aviso v-if="indisponivel" tipo="erro">
      Esse horário já está ocupado para esse profissional.
      <template v-if="modo === 'OUTRO' && !encaixe"> Se for combinado, marque como <button type="button" class="font-semibold underline" @click="encaixe = true">encaixe</button>.</template>
      <template v-else-if="modo === 'LIVRE'"> Alguém marcou antes: escolha outro horário.</template>
    </Aviso>
    <Aviso v-else-if="m.error.value" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>
    <Botao bloco :carregando="m.isPending.value" :desabilitado="!pronto" @click="m.mutate()">Marcar</Botao>
  </div>
</template>
