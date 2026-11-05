<script setup lang="ts">
// Ferramentas de desenvolvimento (só em DEV; removidas do build de produção):
// trocar de organização e avançar o relógio do mock. Rotas /__mock nunca existem em produção.
import { ref } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { Wrench } from 'lucide-vue-next';
import { useSessaoStore } from '@/sessao/store';

const aberto = ref(false);
const status = ref('');
const qc = useQueryClient();
const sessao = useSessaoStore();
const mock = new URL(import.meta.env.VITE_DIRETORIO_URL ?? 'http://localhost:4010/diretorio').origin;
async function avancar(corpo: Record<string, number>) {
  const r = await fetch(`${mock}/__mock/relogio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then((x) => x.json());
  status.value = `Relógio: ${r.agora} (${r.jobsExecutados} jobs)`;
  if (sessao.logado) { await sessao.carregarManifesto().catch(() => undefined); await qc.invalidateQueries(); }
}
async function reiniciar() { await fetch(`${mock}/__mock/reiniciar`, { method: 'POST' }); location.reload(); }
</script>
<template>
  <div class="fixed right-3 bottom-24 z-40 lg:bottom-3">
    <button type="button" class="rounded-full bg-zinc-900 p-3 text-white shadow-lg" aria-label="Ferramentas de desenvolvimento" @click="aberto = !aberto"><Wrench class="size-5" /></button>
    <div v-if="aberto" class="absolute right-0 bottom-14 flex w-72 flex-col gap-2 rounded-xl bg-zinc-900 p-3 text-sm text-white shadow-xl">
      <strong>Organização</strong>
      <div class="flex flex-wrap gap-1">
        <a v-for="s in ['modelo-otorrino', 'fisio-movimento', 'vet-amigo']" :key="s" :href="`/?org=${s}`" class="rounded bg-zinc-700 px-2 py-1">{{ s }}</a>
      </div>
      <strong>Relógio do mock</strong>
      <div class="flex gap-1">
        <button class="rounded bg-zinc-700 px-2 py-1" @click="avancar({ avancarHoras: 1 })">+1 h</button>
        <button class="rounded bg-zinc-700 px-2 py-1" @click="avancar({ avancarHoras: 6 })">+6 h</button>
        <button class="rounded bg-zinc-700 px-2 py-1" @click="avancar({ avancarDias: 1 })">+1 dia</button>
        <button class="rounded bg-red-700 px-2 py-1" @click="reiniciar">Reiniciar</button>
      </div>
      <p v-if="status" class="text-xs text-zinc-300">{{ status }}</p>
    </div>
  </div>
</template>
