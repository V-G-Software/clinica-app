<script setup lang="ts">
// Gestor: horários semanais de cada profissional (grade, versionada por ETag) e bloqueios
// (férias, congresso, feriado da organização). Tudo no fuso da organização.
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { Plus, Trash2 } from 'lucide-vue-next';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { formatarDataHora } from '@/i18n/datas';
import { hojeNoFuso, somarDias } from '@/i18n/dias';
import { artigo, capitalizar } from '@/i18n/termos';
import { comEtag } from '@/dados/etag';
import { useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Conflito from '@/ds/Conflito.vue';
import Selecao from '@/ds/Selecao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';
import { DIAS_SEMANA, paraUtc } from './util';

const rota = useRoute();
const router = useRouter();
const app = useAppStore();
const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const servicos = useQuery({ queryKey: ['agenda-servicos', 'ATIVO'], queryFn: () => ok(api().GET('/v1/agenda/servicos', { params: { query: { status: 'ATIVO' } } })) });
const membros = useQuery({ queryKey: ['membros', 'ATIVO'], queryFn: () => ok(api().GET('/v1/equipe/membros', { params: { query: { status: 'ATIVO', limite: 100 } } })), enabled: computed(() => sessao.modulos.has('equipe') && sessao.pode('equipe.membro.ler')) });
const profissionais = computed(() => {
  const m = new Map<string, string>();
  for (const s of servicos.data.value?.itens ?? []) for (const p of s.profissionais) m.set(p.usuarioId, p.nome);
  for (const x of membros.data.value?.itens ?? []) if (x.perfis.includes('PROFISSIONAL')) m.set(x.id, x.nome);
  return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
});
const profissionalId = ref(typeof rota.query.profissionalId === 'string' ? rota.query.profissionalId : '');
watch(profissionais, (l) => { if (!profissionalId.value && l.length) profissionalId.value = l[0].id; }, { immediate: true });
watch(profissionalId, (p) => { void router.replace({ query: p ? { profissionalId: p } : {} }); });
const servicosDoProf = computed(() => (servicos.data.value?.itens ?? []).filter((s) => s.profissionais.some((p) => p.usuarioId === profissionalId.value)));

// ── Grade semanal ──
type Item = { diaSemana: number; inicio: string; fim: string; servicosIds: string[] | null };
const grade = useQuery({ queryKey: ['agenda-grade', profissionalId], queryFn: () => comEtag(api().GET('/v1/agenda/grades/{profissionalId}', { params: { path: { profissionalId: profissionalId.value } } })), enabled: computed(() => !!profissionalId.value) });
const itens = ref<Item[]>([]);
const conflito = ref(false);
const salvo = ref(false);
watch(() => grade.data.value, (d) => { itens.value = (d?.dado.itens ?? []).map((i) => ({ ...i, servicosIds: i.servicosIds ?? null })).sort((a, b) => a.diaSemana - b.diaSemana || a.inicio.localeCompare(b.inicio)); conflito.value = false; }, { immediate: true });
const podeEditar = computed(() => grade.data.value?.dado.acoesPermitidas.includes('EDITAR') ?? false);
const invalidos = computed(() => itens.value.filter((i) => !(i.inicio < i.fim)).length);
const salvar = useMutation({
  mutationFn: () => comEtag(api().PUT('/v1/agenda/grades/{profissionalId}', { params: { path: { profissionalId: profissionalId.value }, header: { 'If-Match': grade.data.value?.etag ?? '' } }, body: { itens: itens.value.map((i) => ({ diaSemana: i.diaSemana, inicio: i.inicio, fim: i.fim, ...(i.servicosIds?.length ? { servicosIds: i.servicosIds } : {}) })) } })),
  onSuccess: async () => { salvo.value = true; setTimeout(() => (salvo.value = false), 3000); await grade.refetch(); void qc.invalidateQueries({ queryKey: ['agenda-horarios'] }); },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; },
});
const alternarServico = (i: Item, id: string) => {
  const atual = new Set(i.servicosIds ?? []);
  if (atual.has(id)) atual.delete(id); else atual.add(id);
  i.servicosIds = atual.size ? [...atual] : null;
};

