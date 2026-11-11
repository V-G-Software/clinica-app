<script setup lang="ts">
// Documento (equipe e paciente). Botões só pelo `acoesPermitidas`. O PDF assinado é baixado como anexo;
// a URL assinada se renova antes de expirar. Edição do rascunho com If-Match.
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Download, FileText, MessageCircle } from 'lucide-vue-next';
import type { Documento } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { capitalizar } from '@/i18n/termos';
import { comEtag } from '@/dados/etag';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import Conflito from '@/ds/Conflito.vue';
import Dialogo from '@/ds/Dialogo.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { intervaloRenovacao, tamanho } from '@/telas/exames/util';
import EscolherProvedor from './EscolherProvedor.vue';
import FormDocumento from './FormDocumento.vue';
import {
  assinar, atestadoDoDoc, atestadoVazio, corpoAtestado, corpoReceita, problemaAtestado, problemaReceita, receitaDoDoc, receitaVazia, resumo, STATUS, TIPO,
} from './util';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const id = computed(() => rota.params.documentoId as string);
const q = useQuery({
  queryKey: ['documento', id],
  queryFn: () => comEtag(api().GET('/v1/documentos/{documentoId}', { params: { path: { documentoId: id.value } } })),
  refetchInterval: (c) => intervaloRenovacao(c.state.data?.dado.arquivo?.urlsExpiramEm, app.agoraServidor()),
});
const d = computed(() => q.data.value?.dado);
const acoes = computed(() => new Set(d.value?.acoesPermitidas ?? []));
const quando = (iso: string) => formatarDataHora(iso, app.fuso, app.locale);
const atualizar = async (novo?: Documento) => {
  if (novo && q.data.value) q.data.value.dado = novo;
  await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['documentos'] }), qc.invalidateQueries({ queryKey: ['inicio'] })]);
};

// Edição do rascunho.
const editando = ref(false);
const receita = reactive(receitaVazia());
const atestado = reactive(atestadoVazio(''));
const conflito = ref(false);
watch(editando, (e) => {
  if (!e || !d.value) return;
  Object.assign(receita, d.value.receita ? receitaDoDoc(d.value.receita) : receitaVazia());
  Object.assign(atestado, d.value.atestado ? atestadoDoDoc(d.value.atestado) : atestadoVazio(''));
  conflito.value = false;
});
const problema = computed(() => (d.value?.tipo === 'RECEITA' ? problemaReceita(receita) : problemaAtestado(atestado)));
const editar = useMutation({
  mutationFn: () => comEtag(api().PATCH('/v1/documentos/{documentoId}', {
    params: { path: { documentoId: id.value }, header: { 'If-Match': q.data.value?.etag ?? '' } },
    body: d.value!.tipo === 'RECEITA' ? { receita: corpoReceita(receita) } : { atestado: corpoAtestado(atestado) },
  })),
  onSuccess: async () => { editando.value = false; await atualizar(); },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; },
});

// Assinar (sai do app para o provedor do certificado).
const provedor = ref('');
const chaveAssinatura = criarChave();
const assinatura = useMutation({ mutationFn: () => assinar([id.value], provedor.value, chaveAssinatura.obter()), onError: () => chaveAssinatura.concluir() });

