<script setup lang="ts">
// Protocolo: visualização e edição. Salvar publica uma NOVA VERSÃO (PUT com If-Match);
// acompanhamentos em andamento continuam na versão antiga (RN-ACO-003).
// Regras de alerta descrevem o que foi relatado; nunca sugerem conduta (RN-ACO-005).
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2 } from 'lucide-vue-next';
import type { CampoFormulario, Protocolo, ProtocoloEntrada } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { ErroApi } from '@/api/erros';
import { comEtag } from '@/dados/etag';
import { useTermos } from '@/dados/util';
import { useMensagemErro } from '@/dados/erro';
import { capitalizar, novo } from '@/i18n/termos';
import { escreverDias, lerDias } from '@/i18n/intervalos';
import Botao from '@/ds/Botao.vue';
import Cartao from '@/ds/Cartao.vue';
import Aviso from '@/ds/Aviso.vue';
import CampoTexto from '@/ds/CampoTexto.vue';
import Conflito from '@/ds/Conflito.vue';

const { t } = useI18n();
const rota = useRoute();
const router = useRouter();
const qc = useQueryClient();
const termo = useTermos();
const msg = useMensagemErro();
const id = computed(() => String(rota.params.protocoloId));
const criando = computed(() => id.value === 'novo');
const q = useQuery({ queryKey: ['protocolo', id], queryFn: () => comEtag(api().GET('/v1/protocolos/{protocoloId}', { params: { path: { protocoloId: id.value } } })), enabled: computed(() => !criando.value) });
const p = computed(() => q.data.value?.dado);
const formularios = useQuery({ queryKey: ['formularios'], queryFn: () => ok(api().GET('/v1/formularios', { params: { query: { limite: 100 } } })) });
const formsCheckin = computed(() => (formularios.data.value?.itens ?? []).filter((f) => f.finalidade !== 'CADASTRO'));

// ── Edição ──
interface Rascunho { nome: string; descricao: string; duracaoDias: number; checkins: Array<{ dias: string; horario: string; formularioId: string; lembreteAposHoras: number | null; expiraAposHoras: number }>; orientacoes: Array<{ dia: number; horario: string; texto: string }>; regras: Array<{ id: string; tipo: 'RESPOSTA' | 'CHECKIN_EXPIRADO'; campo: string; operador: string; valor: string; severidade: 'BAIXA' | 'MEDIA' | 'ALTA'; mensagem: string }> }
const editando = ref(false);
const r = reactive<Rascunho>({ nome: '', descricao: '', duracaoDias: 7, checkins: [], orientacoes: [], regras: [] });
const erros = ref<string[]>([]);
const conflito = ref(false);
function carregarRascunho(x?: Protocolo) {
  Object.assign(r, {
    nome: x?.nome ?? '', descricao: x?.descricao ?? '', duracaoDias: x?.duracaoDias ?? 7,
    checkins: x?.checkins.map((c) => ({ dias: escreverDias(c.dias), horario: c.horario, formularioId: c.formulario.id, lembreteAposHoras: c.lembreteAposHoras ?? null, expiraAposHoras: c.expiraAposHoras })) ?? [{ dias: '1-7', horario: '09:00', formularioId: formsCheckin.value[0]?.id ?? '', lembreteAposHoras: 4, expiraAposHoras: 14 }],
    orientacoes: x?.orientacoes.map((o) => ({ ...o })) ?? [],
    regras: x?.regrasAlerta.map((g) => ({ id: g.id, tipo: g.tipo, campo: g.campo ?? '', operador: g.operador ?? 'IGUAL', valor: g.valor === undefined ? '' : String(g.valor), severidade: g.severidade, mensagem: g.mensagem })) ?? [{ id: 'sem_resposta', tipo: 'CHECKIN_EXPIRADO', campo: '', operador: 'IGUAL', valor: '', severidade: 'MEDIA', mensagem: 'Check-in não respondido' }],
  });
  erros.value = []; conflito.value = false;
}
if (criando.value) { carregarRascunho(); editando.value = true; }
watch(formsCheckin, (fs) => { for (const c of r.checkins) if (!c.formularioId && fs[0]) c.formularioId = fs[0].id; });
function editar() { carregarRascunho(p.value); editando.value = true; }

