<script setup lang="ts">
// Paciente marca sozinho (RN-AGE-002): só serviços autoagendáveis e só horários livres que o backend
// oferece (grade, bloqueios, antecedência e janela já aplicados). Corrida com outra pessoa → 409.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { artigo, capitalizar } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import EscolherHorario from './EscolherHorario.vue';

const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const consulta = computed(() => termo.value('consulta'));
const vinculados = computed(() => sessao.manifesto?.pacientesVinculados ?? []);
const pacienteId = ref(vinculados.value.length === 1 ? vinculados.value[0].id : '');
const servicos = useQuery({ queryKey: ['agenda-servicos', 'paciente'], queryFn: () => ok(api().GET('/v1/agenda/servicos', {})) });
const disponiveis = computed(() => (servicos.data.value?.itens ?? []).filter((s) => s.acoesPermitidas.includes('AGENDAR')));
const servicoId = ref('');
watch(disponiveis, (l) => { if (l.length === 1 && !servicoId.value) servicoId.value = l[0].id; }, { immediate: true });
const servico = computed(() => disponiveis.value.find((s) => s.id === servicoId.value));
const profissionalId = ref('');
watch(servicoId, () => { profissionalId.value = ''; horario.value = null; });
const horario = ref<{ inicioEm: string; profissionalId: string } | null>(null);
const nomeProfissional = computed(() => servico.value?.profissionais.find((p) => p.usuarioId === horario.value?.profissionalId)?.nome);

const chave = criarChave();
const m = useMutation({
  mutationFn: () => ok(api().POST('/v1/agendamentos', { params: { header: { 'Idempotency-Key': chave.obter() } }, body: { pacienteId: pacienteId.value, servicoId: servicoId.value, profissionalId: horario.value!.profissionalId, inicioEm: horario.value!.inicioEm } })),
  onSuccess: async (a) => { chave.concluir(); await qc.invalidateQueries({ queryKey: ['agendamentos'] }); void qc.invalidateQueries({ queryKey: ['inicio'] }); await router.replace(`/agenda/${a.id}`); },
  onError: (e) => {
    if (!(e instanceof ErroApi) || e.status < 400 || e.status >= 500) return; // rede/5xx: repetir com a mesma chave
    chave.concluir();
    if (e.codigo === 'HORARIO_INDISPONIVEL') { horario.value = null; void qc.invalidateQueries({ queryKey: ['agenda-horarios'] }); }
  },
});
const ocupado = computed(() => m.error.value instanceof ErroApi && m.error.value.codigo === 'HORARIO_INDISPONIVEL');
const pill = (ativo: boolean) => (ativo ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300 hover:border-acao dark:border-zinc-600');
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">Marcar {{ consulta.singular }}</h1>
    <EstadoConsulta :carregando="servicos.isPending.value" :erro="servicos.error.value" :vazio="!disponiveis.length" :texto-vazio="`No momento não há ${consulta.plural} para marcar pelo app. Fale com a equipe.`" @tentar="servicos.refetch()">
      <fieldset v-if="vinculados.length > 1" class="flex flex-col gap-2">
        <legend class="mb-1 font-semibold">Para quem?</legend>
        <div class="flex flex-wrap gap-2">
          <button v-for="p in vinculados" :key="p.id" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="pill(pacienteId === p.id)" :aria-pressed="pacienteId === p.id" @click="pacienteId = p.id">{{ p.nome }}</button>
        </div>
      </fieldset>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 font-semibold">Qual atendimento?</legend>
        <button v-for="s in disponiveis" :key="s.id" type="button" class="flex min-h-12 flex-col items-start rounded-xl border-2 px-4 py-2 text-left" :class="pill(servicoId === s.id)" :aria-pressed="servicoId === s.id" @click="servicoId = s.id">
          <span class="font-semibold">{{ s.nome }}</span><span class="text-sm">{{ s.duracaoMinutos }} min</span>
        </button>
      </fieldset>
      <template v-if="servico">
        <fieldset v-if="servico.profissionais.length > 1" class="flex flex-col gap-2">
          <legend class="mb-1 font-semibold">Com quem?</legend>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="pill(!profissionalId)" :aria-pressed="!profissionalId" @click="profissionalId = ''">Qualquer um</button>
            <button v-for="p in servico.profissionais" :key="p.usuarioId" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="pill(profissionalId === p.usuarioId)" :aria-pressed="profissionalId === p.usuarioId" @click="profissionalId = p.usuarioId">{{ p.nome }}</button>
          </div>
        </fieldset>
        <div>
          <h2 class="mb-2 font-semibold">Quando?</h2>
          <EscolherHorario v-model="horario" :servico-id="servico.id" :profissional-id="profissionalId" :mostrar-profissional="!profissionalId && servico.profissionais.length > 1" />
        </div>
      </template>
      <Aviso v-if="ocupado" tipo="atencao">Alguém acabou de marcar esse horário. Escolha outro.</Aviso>
      <Aviso v-else-if="m.error.value" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>
      <Cartao v-if="servico && horario" class="flex flex-col gap-2">
        <h2 class="font-bold">Confira</h2>
        <p>{{ servico.nome }} com {{ nomeProfissional }}</p>
        <p class="text-lg font-semibold">{{ capitalizar(formatarDataHora(horario.inicioEm, app.fuso, app.locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })) }}</p>
        <Aviso v-if="servico.orientacoes" tipo="atencao"><strong>Preparo:</strong> {{ servico.orientacoes }}</Aviso>
        <Botao bloco :carregando="m.isPending.value" :desabilitado="!pacienteId" @click="m.mutate()">Marcar</Botao>
        <p v-if="!pacienteId" class="text-sm text-erro">Escolha para quem é {{ artigo(consulta) }} {{ consulta.singular }}.</p>
      </Cartao>
    </EstadoConsulta>
  </div>
</template>
