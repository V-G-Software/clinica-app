<script setup lang="ts">
// Novo rascunho de receita ou atestado (RN-DOC-002). "Salvar e assinar" leva direto ao provedor do
// certificado; "Salvar rascunho" deixa para assinar depois, junto com outros (assinatura em lote).
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { hojeNoFuso } from '@/i18n/dias';
import { capitalizar } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Cartao from '@/ds/Cartao.vue';
import EscolherProvedor from './EscolherProvedor.vue';
import FormDocumento from './FormDocumento.vue';
import { assinar, atestadoVazio, corpoAtestado, corpoReceita, problemaAtestado, problemaReceita, receitaVazia, TIPO } from './util';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const tipos = computed(() => ((sessao.manifesto?.modulos.find((m) => m.id === 'documentos')?.config as any)?.tiposPermitidos ?? ['RECEITA', 'ATESTADO']) as Array<'RECEITA' | 'ATESTADO'>);
const daQuery = (k: string) => (typeof rota.query[k] === 'string' ? (rota.query[k] as string) : '');
const tipo = ref<'RECEITA' | 'ATESTADO'>(tipos.value.includes(daQuery('tipo') as any) ? (daQuery('tipo') as any) : tipos.value[0]);
const pacienteId = ref(daQuery('pacienteId'));
const busca = ref('');
const paciente = useQuery({ queryKey: ['paciente-resumo', pacienteId], queryFn: () => ok(api().GET('/v1/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId.value } } })), enabled: computed(() => !!pacienteId.value) });
const encontrados = useQuery({ queryKey: ['pacientes', 'busca', busca], queryFn: () => ok(api().POST('/v1/pacientes/busca', { body: { texto: busca.value.trim(), limite: 8 } })), enabled: computed(() => !pacienteId.value && busca.value.trim().length >= 2) });

const receita = reactive(receitaVazia());
const atestado = reactive(atestadoVazio(hojeNoFuso(app.agoraServidor(), app.fuso)));
const problema = computed(() => (tipo.value === 'RECEITA' ? problemaReceita(receita) : problemaAtestado(atestado)));
const provedor = ref('');
const tocado = ref(false);

const chave = criarChave();
const chaveAssinatura = criarChave();
const m = useMutation({
  mutationFn: async (eAssinar: boolean) => {
    const d = await ok(api().POST('/v1/documentos', {
      params: { header: { 'Idempotency-Key': chave.obter() } },
      body: { pacienteId: pacienteId.value, tipo: tipo.value, ...(tipo.value === 'RECEITA' ? { receita: corpoReceita(receita) } : { atestado: corpoAtestado(atestado) }) },
    }));
    chave.concluir();
    void qc.invalidateQueries({ queryKey: ['documentos'] });
    void qc.invalidateQueries({ queryKey: ['inicio'] });
    if (eAssinar && provedor.value) {
      try { await assinar([d.id], provedor.value, chaveAssinatura.obter()); return; } catch { /* rascunho salvo: o detalhe mostra o erro e deixa tentar de novo */ }
    }
    await router.replace(`/documentos/${d.id}`);
  },
  onError: (e) => { if (e instanceof ErroApi && e.status >= 400 && e.status < 500) chave.concluir(); },
});
const salvar = (eAssinar: boolean) => { tocado.value = true; if (!problema.value && pacienteId.value) m.mutate(eAssinar); };
const semRegistro = computed(() => m.error.value instanceof ErroApi && m.error.value.codigo === 'REGISTRO_PROFISSIONAL_AUSENTE');
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ tipos.length > 1 ? 'Receita ou atestado' : `Nova ${TIPO[tipos[0]].toLowerCase()}` }}</h1>

    <Cartao v-if="pacienteId && paciente.data.value" class="flex items-center justify-between">
      <span><span class="text-sm text-secundario">{{ capitalizar(termo('paciente').singular) }}:</span> <strong>{{ paciente.data.value.nome }}</strong></span>
      <Botao variante="fantasma" @click="pacienteId = ''">Trocar</Botao>
    </Cartao>
    <div v-else class="flex flex-col gap-2">
      <CampoTexto v-model="busca" :rotulo="`Buscar ${termo('paciente').singular}`" autocomplete="off" />
      <button v-for="p in encontrados.data.value?.itens ?? []" :key="p.id" type="button" class="min-h-12 rounded-xl border border-zinc-200 px-4 text-left hover:border-acao dark:border-zinc-700" @click="pacienteId = p.id">{{ p.nome }}</button>
    </div>

    <div v-if="tipos.length > 1" class="flex gap-2" role="group" aria-label="Documento">
      <button v-for="t in tipos" :key="t" type="button" class="min-h-11 flex-1 rounded-xl border-2 px-3 font-medium" :class="tipo === t ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="tipo === t" @click="tipo = t">{{ TIPO[t] }}</button>
    </div>

    <FormDocumento v-model:receita="receita" v-model:atestado="atestado" :tipo="tipo" />

    <Aviso v-if="tocado && problema" tipo="erro">{{ problema }}</Aviso>
    <Aviso v-else-if="semRegistro" tipo="erro">Para emitir documentos, cadastre seu registro no conselho (por exemplo, CRM e UF). Peça à gestão para completar seu cadastro na equipe.</Aviso>
    <Aviso v-else-if="m.error.value" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>

    <Cartao class="flex flex-col gap-3">
      <EscolherProvedor v-model="provedor" />
      <p class="text-sm text-secundario">Ao assinar, você confirma no app do seu certificado digital. O documento assinado vai {{ termo('paciente').genero === 'F' ? 'para a' : 'para o' }} {{ termo('paciente').singular }} pela conversa.</p>
      <Botao bloco :carregando="m.isPending.value && m.variables.value === true" :desabilitado="!pacienteId || !provedor" @click="salvar(true)">Salvar e assinar</Botao>
      <Botao bloco variante="secundario" :carregando="m.isPending.value && m.variables.value === false" :desabilitado="!pacienteId" @click="salvar(false)">Salvar rascunho</Botao>
    </Cartao>
  </div>
</template>