const camposDosForms = computed<CampoFormulario[]>(() => {
  const ids = new Set(r.checkins.map((c) => c.formularioId));
  return formsCheckin.value.filter((f) => ids.has(f.id)).flatMap((f) => f.campos).filter((c) => !['INFORMACAO', 'FOTO', 'TEXTO', 'TEXTO_LONGO'].includes(c.tipo as string));
});
const campoPorId = (cid: string) => camposDosForms.value.find((c) => c.id === cid);
function valorTipado(cid: string, v: string): unknown {
  const c = campoPorId(cid);
  if (c?.tipo === 'NUMERO' || c?.tipo === 'ESCALA') return Number(v.replace(',', '.'));
  if (c?.tipo === 'SIM_NAO') return v === 'true';
  return v;
}
const idDaMensagem = (m: string) => m.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'regra';

function montar(): ProtocoloEntrada | null {
  const e: string[] = [];
  if (r.nome.trim().length < 2) e.push('Informe o nome.');
  if (!(r.duracaoDias >= 1 && r.duracaoDias <= 365)) e.push('Duração entre 1 e 365 dias.');
  const checkins = r.checkins.map((c, i) => {
    const dias = lerDias(c.dias, r.duracaoDias);
    if (!dias) e.push(`Check-in ${i + 1}: dias inválidos (use algo como "1-7" ou "1,3,5"; até o dia ${r.duracaoDias}).`);
    const f = formsCheckin.value.find((x) => x.id === c.formularioId);
    if (!f) e.push(`Check-in ${i + 1}: escolha o formulário.`);
    return { dias: dias ?? [], horario: c.horario, formulario: { id: c.formularioId, versao: f?.versao ?? 1 }, lembreteAposHoras: c.lembreteAposHoras || null, expiraAposHoras: c.expiraAposHoras };
  });
  const usados = new Set<string>();
  const regrasAlerta = r.regras.map((g, i) => {
    let rid = g.id || idDaMensagem(g.mensagem);
    while (usados.has(rid)) rid = `${rid}_${i}`;
    usados.add(rid);
    if (!g.mensagem.trim()) e.push(`Regra ${i + 1}: escreva a mensagem.`);
    if (g.tipo === 'RESPOSTA' && (!g.campo || g.valor === '')) e.push(`Regra ${i + 1}: escolha a pergunta e o valor.`);
    return g.tipo === 'RESPOSTA'
      ? { id: rid, tipo: g.tipo, campo: g.campo, operador: g.operador as never, valor: valorTipado(g.campo, g.valor) as never, severidade: g.severidade, mensagem: g.mensagem.trim() }
      : { id: rid, tipo: g.tipo, severidade: g.severidade, mensagem: g.mensagem.trim() };
  });
  r.orientacoes.forEach((o, i) => { if (o.dia > r.duracaoDias || !o.texto.trim()) e.push(`Orientação ${i + 1}: dia até ${r.duracaoDias} e texto obrigatório.`); });
  erros.value = e;
  if (e.length) return null;
  return { nome: r.nome.trim(), descricao: r.descricao.trim() || null, duracaoDias: r.duracaoDias, checkins, orientacoes: r.orientacoes.map((o) => ({ ...o, texto: o.texto.trim() })), regrasAlerta };
}
const salvar = useMutation({
  mutationFn: async (corpo: ProtocoloEntrada) => criando.value
    ? comEtag(api().POST('/v1/protocolos', { body: corpo }))
    : comEtag(api().PUT('/v1/protocolos/{protocoloId}', { params: { path: { protocoloId: id.value }, header: { 'If-Match': q.data.value?.etag ?? '' } }, body: corpo })),
  onSuccess: async (res) => {
    await qc.invalidateQueries({ queryKey: ['protocolos'] });
    editando.value = false;
    if (criando.value) await router.replace(`/protocolos/${res.dado.id}`);
    else qc.setQueryData(['protocolo', id], res);
  },
  onError: (e) => { if (e instanceof ErroApi && e.codigo === 'CONFLITO_VERSAO') conflito.value = true; if (e instanceof ErroApi && e.status === 422) erros.value = e.campos.map((c) => `${c.campo}: ${c.mensagem}`); },
});
function enviar() { const c = montar(); if (c) salvar.mutate(c); }
const arquivar = useMutation({
  mutationFn: () => ok(api().POST('/v1/protocolos/{protocoloId}/arquivar', { params: { path: { protocoloId: id.value } } })),
  onSuccess: () => { void q.refetch(); void qc.invalidateQueries({ queryKey: ['protocolos'] }); },
});
const nomeForm = (fid: string) => formsCheckin.value.find((f) => f.id === fid)?.titulo ?? fid;
const OPERADORES = [['IGUAL', 'igual a'], ['DIFERENTE', 'diferente de'], ['MAIOR_OU_IGUAL', 'maior ou igual a'], ['MENOR_OU_IGUAL', 'menor ou igual a'], ['CONTEM', 'contém']];
const entrada = 'min-h-11 rounded-lg border-2 border-zinc-300 bg-white px-3 dark:border-zinc-600 dark:bg-zinc-800';
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-4">
    <p v-if="!criando && q.isPending.value">{{ t('app.carregando') }}</p>
    <Aviso v-else-if="q.error.value" tipo="erro">{{ msg(q.error.value)?.texto }}</Aviso>

    <!-- Visualização -->
    <template v-else-if="!editando && p">
      <header class="flex flex-wrap items-start justify-between gap-2">
        <div><h1 class="text-2xl font-bold">{{ p.nome }}</h1><p class="text-sm text-secundario">Versão {{ p.versao }} · {{ p.duracaoDias }} dias{{ p.status === 'ARQUIVADO' ? ' · arquivado' : '' }}</p></div>
        <div class="flex gap-2">
          <Botao v-if="p.acoesPermitidas.includes('EDITAR')" variante="secundario" @click="editar">Editar</Botao>
          <Botao v-if="p.acoesPermitidas.includes('ARQUIVAR')" variante="fantasma" :carregando="arquivar.isPending.value" @click="arquivar.mutate()">Arquivar</Botao>
        </div>
      </header>
      <p v-if="p.descricao">{{ p.descricao }}</p>
      <Cartao><h2 class="mb-2 font-bold">{{ capitalizar(termo('checkin').plural) }}</h2>
        <p v-for="(c, i) in p.checkins" :key="i">Dias {{ escreverDias(c.dias) }} às {{ c.horario }} · {{ nomeForm(c.formulario.id) }} (v{{ c.formulario.versao }}) · expira em {{ c.expiraAposHoras }} h<span v-if="c.lembreteAposHoras">, lembrete após {{ c.lembreteAposHoras }} h</span></p></Cartao>
      <Cartao v-if="p.orientacoes.length"><h2 class="mb-2 font-bold">Orientações</h2>
        <p v-for="(o, i) in p.orientacoes" :key="i" class="py-1"><strong>Dia {{ o.dia }}, {{ o.horario }}:</strong> {{ o.texto }}</p></Cartao>
      <Cartao><h2 class="mb-2 font-bold">Regras de alerta</h2>
        <p v-for="g in p.regrasAlerta" :key="g.id" class="py-1"><strong>{{ g.severidade }}</strong> · {{ g.tipo === 'CHECKIN_EXPIRADO' ? 'quando não for respondido' : `${g.campo} ${OPERADORES.find((o) => o[0] === g.operador)?.[1] ?? g.operador} ${g.valor}` }} → “{{ g.mensagem }}”</p></Cartao>
    </template>

    <!-- Edição -->
    <form v-else-if="editando" class="flex flex-col gap-4" novalidate @submit.prevent="enviar">
      <h1 class="text-2xl font-bold">{{ criando ? capitalizar(novo(termo('protocolo'))) : `Editar ${p?.nome}` }}</h1>
      <Aviso v-if="!criando">Salvar publica a versão {{ (p?.versao ?? 0) + 1 }}. {{ capitalizar(termo('acompanhamento').plural) }} em andamento continuam na versão {{ p?.versao }}.</Aviso>
      <Conflito v-if="conflito" @recarregar="async () => { await q.refetch(); editar(); }" />
      <Aviso v-if="erros.length" tipo="erro"><ul class="list-disc pl-5"><li v-for="e in erros" :key="e">{{ e }}</li></ul></Aviso>
      <CampoTexto v-model="r.nome" rotulo="Nome" obrigatorio />
      <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Descrição</span><textarea v-model="r.descricao" rows="2" :class="entrada" class="py-2" /></label>
      <label class="flex flex-col gap-1.5"><span class="text-sm font-medium">Duração (dias)</span><input v-model.number="r.duracaoDias" type="number" min="1" max="365" :class="entrada" class="w-32" /></label>

      <fieldset class="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <legend class="px-1 font-bold">{{ capitalizar(termo('checkin').plural) }}</legend>
        <div v-for="(c, i) in r.checkins" :key="i" class="grid gap-2 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm">Dias (ex.: 1-7)<input v-model="c.dias" :class="entrada" /></label>
          <label class="flex flex-col gap-1 text-sm">Horário (fuso da organização)<input v-model="c.horario" type="time" :class="entrada" /></label>
          <label class="flex flex-col gap-1 text-sm sm:col-span-2">Formulário<select v-model="c.formularioId" :class="entrada"><option v-for="f in formsCheckin" :key="f.id" :value="f.id">{{ f.titulo }} (v{{ f.versao }})</option></select></label>
          <label class="flex flex-col gap-1 text-sm">Lembrete após (h)<input v-model.number="c.lembreteAposHoras" type="number" min="1" max="48" :class="entrada" /></label>
          <label class="flex flex-col gap-1 text-sm">Expira após (h)<input v-model.number="c.expiraAposHoras" type="number" min="1" max="72" :class="entrada" /></label>
          <Botao v-if="r.checkins.length > 1" variante="fantasma" @click="r.checkins.splice(i, 1)"><Trash2 class="size-4" /> Remover</Botao>
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <legend class="px-1 font-bold">Orientações programadas</legend>
        <div v-for="(o, i) in r.orientacoes" :key="i" class="flex flex-wrap items-end gap-2">
          <label class="flex flex-col gap-1 text-sm">Dia<input v-model.number="o.dia" type="number" min="0" :max="r.duracaoDias" :class="entrada" class="w-20" /></label>
          <label class="flex flex-col gap-1 text-sm">Horário<input v-model="o.horario" type="time" :class="entrada" /></label>
          <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm">Texto<input v-model="o.texto" maxlength="1000" :class="entrada" /></label>
          <button type="button" class="p-2" aria-label="Remover orientação" @click="r.orientacoes.splice(i, 1)"><Trash2 class="size-5" /></button>
        </div>
        <Botao variante="fantasma" @click="r.orientacoes.push({ dia: 0, horario: '09:00', texto: '' })"><Plus class="size-4" /> Orientação</Botao>
      </fieldset>

      <fieldset class="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <legend class="px-1 font-bold">Regras de alerta</legend>
        <p class="text-sm text-zinc-600 dark:text-zinc-300">A mensagem descreve o que foi relatado (“Dor 8 ou mais relatada”). Não escreva conduta.</p>
        <div v-for="(g, i) in r.regras" :key="i" class="flex flex-col gap-2 border-t border-zinc-100 pt-3 first:border-0 first:pt-0 dark:border-zinc-700">
          <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1 text-sm">Quando<select v-model="g.tipo" :class="entrada"><option value="RESPOSTA">a resposta for</option><option value="CHECKIN_EXPIRADO">não responder</option></select></label>
            <template v-if="g.tipo === 'RESPOSTA'">
              <label class="flex flex-col gap-1 text-sm">Pergunta<select v-model="g.campo" :class="entrada"><option value="">—</option><option v-for="c in camposDosForms" :key="c.id" :value="c.id">{{ c.rotulo }}</option></select></label>
              <label class="flex flex-col gap-1 text-sm">Operador<select v-model="g.operador" :class="entrada"><option v-for="[v, l] in OPERADORES" :key="v" :value="v">{{ l }}</option></select></label>
              <label class="flex flex-col gap-1 text-sm">Valor
                <select v-if="campoPorId(g.campo)?.opcoes" v-model="g.valor" :class="entrada"><option v-for="o in campoPorId(g.campo)!.opcoes" :key="o.valor" :value="o.valor">{{ o.rotulo }}</option></select>
                <select v-else-if="campoPorId(g.campo)?.tipo === 'SIM_NAO'" v-model="g.valor" :class="entrada"><option value="true">Sim</option><option value="false">Não</option></select>
                <input v-else v-model="g.valor" inputmode="decimal" :class="entrada" class="w-24" />
              </label>
            </template>
            <label class="flex flex-col gap-1 text-sm">Severidade<select v-model="g.severidade" :class="entrada"><option value="ALTA">Alta</option><option value="MEDIA">Média</option><option value="BAIXA">Baixa</option></select></label>
            <button type="button" class="p-2" aria-label="Remover regra" @click="r.regras.splice(i, 1)"><Trash2 class="size-5" /></button>
          </div>
          <label class="flex flex-col gap-1 text-sm">Mensagem do alerta<input v-model="g.mensagem" maxlength="200" :class="entrada" /></label>
        </div>
        <Botao variante="fantasma" @click="r.regras.push({ id: '', tipo: 'RESPOSTA', campo: '', operador: 'MAIOR_OU_IGUAL', valor: '', severidade: 'MEDIA', mensagem: '' })"><Plus class="size-4" /> Regra</Botao>
      </fieldset>

      <div class="flex gap-2">
        <Botao v-if="!criando" variante="secundario" @click="editando = false">Cancelar</Botao>
        <Botao tipo="submit" bloco :carregando="salvar.isPending.value">{{ criando ? 'Criar' : 'Publicar nova versão' }}</Botao>
      </div>
    </form>
  </div>
</template>
