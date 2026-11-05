<script setup lang="ts">
// Casca do app: menu vindo do manifesto. Celular: barra inferior (PRINCIPAL) + "Mais".
// Desktop (lg+): lateral com os dois grupos. Badges vêm de `contadores`.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { Ellipsis, X } from 'lucide-vue-next';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import Icone from '@/ds/Icone.vue';
import Badge from '@/ds/Badge.vue';

const { t } = useI18n();
const app = useAppStore();
const sessao = useSessaoStore();
const rota = useRoute();
const maisAberto = ref(false);
const contadores = computed(() => (sessao.manifesto?.contadores ?? {}) as Record<string, number>);
const valor = (chave?: string) => (chave ? contadores.value[chave] ?? 0 : 0);
const ativo = (caminho: string) => (caminho === '/' ? rota.path === '/' : rota.path.startsWith(caminho));
const totalMais = computed(() => sessao.menu.secundario.reduce((s, i) => s + valor(i.contador), 0));
const logo = computed(() => app.config?.tema.logoUrl);
</script>

<template>
  <div class="min-h-dvh lg:flex">
    <!-- Lateral (desktop) -->
    <nav class="hidden w-64 shrink-0 flex-col gap-1 border-r border-zinc-200 p-4 lg:flex dark:border-zinc-700" :aria-label="t('nav.menu')">
      <div class="mb-4 flex items-center gap-2 px-2">
        <img v-if="logo" :src="logo" alt="" class="size-8 rounded" @error="($event.target as HTMLImageElement).style.display = 'none'" />
        <span class="font-bold text-marca-700 dark:text-marca-200">{{ app.nome }}</span>
      </div>
      <template v-for="(grupo, i) in [sessao.menu.principal, sessao.menu.secundario]" :key="i">
        <hr v-if="i === 1 && grupo.length" class="my-2 border-zinc-200 dark:border-zinc-700" />
        <RouterLink v-for="item in grupo" :key="item.id" :to="item.caminho"
          class="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-marca-50 dark:hover:bg-zinc-800"
          :class="ativo(item.caminho) && 'bg-marca-100 text-marca-800 dark:bg-zinc-800 dark:text-marca-200'" :aria-current="ativo(item.caminho) ? 'page' : undefined">
          <Icone :nome="item.icone" class="size-5" /> <span class="flex-1">{{ item.rotulo }}</span>
          <Badge :valor="valor(item.contador)" :rotulo="`${valor(item.contador)}`" />
        </RouterLink>
      </template>
    </nav>

    <div class="flex min-h-dvh flex-1 flex-col pb-20 lg:pb-0">
      <header class="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur lg:hidden dark:border-zinc-700 dark:bg-zinc-900/90">
        <img v-if="logo" :src="logo" alt="" class="size-7 rounded" @error="($event.target as HTMLImageElement).style.display = 'none'" />
        <span class="font-bold text-marca-700 dark:text-marca-200">{{ app.nome }}</span>
      </header>
      <main class="mx-auto w-full max-w-5xl flex-1 p-4 lg:p-8"><RouterView /></main>
    </div>

    <!-- Barra inferior (celular) -->
    <nav class="fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden dark:border-zinc-700 dark:bg-zinc-900" :aria-label="t('nav.menu')">
      <RouterLink v-for="item in sessao.menu.principal" :key="item.id" :to="item.caminho"
        class="relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium"
        :class="ativo(item.caminho) ? 'text-acao' : 'text-secundario dark:text-zinc-400'" :aria-current="ativo(item.caminho) ? 'page' : undefined">
        <Icone :nome="item.icone" class="size-6" /><span class="max-w-full truncate px-1">{{ item.rotulo }}</span>
        <span class="absolute top-1.5 left-1/2 ml-2"><Badge :valor="valor(item.contador)" :rotulo="`${valor(item.contador)}`" /></span>
      </RouterLink>
      <button v-if="sessao.menu.secundario.length" type="button" class="relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-secundario dark:text-zinc-400"
        :aria-expanded="maisAberto" @click="maisAberto = true">
        <Ellipsis class="size-6" aria-hidden="true" /><span>{{ t('app.mais') }}</span>
        <span class="absolute top-1.5 left-1/2 ml-2"><Badge :valor="totalMais" :rotulo="`${totalMais}`" /></span>
      </button>
    </nav>

    <!-- Menu "Mais" -->
    <div v-if="maisAberto" class="fixed inset-0 z-30 bg-black/40 lg:hidden" @click.self="maisAberto = false">
      <div class="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:bg-zinc-900" role="dialog" aria-modal="true" :aria-label="t('app.mais')">
        <div class="mb-2 flex justify-end"><button type="button" class="p-2" :aria-label="t('app.voltar')" @click="maisAberto = false"><X class="size-6" /></button></div>
        <RouterLink v-for="item in sessao.menu.secundario" :key="item.id" :to="item.caminho" class="flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium hover:bg-marca-50 dark:hover:bg-zinc-800" @click="maisAberto = false">
          <Icone :nome="item.icone" class="size-5" /><span class="flex-1">{{ item.rotulo }}</span>
          <Badge :valor="valor(item.contador)" :rotulo="`${valor(item.contador)}`" />
        </RouterLink>
      </div>
    </div>
  </div>
</template>
