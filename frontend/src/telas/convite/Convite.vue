<script setup lang="ts">
// Aceite de convite (4.3): dados mínimos do convite, e-mail e termos. Depois, onboarding.
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { useFluxoLoginStore } from '@/sessao/fluxo-login';
import { formatarDataHora } from '@/i18n/datas';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Aviso from '@/ds/Aviso.vue';
import TelaCheia from '@/ds/TelaCheia.vue';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const fluxo = useFluxoLoginStore();
const token = computed(() => String(rota.params.token));
const convite = useQuery({ queryKey: ['convite', token], queryFn: () => ok(api().GET('/v1/publico/convites/{token}', { params: { path: { token: token.value } } })), retry: false });
const email = ref('');
const aceito = ref(false);
const enviando = ref(false);
const erro = ref<ErroApi | null>(null);

async function aceitar() {
  enviando.value = true; erro.value = null;
  try {
    if (sessao.logado) await sessao.sair(false); // convite é para outra conta, ou a mesma pessoa entrando de novo
    const r = await ok(api().POST('/v1/auth/convites/{token}/aceitar', { params: { path: { token: token.value } }, body: { email: email.value.trim().toLowerCase(), termosVersao: app.config!.autenticacao.termosVersao } }));
    const destino = convite.data.value?.tipo === 'PACIENTE' ? '/bem-vindo' : '/';
    if (r.etapa === 'CONCLUIDO') { await sessao.concluirLogin({ tokenAcesso: r.tokenAcesso!, expiraEm: r.expiraEm! }); await router.replace(destino); return; }
    fluxo.pendente = { resposta: r, email: email.value.trim().toLowerCase(), destino };
    await router.replace('/entrar');
  } catch (e) { erro.value = e instanceof ErroApi ? e : new ErroApi(0, 'DESCONHECIDO', null); }
  finally { enviando.value = false; }
}
</script>
<template>
  <TelaCheia v-if="convite.error.value" :titulo="t(`erros.${(convite.error.value as ErroApi).codigo}`, t('erros.CONVITE_INVALIDO'))" :texto="app.config?.organizacao.nome ? `Fale com a ${app.config.organizacao.nome} para receber um novo convite.` : null" />
  <main v-else class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10">
    <h1 class="text-2xl font-bold text-marca-700 dark:text-marca-200">{{ app.nome }}</h1>
    <p v-if="convite.isPending.value">{{ t('app.carregando') }}</p>
    <template v-else-if="convite.data.value">
      <p class="text-lg">Olá, <strong>{{ convite.data.value.nomeParcial }}</strong>! Você foi {{ convite.data.value.tipo === 'EQUIPE' ? 'convidado para a equipe' : 'convidado para o app' }} da {{ convite.data.value.organizacao.nome }}.</p>
      <p v-if="convite.data.value.emailMascarado" class="text-sm text-zinc-600 dark:text-zinc-300">Confirme o e-mail do convite ({{ convite.data.value.emailMascarado }}). O convite vale até {{ formatarDataHora(convite.data.value.expiraEm, app.fuso, app.locale) }}.</p>
      <Aviso v-if="erro" tipo="erro">{{ t(`erros.${erro.codigo}`, t('erros.DESCONHECIDO')) }}</Aviso>
      <form class="flex flex-col gap-4" @submit.prevent="aceitar">
        <CampoTexto v-model="email" :rotulo="t('auth.email')" tipo="email" autocomplete="email" inputmode="email" obrigatorio :erro="erro?.porCampo().email" />
        <label class="flex items-start gap-3">
          <input v-model="aceito" type="checkbox" class="mt-1 size-5" />
          <span>Li e aceito os <a :href="app.config?.links.termosDeUso" target="_blank" rel="noopener noreferrer" class="text-acao underline">termos de uso</a> e a <a :href="app.config?.links.privacidade" target="_blank" rel="noopener noreferrer" class="text-acao underline">política de privacidade</a>.</span>
        </label>
        <Botao tipo="submit" bloco :carregando="enviando" :desabilitado="!aceito || !email">{{ t('app.continuar') }}</Botao>
      </form>
    </template>
  </main>
</template>
