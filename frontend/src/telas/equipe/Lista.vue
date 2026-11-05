<script setup lang="ts">
// Equipe (gestor): membros, convite, perfis e status. Desligar revoga as sessões na hora (RN-EQP-002);
// o último gestor não perde o perfil (RN-EQP-001 → ULTIMO_GESTOR).
import { computed, reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { UserPlus } from 'lucide-vue-next';
import type { Membro } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { comEtag } from '@/dados/etag';
import { criarChave } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Dialogo from '@/ds/Dialogo.vue';

const { t } = useI18n();
const qc = useQueryClient();
const msg = useMensagemErro();
const q = useQuery({ queryKey: ['membros', 'todos'], queryFn: () => ok(api().GET('/v1/equipe/membros', { params: { query: { limite: 100 } } })) });
const PERFIS = [['GESTOR', 'Gestão'], ['PROFISSIONAL', 'Profissional'], ['SECRETARIA', 'Secretaria']] as const;
const STATUS: Record<string, string> = { CONVIDADO: 'Convidado', ATIVO: 'Ativo', SUSPENSO: 'Suspenso', DESLIGADO: 'Desligado' };
const membros = computed(() => (q.data.value?.itens ?? []).filter((m) => m.status !== 'DESLIGADO' || mostrarDesligados.value));
const mostrarDesligados = ref(false);

// Convite.
const convidando = ref(false);
const convite = reactive({ nome: '', email: '', perfis: ['SECRETARIA'] as string[] });
const chave = criarChave();
const convidar = useMutation({
  mutationFn: () => ok(api().POST('/v1/equipe/convites', { params: { header: { 'Idempotency-Key': chave.obter() } }, body: { nome: convite.nome.trim(), email: convite.email.trim().toLowerCase(), perfis: convite.perfis as never } })),
  onSuccess: () => { chave.concluir(); convidando.value = false; Object.assign(convite, { nome: '', email: '', perfis: ['SECRETARIA'] }); void q.refetch(); },
  onError: (e) => { if (e instanceof ErroApi && e.status === 422) chave.concluir(); },
});

// Edição de perfis/status (If-Match com o ETag do membro).
const erroEdicao = ref<unknown>(null);
const editar = useMutation({
  mutationFn: async ({ m, corpo }: { m: Membro; corpo: { perfis?: string[]; status?: string } }) => {
    const atual = await comEtag(api().GET('/v1/equipe/membros/{membroId}', { params: { path: { membroId: m.id } } }));
    return ok(api().PATCH('/v1/equipe/membros/{membroId}', { params: { path: { membroId: m.id }, header: { 'If-Match': atual.etag ?? '' } }, body: corpo as never }));
  },
  onSuccess: () => { erroEdicao.value = null; void q.refetch(); void qc.invalidateQueries({ queryKey: ['membros'] }); },
  onError: (e) => { erroEdicao.value = e; },
});
function alternarPerfil(m: Membro, perfil: string) {
  const perfis = m.perfis.includes(perfil as never) ? m.perfis.filter((p) => p !== perfil) : [...m.perfis, perfil];
  if (perfis.length) editar.mutate({ m, corpo: { perfis } });
}
const confirmandoDesligar = ref<Membro | null>(null);
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">Equipe</h1>
      <Botao @click="convidando = true"><UserPlus class="size-5" aria-hidden="true" /> Convidar</Botao>
    </div>
    <Aviso v-if="erroEdicao" tipo="erro" :detalhe="msg(erroEdicao)?.suporte">{{ msg(erroEdicao)?.texto }}</Aviso>
    <label class="flex items-center gap-2 text-sm"><input v-model="mostrarDesligados" type="checkbox" class="size-5" /> Mostrar desligados</label>
    <p v-if="q.isPending.value">{{ t('app.carregando') }}</p>
    <div v-for="m in membros" :key="m.id" class="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div><p class="font-semibold">{{ m.nome }} <span class="text-sm font-normal text-zinc-500">· {{ STATUS[m.status] ?? m.status }}</span></p>
          <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ m.email }}<span v-if="m.profissional"> · {{ m.profissional.conselho }} {{ m.profissional.numero }}/{{ m.profissional.uf }}</span></p></div>
        <div class="flex flex-wrap gap-2">
          <Botao v-if="m.acoesPermitidas.includes('SUSPENDER')" variante="fantasma" @click="editar.mutate({ m, corpo: { status: 'SUSPENSO' } })">Suspender</Botao>
          <Botao v-if="m.acoesPermitidas.includes('REATIVAR')" variante="secundario" @click="editar.mutate({ m, corpo: { status: 'ATIVO' } })">Reativar</Botao>
          <Botao v-if="m.acoesPermitidas.includes('DESLIGAR')" variante="fantasma" @click="confirmandoDesligar = m">Desligar</Botao>
        </div>
      </div>
      <div v-if="m.acoesPermitidas.includes('EDITAR')" class="flex flex-wrap gap-3" role="group" :aria-label="`Perfis de ${m.nome}`">
        <label v-for="[v, r] in PERFIS" :key="v" class="flex items-center gap-2"><input type="checkbox" class="size-5" :checked="m.perfis.includes(v)" @change="alternarPerfil(m, v)" /> {{ r }}</label>
      </div>
    </div>

    <Dialogo v-model:aberto="convidando" titulo="Convidar para a equipe" descricao="O convite vale por 72 horas e é enviado por e-mail.">
      <form class="flex flex-col gap-3" @submit.prevent="convidar.mutate()">
        <CampoTexto v-model="convite.nome" rotulo="Nome" obrigatorio />
        <CampoTexto v-model="convite.email" rotulo="E-mail" tipo="email" inputmode="email" obrigatorio :erro="convidar.error.value instanceof ErroApi ? convidar.error.value.porCampo().email : null" />
        <fieldset class="flex flex-wrap gap-3"><legend class="mb-1 text-sm font-medium">Perfis</legend>
          <label v-for="[v, r] in PERFIS" :key="v" class="flex items-center gap-2"><input v-model="convite.perfis" type="checkbox" :value="v" class="size-5" /> {{ r }}</label></fieldset>
        <Aviso v-if="convidar.error.value && !(convidar.error.value instanceof ErroApi && convidar.error.value.status === 422)" tipo="erro">{{ msg(convidar.error.value)?.texto }}</Aviso>
        <Botao tipo="submit" bloco :carregando="convidar.isPending.value" :desabilitado="!convite.nome || !convite.email || !convite.perfis.length">Enviar convite</Botao>
      </form>
    </Dialogo>
    <Dialogo :aberto="!!confirmandoDesligar" :titulo="`Desligar ${confirmandoDesligar?.nome ?? ''}?`" descricao="O acesso é encerrado na hora e a pessoa sai das conversas. O que ela registrou continua com a autoria dela." @update:aberto="(v) => !v && (confirmandoDesligar = null)">
      <Botao bloco @click="editar.mutate({ m: confirmandoDesligar!, corpo: { status: 'DESLIGADO' } }); confirmandoDesligar = null">Desligar</Botao>
    </Dialogo>
  </div>
</template>
