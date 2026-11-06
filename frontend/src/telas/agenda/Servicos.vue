<script setup lang="ts">
// Gestor: tipos de atendimento (consulta, procedimento), quem atende, duração, autoagendamento e
// preparo. Arquivar não apaga: agendamentos antigos continuam apontando para o serviço.
import { computed, reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CalendarClock, Plus } from 'lucide-vue-next';
import type { Servico } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { useSessaoStore } from '@/sessao/store';
import { capitalizar, nenhum } from '@/i18n/termos';
import { comEtag } from '@/dados/etag';
import { useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import Botao from '@/ds/Botao.vue';
import Aviso from '@/ds/Aviso.vue';
import Cartao from '@/ds/Cartao.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Conflito from '@/ds/Conflito.vue';
import Dialogo from '@/ds/Dialogo.vue';
import Selecao from '@/ds/Selecao.vue';
import EstadoConsulta from '@/ds/EstadoConsulta.vue';

const sessao = useSessaoStore();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const status = ref<'ATIVO' | 'ARQUIVADO'>('ATIVO');
const q = useQuery({ queryKey: ['agenda-servicos', status], queryFn: () => ok(api().GET('/v1/agenda/servicos', { params: { query: { status: status.value } } })) });
const membros = useQuery({ queryKey: ['membros', 'ATIVO'], queryFn: () => ok(api().GET('/v1/equipe/membros', { params: { query: { status: 'ATIVO', limite: 100 } } })), enabled: computed(() => sessao.modulos.has('equipe') && sessao.pode('equipe.membro.ler')) });
// Sem acesso à equipe, oferece quem já atende algum serviço (e a própria pessoa).
const profissionais = computed(() => {
  const m = new Map<string, string>();
  for (const x of membros.data.value?.itens ?? []) if (x.perfis.includes('PROFISSIONAL')) m.set(x.id, x.nome);
  if (!m.size) {
    for (const s of q.data.value?.itens ?? []) for (const p of s.profissionais) m.set(p.usuarioId, p.nome);
    const eu = sessao.manifesto?.usuario;
    if (eu) m.set(eu.id, eu.nome);
  }
  return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
});

const aberto = ref(false);
const editandoId = ref<string | null>(null);
const etag = ref<string | null>(null);
const conflito = ref(false);
const f = reactive({ nome: '', categoria: 'CONSULTA' as 'CONSULTA' | 'PROCEDIMENTO', duracao: '30', autoagendavel: false, profissionaisIds: [] as string[], orientacoes: '', protocoloId: '' });
// Protocolo sugerido (RN-AGE-008): só procedimento e só com o módulo de acompanhamento.
const temAcompanhamento = computed(() => sessao.modulos.has('acompanhamento'));
const protocolos = useQuery({ queryKey: ['protocolos', 'ATIVO'], queryFn: () => ok(api().GET('/v1/protocolos', { params: { query: { status: 'ATIVO', limite: 100 } } })), enabled: temAcompanhamento });
function abrir(s?: Servico) {
  editandoId.value = s?.id ?? null; conflito.value = false; salvar.reset();
  Object.assign(f, s
    ? { nome: s.nome, categoria: s.categoria, duracao: String(s.duracaoMinutos), autoagendavel: s.autoagendavel, profissionaisIds: s.profissionais.map((p) => p.usuarioId), orientacoes: s.orientacoes ?? '', protocoloId: s.protocoloId ?? '' }
    : { nome: '', categoria: 'CONSULTA', duracao: '30', autoagendavel: false, profissionaisIds: profissionais.value.length === 1 ? [profissionais.value[0].id] : [], orientacoes: '', protocoloId: '' });
  etag.value = null;
  if (s) void comEtag(api().GET('/v1/agenda/servicos/{servicoId}', { params: { path: { servicoId: s.id } } })).then((r) => { etag.value = r.etag; });
  aberto.value = true;
}
const valido = computed(() => f.nome.trim().length >= 2 && Number(f.duracao) >= 5 && Number(f.duracao) <= 720 && f.profissionaisIds.length > 0);
const salvar = useMutation({
  mutationFn: () => {
    const body = { nome: f.nome.trim(), categoria: f.categoria, duracaoMinutos: Number(f.duracao), autoagendavel: f.categoria === 'CONSULTA' && f.autoagendavel, profissionaisIds: f.profissionaisIds, orientacoes: f.orientacoes.trim() || null, ...(temAcompanhamento.value ? { protocoloId: f.categoria === 'PROCEDIMENTO' && f.protocoloId ? f.protocoloId : null } : {}) };
    return editandoId.value
      ? ok(api().PUT('/v1/agenda/servicos/{servicoId}', { params: { path: { servicoId: editandoId.value }, header: { 'If-Match': etag.value ?? '' } }, body }))
      : ok(api().POST('/v1/agenda/servicos', { body }));
  },
  onSuccess: async () => { aberto.value = false; await qc.invalidateQueries({ queryKey: ['agenda-servicos'] }); },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; },
});
const arquivar = useMutation({
  mutationFn: (id: string) => ok(api().POST('/v1/agenda/servicos/{servicoId}/arquivar', { params: { path: { servicoId: id } } })),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-servicos'] }),
});
const CATEGORIA = computed(() => ({ CONSULTA: capitalizar(termo.value('consulta').singular), PROCEDIMENTO: capitalizar(termo.value('procedimento').singular) }));
</script>
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-bold">Serviços e horários</h1>
      <div class="flex flex-wrap gap-2">
        <RouterLink to="/agenda/grade"><Botao variante="secundario"><CalendarClock class="size-5" aria-hidden="true" /> Horários e bloqueios</Botao></RouterLink>
        <Botao @click="abrir()"><Plus class="size-5" aria-hidden="true" /> Novo serviço</Botao>
      </div>
    </div>
    <div class="flex gap-2" role="group" aria-label="Status">
      <button v-for="[v, r] in [['ATIVO', 'Ativos'], ['ARQUIVADO', 'Arquivados']] as const" :key="v" type="button" class="min-h-10 rounded-full border-2 px-4 text-sm font-medium" :class="status === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" :aria-pressed="status === v" @click="status = v">{{ r }}</button>
    </div>
    <Aviso v-if="arquivar.error.value" tipo="erro">{{ msg(arquivar.error.value)?.texto }}</Aviso>
    <EstadoConsulta :carregando="q.isPending.value" :erro="q.error.value" :vazio="!q.data.value?.itens.length" :texto-vazio="`${capitalizar(nenhum({ singular: 'serviço', plural: 'serviços', genero: 'M' }))} ${status === 'ATIVO' ? 'ativo' : 'arquivado'}.`" @tentar="q.refetch()">
      <Cartao v-for="s in q.data.value?.itens" :key="s.id" class="flex flex-col gap-1">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="font-bold">{{ s.nome }}</h2>
            <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ CATEGORIA[s.categoria] }} · {{ s.duracaoMinutos }} min · {{ s.profissionais.map((p) => p.nome).join(', ') }}</p>
            <p class="text-sm" :class="s.autoagendavel ? 'text-sucesso' : 'text-secundario'">{{ s.autoagendavel ? `${capitalizar(termo('paciente').singular)} pode marcar pelo app` : 'Só a equipe marca' }}</p>
          </div>
          <div class="flex gap-1">
            <Botao v-if="s.acoesPermitidas.includes('EDITAR')" variante="fantasma" :aria-label="`Editar ${s.nome}`" @click="abrir(s)">Editar</Botao>
            <Botao v-if="s.acoesPermitidas.includes('ARQUIVAR')" variante="fantasma" :aria-label="`Arquivar ${s.nome}`" :carregando="arquivar.isPending.value && arquivar.variables.value === s.id" @click="arquivar.mutate(s.id)">Arquivar</Botao>
          </div>
        </div>
        <p v-if="s.orientacoes" class="text-sm"><span class="font-medium">Preparo:</span> {{ s.orientacoes }}</p>
      </Cartao>
    </EstadoConsulta>

    <Dialogo v-model:aberto="aberto" :titulo="editandoId ? 'Editar serviço' : 'Novo serviço'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="salvar.mutate()">
        <Conflito v-if="conflito" @recarregar="aberto = false; q.refetch()" />
        <Aviso v-else-if="salvar.error.value" tipo="erro" :detalhe="msg(salvar.error.value)?.suporte">{{ msg(salvar.error.value)?.texto }}</Aviso>
        <CampoTexto v-model="f.nome" rotulo="Nome" :maxlength="120" />
        <fieldset class="flex gap-2"><legend class="mb-1 text-sm font-medium">Tipo</legend>
          <label v-for="(r, v) in CATEGORIA" :key="v" class="flex min-h-11 flex-1 items-center gap-2 rounded-xl border-2 px-3" :class="f.categoria === v ? 'border-acao' : 'border-zinc-300'"><input v-model="f.categoria" type="radio" :value="v" class="size-5" /> {{ r }}</label>
        </fieldset>
        <CampoTexto v-model="f.duracao" rotulo="Duração (minutos)" tipo="number" inputmode="numeric" />
        <fieldset class="flex flex-col gap-1"><legend class="mb-1 text-sm font-medium">Quem atende</legend>
          <label v-for="p in profissionais" :key="p.id" class="flex min-h-11 items-center gap-3"><input v-model="f.profissionaisIds" type="checkbox" :value="p.id" class="size-5" /> {{ p.nome }}</label>
        </fieldset>
        <label class="flex items-start gap-3" :class="f.categoria === 'PROCEDIMENTO' && 'opacity-60'">
          <input v-model="f.autoagendavel" type="checkbox" class="mt-0.5 size-5 shrink-0" :disabled="f.categoria === 'PROCEDIMENTO'" />
          <span>{{ capitalizar(termo('paciente').singular) }} pode marcar pelo app
            <span class="block text-sm text-secundario">{{ f.categoria === 'PROCEDIMENTO' ? `${capitalizar(termo('procedimento').plural)} são marcados só pela equipe.` : 'Vale quando o autoagendamento está ligado nas configurações.' }}</span></span>
        </label>
        <Selecao v-if="temAcompanhamento && f.categoria === 'PROCEDIMENTO'" v-model="f.protocoloId" :rotulo="`${capitalizar(termo('protocolo').singular)} sugerido ao marcar`" vazio="Nenhum" :opcoes="(protocolos.data.value?.itens ?? []).map((p) => ({ valor: p.id, rotulo: p.nome }))" />
        <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Preparo (mostrado ao {{ termo('paciente').singular }})</span>
          <textarea v-model="f.orientacoes" rows="2" maxlength="2000" class="rounded-xl border-2 border-zinc-300 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-800" /></label>
        <Botao tipo="submit" bloco :carregando="salvar.isPending.value" :desabilitado="!valido || (!!editandoId && !etag)">Salvar</Botao>
      </form>
    </Dialogo>
  </div>
</template>
