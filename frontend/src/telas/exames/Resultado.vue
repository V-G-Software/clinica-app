<script setup lang="ts">
// Resultado de exame (equipe e paciente). Foto abre em tamanho real; PDF é baixado como anexo (o backend
// manda Content-Disposition: attachment — nunca renderizado inline). URLs assinadas duram minutos:
// a consulta se renova antes de expirarem. Revisão com nota opcional, visível ao paciente (RN-EXA-004).
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CheckCircle2, Download, FileText } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarData, formatarDataHora } from '@/i18n/datas';
import { artigo, capitalizar } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { ehPdf, intervaloRenovacao, STATUS_RESULTADO, tamanho } from './util';

const rota = useRoute();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const exame = computed(() => termo.value('exame'));
const id = computed(() => rota.params.resultadoId as string);
const q = useQuery({
  queryKey: ['exame-resultado', id],
  queryFn: () => ok(api().GET('/v1/exames/resultados/{resultadoId}', { params: { path: { resultadoId: id.value } } })),
  refetchInterval: (c) => {
    const exp = c.state.data?.arquivos.map((a) => a.urlsExpiramEm).filter(Boolean).sort()[0];
    return intervaloRenovacao(exp, app.agoraServidor());
  },
});
const r = computed(() => q.data.value);
const fotos = computed(() => (r.value?.arquivos ?? []).filter((a) => !ehPdf(a.tipo)));
const pdfs = computed(() => (r.value?.arquivos ?? []).filter((a) => ehPdf(a.tipo)));
const quando = (iso: string) => formatarDataHora(iso, app.fuso, app.locale);
const pac = computed(() => termo.value('paciente'));

const nota = ref('');
const revisar = useMutation({
  mutationFn: () => ok(api().POST('/v1/exames/resultados/{resultadoId}/revisar', { params: { path: { resultadoId: id.value } }, body: { nota: nota.value.trim() || null } })),
  onSuccess: async (novo) => {
    qc.setQueryData(['exame-resultado', id.value], novo);
    nota.value = '';
    await Promise.all([qc.invalidateQueries({ queryKey: ['exames-resultados'] }), qc.invalidateQueries({ queryKey: ['inicio'] }), ...(novo.pedidoId ? [qc.invalidateQueries({ queryKey: ['exame-pedido', novo.pedidoId] })] : [])]);
  },
});
// URL vencida (aba esquecida aberta): a imagem falha → busca URLs novas.
const renovar = () => void q.refetch();
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" @tentar="q.refetch()">
      <template v-if="r">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="text-sm text-secundario">Resultado de {{ exame.singular }}<template v-if="!sessao.ehPaciente || (sessao.manifesto?.pacientesVinculados?.length ?? 0) > 1"> · {{ r.paciente.nome }}</template></p>
            <h1 class="text-2xl font-bold">{{ r.titulo }}</h1>
          </div>
          <span class="rounded-full px-3 py-1 text-sm font-semibold" :class="STATUS_RESULTADO[r.status].classe">{{ STATUS_RESULTADO[r.status].rotulo }}</span>
        </div>

        <Cartao v-if="r.revisao" class="flex flex-col gap-1 border-green-600/40">
          <p class="flex items-center gap-2 font-semibold"><CheckCircle2 class="size-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" /> Revisado por {{ r.revisao.por.nome }}</p>
          <p class="text-sm text-secundario">{{ quando(r.revisao.revisadoEm) }}</p>
          <p v-if="r.revisao.nota" class="mt-1 whitespace-pre-line rounded-lg bg-marca-50 p-3 dark:bg-zinc-700">{{ r.revisao.nota }}</p>
        </Cartao>
        <Aviso v-else-if="sessao.ehPaciente">A equipe ainda vai revisar este resultado. Você recebe um aviso quando isso acontecer.</Aviso>

        <Cartao class="flex flex-col gap-1 text-sm">
          <p v-if="r.dataColeta">Coleta: <strong>{{ formatarData(r.dataColeta, app.locale) }}</strong></p>
          <p>Enviado {{ r.origem === 'PACIENTE' ? (sessao.ehPaciente ? 'por você' : `pel${artigo(pac)} ${pac.singular} (${r.enviadoPor.nome})`) : `pela equipe (${r.enviadoPor.nome})` }} em {{ quando(r.criadoEm) }}</p>
          <p v-if="r.comentario" class="mt-1 whitespace-pre-line"><strong>Comentário:</strong> {{ r.comentario }}</p>
          <RouterLink v-if="r.pedidoId" :to="`/exames/pedidos/${r.pedidoId}`" class="mt-1 text-acao underline">Ver o pedido</RouterLink>
        </Cartao>

        <section v-if="fotos.length" class="flex flex-col gap-2" aria-labelledby="titulo-fotos">
          <h2 id="titulo-fotos" class="font-bold">Fotos</h2>
          <ul class="flex flex-wrap gap-3">
            <li v-for="a in fotos" :key="a.id">
              <a v-if="a.urlVisualizacao" :href="a.urlVisualizacao" target="_blank" rel="noopener noreferrer" class="block">
                <img :src="a.urlMiniatura ?? a.urlVisualizacao" :alt="`Foto: ${a.nome}`" class="size-36 rounded-xl object-cover" @error="renovar" />
              </a>
              <div v-else class="flex size-36 items-center justify-center rounded-xl bg-zinc-100 text-sm dark:bg-zinc-700">Indisponível</div>
            </li>
          </ul>
        </section>
        <section v-if="pdfs.length" class="flex flex-col gap-2" aria-labelledby="titulo-pdfs">
          <h2 id="titulo-pdfs" class="font-bold">Documentos</h2>
          <template v-for="a in pdfs" :key="a.id">
            <a v-if="a.urlVisualizacao" :href="a.urlVisualizacao" :download="a.nome" rel="noopener noreferrer" class="flex min-h-14 items-center gap-3 rounded-xl border-2 border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
              <FileText class="size-6 shrink-0" aria-hidden="true" />
              <span class="min-w-0 flex-1"><span class="block truncate font-medium">{{ a.nome }}</span><span class="text-sm text-secundario">PDF · {{ tamanho(a.tamanhoBytes) }}</span></span>
              <Download class="size-5 shrink-0 text-acao" aria-hidden="true" /><span class="sr-only">Baixar</span>
            </a>
            <p v-else class="text-sm text-secundario">{{ a.nome }}: indisponível no momento.</p>
          </template>
        </section>

        <Cartao v-if="r.acoesPermitidas.includes('REVISAR')" class="flex flex-col gap-3">
          <h2 class="font-bold">Revisar</h2>
          <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Nota {{ sessao.ehPaciente ? '' : `para ${artigo(pac)} ${pac.singular}` }} (opcional)</span>
            <textarea v-model="nota" rows="3" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
          <p class="text-sm text-secundario">{{ capitalizar(artigo(pac)) }} {{ pac.singular }} vê a nota e recebe um aviso de que o resultado foi revisado.</p>
          <Aviso v-if="revisar.error.value" tipo="erro" :detalhe="msg(revisar.error.value)?.suporte">{{ msg(revisar.error.value)?.texto }}</Aviso>
          <Botao :carregando="revisar.isPending.value" @click="revisar.mutate()">Marcar como revisado</Botao>
        </Cartao>
      </template>
    </EstadoConsulta>
  </div>
</template>
