<script setup lang="ts">
// Fotos de um campo FOTO: valor = lista de arquivoId já DISPONIVEL.
import { ref } from 'vue';
import { Camera, Loader2, X } from 'lucide-vue-next';
import { enviarArquivo } from '@/dados/arquivos';
import { ErroApi } from '@/api/erros';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ maximo?: number; finalidade?: 'CHECKIN' | 'CHAT'; rotulo: string }>();
const ids = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const previas = ref<Record<string, string>>({});
const enviando = ref<{ nome: string; progresso: number } | null>(null);
const erro = ref<string | null>(null);
const entrada = ref<HTMLInputElement | null>(null);

async function escolher(e: Event) {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!arquivo) return;
  erro.value = null;
  enviando.value = { nome: arquivo.name, progresso: 0 };
  try {
    const a = await enviarArquivo(arquivo, props.finalidade ?? 'CHECKIN', { aoProgresso: (p) => enviando.value && (enviando.value.progresso = p) });
    previas.value[a.id] = URL.createObjectURL(arquivo); // prévia local; a URL assinada vale só 5 min
    ids.value = [...ids.value, a.id];
  } catch (x) {
    erro.value = x instanceof ErroApi ? (x.detalhe ?? t(`erros.${x.codigo}`, t('erros.DESCONHECIDO'))) : t('erros.DESCONHECIDO');
  } finally { enviando.value = null; }
}
function remover(id: string) { ids.value = ids.value.filter((x) => x !== id); }
</script>
<template>
  <div class="flex flex-col gap-3">
    <ul v-if="ids.length" class="flex flex-wrap gap-3">
      <li v-for="id in ids" :key="id" class="relative">
        <img v-if="previas[id]" :src="previas[id]" alt="Foto enviada" class="size-28 rounded-xl object-cover" />
        <div v-else class="flex size-28 items-center justify-center rounded-xl bg-zinc-100 text-sm dark:bg-zinc-700">Foto</div>
        <button type="button" class="absolute -top-2 -right-2 rounded-full bg-zinc-900 p-1.5 text-white" :aria-label="`Remover foto`" @click="remover(id)"><X class="size-4" /></button>
      </li>
    </ul>
    <p v-if="enviando" class="flex items-center gap-2 text-sm" role="status"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Enviando… {{ Math.round(enviando.progresso * 100) }}%</p>
    <p v-if="erro" class="text-sm text-erro" role="alert">{{ erro }}</p>
    <button v-if="!enviando && (!maximo || ids.length < maximo)" type="button" class="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-acao font-semibold text-acao" @click="entrada?.click()">
      <Camera class="size-6" aria-hidden="true" /> {{ ids.length ? 'Adicionar outra foto' : 'Tirar ou escolher foto' }}
    </button>
    <input ref="entrada" type="file" accept="image/*" class="sr-only" :aria-label="rotulo" @change="escolher" />
  </div>
</template>
