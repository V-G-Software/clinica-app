<script setup lang="ts">
// Certificado em nuvem (PSC) usado para assinar. Lista vazia = o servidor não tem provedor configurado:
// não há como assinar (falha fechada) e o app explica em vez de esconder o botão sem motivo.
import { computed, watchEffect } from 'vue';
import { useSessaoStore } from '@/sessao/store';
import { artigo } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Aviso from '@/ds/Aviso.vue';
import Selecao from '@/ds/Selecao.vue';
import { provedorLembrado } from './util';

const provedor = defineModel<string>({ default: '' });
const sessao = useSessaoStore();
const termo = useTermos();
const provedores = computed(() => (sessao.manifesto?.capacidades as any)?.assinatura?.provedores as Array<{ id: string; nome: string }> | undefined ?? []);
watchEffect(() => {
  if (provedor.value && provedores.value.some((p) => p.id === provedor.value)) return;
  const lembrado = provedorLembrado();
  provedor.value = provedores.value.find((p) => p.id === lembrado)?.id ?? (provedores.value.length === 1 ? provedores.value[0].id : '');
});
</script>
<template>
  <Aviso v-if="!provedores.length" tipo="atencao">A assinatura digital ainda não está disponível n{{ artigo(termo('organizacao')) }} {{ termo('organizacao').singular }}: falta configurar o provedor de certificado em nuvem. Os rascunhos ficam guardados.</Aviso>
  <Selecao v-else-if="provedores.length > 1" v-model="provedor" rotulo="Certificado digital" vazio="Escolha…" :opcoes="provedores.map((p) => ({ valor: p.id, rotulo: p.nome }))" />
  <p v-else class="text-sm text-secundario">Certificado digital: <strong>{{ provedores[0].nome }}</strong></p>
</template>
