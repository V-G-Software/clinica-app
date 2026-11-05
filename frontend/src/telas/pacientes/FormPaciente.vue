<script setup lang="ts">
// Formulário de paciente (novo e edição): pessoa ou animal conforme `relacoesPermitidas`,
// responsáveis/tutor e campos adicionais do formulário de cadastro da organização.
import { computed, reactive, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { Paciente, PacienteEntrada } from '@clinica/contrato-tipos';
import { api, ok } from '@/api';
import { useSessaoStore } from '@/sessao/store';
import { capitalizar } from '@/i18n/termos';
import { formatarTelefone, paraE164 } from '@/i18n/telefone';
import { useTermos } from '@/dados/util';
import { limparRespostas, validarTudo } from '@/ds/formulario/regras';
import CampoTexto from '@/ds/CampoTexto.vue';
import FormularioCompleto from '@/ds/formulario/FormularioCompleto.vue';
import Botao from '@/ds/Botao.vue';

const props = defineProps<{ inicial?: Paciente; enviando?: boolean; errosServidor?: Record<string, string> }>();
const emit = defineEmits<{ salvar: [PacienteEntrada] }>();
const sessao = useSessaoStore();
const termo = useTermos();
const cfg = computed(() => (sessao.manifesto?.modulos.find((m) => m.id === 'pacientes')?.config ?? {}) as { formularioCadastroId?: string | null; relacoesPermitidas?: string[] });
const relacoes = computed(() => cfg.value.relacoesPermitidas ?? ['PROPRIO']);
const aceitaAnimal = computed(() => relacoes.value.includes('ANIMAL'));
const aceitaPessoa = computed(() => relacoes.value.some((r) => r !== 'ANIMAL'));
const formCadastro = useQuery({
  queryKey: ['formulario', computed(() => cfg.value.formularioCadastroId)],
  queryFn: () => ok(api().GET('/v1/formularios/{formularioId}', { params: { path: { formularioId: cfg.value.formularioCadastroId! } } })),
  enabled: computed(() => !!cfg.value.formularioCadastroId),
});

const i = props.inicial;
const f = reactive({
  tipo: (i?.tipo ?? (aceitaPessoa.value ? 'PESSOA' : 'ANIMAL')) as 'PESSOA' | 'ANIMAL',
  nome: i?.nome ?? '', nomeSocial: i?.nomeSocial ?? '', dataNascimento: i?.dataNascimento ?? '',
  email: i?.contato.email ?? '', celular: formatarTelefone(i?.contato.celular),
  temResponsavel: !!i?.responsaveis.length,
  respNome: i?.responsaveis[0]?.nome ?? '', respParentesco: i?.responsaveis[0]?.parentesco ?? '',
  respEmail: i?.responsaveis[0]?.contato.email ?? '', respCelular: formatarTelefone(i?.responsaveis[0]?.contato.celular),
  campos: { ...(i?.camposAdicionais ?? {}) } as Record<string, unknown>,
});
watch(() => f.tipo, (t) => { if (t === 'ANIMAL') f.temResponsavel = true; });
if (f.tipo === 'ANIMAL') f.temResponsavel = true;
const erros = reactive<Record<string, string>>({});

function salvar() {
  for (const k of Object.keys(erros)) delete erros[k];
  const celular = f.celular ? paraE164(f.celular) : null;
  const respCelular = f.respCelular ? paraE164(f.respCelular) : null;
  if (f.nome.trim().length < 2) erros.nome = 'Informe o nome.';
  if (f.celular && !celular) erros.celular = 'Celular inválido. Ex.: (11) 98888-7777';
  if (f.respCelular && !respCelular) erros.respCelular = 'Celular inválido.';
  if (f.temResponsavel && f.respNome.trim().length < 2) erros.respNome = `Informe o nome do ${termo.value('responsavel').singular}.`;
  const algumContato = f.email || celular || (f.temResponsavel && (f.respEmail || respCelular));
  if (!algumContato) erros.contato = 'Informe ao menos um e-mail ou celular.';
  const camposForm = formCadastro.data.value?.campos ?? [];
  const errosCampos = validarTudo(camposForm, f.campos);
  if (Object.keys(erros).length || Object.keys(errosCampos).length) { Object.assign(erros, Object.fromEntries(Object.entries(errosCampos).map(([k, v]) => [`camposAdicionais.${k}`, v]))); return; }
  emit('salvar', {
    tipo: f.tipo, nome: f.nome.trim(), nomeSocial: f.nomeSocial.trim() || null, dataNascimento: f.dataNascimento || null,
    contato: { email: f.email.trim().toLowerCase() || null, celular },
    camposAdicionais: limparRespostas(camposForm, f.campos) as never,
    responsaveis: f.temResponsavel ? [{ nome: f.respNome.trim(), parentesco: f.respParentesco.trim() || null, contato: { email: f.respEmail.trim().toLowerCase() || null, celular: respCelular } }] : [],
  });
}
const erro = (k: string) => props.errosServidor?.[k] ?? erros[k];
const errosAdicionais = computed(() => Object.fromEntries(Object.entries({ ...erros, ...props.errosServidor }).filter(([k]) => k.startsWith('camposAdicionais.')).map(([k, v]) => [k.slice(17), v])));
</script>
<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="salvar">
    <div v-if="aceitaAnimal && aceitaPessoa && !inicial" class="flex gap-2" role="radiogroup" aria-label="Tipo">
      <button v-for="[v, r] in [['PESSOA', 'Pessoa'], ['ANIMAL', 'Animal']] as const" :key="v" type="button" role="radio" :aria-checked="f.tipo === v" class="min-h-11 flex-1 rounded-xl border-2 font-medium" :class="f.tipo === v ? 'border-acao bg-acao text-acao-texto' : 'border-zinc-300'" @click="f.tipo = v">{{ r }}</button>
    </div>
    <CampoTexto v-model="f.nome" rotulo="Nome" obrigatorio :erro="erro('nome')" autocomplete="off" />
    <CampoTexto v-if="f.tipo === 'PESSOA'" v-model="f.nomeSocial" rotulo="Nome social (opcional)" autocomplete="off" />
    <CampoTexto v-model="f.dataNascimento" rotulo="Data de nascimento (opcional)" tipo="date" :erro="erro('dataNascimento')" />
    <template v-if="f.tipo === 'PESSOA'">
      <CampoTexto v-model="f.email" rotulo="E-mail" tipo="email" inputmode="email" autocomplete="off" :erro="erro('contato.email')" />
      <CampoTexto v-model="f.celular" rotulo="Celular" inputmode="tel" autocomplete="off" :erro="erro('celular') ?? erro('contato.celular')" />
      <label v-if="relacoes.includes('DEPENDENTE')" class="flex items-center gap-3"><input v-model="f.temResponsavel" type="checkbox" class="size-5" /> Tem {{ termo('responsavel').singular }} (menor de idade ou dependente)</label>
    </template>
    <fieldset v-if="f.temResponsavel" class="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <legend class="px-1 font-bold">{{ capitalizar(termo('responsavel').singular) }}</legend>
      <CampoTexto v-model="f.respNome" rotulo="Nome" :erro="erro('respNome') ?? erro('responsaveis.0.nome')" autocomplete="off" />
      <CampoTexto v-model="f.respParentesco" rotulo="Parentesco (opcional)" autocomplete="off" />
      <CampoTexto v-model="f.respEmail" rotulo="E-mail" tipo="email" inputmode="email" autocomplete="off" />
      <CampoTexto v-model="f.respCelular" rotulo="Celular" inputmode="tel" autocomplete="off" :erro="erro('respCelular')" />
    </fieldset>
    <p v-if="erro('contato')" class="text-sm text-erro" role="alert">{{ erro('contato') }}</p>
    <fieldset v-if="formCadastro.data.value" class="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <legend class="px-1 font-bold">{{ formCadastro.data.value.titulo }}</legend>
      <FormularioCompleto v-model="f.campos" :campos="formCadastro.data.value.campos" :erros="errosAdicionais" />
    </fieldset>
    <Botao tipo="submit" bloco :carregando="enviando">Salvar</Botao>
  </form>
</template>
