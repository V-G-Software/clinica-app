<script setup lang="ts">
// Paciente: pedidos em aberto (com preparo e botão de enviar) e resultados enviados, dos pacientes
// vinculados. Pedidos encerrados ficam sob demanda.
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { Upload } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { capitalizar, flexao } from '@/i18n/termos';
import { useTermos } from '@/dados/util';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { STATUS_PEDIDO, STATUS_RESULTADO } from './util';

const app = useAppStore();
const sessao = useSessaoStore();
const termo = useTermos();
const exame = computed(() => termo.value('exame'));
const vinculados = computed(() => sessao.manifesto?.pacientesVinculados ?? []);
const selecionado = ref<string | null>(null);
const filtro = () => (selecionado.value ? { pacienteId: selecionado.value } : {});
const abertos = useQuery({ queryKey: ['exames-pedidos', 'meus', 'ABERTO', selecionado], queryFn: () => ok(api().GET('/v1/exames/pedidos', { params: { query: { ...filtro(), status: 'ABERTO', limite: 50 } } })) });
const resultados = useQuery({ queryKey: ['exames-resultados', 'meus', selecionado], queryFn: () => ok(api().GET('/v1/exames/resultados', { params: { query: { ...filtro(), limite: 50 } } })) });
const verEncerrados = ref(false);
const encerrados = useQuery({ queryKey: ['exames-pedidos', 'meus', 'todos', selecionado], queryFn: () => ok(api().GET('/v1/exames/pedidos', { params: { query: { ...filtro(), limite: 50 } } })), enabled: verEncerrados });
const listaEncerrados = computed(() => (encerrados.data.value?.itens ?? []).filter((p) => p.status !== 'ABERTO'));
const podeEnviar = computed(() => sessao.pode('exames.resultado.enviar'));
const quando = (iso: string) => formatarDataHora(iso, app.fuso, app.locale, { dateStyle: 'short' });
const titulo = computed(() => capitalizar(`${flexao(exame.value, 'meus', 'minhas')} ${exame.value.plural}`));
const varios = computed(() => vinculados.value.length > 1);
const enviar = (pedidoId: string, pacienteId: string) => `/exames/enviar?pedidoId=${encodeURIComponent(pedidoId)}&pacienteId=${encodeURIComponent(pacienteId)}`;
</script>
<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">{{ titulo }}</h1>
      <RouterLink v-if="podeEnviar" :to="selecionado ? `/exames/enviar?pacienteId=${encodeURIComponent(selecionado)}` : '/exames/enviar'"><Botao><Upload class="size-5" aria-hidden="true" /> Enviar resultado</Botao></RouterLink>
    </div>
    <div v-if="varios" class="flex flex-wrap gap-2" role="group" :aria-label="capitalizar(termo('paciente').plural)">
      <button type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="!selecionado ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="!selecionado" @click="selecionado = null">Todos</button>
      <button v-for="p in vinculados" :key="p.id" type="button" class="min-h-11 rounded-full border-2 px-4 font-medium" :class="selecionado === p.id ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="selecionado === p.id" @click="selecionado = p.id">{{ p.nome }}</button>
    </div>

    <section class="flex flex-col gap-2" aria-labelledby="titulo-pedidos">
      <h2 id="titulo-pedidos" class="font-bold">Pedidos em aberto</h2>
      <EstadoConsulta :carregando="abertos.isPending.value" :erro="abertos.error.value" :vazio="!abertos.data.value?.itens.length" :texto-vazio="`Nenhum pedido de ${exame.singular} em aberto.`" @tentar="abertos.refetch()">
        <Cartao v-for="p in abertos.data.value?.itens ?? []" :key="p.id" class="flex flex-col gap-2">
          <RouterLink :to="`/exames/pedidos/${p.id}`" class="flex flex-col gap-1 hover:underline">
            <p class="text-sm text-secundario">{{ quando(p.criadoEm) }} · {{ p.solicitante.nome }}<template v-if="varios"> · {{ p.paciente.nome }}</template></p>
            <h3 class="text-lg font-bold">{{ p.itens.map((i) => i.nome).join(', ') }}</h3>
          </RouterLink>
          <ul v-if="p.itens.some((i) => i.orientacoes) || p.orientacoes" class="flex flex-col gap-1 text-sm">
            <li v-for="(i, n) in p.itens.filter((x) => x.orientacoes)" :key="n"><strong>{{ i.nome }}:</strong> {{ i.orientacoes }}</li>
            <li v-if="p.orientacoes" class="whitespace-pre-line">{{ p.orientacoes }}</li>
          </ul>
          <p v-if="p.resultados.length" class="text-sm">{{ p.resultados.length }} resultado{{ p.resultados.length === 1 ? '' : 's' }} enviado{{ p.resultados.length === 1 ? '' : 's' }}</p>
          <RouterLink v-if="p.acoesPermitidas.includes('ENVIAR_RESULTADO')" :to="enviar(p.id, p.paciente.id)" class="self-start"><Botao variante="secundario"><Upload class="size-5" aria-hidden="true" /> Enviar resultado</Botao></RouterLink>
        </Cartao>
      </EstadoConsulta>
    </section>

    <section class="flex flex-col gap-2" aria-labelledby="titulo-resultados">
      <h2 id="titulo-resultados" class="font-bold">Resultados</h2>
      <EstadoConsulta :carregando="resultados.isPending.value" :erro="resultados.error.value" :vazio="!resultados.data.value?.itens.length" texto-vazio="Nenhum resultado ainda." @tentar="resultados.refetch()">
        <RouterLink v-for="r in resultados.data.value?.itens ?? []" :key="r.id" :to="`/exames/resultados/${r.id}`" class="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
          <span class="min-w-0"><span class="block truncate font-medium">{{ r.titulo }}</span><span class="text-sm text-secundario">{{ quando(r.criadoEm) }}<template v-if="varios"> · {{ r.paciente.nome }}</template><template v-if="r.revisao?.nota"> · tem nota da equipe</template></span></span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS_RESULTADO[r.status].classe">{{ STATUS_RESULTADO[r.status].rotulo }}</span>
        </RouterLink>
      </EstadoConsulta>
    </section>

    <Botao v-if="!verEncerrados" variante="fantasma" @click="verEncerrados = true">Ver pedidos encerrados</Botao>
    <section v-else class="flex flex-col gap-2" aria-labelledby="titulo-encerrados">
      <h2 id="titulo-encerrados" class="font-bold">Pedidos encerrados</h2>
      <EstadoConsulta :carregando="encerrados.isPending.value" :erro="encerrados.error.value" :vazio="!listaEncerrados.length" texto-vazio="Nenhum pedido encerrado." @tentar="encerrados.refetch()">
        <RouterLink v-for="p in listaEncerrados" :key="p.id" :to="`/exames/pedidos/${p.id}`" class="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-zinc-200 px-4 py-2 hover:border-acao dark:border-zinc-700">
          <span class="min-w-0 truncate">{{ quando(p.criadoEm) }} · {{ p.itens.map((i) => i.nome).join(', ') }}</span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS_PEDIDO[p.status].classe">{{ STATUS_PEDIDO[p.status].rotulo }}</span>
        </RouterLink>
      </EstadoConsulta>
    </section>
    <p v-if="!podeEnviar" class="text-sm text-secundario">Para entregar um resultado, leve-o na próxima {{ termo('consulta').singular }} ou fale com a equipe.</p>
  </div>
</template>
