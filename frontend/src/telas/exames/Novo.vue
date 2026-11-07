<script setup lang="ts">
// Pedido de exame estruturado (RN-EXA-002): itens com preparo próprio, orientações gerais (o paciente vê)
// e observação interna (não vê). Avisa o paciente. Idempotency-Key por ação: retry não duplica.
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Plus, Trash2 } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { artigo, capitalizar, flexao } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';

const rota = useRoute();
const router = useRouter();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const exame = computed(() => termo.value('exame'));
const pacienteId = ref(typeof rota.query.pacienteId === 'string' ? rota.query.pacienteId : '');
const busca = ref('');
const paciente = useQuery({ queryKey: ['paciente-resumo', pacienteId], queryFn: () => ok(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId.value } } })), enabled: computed(() => !!pacienteId.value) });
const resultados = useQuery({ queryKey: ['pacientes', 'busca', busca], queryFn: () => ok(api().POST('/v1/pacientes/busca', { body: { texto: busca.value.trim(), limite: 8 } })), enabled: computed(() => !pacienteId.value && busca.value.trim().length >= 2) });

const itens = reactive([{ nome: '', orientacoes: '' }]);
const orientacoes = ref('');
const observacao = ref('');
const preenchidos = computed(() => itens.filter((i) => i.nome.trim()));
const curtos = computed(() => preenchidos.value.some((i) => i.nome.trim().length < 2));
const pronto = computed(() => !!pacienteId.value && preenchidos.value.length > 0 && !curtos.value);

const chave = criarChave();
const m = useMutation({
  mutationFn: () => ok(api().POST('/v1/exames/pedidos', {
    params: { header: { 'Idempotency-Key': chave.obter() } },
    body: {
      pacienteId: pacienteId.value,
      itens: preenchidos.value.map((i) => ({ nome: i.nome.trim(), orientacoes: i.orientacoes.trim() || null })),
      orientacoes: orientacoes.value.trim() || null,
      observacao: observacao.value.trim() || null,
    },
  })),
  onSuccess: async (p) => { chave.concluir(); await Promise.all([qc.invalidateQueries({ queryKey: ['exames-pedidos'] }), qc.invalidateQueries({ queryKey: ['inicio'] })]); await router.replace(`/exames/pedidos/${p.id}`); },
  onError: (e) => { if (e instanceof ErroApi && e.status >= 400 && e.status < 500) chave.concluir(); },
});
const textarea = 'rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800';
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">Pedido de {{ exame.singular }}</h1>

    <Cartao v-if="pacienteId && paciente.data.value" class="flex items-center justify-between">
      <span><span class="text-sm text-secundario">{{ capitalizar(termo('paciente').singular) }}:</span> <strong>{{ paciente.data.value.nome }}</strong></span>
      <Botao variante="fantasma" @click="pacienteId = ''">Trocar</Botao>
    </Cartao>
    <div v-else class="flex flex-col gap-2">
      <CampoTexto v-model="busca" :rotulo="`Buscar ${termo('paciente').singular}`" autocomplete="off" />
      <button v-for="p in resultados.data.value?.itens ?? []" :key="p.id" type="button" class="min-h-12 rounded-xl border border-zinc-200 px-4 text-left hover:border-acao dark:border-zinc-700" @click="pacienteId = p.id">{{ p.nome }}</button>
    </div>

    <fieldset class="flex flex-col gap-3">
      <legend class="mb-2 font-bold">{{ capitalizar(exame.plural) }}</legend>
      <Cartao v-for="(item, i) in itens" :key="i" class="flex flex-col gap-2">
        <div class="flex items-end gap-2">
          <CampoTexto v-model="item.nome" :rotulo="`${capitalizar(exame.singular)} ${i + 1}`" :maxlength="200" class="flex-1" :erro="item.nome.trim().length === 1 ? 'Nome muito curto.' : null" />
          <button v-if="itens.length > 1" type="button" class="flex size-11 shrink-0 items-center justify-center rounded-lg border-2 border-zinc-300" :aria-label="`Remover ${exame.singular} ${i + 1}`" @click="itens.splice(i, 1)"><Trash2 class="size-5" /></button>
        </div>
        <CampoTexto v-model="item.orientacoes" rotulo="Preparo (opcional)" :maxlength="1000" ajuda="Por exemplo: jejum de 8 horas." />
      </Cartao>
      <Botao v-if="itens.length < 30" variante="fantasma" @click="itens.push({ nome: '', orientacoes: '' })"><Plus class="size-5" aria-hidden="true" /> Adicionar {{ exame.singular }}</Botao>
    </fieldset>

    <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Orientações {{ flexao(termo('paciente'), 'ao', 'à') }} {{ termo('paciente').singular }} (opcional)</span>
      <textarea v-model="orientacoes" rows="3" maxlength="2000" :class="textarea" /></label>
    <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Observação interna ({{ artigo(termo('paciente')) }} {{ termo('paciente').singular }} não vê)</span>
      <textarea v-model="observacao" rows="2" maxlength="2000" :class="textarea" /></label>
    <Aviso>{{ capitalizar(artigo(termo('paciente'))) }} {{ termo('paciente').singular }} recebe um aviso com o pedido e pode enviar o resultado pelo app.</Aviso>

    <Aviso v-if="m.error.value" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>
    <Botao bloco :carregando="m.isPending.value" :desabilitado="!pronto" @click="m.mutate()">Registrar pedido</Botao>
  </div>
</template>
