<script setup lang="ts">
import { defineAsyncComponent, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '@/app/store';
import { iniciar } from '@/app/inicializacao';
import { useSessaoStore } from '@/sessao/store';
import TelaCheia from '@/ds/TelaCheia.vue';
import Botao from '@/ds/Botao.vue';
import { Loader2, WifiOff } from 'lucide-vue-next';

const { t } = useI18n();
const app = useAppStore();
const sessao = useSessaoStore();
const router = useRouter();
const rota = useRoute();
const EscolherOrganizacao = defineAsyncComponent(() => import('@/telas/sistema/EscolherOrganizacao.vue'));
const DevFerramentas = import.meta.env.DEV ? defineAsyncComponent(() => import('@/dev/DevFerramentas.vue')) : null;

onMounted(async () => {
  window.addEventListener('online', () => (app.online = true));
  window.addEventListener('offline', () => (app.online = false));
});
async function tentarDeNovo() {
  await iniciar();
  if (app.estado === 'pronto') await router.replace(rota.fullPath);
}
// Sessão perdida (revogada/expirada): volta ao login com aviso.
watch(() => sessao.logado, (logado, antes) => {
  if (antes && !logado && !rota.meta.publica) router.replace({ path: '/entrar', query: { voltar: rota.fullPath } });
});
let tentativa: ReturnType<typeof setInterval> | undefined;
watch(() => app.estado, (e) => {
  clearInterval(tentativa);
  if (e === 'manutencao') tentativa = setInterval(tentarDeNovo, 60_000);
});
const recarregar = () => location.reload();
</script>

<template>
  <div v-if="!app.online" class="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-zinc-800 py-1.5 text-sm text-white" role="status">
    <WifiOff class="size-4" aria-hidden="true" /> {{ t('app.semConexao') }}
  </div>
  <RouterView v-if="app.estado === 'pronto'" />
  <TelaCheia v-else-if="app.estado === 'carregando'" :titulo="t('app.carregando')">
    <template #icone><Loader2 class="size-10 animate-spin text-marca-500" aria-hidden="true" /></template>
  </TelaCheia>
  <EscolherOrganizacao v-else-if="app.estado === 'escolher-organizacao'" />
  <TelaCheia v-else-if="app.estado === 'nao-encontrada'" :titulo="t('sistema.naoEncontradaTitulo')" :texto="t('sistema.naoEncontradaTexto')" />
  <TelaCheia v-else-if="app.estado === 'manutencao'" :titulo="t('sistema.manutencaoTitulo')" :texto="app.mensagem ?? t('sistema.manutencaoTexto')" />
  <TelaCheia v-else-if="app.estado === 'suspensa'" :titulo="t('sistema.suspensaTitulo')" :texto="t('sistema.suspensaTexto', { organizacao: app.organizacao?.nome ?? '' })" />
  <TelaCheia v-else-if="app.estado === 'atualizar'" :titulo="t('sistema.atualizeTitulo')" :texto="t('sistema.atualizeTexto')">
    <Botao @click="recarregar">{{ t('app.atualizar') }}</Botao>
  </TelaCheia>
  <TelaCheia v-else :titulo="t('sistema.erroInicio')">
    <Botao @click="tentarDeNovo">{{ t('app.tentarDeNovo') }}</Botao>
  </TelaCheia>
  <component :is="DevFerramentas" v-if="DevFerramentas" />
</template>
