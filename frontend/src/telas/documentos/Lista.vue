<script setup lang="ts">
// Equipe: rascunhos para assinar (em lote: uma autorização no certificado para vários), assinados e
// anulados. O PSC devolve o navegador para cá com ?assinatura={id} (ou "invalida"): mostramos o resultado.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CheckCircle2, FilePlus2, X } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { capitalizar } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import EscolherProvedor from './EscolherProvedor.vue';
import { assinar, resumo, STATUS, TIPO } from './util';

type Aba = 'ASSINAR' | 'ASSINADO' | 'ANULADO';
const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const emite = computed(() => sessao.pode('documentos.documento.emitir'));
const aba = ref<Aba>(emite.value ? 'ASSINAR' : 'ASSINADO');
const pacienteId = computed(() => (typeof rota.query.pacienteId === 'string' ? rota.query.pacienteId : ''));
const quando = (iso: string) => formatarDataHora(iso, app.fuso, app.locale, { dateStyle: 'short', timeStyle: 'short' });

const lista = useInfiniteQuery({
  queryKey: ['documentos', { aba, pacienteId }],
  queryFn: ({ pageParam }) => ok(api().GET('/v1/documentos', { params: { query: {
    ...(pacienteId.value ? { pacienteId: pacienteId.value } : {}),
    ...(aba.value === 'ASSINAR' ? { status: 'RASCUNHO' as const, emissorId: sessao.manifesto!.usuario.id } : { status: aba.value }),
    limite: 30, ...(pageParam ? { cursor: pageParam } : {}),
  } } })),
  initialPageParam: '' as string,
  getNextPageParam: (p) => p.proximoCursor ?? undefined,
});
const itens = computed(() => (lista.data.value?.pages ?? []).flatMap((p) => p.itens));

// Assinatura em lote.
const selecionados = ref<string[]>([]);
watch(itens, (l) => { selecionados.value = selecionados.value.filter((id) => l.some((d) => d.id === id)); });
const todos = computed({ get: () => !!itens.value.length && selecionados.value.length === itens.value.length, set: (v) => { selecionados.value = v ? itens.value.slice(0, 10).map((d) => d.id) : []; } });
const provedor = ref('');
const chave = criarChave();
const lote = useMutation({ mutationFn: () => assinar(selecionados.value, provedor.value, chave.obter()), onError: () => chave.concluir() });

