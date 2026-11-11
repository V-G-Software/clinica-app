<script setup lang="ts">
// Conteúdo do rascunho (receita ou atestado). Usado em "novo" e na edição do detalhe.
import { Plus, Trash2 } from 'lucide-vue-next';
import { artigo, capitalizar } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Cartao from '@/ds/Cartao.vue';
import type { FormAtestado, FormReceita } from './util';

defineProps<{ tipo: 'RECEITA' | 'ATESTADO' }>();
const receita = defineModel<FormReceita>('receita', { required: true });
const atestado = defineModel<FormAtestado>('atestado', { required: true });
const termo = useTermos();
const area = 'rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800';
</script>
<template>
  <div v-if="tipo === 'RECEITA'" class="flex flex-col gap-3">
    <Aviso tipo="atencao">Receita simples. Medicamentos de controle especial (Portaria 344/98) e antimicrobianos não são emitidos pelo app.</Aviso>
    <Cartao v-for="(item, i) in receita.itens" :key="i" class="flex flex-col gap-2">
      <div class="flex items-end gap-2">
        <CampoTexto v-model="item.medicamento" :rotulo="`Medicamento ${i + 1}`" :maxlength="200" ajuda="Nome, concentração e forma. Ex.: Amoxicilina 500 mg, cápsula." class="flex-1" />
        <button v-if="receita.itens.length > 1" type="button" class="mb-6 flex size-11 shrink-0 items-center justify-center rounded-lg border-2 border-zinc-300" :aria-label="`Remover medicamento ${i + 1}`" @click="receita.itens.splice(i, 1)"><Trash2 class="size-5" /></button>
      </div>
      <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Posologia {{ i + 1 }}</span>
        <textarea v-model="item.posologia" rows="2" maxlength="500" :class="area" placeholder="Ex.: 1 cápsula de 8 em 8 horas por 7 dias." /></label>
      <CampoTexto v-model="item.quantidade" :rotulo="`Quantidade ${i + 1} (opcional)`" :maxlength="100" ajuda="Ex.: 1 caixa ou 21 cápsulas." />
    </Cartao>
    <Botao v-if="receita.itens.length < 20" variante="fantasma" @click="receita.itens.push({ medicamento: '', posologia: '', quantidade: '' })"><Plus class="size-5" aria-hidden="true" /> Adicionar medicamento</Botao>
    <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Orientações (opcional)</span>
      <textarea v-model="receita.orientacoes" rows="2" maxlength="2000" :class="area" /></label>
  </div>

  <div v-else class="flex flex-col gap-3">
    <div class="flex gap-2" role="group" aria-label="Tipo de atestado">
      <button v-for="[v, r] in [['AFASTAMENTO', 'Afastamento'], ['COMPARECIMENTO', 'Comparecimento']] as const" :key="v" type="button" class="min-h-11 flex-1 rounded-xl border-2 px-3 font-medium" :class="atestado.modalidade === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="atestado.modalidade === v" @click="atestado.modalidade = v">{{ r }}</button>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <CampoTexto v-model="atestado.data" :rotulo="atestado.modalidade === 'AFASTAMENTO' ? 'A partir de' : 'Data'" tipo="date" />
      <CampoTexto v-if="atestado.modalidade === 'AFASTAMENTO'" v-model="atestado.dias" rotulo="Dias" tipo="number" inputmode="numeric" />
    </div>
    <div v-if="atestado.modalidade === 'COMPARECIMENTO'" class="grid grid-cols-2 gap-3">
      <CampoTexto v-model="atestado.horaInicio" rotulo="Das" tipo="time" />
      <CampoTexto v-model="atestado.horaFim" rotulo="Às" tipo="time" />
    </div>
    <Cartao class="flex flex-col gap-2">
      <CampoTexto v-model="atestado.cid" rotulo="CID (opcional)" :maxlength="6" ajuda="Só com a autorização expressa do paciente (CFM 1.658/2002)." />
      <label v-if="atestado.cid.trim()" class="flex items-start gap-3"><input v-model="atestado.cidAutorizado" type="checkbox" class="mt-0.5 size-5 shrink-0" />
        <span>{{ capitalizar(artigo(termo('paciente'))) }} {{ termo('paciente').singular }} autorizou expressamente incluir o CID</span></label>
    </Cartao>
    <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Observações (opcional)</span>
      <textarea v-model="atestado.observacoes" rows="2" maxlength="1000" :class="area" /></label>
  </div>
</template>
