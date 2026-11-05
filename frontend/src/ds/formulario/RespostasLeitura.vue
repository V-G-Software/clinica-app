<script setup lang="ts">
// Respostas já enviadas (somente leitura). Opções mostram o rótulo, não o valor técnico.
import type { CampoFormulario } from '@clinica/contrato-tipos';
const props = defineProps<{ campos: CampoFormulario[]; respostas: Record<string, unknown>; fotos?: Array<{ id: string; urlMiniatura: string | null; urlVisualizacao: string | null }>; destacar?: string[] }>();
function legivel(c: CampoFormulario, v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (c.opcoes) return (Array.isArray(v) ? v : [v]).map((x) => c.opcoes!.find((o) => o.valor === x)?.rotulo ?? String(x)).join(', ');
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return `${String(v).replace('.', ',')}${c.unidade ? ` ${c.unidade}` : ''}`;
  return String(v);
}
const fotosDe = (v: unknown) => (Array.isArray(v) ? (v as string[]).map((id) => props.fotos?.find((f) => f.id === id)).filter(Boolean) : []);
</script>
<template>
  <dl class="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-700">
    <template v-for="c in campos" :key="c.id">
      <div v-if="c.tipo !== 'INFORMACAO' && respostas[c.id] !== undefined" class="py-3" :class="destacar?.includes(c.id) && 'rounded-lg bg-red-50 px-3 dark:bg-red-950'">
        <dt class="text-sm text-zinc-600 dark:text-zinc-300">{{ c.rotulo }}</dt>
        <dd v-if="c.tipo !== 'FOTO'" class="font-semibold">{{ legivel(c, respostas[c.id]) }}</dd>
        <dd v-else class="mt-1 flex flex-wrap gap-2">
          <a v-for="f in fotosDe(respostas[c.id])" :key="f!.id" :href="f!.urlVisualizacao ?? undefined" target="_blank" rel="noopener noreferrer">
            <img :src="f!.urlMiniatura ?? f!.urlVisualizacao ?? ''" alt="Foto enviada" class="size-24 rounded-lg object-cover" />
          </a>
        </dd>
      </div>
    </template>
  </dl>
</template>