const descartar = useMutation({
  mutationFn: () => ok(api().POST('/v1/documentos/{documentoId}/descartar', { params: { path: { documentoId: id.value } } })),
  onSuccess: async () => { await atualizar(); await router.replace('/documentos'); },
});
const anulando = ref(false);
const motivo = ref('');
const anular = useMutation({
  mutationFn: () => ok(api().POST('/v1/documentos/{documentoId}/anular', { params: { path: { documentoId: id.value } }, body: { motivo: motivo.value.trim() } })),
  onSuccess: async (r) => { anulando.value = false; motivo.value = ''; await atualizar(r); },
});
const erroAcao = computed(() => assinatura.error.value ?? descartar.error.value);
const br = (x: string) => x.split('-').reverse().join('/');
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" @tentar="q.refetch()">
      <template v-if="d">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="text-sm text-secundario">{{ TIPO[d.tipo] }}<template v-if="d.assinadoEm"> · assinado em {{ quando(d.assinadoEm) }}</template></p>
            <h1 class="text-2xl font-bold">{{ sessao.ehPaciente && (sessao.manifesto?.pacientesVinculados?.length ?? 0) <= 1 ? TIPO[d.tipo] : d.paciente.nome }}</h1>
          </div>
          <span class="rounded-full px-3 py-1 text-sm font-semibold" :class="STATUS[d.status].classe">{{ STATUS[d.status].rotulo }}</span>
        </div>

        <Aviso v-if="d.status === 'ANULADO'" tipo="erro"><strong>Anulado</strong><template v-if="d.anuladoEm"> em {{ quando(d.anuladoEm) }}</template>: {{ d.motivoAnulacao }}. Não use este documento.</Aviso>
        <Aviso v-if="d.status === 'RASCUNHO' && d.erroAssinatura" tipo="atencao">Não foi assinado: {{ d.erroAssinatura }}</Aviso>
        <Aviso v-if="d.status === 'ASSINANDO'">Aguardando a confirmação no app do certificado digital. Se você desistiu, a assinatura expira em alguns minutos e o rascunho volta.</Aviso>
        <Aviso v-if="erroAcao" tipo="erro" :detalhe="msg(erroAcao)?.suporte">{{ msg(erroAcao)?.texto }}</Aviso>

        <Cartao v-if="!editando" class="flex flex-col gap-2">
          <template v-if="d.receita">
            <ol class="flex flex-col gap-2">
              <li v-for="(i, n) in d.receita.itens" :key="n"><p class="font-semibold">{{ n + 1 }}. {{ i.medicamento }}<template v-if="i.quantidade"> — {{ i.quantidade }}</template></p><p class="text-sm">{{ i.posologia }}</p></li>
            </ol>
            <p v-if="d.receita.orientacoes" class="whitespace-pre-line text-sm"><strong>Orientações:</strong> {{ d.receita.orientacoes }}</p>
          </template>
          <template v-else-if="d.atestado">
            <p>{{ resumo(d) }}.</p>
            <p v-if="d.atestado.cid" class="text-sm">CID: {{ d.atestado.cid }} (com autorização {{ termo('paciente').genero === 'F' ? 'da' : 'do' }} {{ termo('paciente').singular }})</p>
            <p v-if="d.atestado.observacoes" class="whitespace-pre-line text-sm">{{ d.atestado.observacoes }}</p>
          </template>
          <p class="mt-1 text-sm text-secundario">{{ d.emissor.nome }} · {{ d.registro.conselho }} {{ d.registro.numero }}/{{ d.registro.uf }}<template v-if="!sessao.ehPaciente"> · {{ capitalizar(termo('paciente').singular) }}: {{ d.paciente.nome }}</template></p>
        </Cartao>
        <Cartao v-else class="flex flex-col gap-3">
          <Conflito v-if="conflito" @recarregar="q.refetch().then(() => { editando = false; })" />
          <FormDocumento v-model:receita="receita" v-model:atestado="atestado" :tipo="d.tipo" />
          <Aviso v-if="problema" tipo="erro">{{ problema }}</Aviso>
          <Aviso v-else-if="editar.error.value && !conflito" tipo="erro">{{ msg(editar.error.value)?.texto }}</Aviso>
          <div class="flex gap-2"><Botao :carregando="editar.isPending.value" :desabilitado="!!problema" @click="editar.mutate()">Salvar</Botao><Botao variante="fantasma" @click="editando = false">Descartar alterações</Botao></div>
        </Cartao>

        <a v-if="d.arquivo?.urlVisualizacao" :href="d.arquivo.urlVisualizacao" rel="noopener noreferrer" class="flex min-h-14 items-center gap-3 rounded-xl border-2 border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
          <FileText class="size-6 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1"><span class="block truncate font-medium">{{ d.arquivo.nome }}</span><span class="text-sm text-secundario">PDF assinado · {{ tamanho(d.arquivo.tamanhoBytes) }}</span></span>
          <Download class="size-5 shrink-0 text-acao" aria-hidden="true" /><span class="sr-only">Baixar</span>
        </a>
        <Cartao v-if="d.codigoValidacao" class="flex flex-col gap-1 text-sm">
          <p>Código de validação: <strong class="font-mono tracking-wider">{{ d.codigoValidacao }}</strong></p>
          <p class="text-secundario">Quem recebe o documento (farmácia, empregador) confere a situação pelo código e a assinatura digital em validar.iti.gov.br.</p>
        </Cartao>
        <RouterLink v-if="d.entrega" :to="`/conversas/${d.entrega.conversaId}`" class="flex min-h-12 items-center gap-2 text-acao underline"><MessageCircle class="size-5" aria-hidden="true" /> {{ sessao.ehPaciente ? 'Ver na conversa' : `Entregue na conversa em ${quando(d.entrega.entregueEm)}` }}</RouterLink>

        <Cartao v-if="acoes.has('ASSINAR') && !editando" class="flex flex-col gap-3">
          <EscolherProvedor v-model="provedor" />
          <Botao bloco :carregando="assinatura.isPending.value" :desabilitado="!provedor" @click="assinatura.mutate()">Assinar e enviar</Botao>
        </Cartao>
        <div v-if="!editando" class="flex flex-wrap gap-2">
          <Botao v-if="acoes.has('EDITAR')" variante="secundario" @click="editando = true">Editar</Botao>
          <Botao v-if="acoes.has('DESCARTAR')" variante="fantasma" :carregando="descartar.isPending.value" @click="descartar.mutate()">Descartar rascunho</Botao>
          <Botao v-if="acoes.has('ANULAR')" variante="secundario" @click="anular.reset(); anulando = true">Anular</Botao>
        </div>
        <p v-if="d.status === 'RASCUNHO' && d.atestado" class="text-xs text-secundario">Data do atestado: {{ br(d.atestado.data) }}.</p>
      </template>
    </EstadoConsulta>

    <Dialogo v-model:aberto="anulando" :titulo="`Anular ${d ? TIPO[d.tipo].toLowerCase() : 'documento'}`" descricao="O documento continua guardado, mas a validação pública passa a mostrar que foi anulado e o paciente é avisado. Se errou, emita outro.">
      <form class="flex flex-col gap-3" @submit.prevent="anular.mutate()">
        <Aviso v-if="anular.error.value" tipo="erro" :detalhe="msg(anular.error.value)?.suporte">{{ msg(anular.error.value)?.texto }}</Aviso>
        <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Motivo</span><textarea v-model="motivo" rows="3" maxlength="1000" required class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
        <Botao tipo="submit" bloco :carregando="anular.isPending.value" :desabilitado="motivo.trim().length < 3">Confirmar anulação</Botao>
      </form>
    </Dialogo>
  </div>
</template>