// Volta do provedor.
const retorno = computed(() => (typeof rota.query.assinatura === 'string' ? rota.query.assinatura : ''));
const sessaoAss = useQuery({
  queryKey: ['assinatura', retorno],
  queryFn: () => ok(api().GET('/v1/documentos/assinaturas/{sessaoId}', { params: { path: { sessaoId: retorno.value } } })),
  enabled: computed(() => !!retorno.value && retorno.value !== 'invalida'),
  refetchInterval: (c) => (c.state.data && ['AGUARDANDO_AUTORIZACAO', 'ASSINANDO'].includes(c.state.data.status) ? 1500 : false),
});
watch(() => sessaoAss.data.value?.status, (s) => { if (s === 'CONCLUIDA' || s === 'FALHOU' || s === 'EXPIRADA') { void qc.invalidateQueries({ queryKey: ['documentos'] }); void qc.invalidateQueries({ queryKey: ['inicio'] }); } });
const fecharRetorno = () => router.replace({ query: { ...rota.query, assinatura: undefined } });
const qtd = (n: number) => `${n} documento${n === 1 ? '' : 's'}`;
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">Documentos</h1>
      <RouterLink v-if="emite" :to="pacienteId ? `/documentos/novo?pacienteId=${encodeURIComponent(pacienteId)}` : '/documentos/novo'"><Botao><FilePlus2 class="size-5" aria-hidden="true" /> Receita ou atestado</Botao></RouterLink>
    </div>

    <div v-if="retorno" role="status">
      <Aviso v-if="retorno === 'invalida'" tipo="erro">Este retorno da assinatura não vale mais (já usado ou expirado). Confira a situação dos documentos abaixo e assine de novo, se preciso.</Aviso>
      <Aviso v-else-if="sessaoAss.data.value?.status === 'CONCLUIDA'" tipo="informacao"><CheckCircle2 class="mr-1 inline size-5" aria-hidden="true" /> {{ capitalizar(qtd(sessaoAss.data.value.documentosIds.length)) }} assinado{{ sessaoAss.data.value.documentosIds.length === 1 ? '' : 's' }} e enviado{{ sessaoAss.data.value.documentosIds.length === 1 ? '' : 's' }} {{ termo('paciente').genero === 'F' ? 'à' : 'ao' }} {{ termo('paciente').singular }}.</Aviso>
      <Aviso v-else-if="sessaoAss.data.value?.status === 'FALHOU' || sessaoAss.data.value?.status === 'EXPIRADA'" tipo="erro">Não foi assinado: {{ sessaoAss.data.value.erro }} Os rascunhos continuam em "Para assinar".</Aviso>
      <Aviso v-else-if="sessaoAss.error.value" tipo="erro">{{ msg(sessaoAss.error.value)?.texto }}</Aviso>
      <Aviso v-else>Concluindo a assinatura…</Aviso>
      <button type="button" class="mt-1 flex min-h-10 items-center gap-1 text-sm underline" @click="fecharRetorno"><X class="size-4" aria-hidden="true" /> Fechar aviso</button>
    </div>

    <div class="flex flex-wrap gap-1" role="group" aria-label="Mostrar">
      <button v-for="[v, r] in ([...(emite ? [['ASSINAR', 'Para assinar']] : []), ['ASSINADO', 'Assinados'], ['ANULADO', 'Anulados']] as Array<[Aba, string]>)" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="aba === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="aba === v" @click="aba = v">{{ r }}</button>
    </div>

    <Cartao v-if="aba === 'ASSINAR' && itens.length" class="flex flex-col gap-3">
      <label class="flex items-center gap-3"><input v-model="todos" type="checkbox" class="size-5" /> Selecionar todos (até 10)</label>
      <EscolherProvedor v-model="provedor" />
      <Aviso v-if="lote.error.value" tipo="erro" :detalhe="msg(lote.error.value)?.suporte">{{ msg(lote.error.value)?.texto }}</Aviso>
      <Botao bloco :carregando="lote.isPending.value" :desabilitado="!selecionados.length || selecionados.length > 10 || !provedor" @click="lote.mutate()">Assinar {{ selecionados.length ? qtd(selecionados.length) : 'selecionados' }}</Botao>
    </Cartao>

    <EstadoConsulta :carregando="lista.isPending.value" :erro="lista.error.value" :vazio="!itens.length" :texto-vazio="aba === 'ASSINAR' ? 'Nenhum rascunho para assinar.' : aba === 'ANULADO' ? 'Nenhum documento anulado.' : 'Nenhum documento assinado.'" @tentar="lista.refetch()">
      <div v-for="d in itens" :key="d.id" class="flex min-h-16 items-center gap-3 rounded-xl border border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <input v-if="aba === 'ASSINAR'" v-model="selecionados" type="checkbox" :value="d.id" class="size-5 shrink-0" :aria-label="`Selecionar ${TIPO[d.tipo].toLowerCase()} de ${d.paciente.nome}`" />
        <RouterLink :to="`/documentos/${d.id}`" class="min-w-0 flex-1 hover:underline">
          <p class="font-semibold">{{ d.paciente.nome }} · {{ TIPO[d.tipo] }}</p>
          <p class="truncate text-sm text-zinc-600 dark:text-zinc-300">{{ resumo(d) }}</p>
          <p class="text-xs text-secundario">{{ quando(d.assinadoEm ?? d.criadoEm) }}<template v-if="aba !== 'ASSINAR'"> · {{ d.emissor.nome }}</template><template v-if="d.erroAssinatura"> · não assinado: tente de novo</template></p>
        </RouterLink>
        <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[d.status].classe">{{ STATUS[d.status].rotulo }}</span>
      </div>
    </EstadoConsulta>
    <Botao v-if="lista.hasNextPage.value" variante="fantasma" :carregando="lista.isFetchingNextPage.value" @click="lista.fetchNextPage()">Ver mais</Botao>
  </div>
</template>
