<script setup lang="ts">
// Onboarding do paciente (11.3), pensado para a consulta, com a secretária ao lado:
// instalar o app → ativar notificações → onde ficam o check-in e a conversa. Tudo pode ser pulado.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Bell, CircleCheck, Share, SquarePlus } from 'lucide-vue-next';
import { useSessaoStore } from '@/sessao/store';
import { ativarPush, ehIos, estadoPush, instalado, type EstadoPush } from '@/pwa/push';
import { capitalizar } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';

const router = useRouter();
const sessao = useSessaoStore();
const termo = useTermos();
const passo = ref<'instalar' | 'notificacoes' | 'pronto'>(instalado() ? 'notificacoes' : 'instalar');
const push = ref<EstadoPush>('indisponivel');
const ios = ehIos();
let promptInstalacao: (Event & { prompt?: () => Promise<void> }) | null = null;
const podeInstalarDireto = ref(false);
onMounted(async () => {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalacao = e; podeInstalarDireto.value = true; });
  const m = sessao.manifesto!;
  push.value = await estadoPush(m.usuario.id, m.capacidades.push.modo).catch(() => 'indisponivel' as const);
});
async function instalar() { await promptInstalacao?.prompt?.(); passo.value = 'notificacoes'; }
async function ativar() {
  const m = sessao.manifesto!;
  push.value = await ativarPush(m.usuario.id, m.capacidades.push.chavePublicaVapid ?? '').catch(() => 'negado' as const);
  passo.value = 'pronto';
}
const titulo = computed(() => ({ instalar: 'Instale o app', notificacoes: 'Ative as notificações', pronto: 'Tudo pronto!' })[passo.value]);
</script>
<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10">
    <p class="text-sm font-medium text-zinc-500">Passo {{ passo === 'instalar' ? 1 : passo === 'notificacoes' ? 2 : 3 }} de 3</p>
    <h1 class="text-2xl font-bold">{{ titulo }}</h1>

    <template v-if="passo === 'instalar'">
      <p>Com o app na tela de início, fica mais fácil responder {{ termo('checkin').plural }} e receber avisos da equipe.</p>
      <Botao v-if="podeInstalarDireto" bloco @click="instalar">Instalar agora</Botao>
      <ol v-else-if="ios" class="flex flex-col gap-3">
        <li class="flex items-center gap-3"><Share class="size-6 shrink-0" aria-hidden="true" /> Toque em <strong>Compartilhar</strong> na barra do Safari.</li>
        <li class="flex items-center gap-3"><SquarePlus class="size-6 shrink-0" aria-hidden="true" /> Escolha <strong>Adicionar à Tela de Início</strong>.</li>
        <li class="flex items-center gap-3"><CircleCheck class="size-6 shrink-0" aria-hidden="true" /> Abra o app pelo novo ícone.</li>
      </ol>
      <p v-else>No menu do navegador, escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</p>
      <Botao variante="fantasma" @click="passo = 'notificacoes'">Agora não</Botao>
    </template>

    <template v-else-if="passo === 'notificacoes'">
      <p class="flex gap-3"><Bell class="size-6 shrink-0 text-acao" aria-hidden="true" /> Avisamos quando {{ termo('checkin').genero === 'F' ? 'a' : 'o' }} {{ termo('checkin').singular }} do dia estiver disponível e quando a equipe responder. Sem conteúdo do seu tratamento na notificação.</p>
      <Botao v-if="push === 'inativo'" bloco @click="ativar">Ativar notificações</Botao>
      <p v-else-if="push === 'precisa-instalar'" class="text-sm">No iPhone, primeiro adicione o app à Tela de Início (passo anterior).</p>
      <p v-else class="text-sm text-zinc-600">Neste aparelho, avisaremos por e-mail.</p>
      <Botao variante="fantasma" @click="passo = 'pronto'">Agora não</Botao>
    </template>

    <template v-else>
      <p>{{ capitalizar(termo('checkin').plural) }} aparecem no início, todo dia. Para falar com a equipe, use <strong>{{ capitalizar(termo('conversa').plural) }}</strong>.</p>
      <Botao bloco @click="router.replace('/')">Começar</Botao>
    </template>
  </main>
</template>
