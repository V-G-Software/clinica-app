<script setup lang="ts">
// Chat (11.5): envio otimista, fila sem duplicar ao reconectar, aviso de urgência fixo para o
// paciente, fora do horário, fotos (se permitido), leitura e conversa arquivada.
// Texto é renderizado como texto (nunca v-html).
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Archive, Camera, CircleAlert, Clock, RotateCw, Send, TriangleAlert } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { useMensagens } from '@/dados/mensagens';
import { enviarArquivo } from '@/dados/arquivos';
import { formatarHora, formatarData } from '@/i18n/datas';
import { dentroDoHorario } from './horario';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import Dialogo from '@/ds/Dialogo.vue';
import { useMensagemErro } from '@/dados/erro';

const { t } = useI18n();
const rota = useRoute();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const id = computed(() => String(rota.params.conversaId));
const eu = computed(() => sessao.manifesto?.usuario.id);
const cfgChat = computed(() => (sessao.manifesto?.modulos.find((m) => m.id === 'chat')?.config ?? {}) as Record<string, any>);
const conversa = useQuery({ queryKey: ['conversa', id], queryFn: () => ok(api().GET('/v1/conversas/{conversaId}', { params: { path: { conversaId: id.value } } })) });
const m = useMensagens(id, eu);
const texto = ref('');
const enviandoFoto = ref(false);
const erroFoto = ref<string | null>(null);
const rolagem = ref<HTMLElement | null>(null);
const entradaFoto = ref<HTMLInputElement | null>(null);

const podeEnviar = computed(() => conversa.data.value?.acoesPermitidas.includes('ENVIAR'));
const arquivada = computed(() => conversa.data.value?.status === 'ARQUIVADA');
const titulo = computed(() => {
  const c = conversa.data.value;
  if (!c) return '';
  return sessao.ehPaciente && (sessao.manifesto?.pacientesVinculados?.length ?? 0) > 1 ? `${c.titulo} · ${c.paciente.nome}` : c.titulo;
});
const foraDoHorario = computed(() => sessao.ehPaciente && !dentroDoHorario(cfgChat.value.horarioAtendimento ?? [], app.agoraServidor(), app.fuso));

function enviar() {
  if (!texto.value.trim()) return;
  m.enviar(texto.value);
  texto.value = '';
}
async function escolherFoto(e: Event) {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!arquivo) return;
  enviandoFoto.value = true; erroFoto.value = null;
  try { const a = await enviarArquivo(arquivo, 'CHAT'); m.enviar(texto.value || null, [a.id]); texto.value = ''; }
  catch { erroFoto.value = 'Não foi possível enviar a foto.'; }
  finally { enviandoFoto.value = false; }
}

// Leitura: marca até a última mensagem quando a conversa está visível.
const leitura = useMutation({ mutationFn: (ateMensagemId: string) => ok(api().POST('/v1/conversas/{conversaId}/leitura', { params: { path: { conversaId: id.value } }, body: { ateMensagemId } })) });
let ultimaLida: string | null = null;
watch(() => m.lista.value.at(-1)?.id, async (ultima) => {
  await nextTick();
  rolagem.value?.scrollTo({ top: rolagem.value.scrollHeight });
  if (ultima && ultima !== ultimaLida && document.visibilityState === 'visible' && conversa.data.value) {
    ultimaLida = ultima;
    await leitura.mutateAsync(ultima).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['conversas'] });
  }
});
watch(() => m.pendentes.value.length, async () => { await nextTick(); rolagem.value?.scrollTo({ top: rolagem.value.scrollHeight }); });

// Equipe: participantes, arquivar e reabrir (acoesPermitidas).
const msgErro = useMensagemErro();
const acoes = computed(() => new Set(conversa.data.value?.acoesPermitidas ?? []));
const gerenciando = ref(false);
const membros = useQuery({ queryKey: ['membros', 'ATIVO'], queryFn: () => ok(api().GET('/v1/equipe/membros', { params: { query: { status: 'ATIVO', limite: 100 } } })), enabled: computed(() => gerenciando.value && sessao.modulos.has('equipe') && sessao.pode('equipe.membro.ler')) });
const foraDaConversa = computed(() => (membros.data.value?.itens ?? []).filter((mb) => !conversa.data.value?.participantes.some((p) => p.usuarioId === mb.id)));
const atualizarConversa = () => { void conversa.refetch(); void qc.invalidateQueries({ queryKey: ['conversas'] }); void qc.invalidateQueries({ queryKey: ['mensagens', id] }); };
const adicionar = useMutation({ mutationFn: (usuarioId: string) => ok(api().POST('/v1/conversas/{conversaId}/participantes', { params: { path: { conversaId: id.value } }, body: { usuarioId } })), onSuccess: atualizarConversa });
const remover = useMutation({ mutationFn: (usuarioId: string) => ok(api().DELETE('/v1/conversas/{conversaId}/participantes/{usuarioId}', { params: { path: { conversaId: id.value, usuarioId } } })), onSuccess: atualizarConversa });
const arquivar = useMutation({ mutationFn: () => ok(api().POST('/v1/conversas/{conversaId}/arquivar', { params: { path: { conversaId: id.value } } })), onSuccess: atualizarConversa });
const reabrir = useMutation({ mutationFn: () => ok(api().POST('/v1/conversas/{conversaId}/reabrir', { params: { path: { conversaId: id.value } } })), onSuccess: atualizarConversa });