// ── Bloqueios (próximos 12 meses) ──
const hoje = hojeNoFuso(app.agoraServidor(), app.fuso);
const bloqueios = useQuery({ queryKey: ['agenda-bloqueios', profissionalId], queryFn: () => ok(api().GET('/v1/agenda/bloqueios', { params: { query: { de: hoje, ate: somarDias(hoje, 365), ...(profissionalId.value ? { profissionalId: profissionalId.value } : {}) } } })) });
const novo = ref({ todaOrganizacao: false, de: hoje, ate: hoje, diaInteiro: true, horaInicio: '08:00', horaFim: '12:00', motivo: '' });
const periodoBloqueio = computed(() => {
  const n = novo.value;
  if (!n.de || !n.ate || n.ate < n.de) return null;
  const inicioEm = paraUtc(n.de, n.diaInteiro ? '00:00' : n.horaInicio, app.fuso);
  const fimEm = n.diaInteiro ? paraUtc(somarDias(n.ate, 1), '00:00', app.fuso) : paraUtc(n.ate, n.horaFim, app.fuso);
  return inicioEm < fimEm ? { inicioEm, fimEm } : null;
});
const criarBloqueio = useMutation({
  mutationFn: () => ok(api().POST('/v1/agenda/bloqueios', { body: { profissionalId: novo.value.todaOrganizacao ? null : profissionalId.value, ...periodoBloqueio.value!, motivo: novo.value.motivo.trim() || null } })),
  onSuccess: async () => { novo.value.motivo = ''; await bloqueios.refetch(); void qc.invalidateQueries({ queryKey: ['agenda-horarios'] }); },
});
const removerBloqueio = useMutation({
  mutationFn: (id: string) => ok(api().DELETE('/v1/agenda/bloqueios/{bloqueioId}', { params: { path: { bloqueioId: id } } })),
  onSuccess: async () => { await bloqueios.refetch(); void qc.invalidateQueries({ queryKey: ['agenda-horarios'] }); },
});
const entrada = 'min-h-11 rounded-lg border-2 border-zinc-300 bg-white px-2 dark:border-zinc-600 dark:bg-zinc-800';
</script>
<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <h1 class="text-2xl font-bold">Horários e bloqueios</h1>
    <Selecao v-model="profissionalId" :rotulo="capitalizar(termo('profissional').singular)" :opcoes="profissionais.map((p) => ({ valor: p.id, rotulo: p.nome }))" />

    <Cartao class="flex flex-col gap-3">
      <h2 class="font-bold">Horários da semana</h2>
      <p class="text-sm text-secundario">É onde {{ artigo(termo('paciente')) }} {{ termo('paciente').singular }} marca pelo app. A equipe pode marcar fora destes horários.</p>
      <EstadoConsulta :carregando="!!profissionalId && grade.isPending.value" :erro="grade.error.value" @tentar="grade.refetch()">
        <Conflito v-if="conflito" @recarregar="grade.refetch()" />
        <Aviso v-else-if="salvar.error.value" tipo="erro" :detalhe="msg(salvar.error.value)?.suporte">{{ msg(salvar.error.value)?.texto }}</Aviso>
        <Aviso v-if="salvo">Horários salvos.</Aviso>
        <p v-if="!itens.length" class="text-secundario">Nenhum horário cadastrado.</p>
        <div v-for="(i, n) in itens" :key="n" class="flex flex-col gap-2 border-t border-zinc-100 pt-3 first:border-0 first:pt-0 dark:border-zinc-700">
          <div class="flex flex-wrap items-center gap-2">
            <select v-model.number="i.diaSemana" :class="entrada" aria-label="Dia da semana" :disabled="!podeEditar"><option v-for="(d, k) in DIAS_SEMANA" :key="k" :value="k">{{ d }}</option></select>
            <input v-model="i.inicio" type="time" :class="entrada" aria-label="Início" :disabled="!podeEditar" /> até
            <input v-model="i.fim" type="time" :class="entrada" aria-label="Fim" :disabled="!podeEditar" />
            <button v-if="podeEditar" type="button" class="p-2" aria-label="Remover horário" @click="itens.splice(n, 1)"><Trash2 class="size-5" /></button>
          </div>
          <p v-if="!(i.inicio < i.fim)" class="text-sm text-erro" role="alert">O fim precisa ser depois do início.</p>
          <div v-if="servicosDoProf.length > 1" class="flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Serviços neste horário">
            <span class="text-secundario">Serviços:</span>
            <button type="button" class="rounded-full border px-2.5 py-0.5" :class="!i.servicosIds ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="!i.servicosIds" :disabled="!podeEditar" @click="i.servicosIds = null">Todos</button>
            <button v-for="s in servicosDoProf" :key="s.id" type="button" class="rounded-full border px-2.5 py-0.5" :class="i.servicosIds?.includes(s.id) ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="!!i.servicosIds?.includes(s.id)" :disabled="!podeEditar" @click="alternarServico(i, s.id)">{{ s.nome }}</button>
          </div>
        </div>
        <div v-if="podeEditar" class="flex flex-wrap gap-2">
          <Botao variante="fantasma" @click="itens.push({ diaSemana: 1, inicio: '08:00', fim: '12:00', servicosIds: null })"><Plus class="size-4" /> Horário</Botao>
          <Botao :carregando="salvar.isPending.value" :desabilitado="invalidos > 0" @click="salvar.mutate()">Salvar horários</Botao>
        </div>
      </EstadoConsulta>
    </Cartao>

    <Cartao class="flex flex-col gap-3">
      <h2 class="font-bold">Bloqueios</h2>
      <EstadoConsulta :carregando="bloqueios.isPending.value" :erro="bloqueios.error.value" :vazio="!bloqueios.data.value?.itens.length" texto-vazio="Nenhum bloqueio nos próximos 12 meses." @tentar="bloqueios.refetch()">
        <ul class="flex flex-col gap-2">
          <li v-for="b in bloqueios.data.value?.itens" :key="b.id" class="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 first:border-0 first:pt-0 dark:border-zinc-700">
            <div>
              <p class="font-medium">{{ b.motivo ?? 'Bloqueio' }} <span class="text-sm font-normal text-secundario">· {{ b.profissional?.nome ?? `toda a ${termo('organizacao').singular}` }}</span></p>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ formatarDataHora(b.inicioEm, app.fuso, app.locale) }} até {{ formatarDataHora(b.fimEm, app.fuso, app.locale) }}</p>
            </div>
            <button v-if="b.acoesPermitidas.includes('REMOVER')" type="button" class="p-2" :aria-label="`Remover bloqueio ${b.motivo ?? ''}`" @click="removerBloqueio.mutate(b.id)"><Trash2 class="size-5" /></button>
          </li>
        </ul>
      </EstadoConsulta>
      <form v-if="sessao.pode('agenda.configuracao.gerenciar')" class="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700" @submit.prevent="criarBloqueio.mutate()">
        <h3 class="font-semibold">Novo bloqueio</h3>
        <Aviso v-if="criarBloqueio.error.value" tipo="erro" :detalhe="msg(criarBloqueio.error.value)?.suporte">{{ msg(criarBloqueio.error.value)?.texto }}</Aviso>
        <label class="flex items-center gap-3"><input v-model="novo.todaOrganizacao" type="checkbox" class="size-5" /> Toda a {{ termo('organizacao').singular }} (feriado)</label>
        <div class="grid grid-cols-2 gap-3"><CampoTexto v-model="novo.de" rotulo="De" tipo="date" /><CampoTexto v-model="novo.ate" rotulo="Até" tipo="date" /></div>
        <label class="flex items-center gap-3"><input v-model="novo.diaInteiro" type="checkbox" class="size-5" /> Dia inteiro</label>
        <div v-if="!novo.diaInteiro" class="grid grid-cols-2 gap-3"><CampoTexto v-model="novo.horaInicio" rotulo="Hora inicial" tipo="time" /><CampoTexto v-model="novo.horaFim" rotulo="Hora final" tipo="time" /></div>
        <CampoTexto v-model="novo.motivo" rotulo="Motivo (opcional)" :maxlength="200" />
        <Botao tipo="submit" :carregando="criarBloqueio.isPending.value" :desabilitado="!periodoBloqueio || (!novo.todaOrganizacao && !profissionalId)">Bloquear</Botao>
      </form>
    </Cartao>
  </div>
</template>
