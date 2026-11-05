<script setup lang="ts">
// Paciente: responde passo a passo. Equipe (e paciente depois de responder): leitura das respostas.
// Nunca mostra alerta ou interpretação clínica para o paciente.
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { CircleCheck } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { capitalizar } from '@/i18n/termos';
import { criarChave, useTermos } from '@/dados/util';
import FormularioPassoAPasso from '@/ds/formulario/FormularioPassoAPasso.vue';
import RespostasLeitura from '@/ds/formulario/RespostasLeitura.vue';
import Aviso from '@/ds/Aviso.vue';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const qc = useQueryClient();
const id = computed(() => String(rota.params.checkinId));
const { data: checkin, isPending, error } = useQuery({ queryKey: ['checkin', id], queryFn: () => ok(api().GET('/v1/checkins/{checkinId}', { params: { path: { checkinId: id.value } } })) });
const podeResponder = computed(() => checkin.value?.acoesPermitidas.includes('RESPONDER'));
const enviado = ref(false);
const errosServidor = ref<Record<string, string>>({});
const form = ref<InstanceType<typeof FormularioPassoAPasso> | null>(null);
const chave = criarChave();

const envio = useMutation({
  mutationFn: (respostas: Record<string, unknown>) => ok(api().POST('/v1/checkins/{checkinId}/respostas', {
    params: { path: { checkinId: id.value }, header: { 'Idempotency-Key': chave.obter() } },
    body: { respostas: respostas as never },
  })),
  onSuccess: (c) => {
    chave.concluir();
    qc.setQueryData(['checkin', id], c);
    void qc.invalidateQueries({ queryKey: ['inicio'] });
    void qc.invalidateQueries({ queryKey: ['acompanhamento', c.acompanhamentoId] });
    enviado.value = true;
  },
  onError: (e) => {
    if (!(e instanceof ErroApi)) return;
    if (e.codigo === 'VALIDACAO_FALHOU') {
      chave.concluir(); // corpo vai mudar: nova operação
      errosServidor.value = e.porCampo('respostas');
      const [campo, msg] = Object.entries(errosServidor.value)[0] ?? [];
      if (campo) form.value?.irParaErro(campo, msg);
    }
    if (e.codigo === 'CHECKIN_JA_RESPONDIDO' || e.codigo === 'CHECKIN_INDISPONIVEL') { chave.concluir(); void qc.invalidateQueries({ queryKey: ['checkin', id] }); }
  },
});
const erroEnvio = computed(() => (envio.error.value instanceof ErroApi && envio.error.value.codigo !== 'VALIDACAO_FALHOU' ? envio.error.value : null));
const alertaCampos = computed(() => (checkin.value?.alertas ?? []).map(() => '') as string[]);
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-4">
    <p v-if="isPending">{{ t('app.carregando') }}</p>
    <Aviso v-else-if="error" tipo="erro">{{ t(`erros.${(error as ErroApi).codigo}`, t('erros.DESCONHECIDO')) }}</Aviso>
    <template v-else-if="checkin">
      <header>
        <h1 class="text-2xl font-bold">{{ capitalizar(termo('checkin').singular) }} do dia {{ checkin.dia }}</h1>
        <p class="text-zinc-600 dark:text-zinc-300">{{ checkin.paciente.nome }}</p>
      </header>

      <Cartao v-if="enviado" class="flex flex-col items-center gap-3 py-8 text-center">
        <CircleCheck class="size-14 text-sucesso" aria-hidden="true" />
        <h2 class="text-xl font-bold">Recebido!</h2>
        <p>A equipe vai ver suas respostas. Se precisar contar mais alguma coisa, use a conversa.</p>
        <Botao @click="router.push('/')">Voltar ao início</Botao>
      </Cartao>

      <template v-else-if="podeResponder && checkin.formulario">
        <Aviso v-if="erroEnvio" tipo="erro" :detalhe="erroEnvio.requestId ? t('app.codigoSuporte', { id: erroEnvio.requestId }) : null">{{ t(`erros.${erroEnvio.codigo}`, t('erros.DESCONHECIDO')) }}</Aviso>
        <p class="text-sm text-zinc-600 dark:text-zinc-300">Responda até {{ formatarDataHora(checkin.expiraEm, app.fuso, app.locale) }}.</p>
        <FormularioPassoAPasso ref="form" :campos="checkin.formulario.campos" :titulo="checkin.formulario.titulo" :enviando="envio.isPending.value" :erros-servidor="errosServidor" @enviar="envio.mutate" />
      </template>

      <template v-else>
        <Aviso v-if="checkin.status === 'EXPIRADO'" tipo="atencao">O prazo para responder terminou. Se quiser contar como está, use a conversa com a equipe.</Aviso>
        <Aviso v-else-if="checkin.status === 'AGENDADO'">Disponível a partir de {{ formatarDataHora(checkin.disponivelEm, app.fuso, app.locale) }}.</Aviso>
        <Aviso v-else-if="checkin.status === 'CANCELADO'">Este {{ termo('checkin').singular }} foi cancelado.</Aviso>
        <Cartao v-if="checkin.respostas && checkin.formulario">
          <p class="text-sm text-zinc-600 dark:text-zinc-300">Respondido em {{ formatarDataHora(checkin.respondidoEm!, app.fuso, app.locale) }}</p>
          <RespostasLeitura :campos="checkin.formulario.campos" :respostas="checkin.respostas as Record<string, unknown>" :fotos="checkin.anexos" :destacar="alertaCampos" />
        </Cartao>
        <Cartao v-if="!sessao.ehPaciente && checkin.alertas.length">
          <h2 class="font-bold">Alertas</h2>
          <ul><li v-for="a in checkin.alertas" :key="a.id"><strong :class="a.severidade === 'ALTA' ? 'text-erro' : 'text-atencao'">{{ a.severidade }}</strong> {{ a.mensagem }} — {{ a.status === 'ABERTO' ? 'aberto' : 'resolvido' }}</li></ul>
        </Cartao>
      </template>
    </template>
  </div>
</template>
