<script setup lang="ts">
// Pedido de exame (equipe e paciente). Botões só pelo `acoesPermitidas`; a observação interna chega
// `null` ao paciente (o backend decide). Resultados ligados, do mais antigo ao mais recente.
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Upload } from 'lucide-vue-next';
import type { PedidoExame } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import Dialogo from '@/ds/Dialogo.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { STATUS_PEDIDO, STATUS_RESULTADO } from './util';

const rota = useRoute();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const exame = computed(() => termo.value('exame'));
const id = computed(() => rota.params.pedidoId as string);
const q = useQuery({ queryKey: ['exame-pedido', id], queryFn: () => ok(api().GET('/v1/exames/pedidos/{pedidoId}', { params: { path: { pedidoId: id.value } } })) });
const p = computed(() => q.data.value);
const acoes = computed(() => new Set(p.value?.acoesPermitidas ?? []));
const quando = (iso: string) => formatarDataHora(iso, app.fuso, app.locale);

const atualizar = async (novo: PedidoExame) => {
  qc.setQueryData(['exame-pedido', id.value], novo);
  await Promise.all([qc.invalidateQueries({ queryKey: ['exames-pedidos'] }), qc.invalidateQueries({ queryKey: ['inicio'] })]);
};
const concluir = useMutation({
  mutationFn: () => ok(api().POST('/v1/exames/pedidos/{pedidoId}/concluir', { params: { path: { pedidoId: id.value } } })),
  onSuccess: atualizar,
});
const cancelando = ref(false);
const motivo = ref('');
const cancelar = useMutation({
  mutationFn: () => ok(api().POST('/v1/exames/pedidos/{pedidoId}/cancelar', { params: { path: { pedidoId: id.value } }, body: { motivo: motivo.value.trim() } })),
  onSuccess: async (r) => { cancelando.value = false; motivo.value = ''; await atualizar(r); },
});
const enviar = computed(() => (p.value ? `/exames/enviar?pedidoId=${encodeURIComponent(p.value.id)}&pacienteId=${encodeURIComponent(p.value.paciente.id)}` : ''));
const variosVinculados = computed(() => (sessao.manifesto?.pacientesVinculados?.length ?? 0) > 1);
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" @tentar="q.refetch()">
      <template v-if="p">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="text-sm text-secundario">Pedido de {{ exame.singular }} · {{ quando(p.criadoEm) }}</p>
            <h1 class="text-2xl font-bold">{{ sessao.ehPaciente && !variosVinculados ? `Pedido de ${exame.plural}` : p.paciente.nome }}</h1>
          </div>
          <span class="rounded-full px-3 py-1 text-sm font-semibold" :class="STATUS_PEDIDO[p.status].classe">{{ STATUS_PEDIDO[p.status].rotulo }}</span>
        </div>
        <Aviso v-if="concluir.error.value" tipo="erro" :detalhe="msg(concluir.error.value)?.suporte">{{ msg(concluir.error.value)?.texto }}</Aviso>
        <Aviso v-if="p.status === 'CANCELADO' && p.motivoCancelamento" tipo="atencao">Cancelado: {{ p.motivoCancelamento }}</Aviso>

        <Cartao class="flex flex-col gap-3">
          <p class="text-sm">Pedido por <strong>{{ p.solicitante.nome }}</strong><template v-if="sessao.ehPaciente && variosVinculados"> para <strong>{{ p.paciente.nome }}</strong></template></p>
          <ul class="flex flex-col gap-2">
            <li v-for="(i, n) in p.itens" :key="n" class="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p class="font-semibold">{{ i.nome }}</p>
              <p v-if="i.orientacoes" class="text-sm"><strong>Preparo:</strong> {{ i.orientacoes }}</p>
            </li>
          </ul>
          <p v-if="p.orientacoes" class="whitespace-pre-line text-sm"><strong>Orientações:</strong> {{ p.orientacoes }}</p>
          <p v-if="p.observacao" class="whitespace-pre-line text-sm text-secundario"><strong>Observação interna:</strong> {{ p.observacao }}</p>
          <p v-if="p.concluidoEm" class="text-sm text-secundario">Concluído em {{ quando(p.concluidoEm) }}</p>
        </Cartao>

        <div class="flex flex-wrap gap-2">
          <RouterLink v-if="acoes.has('ENVIAR_RESULTADO')" :to="enviar"><Botao><Upload class="size-5" aria-hidden="true" /> Enviar resultado</Botao></RouterLink>
          <Botao v-if="acoes.has('CONCLUIR')" variante="secundario" :carregando="concluir.isPending.value" @click="concluir.mutate()">Concluir pedido</Botao>
          <Botao v-if="acoes.has('CANCELAR')" variante="secundario" @click="cancelar.reset(); cancelando = true">Cancelar pedido</Botao>
        </div>
        <p v-if="sessao.ehPaciente && p.status === 'ABERTO' && !acoes.has('ENVIAR_RESULTADO')" class="text-sm text-secundario">Leve o resultado na próxima {{ termo('consulta').singular }} ou fale com a equipe.</p>

        <section class="flex flex-col gap-2" aria-labelledby="titulo-resultados">
          <h2 id="titulo-resultados" class="font-bold">Resultados</h2>
          <p v-if="!p.resultados.length" class="text-secundario">Nenhum resultado enviado ainda.</p>
          <RouterLink v-for="r in p.resultados" :key="r.id" :to="`/exames/resultados/${r.id}`" class="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
            <span><span class="font-medium">{{ r.titulo }}</span> <span class="text-sm text-secundario">· {{ quando(r.criadoEm) }}</span></span>
            <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS_RESULTADO[r.status].classe">{{ STATUS_RESULTADO[r.status].rotulo }}</span>
          </RouterLink>
        </section>
      </template>
    </EstadoConsulta>

    <Dialogo v-model:aberto="cancelando" :titulo="`Cancelar pedido de ${exame.singular}`" :descricao="`O motivo fica registrado. Nenhum resultado é apagado.`">
      <form class="flex flex-col gap-3" @submit.prevent="cancelar.mutate()">
        <Aviso v-if="cancelar.error.value" tipo="erro" :detalhe="msg(cancelar.error.value)?.suporte">{{ msg(cancelar.error.value)?.texto }}</Aviso>
        <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Motivo</span><textarea v-model="motivo" rows="3" maxlength="1000" required class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
        <Botao tipo="submit" bloco :carregando="cancelar.isPending.value" :desabilitado="motivo.trim().length < 3">Confirmar cancelamento</Botao>
      </form>
    </Dialogo>
  </div>
</template>
