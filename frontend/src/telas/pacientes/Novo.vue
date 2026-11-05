<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import type { PacienteEntrada } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { capitalizar, novo } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import FormPaciente from './FormPaciente.vue';
import Aviso from '@/ds/Aviso.vue';

const router = useRouter();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const chave = criarChave();
const errosServidor = ref<Record<string, string>>({});
const m = useMutation({
  mutationFn: (corpo: PacienteEntrada) => ok(api().POST('/v1/pacientes', { params: { header: { 'Idempotency-Key': chave.obter() } }, body: corpo })),
  onSuccess: async (p) => { chave.concluir(); await qc.invalidateQueries({ queryKey: ['pacientes'] }); await router.replace(`/pacientes/${p.id}`); },
  onError: (e) => { if (e instanceof ErroApi && e.status === 422) { chave.concluir(); errosServidor.value = e.porCampo(); } },
});
</script>
<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ capitalizar(novo(termo('paciente'))) }}</h1>
    <Aviso v-if="m.error.value && !(m.error.value instanceof ErroApi && m.error.value.status === 422)" tipo="erro" :detalhe="msg(m.error.value)?.suporte">{{ msg(m.error.value)?.texto }}</Aviso>
    <FormPaciente :enviando="m.isPending.value" :erros-servidor="errosServidor" @salvar="m.mutate" />
  </div>
</template>
