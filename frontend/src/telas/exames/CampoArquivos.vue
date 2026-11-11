<script setup lang="ts">
// Arquivos de um resultado de exame: fotos e PDF (finalidade EXAME). Valor = ids já DISPONIVEL.
// Tipos e tamanho vêm das capacidades do manifesto — sem `application/pdf` lá, o app não oferece PDF.
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FileText, Loader2, Paperclip, X } from 'lucide-vue-next';
import { enviarArquivo, tipoDoArquivo } from '@/dados/arquivos';
import { ErroApi } from '@/api/erros';
import { useSessaoStore } from '@/sessao/store';
import { tamanho } from './util';

const props = withDefaults(defineProps<{ maximo?: number; rotulo: string }>(), { maximo: 10 });
const ids = defineModel<string[]>({ default: () => [] });
/** Upload em andamento: o formulário não deve enviar sem este arquivo. */
const ocupado = defineModel<boolean>('ocupado', { default: false });
const { t } = useI18n();
const sessao = useSessaoStore();
const upload = computed(() => sessao.manifesto?.capacidades.upload);
const tipos = computed(() => upload.value?.tiposPermitidosExame ?? upload.value?.tiposPermitidos ?? ['image/jpeg']);
const aceitaPdf = computed(() => tipos.value.includes('application/pdf'));
const aceita = computed(() => [...tipos.value, ...(aceitaPdf.value ? ['.pdf'] : [])].join(','));
const itens = ref<Record<string, { nome: string; pdf: boolean; previa?: string; bytes: number }>>({});
const enviando = ref<{ nome: string; progresso: number } | null>(null);
const erro = ref<string | null>(null);
const entrada = ref<HTMLInputElement | null>(null);
watch(enviando, (e) => { ocupado.value = !!e; });

async function escolher(e: Event) {
  const arquivo = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!arquivo) return;
  erro.value = null;
  const tipo = tipoDoArquivo(arquivo);
  // Checagem antecipada só para poupar dados móveis; quem decide é o backend.
  if (!tipos.value.includes(tipo)) { erro.value = aceitaPdf.value ? 'Envie uma foto ou um PDF.' : 'Envie uma foto.'; return; }
  const pdf = tipo === 'application/pdf';
  if (pdf && upload.value && arquivo.size > upload.value.tamanhoMaximoBytes) { erro.value = `PDF maior que ${tamanho(upload.value.tamanhoMaximoBytes)}.`; return; }
  enviando.value = { nome: arquivo.name, progresso: 0 };
  try {
    const a = await enviarArquivo(arquivo, 'EXAME', { aoProgresso: (p) => enviando.value && (enviando.value.progresso = p) });
    itens.value[a.id] = { nome: a.nome, pdf, bytes: a.tamanhoBytes, previa: pdf ? undefined : URL.createObjectURL(arquivo) };
    ids.value = [...ids.value, a.id];
  } catch (x) {
    if (x instanceof ErroApi && x.codigo === 'INDISPONIVEL_TEMPORARIAMENTE' && pdf) erro.value = 'O PDF ainda está sendo verificado. Tente de novo em alguns minutos ou envie uma foto.';
    else erro.value = x instanceof ErroApi ? (x.detalhe ?? t(`erros.${x.codigo}`, t('erros.DESCONHECIDO'))) : t('erros.DESCONHECIDO');
  } finally { enviando.value = null; }
}
function remover(id: string) {
  const p = itens.value[id]?.previa;
  if (p) URL.revokeObjectURL(p);
  ids.value = ids.value.filter((x) => x !== id);
}
</script>
<template>
  <div class="flex flex-col gap-3">
    <ul v-if="ids.length" class="flex flex-wrap gap-3" aria-label="Arquivos anexados">
      <li v-for="id in ids" :key="id" class="relative">
        <img v-if="itens[id]?.previa" :src="itens[id].previa" :alt="`Foto: ${itens[id].nome}`" class="size-28 rounded-xl object-cover" />
        <div v-else class="flex size-28 flex-col items-center justify-center gap-1 rounded-xl bg-zinc-100 p-2 text-center text-xs dark:bg-zinc-700">
          <FileText class="size-8" aria-hidden="true" /><span class="line-clamp-2 break-all">{{ itens[id]?.nome ?? 'Arquivo' }}</span><span v-if="itens[id]" class="text-secundario">{{ tamanho(itens[id].bytes) }}</span>
        </div>
        <button type="button" class="absolute -top-2 -right-2 rounded-full bg-zinc-900 p-1.5 text-white" :aria-label="`Remover ${itens[id]?.nome ?? 'arquivo'}`" @click="remover(id)"><X class="size-4" /></button>
      </li>
    </ul>
    <p v-if="enviando" class="flex items-center gap-2 text-sm" role="status"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Enviando {{ enviando.nome }}… {{ Math.round(enviando.progresso * 100) }}%</p>
    <p v-if="erro" class="text-sm text-erro" role="alert">{{ erro }}</p>
    <button v-if="!enviando && ids.length < props.maximo" type="button" class="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-acao px-3 font-semibold text-acao" @click="entrada?.click()">
      <Paperclip class="size-6" aria-hidden="true" /> {{ ids.length ? 'Adicionar outro arquivo' : aceitaPdf ? 'Tirar foto ou escolher foto/PDF' : 'Tirar ou escolher foto' }}
    </button>
    <p class="text-xs text-secundario">{{ aceitaPdf ? 'Fotos ou PDF' : 'Somente fotos' }}, até {{ props.maximo }} arquivos.<template v-if="upload"> Máximo de {{ tamanho(upload.tamanhoMaximoBytes) }} por arquivo.</template></p>
    <input ref="entrada" type="file" :accept="aceita" class="sr-only" :aria-label="rotulo" @change="escolher" />
  </div>
</template>
