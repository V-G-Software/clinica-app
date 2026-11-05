<script setup lang="ts">
// FE0: tela inicial mínima — desenha as seções conhecidas, na ordem recebida, e ignora as desconhecidas.
// O visual completo de cada seção vem na FE1 (paciente) e FE2 (equipe).
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { api, ok } from '@/api';
import { caminhoDe } from '@/catalogo/telas';
import { useSessaoStore } from '@/sessao/store';
import { capitalizar, contar, nenhum, TERMOS_PADRAO, type Termo } from '@/i18n/termos';
import Cartao from '@/ds/Cartao.vue';
import Aviso from '@/ds/Aviso.vue';
import Icone from '@/ds/Icone.vue';
import Botao from '@/ds/Botao.vue';

const { t } = useI18n();
const sessao = useSessaoStore();
const termo = (k: string): Termo => ((sessao.termos as Record<string, Termo> | undefined)?.[k] ?? TERMOS_PADRAO[k]);
const { data, isPending, error, refetch } = useQuery({ queryKey: ['inicio'], queryFn: () => ok(api().GET('/v1/inicio', {})) });
const CONHECIDAS = new Set(['ACOMPANHAMENTO_ATUAL', 'CHECKINS_PENDENTES', 'ALERTAS_ABERTOS', 'CHECKINS_DO_DIA', 'ACOMPANHAMENTOS_ATIVOS', 'CONVERSAS_RECENTES', 'ATALHOS', 'AVISO', 'CONTATO_ORGANIZACAO']);
const secoes = computed(() => (data.value?.secoes ?? []).filter((s) => CONHECIDAS.has(s.tipo as string)) as Array<{ id: string; tipo: string; titulo?: string; dados: any }>);
// Com mais de um paciente vinculado (tutora com dois pets), o título "nome da clínica" (RN-CHA-003)
// fica ambíguo: mostramos o nome do paciente. Ver QUESTION-016.
const variosVinculados = computed(() => (sessao.manifesto?.pacientesVinculados?.length ?? 0) > 1);
const tituloConversa = (c: { titulo: string; paciente: { nome: string } }) => (sessao.ehPaciente && variosVinculados.value ? c.paciente.nome : c.titulo);
const primeiroNome = computed(() => sessao.manifesto?.usuario.nomeExibicao.split(' ').slice(0, 2).join(' '));
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">Olá, {{ primeiroNome }}</h1>
    <p v-if="isPending">{{ t('app.carregando') }}</p>
    <Aviso v-else-if="error" tipo="erro">{{ t('erros.DESCONHECIDO') }} <Botao variante="fantasma" @click="refetch()">{{ t('app.tentarDeNovo') }}</Botao></Aviso>
    <template v-for="s in secoes" :key="s.id">
      <Cartao v-if="s.tipo === 'ACOMPANHAMENTO_ATUAL'">
        <p class="text-sm text-zinc-500">{{ s.titulo ?? capitalizar(termo('acompanhamento').singular) }}</p>
        <h2 class="text-lg font-bold">{{ s.dados.titulo }}</h2>
        <p v-if="s.dados.diaAtual >= 0">Dia {{ s.dados.diaAtual }} de {{ s.dados.totalDias }}</p>
        <p v-else>Faltam {{ -s.dados.diaAtual }} dia(s) para {{ termo('procedimento').genero === 'F' ? 'a' : 'o' }} {{ termo('procedimento').singular }}</p>
        <div class="mt-2 h-2 rounded-full bg-marca-100"><div class="h-2 rounded-full bg-acao" :style="{ width: `${Math.max(0, Math.min(100, (s.dados.diaAtual / s.dados.totalDias) * 100))}%` }" /></div>
        <p v-if="s.dados.orientacaoDoDia" class="mt-3 rounded-lg bg-marca-50 p-3 text-sm dark:bg-zinc-700">{{ s.dados.orientacaoDoDia }}</p>
      </Cartao>
      <Cartao v-else-if="s.tipo === 'CHECKINS_PENDENTES'">
        <h2 class="font-bold">{{ capitalizar(termo('checkin').plural) }} para responder</h2>
        <p v-if="!s.dados.itens.length" class="text-zinc-500">{{ capitalizar(nenhum(termo('checkin'))) }} pendente.</p>
        <RouterLink v-for="c in s.dados.itens" :key="c.id" :to="caminhoDe('acompanhamento.checkin', { checkinId: c.id }) ?? '/'" class="mt-2 flex min-h-12 items-center justify-between rounded-lg bg-acao px-4 font-semibold text-acao-texto">
          Responder dia {{ c.dia }} <Icone nome="activity" class="size-5" />
        </RouterLink>
      </Cartao>
      <Cartao v-else-if="s.tipo === 'ALERTAS_ABERTOS'">
        <h2 class="font-bold">Alertas abertos ({{ s.dados.total }})</h2>
        <ul class="mt-2 flex flex-col gap-1"><li v-for="a in s.dados.itens" :key="a.id" class="flex gap-2"><span class="font-semibold" :class="a.severidade === 'ALTA' ? 'text-erro' : 'text-atencao'">{{ a.severidade }}</span> {{ a.paciente.nome }} — {{ a.mensagem }}</li></ul>
      </Cartao>
      <Cartao v-else-if="s.tipo === 'CHECKINS_DO_DIA'">
        <h2 class="font-bold">{{ capitalizar(termo('checkin').plural) }} de hoje</h2>
        <p>{{ t('inicio.respondidos', s.dados.respondidos) }} · {{ t('inicio.pendentes', s.dados.pendentes) }} · {{ t('inicio.expirados', s.dados.expirados) }}</p>
      </Cartao>
      <Cartao v-else-if="s.tipo === 'ACOMPANHAMENTOS_ATIVOS'">
        <h2 class="font-bold">{{ capitalizar(termo('acompanhamento').plural) }} em andamento</h2>
        <p>{{ contar(s.dados.total, termo('acompanhamento')) }}</p>
      </Cartao>
      <Cartao v-else-if="s.tipo === 'CONVERSAS_RECENTES'">
        <h2 class="font-bold">{{ capitalizar(termo('conversa').plural) }}</h2>
        <p v-if="!s.dados.itens.length" class="text-zinc-500">{{ capitalizar(nenhum(termo('conversa'))) }}.</p>
        <ul class="mt-1"><li v-for="c in s.dados.itens" :key="c.id" class="flex justify-between py-1"><span>{{ tituloConversa(c) }}</span><span v-if="c.naoLidas" class="font-bold text-acao">{{ c.naoLidas }}</span></li></ul>
      </Cartao>
      <div v-else-if="s.tipo === 'ATALHOS'" class="flex flex-wrap gap-2">
        <template v-for="a in s.dados.itens" :key="a.rotulo">
          <RouterLink v-if="caminhoDe(a.destino.tela, a.destino.parametros)" :to="caminhoDe(a.destino.tela, a.destino.parametros)!" class="flex min-h-12 items-center gap-2 rounded-xl border-2 border-acao px-4 font-semibold text-acao">
            <Icone :nome="a.icone" class="size-5" /> {{ a.rotulo }}
          </RouterLink>
        </template>
      </div>
      <Aviso v-else-if="s.tipo === 'AVISO'" :tipo="s.dados.severidade === 'URGENTE' ? 'erro' : s.dados.severidade === 'ATENCAO' ? 'atencao' : 'informacao'"><strong>{{ s.dados.titulo }}</strong> {{ s.dados.texto }}</Aviso>
      <Cartao v-else-if="s.tipo === 'CONTATO_ORGANIZACAO'">
        <h2 class="font-bold">Contato</h2>
        <a v-if="s.dados.telefone" :href="`tel:${s.dados.telefone}`" class="block text-acao underline">{{ s.dados.telefone }}</a>
        <p v-if="s.dados.endereco">{{ s.dados.endereco }}</p>
      </Cartao>
    </template>
  </div>
</template>
