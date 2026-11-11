<script setup lang="ts">
// Envio de resultado (RN-EXA-003) pelo paciente ou pela equipe: fotos e/ou PDF (finalidade EXAME, já
// DISPONIVEL — PDF passou por antivírus e saneamento), ligado a um pedido aberto do mesmo paciente ou avulso.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { hojeNoFuso } from '@/i18n/dias';
import { artigo, capitalizar } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Selecao from '@/ds/Selecao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import CampoArquivos from './CampoArquivos.vue';
import { tituloSugerido } from './util';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const exame = computed(() => termo.value('exame'));
const pac = computed(() => termo.value('paciente'));
const daQuery = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');
const vinculados = computed(() => sessao.manifesto?.pacientesVinculados ?? []);
const pacienteId = ref(daQuery('pacienteId') || (sessao.ehPaciente && vinculados.value.length === 1 ? vinculados.value[0].id : ''));
const pedidoId = ref(daQuery('pedidoId'));
const titulo = ref('');
const dataColeta = ref('');
const arquivos = ref<string[]>([]);
const comentario = ref('');
const enviandoArquivo = ref(false);
const hoje = hojeNoFuso(app.agoraServidor(), app.fuso);

// Equipe escolhe o paciente pela busca; paciente, entre os vinculados.
const busca = ref('');
const paciente = useQuery({ queryKey: ['paciente-resumo', pacienteId], queryFn: () => ok(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId.value } } })), enabled: computed(() => !!pacienteId.value && !sessao.ehPaciente) });
const encontrados = useQuery({ queryKey: ['pacientes', 'busca', busca], queryFn: () => ok(api().POST('/v1/pacientes/busca', { body: { texto: busca.value.trim(), limite: 8 } })), enabled: computed(() => !sessao.ehPaciente && !pacienteId.value && busca.value.trim().length >= 2) });
const nomePaciente = computed(() => (sessao.ehPaciente ? vinculados.value.find((v) => v.id === pacienteId.value)?.nome : paciente.data.value?.nome));

const pedidos = useQuery({
  queryKey: ['exames-pedidos', 'abertos-do-paciente', pacienteId],
  queryFn: () => ok(api().GET('/v1/exames/pedidos', { params: { query: { pacienteId: pacienteId.value, status: 'ABERTO', limite: 50 } } })),
  enabled: computed(() => !!pacienteId.value),
});
const abertos = computed(() => (pedidos.data.value?.itens ?? []).filter((p) => p.acoesPermitidas.includes('ENVIAR_RESULTADO')));
const pedido = computed(() => abertos.value.find((p) => p.id === pedidoId.value));
// Título sugerido pelo pedido, sem atropelar o que a pessoa já digitou.
let sugerido = '';
watch(pedido, (p) => { if (!titulo.value || titulo.value === sugerido) { sugerido = tituloSugerido(p); titulo.value = sugerido; } }, { immediate: true });
watch(pacienteId, (novo, antigo) => { if (antigo && novo !== antigo) pedidoId.value = ''; });

const dataValida = computed(() => !dataColeta.value || dataColeta.value <= hoje);
const pronto = computed(() => !!pacienteId.value && titulo.value.trim().length >= 2 && arquivos.value.length > 0 && !enviandoArquivo.value && dataValida.value);

const chave = criarChave();
const m = useMutation({
  mutationFn: () => ok(api().POST('/v1/exames/resultados', {
    params: { header: { 'Idempotency-Key': chave.obter() } },
    body: {
      pacienteId: pacienteId.value, pedidoId: pedidoId.value || null, titulo: titulo.value.trim(),
      dataColeta: dataColeta.value || null, arquivosIds: arquivos.value, comentario: comentario.value.trim() || null,
    },
  })),
  onSuccess: async (r) => {
    chave.concluir();
    await Promise.all([qc.invalidateQueries({ queryKey: ['exames-resultados'] }), qc.invalidateQueries({ queryKey: ['exames-pedidos'] }), qc.invalidateQueries({ queryKey: ['inicio'] }), ...(r.pedidoId ? [qc.invalidateQueries({ queryKey: ['exame-pedido', r.pedidoId] })] : [])]);
    await router.replace(`/exames/resultados/${r.id}`);
  },
  onError: (e) => { if (e instanceof ErroApi && e.status >= 400 && e.status < 500) chave.concluir(); },
});
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">Enviar resultado de {{ exame.singular }}</h1>

    <Aviso v-if="!sessao.pode('exames.resultado.enviar')">
      {{ sessao.ehPaciente ? `Pelo app, ${artigo(termo('organizacao'))} ${termo('organizacao').singular} não recebe resultados. Leve-o na próxima ${termo('consulta').singular} ou fale com a equipe.` : 'Seu perfil não envia resultados.' }}
    </Aviso>
    <template v-else>
      <!-- Paciente -->
      <div v-if="sessao.ehPaciente && vinculados.length > 1" class="flex flex-wrap gap-2" role="group" :aria-label="capitalizar(pac.singular)">
        <button v-for="p in vinculados" :key="p.id" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="pacienteId === p.id ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="pacienteId === p.id" @click="pacienteId = p.id">{{ p.nome }}</button>
      </div>
      <Cartao v-else-if="!sessao.ehPaciente && pacienteId" class="flex items-center justify-between">
        <span><span class="text-sm text-secundario">{{ capitalizar(pac.singular) }}:</span> <strong>{{ nomePaciente ?? '…' }}</strong></span>
        <Botao variante="fantasma" @click="pacienteId = ''">Trocar</Botao>
      </Cartao>
      <div v-else-if="!sessao.ehPaciente" class="flex flex-col gap-2">
        <CampoTexto v-model="busca" :rotulo="`Buscar ${pac.singular}`" autocomplete="off" />
        <button v-for="p in encontrados.data.value?.itens ?? []" :key="p.id" type="button" class="min-h-12 rounded-xl border border-zinc-200 px-4 text-left hover:border-acao dark:border-zinc-700" @click="pacienteId = p.id">{{ p.nome }}</button>
      </div>

      <template v-if="pacienteId">
        <Selecao v-if="abertos.length" v-model="pedidoId" rotulo="Pedido" vazio="Sem pedido (resultado avulso)"
          :opcoes="abertos.map((p) => ({ valor: p.id, rotulo: `${p.itens.map((i) => i.nome).join(', ')} — ${formatarDataHora(p.criadoEm, app.fuso, app.locale, { dateStyle: 'short' })}` }))" />
        <CampoTexto v-model="titulo" rotulo="Título" :maxlength="200" ajuda="Por exemplo: Hemograma completo." />
        <CampoTexto v-model="dataColeta" rotulo="Data da coleta (opcional)" tipo="date" :erro="dataValida ? null : 'A data não pode ser futura.'" />
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 font-medium">Arquivos</legend>
          <CampoArquivos v-model="arquivos" v-model:ocupado="enviandoArquivo" rotulo="Arquivos do resultado" />
        </fieldset>
        <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Comentário (opcional)</span>
          <textarea v-model="comentario" rows="2" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
        <Aviso v-if="sessao.ehPaciente">A equipe recebe um aviso e revisa o resultado. A revisão não substitui a {{ termo('consulta').singular }}.</Aviso>
        <Aviso v-if="m.error.value" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>
        <Botao bloco :carregando="m.isPending.value" :desabilitado="!pronto" @click="m.mutate()">Enviar</Botao>
      </template>
    </template>
  </div>
</template>
