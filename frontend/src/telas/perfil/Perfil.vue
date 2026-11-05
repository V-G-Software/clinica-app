<script setup lang="ts">
// FE0: dados da conta, troca de perfil e saída. Preferências e push na FE1.
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import type { Perfil } from '@clinica/contrato-tipos';
import { useSessaoStore } from '@/sessao/store';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';

const { t } = useI18n();
const sessao = useSessaoStore();
const router = useRouter();
const qc = useQueryClient();
async function trocar(p: string) {
  await sessao.trocarPerfil(p as Perfil);
  qc.clear(); // dados visíveis mudam com o perfil
  await router.replace('/');
}
async function sair(todas: boolean) {
  await sessao.sair(todas);
  qc.clear();
  await router.replace('/entrar');
}
</script>
<template>
  <div v-if="sessao.manifesto" class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ sessao.manifesto.usuario.nomeExibicao }}</h1>
    <p class="text-zinc-600 dark:text-zinc-300">{{ sessao.manifesto.usuario.email }}</p>
    <Cartao v-if="sessao.manifesto.perfisDisponiveis.length > 1">
      <h2 class="mb-2 font-bold">{{ t('nav.trocarPerfil') }}</h2>
      <div class="flex flex-wrap gap-2">
        <Botao v-for="p in sessao.manifesto.perfisDisponiveis" :key="p.id" :variante="p.id === sessao.perfil ? 'primario' : 'secundario'" :desabilitado="p.id === sessao.perfil" @click="trocar(p.id)">{{ p.rotulo }}</Botao>
      </div>
    </Cartao>
    <Botao variante="secundario" @click="sair(false)">{{ t('app.sair') }}</Botao>
    <Botao variante="fantasma" @click="sair(true)">Sair de todos os aparelhos</Botao>
  </div>
</template>