const novoDia = (i: number) => i === 0 || m.lista.value[i - 1].enviadoEm.slice(0, 10) !== m.lista.value[i].enviadoEm.slice(0, 10);
const dataDe = (iso: string) => formatarData(new Intl.DateTimeFormat('en-CA', { timeZone: app.fuso }).format(new Date(iso)), app.locale, { day: '2-digit', month: 'long' });
</script>

<template>
  <div class="-m-4 flex h-[calc(100dvh-9rem)] flex-col lg:-m-8 lg:h-dvh">
    <header class="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <h1 class="text-lg font-bold">{{ titulo }}</h1>
      <p v-if="conversa.data.value" class="text-sm text-zinc-500">{{ conversa.data.value.participantes.map((p) => p.nome).join(', ') }}</p>
      <div v-if="!sessao.ehPaciente && (acoes.has('ADICIONAR_PARTICIPANTE') || acoes.has('ARQUIVAR') || acoes.has('REABRIR'))" class="mt-2 flex flex-wrap gap-2">
        <RouterLink v-if="conversa.data.value" :to="`/pacientes/${conversa.data.value.paciente.id}`" class="text-sm text-acao underline">Ver paciente</RouterLink>
        <button v-if="acoes.has('ADICIONAR_PARTICIPANTE')" type="button" class="text-sm text-acao underline" @click="gerenciando = true">Participantes</button>
        <button v-if="acoes.has('ARQUIVAR')" type="button" class="text-sm text-acao underline" @click="arquivar.mutate()">Arquivar</button>
        <button v-if="acoes.has('REABRIR')" type="button" class="text-sm text-acao underline" @click="reabrir.mutate()">Reabrir</button>
      </div>
    </header>
    <div v-if="sessao.ehPaciente && cfgChat.avisoUrgencia" class="flex gap-2 bg-red-50 px-4 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100" role="note">
      <CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {{ cfgChat.avisoUrgencia }}
    </div>

    <div ref="rolagem" class="flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
      <button v-if="m.temAnteriores.value" type="button" class="mx-auto mb-3 block text-sm text-acao underline" :disabled="m.carregandoAnteriores.value" @click="m.carregarAnteriores">Ver mensagens anteriores</button>
      <p v-if="m.carregando.value">{{ t('app.carregando') }}</p>
      <template v-for="(msg, i) in m.lista.value" :key="msg.id">
        <p v-if="novoDia(i)" class="my-3 text-center text-xs text-zinc-500">{{ dataDe(msg.enviadoEm) }}</p>
        <p v-if="msg.tipo === 'SISTEMA'" class="my-2 text-center text-sm text-zinc-500">{{ msg.texto }}</p>
        <div v-else-if="msg.tipo === 'ORIENTACAO'" class="my-2 rounded-xl border border-marca-200 bg-marca-50 p-3 text-sm dark:border-zinc-600 dark:bg-zinc-800">
          <strong class="block text-marca-700 dark:text-marca-200">Orientação da equipe</strong>{{ msg.texto }}
        </div>
        <div v-else class="my-1 flex" :class="m.minhas(msg) ? 'justify-end' : 'justify-start'">
          <div class="max-w-[80%] rounded-2xl px-4 py-2" :class="m.minhas(msg) ? 'bg-acao text-acao-texto' : 'bg-zinc-100 dark:bg-zinc-800'">
            <p v-if="!m.minhas(msg)" class="text-xs font-semibold opacity-80">{{ msg.autor?.nome }}</p>
            <RouterLink v-if="msg.tipo === 'CHECKIN' && msg.referencia" :to="`/checkins/${msg.referencia.id}`" class="block underline">
              {{ msg.referencia.resumo }}<span v-if="!sessao.ehPaciente && msg.referencia.temAlerta" class="ml-1 font-bold">⚠</span>
            </RouterLink>
            <div v-if="msg.anexos.length" class="my-1 flex flex-wrap gap-2">
              <a v-for="a in msg.anexos" :key="a.id" :href="a.urlVisualizacao ?? undefined" target="_blank" rel="noopener noreferrer">
                <img :src="a.urlMiniatura ?? a.urlVisualizacao ?? ''" alt="Foto" class="size-32 rounded-lg object-cover" @error="qc.invalidateQueries({ queryKey: ['mensagens', id] })" />
              </a>
            </div>
            <p v-if="msg.texto" class="whitespace-pre-wrap break-words">{{ msg.texto }}</p>
            <p class="mt-0.5 text-right text-[0.7rem] opacity-70">{{ formatarHora(msg.enviadoEm, app.fuso, app.locale) }}</p>
          </div>
        </div>
      </template>
      <div v-for="p in m.pendentes.value" :key="p.idCliente" class="my-1 flex justify-end">
        <div class="max-w-[80%] rounded-2xl bg-acao/70 px-4 py-2 text-acao-texto">
          <p v-if="p.texto" class="whitespace-pre-wrap break-words">{{ p.texto }}</p>
          <p v-if="p.anexosIds.length">📷 Foto</p>
          <p class="mt-0.5 flex items-center justify-end gap-1 text-[0.7rem]">
            <template v-if="p.estado === 'enviando'"><Clock class="size-3" aria-hidden="true" /> enviando…</template>
            <button v-else type="button" class="flex items-center gap-1 font-semibold underline" @click="m.tentar(p)">
              <RotateCw class="size-3" aria-hidden="true" /> {{ p.erro === 'REDE' ? 'sem conexão — tocar para reenviar' : t(`erros.${p.erro}`, t('erros.DESCONHECIDO')) }}
            </button>
          </p>
        </div>
      </div>
    </div>

    <footer class="border-t border-zinc-200 p-3 dark:border-zinc-700">
      <p v-if="arquivada" class="flex items-center justify-center gap-2 py-2 text-zinc-500"><Archive class="size-4" aria-hidden="true" /> {{ t('erros.CONVERSA_ARQUIVADA') }}</p>
      <template v-else-if="podeEnviar">
        <Aviso v-if="foraDoHorario" tipo="atencao" class="mb-2"><Clock class="inline size-4" /> Fora do horário de atendimento. A equipe responde assim que possível.</Aviso>
        <p v-if="erroFoto" class="mb-2 text-sm text-erro" role="alert"><TriangleAlert class="inline size-4" /> {{ erroFoto }}</p>
        <form class="flex items-end gap-2" @submit.prevent="enviar">
          <button v-if="cfgChat.anexosPermitidos" type="button" class="flex size-12 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-300 dark:border-zinc-600" :disabled="enviandoFoto" aria-label="Enviar foto" @click="entradaFoto?.click()"><Camera class="size-5" /></button>
          <input ref="entradaFoto" type="file" accept="image/*" class="sr-only" aria-label="Escolher foto" @change="escolherFoto" />
          <textarea v-model="texto" rows="1" placeholder="Escreva uma mensagem" aria-label="Mensagem" maxlength="4000"
            class="max-h-32 min-h-12 flex-1 resize-none rounded-xl border-2 border-zinc-300 bg-white px-4 py-3 dark:border-zinc-600 dark:bg-zinc-800" @keydown.enter.exact.prevent="enviar" />
          <button type="submit" class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-acao text-acao-texto disabled:opacity-50" :disabled="!texto.trim()" aria-label="Enviar"><Send class="size-5" /></button>
        </form>
      </template>
    </footer>
    <Dialogo v-model:aberto="gerenciando" titulo="Participantes" descricao="Quem sai deixa de ver a conversa daqui em diante; o histórico fica.">
      <Aviso v-if="adicionar.error.value || remover.error.value" tipo="erro" class="mb-2">{{ msgErro(adicionar.error.value ?? remover.error.value)?.texto }}</Aviso>
      <ul class="flex flex-col gap-1">
        <li v-for="p in conversa.data.value?.participantes ?? []" :key="p.usuarioId" class="flex min-h-11 items-center justify-between">
          <span>{{ p.nome }} <span class="text-sm text-zinc-500">{{ p.perfil.toLowerCase() }}</span></span>
          <Botao v-if="p.perfil !== 'PACIENTE' && acoes.has('REMOVER_PARTICIPANTE') && p.usuarioId !== eu" variante="fantasma" @click="remover.mutate(p.usuarioId)">Remover</Botao>
        </li>
      </ul>
      <template v-if="foraDaConversa.length">
        <p class="mt-3 mb-1 text-sm font-medium">Adicionar</p>
        <Botao v-for="mb in foraDaConversa" :key="mb.id" variante="secundario" class="mr-2 mb-2" @click="adicionar.mutate(mb.id)">{{ mb.nome }}</Botao>
      </template>
    </Dialogo>
  </div>
</template>
